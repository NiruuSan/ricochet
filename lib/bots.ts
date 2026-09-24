import { database, type Statement } from "@/db/raw";
import { initial, simulate, simulateShot, ShotError, type Game } from "./engine";
import { GameError, settle, startMatch } from "./matches";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";
import { rowsFor } from "./secret-rows";
import { registerForTournament } from "./tournaments";

// The house's practice opponents.
//
// Until there are enough people on the site for a seat to be taken quickly, the
// house sits a few players of its own at the tables. They are ordinary rows in
// `players` carrying `bot = 1`, they hold devnet SOL topped up from the
// treasury, and they play through the same engine every human plays through —
// the same boards, the same rounds, the same settlement.
//
// Three things keep them honest:
//
// - they never touch anything the house pays for out of its own pocket: no
//   cashback, no quests, no daily gems, no referral, and the weekly race skips
//   them, so a bot can never take a prize away from a person;
// - they are a switch. Off, nothing new is entered and the site is people only;
// - they carry a flag, so an administrator always sees which players they are,
//   and `removeBots` takes them off the site in one call at launch.
//
// A bot never goes through the shot-report path, so the anti-cheat never has an
// opinion about them: they are not pretending to be a browser.

const SETTING = "bots";
/** The most a single tick will do, so a page load never waits on the house. */
const WORK_PER_TICK = 3;
/** One instance ticks at most this often; the rest return immediately. */
const TICK_EVERY = 20_000;
const SOL = 1_000_000_000;

/**
 * How well a bot plays. `tries` is how many angles it looks at before shooting
 * and `wobble` is how far its hand strays from the one it picked: a rookie
 * glances at three and misses by a dozen degrees, a sharp one reads the board.
 */
export const SKILLS = {
  rookie: { label: "Rookie", tries: 3, wobble: 13, blunder: 0.22 },
  steady: { label: "Steady", tries: 9, wobble: 5, blunder: 0.07 },
  sharp: { label: "Sharp", tries: 18, wobble: 1.5, blunder: 0.02 },
} as const;
export type BotSkill = keyof typeof SKILLS;
export const SKILL_ORDER: BotSkill[] = ["rookie", "steady", "sharp"];

/** The names the house's players go by. One per bot, in this order. */
const ROSTER = [
  "Bumper", "Cinder", "Halcyon", "Juniper", "Karst", "Lumen", "Mistral", "Nimbus",
  "Onyx", "Peregrine", "Quill", "Ridge", "Sable", "Tessellate", "Umbra", "Vellum",
  "Wren", "Xenon", "Yarrow", "Zephyr",
] as const;

export type BotConfig = {
  /** Off means nothing new is entered; runs already under way still finish. */
  enabled: boolean;
  /** How many of them sit on the site. */
  count: number;
  /** Which skills they are drawn from, in the order the roster is filled. */
  skills: BotSkill[];
  /** Stakes a bot will take a seat at, in lamports. */
  stakes: number[];
  /** Topped up from the treasury whenever a bot falls below this. */
  floor: number;
  /** Topped up to this much. */
  topUp: number;
  /** Bots enter tournaments on their own while this is on. */
  tournaments: boolean;
};

const DEFAULTS: BotConfig = {
  enabled: false,
  count: 6,
  skills: ["rookie", "steady", "sharp"],
  stakes: [SOL / 100, SOL / 20, SOL / 10],
  floor: SOL / 2,
  topUp: 5 * SOL,
  tournaments: true,
};

export const botId = (n: number) => `bot:${ROSTER[n].toLowerCase()}`;
export const MAX_BOTS = ROSTER.length;

/** The switch and its settings, as an administrator left them. */
export async function botConfig(): Promise<BotConfig> {
  const row = await database().prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING).first<{ value: string }>();
  if (!row) return DEFAULTS;
  try {
    const saved = JSON.parse(row.value) as Partial<BotConfig>;
    return {
      ...DEFAULTS,
      ...saved,
      count: Math.max(0, Math.min(MAX_BOTS, Math.floor(Number(saved.count ?? DEFAULTS.count)))),
      skills: (saved.skills ?? DEFAULTS.skills).filter((s): s is BotSkill => s in SKILLS),
      stakes: (saved.stakes ?? DEFAULTS.stakes).filter((s) => Number.isFinite(s) && s > 0),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Administrator: changes the settings, and records who changed them. */
export async function setBotConfig(adminUid: string, patch: Partial<BotConfig>, now = Date.now()) {
  const next: BotConfig = { ...(await botConfig()), ...patch };
  if (!next.skills.length) next.skills = DEFAULTS.skills;
  if (!next.stakes.length) next.stakes = DEFAULTS.stakes;
  next.count = Math.max(0, Math.min(MAX_BOTS, Math.floor(next.count)));
  const db = database();
  await db.batch([
    db
      .prepare("INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated = excluded.updated")
      .bind(SETTING, JSON.stringify(next), adminUid, now),
    db
      .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'bots', 'bots', ?, ?)")
      .bind(crypto.randomUUID(), adminUid, `Bots ${next.enabled ? "on" : "off"} · ${next.count} on the site`, now),
  ]);
  if (next.enabled) await ensureBots(now);
  return next;
}

/** The skill a bot plays at: fixed by its place in the roster, so it never changes. */
export const skillOf = (index: number, skills: BotSkill[]) => skills[index % skills.length];

export type BotRow = { id: string; name: string; bot: number; balance: number; sol: number; matches: number; wins: number; skill: BotSkill };

/** Everyone the house has sat at the tables, with what they have and how they have done. */
export async function bots(): Promise<BotRow[]> {
  const config = await botConfig();
  const { results } = await database()
    .prepare(
      `SELECT p.id, p.name, p.bot, p.balance,
         COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS sol,
         (SELECT COUNT(*) FROM matches m WHERE m.settled = 1 AND m.cancelled = 0 AND (m.p1 = p.id OR m.p2 = p.id)) AS matches,
         (SELECT COUNT(*) FROM matches m WHERE m.settled = 1 AND m.winner = p.id) AS wins
       FROM players p WHERE p.bot = 1 AND p.deleted IS NULL ORDER BY p.created`,
    )
    .all<Omit<BotRow, "skill">>();
  return results.map((row) => ({ ...row, skill: skillFor(row.id, config) }));
}

/**
 * Brings the roster to the configured size and keeps their wallets funded from
 * the treasury. Bots past the size stay on the site but stop entering anything,
 * because a row that played matches cannot simply disappear from them.
 */
export async function ensureBots(now = Date.now()) {
  const config = await botConfig();
  const db = database();
  const { results: existing } = await db.prepare("SELECT id FROM players WHERE bot = 1").all<{ id: string }>();
  const have = new Set(existing.map((row) => row.id));
  const ops: Statement[] = [];
  for (let i = 0; i < config.count; i++) {
    const id = botId(i);
    if (have.has(id)) continue;
    ops.push(
      db
        .prepare("INSERT INTO players(id, name, balance, created, last_seen, bot) VALUES(?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET bot = 1, deleted = NULL")
        // Older rows first, so the roster reads in the order it was filled.
        .bind(id, ROSTER[i], 5_000, now - (MAX_BOTS - i) * 3_600_000, now),
    );
  }
  if (ops.length) await db.batch(ops);
  await fundBots(now);
}

/** Tops up every bot the treasury can afford to, and says how much it moved. */
export async function fundBots(now = Date.now()) {
  const config = await botConfig();
  const db = database();
  const { results } = await db
    .prepare(
      `SELECT p.id, COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS sol
       FROM players p WHERE p.bot = 1 AND p.deleted IS NULL`,
    )
    .all<{ id: string; sol: number }>();
  const short = results.filter((row) => Number(row.sol) < config.floor);
  if (!short.length) return 0;
  const house = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(HOUSE)).first<{ balance: number }>();
  let left = Number(house?.balance ?? 0);
  let moved = 0;
  for (const row of short) {
    const amount = config.topUp - Number(row.sol);
    // The treasury pays for the practice; it never goes short to do it.
    if (amount <= 0 || amount > left) continue;
    await Promise.all([ensureCashAccount(row.id), ensureCashAccount(HOUSE)]);
    const reference = `bot-funding:${row.id}:${now}`;
    await db.batch([
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:house`, cashAccountId(HOUSE), -amount, reference, now),
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:bot`, cashAccountId(row.id), amount, reference, now),
    ]);
    left -= amount;
    moved += amount;
  }
  return moved;
}

/** A small deterministic number from a string, so a bot's pace never jitters. */
function hashed(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** The angle a bot of this skill would take on this board. */
export function pickAngle(game: Game, skill: BotSkill, ruleset: number, rows: ReturnType<typeof rowsFor>, roll: () => number) {
  const { tries, wobble, blunder } = SKILLS[skill];
  // Now and again it simply shoots: a player who is not very good does that.
  if (roll() < blunder) return 12 + roll() * 156;
  let best = 90;
  let bestValue = -Infinity;
  for (let i = 0; i < tries; i++) {
    // Spread the candidates across the board rather than clustering them.
    const angle = 12 + ((i + roll()) / tries) * 156;
    try {
      const after = simulate(game, angle, ruleset, rows);
      // What a shot is worth: the points it made, and the bricks it took away.
      const value = after.score - game.score + (game.bricks.length - after.bricks.length) * 40 + (after.bonus ? 400 : 0) - (after.over ? 900 : 0);
      if (value > bestValue) {
        bestValue = value;
        best = angle;
      }
    } catch {
      // A shot the engine refuses is simply not a candidate.
    }
  }
  const strayed = best + (roll() - 0.5) * 2 * wobble;
  return Math.min(171, Math.max(9, strayed));
}

/** Plays a whole run in memory: the final board, and every angle it took. */
export function playRun(seed: number, ruleset: number, rowKey: string | null, skill: BotSkill, roll: () => number) {
  const rows = rowsFor(ruleset, rowKey);
  let game = initial(seed, rows);
  const angles: { angle: number; ticks: number }[] = [];
  let clears = 0;
  // A board that will not end is not a reason to hold a request open.
  for (let shot = 0; shot < 200 && !game.over; shot++) {
    const angle = pickAngle(game, skill, ruleset, rows, roll);
    try {
      const { game: next, ticks } = simulateShot(game, angle, ruleset, rows);
      game = next;
      angles.push({ angle, ticks });
      if (next.bonus) clears++;
    } catch (e) {
      if (e instanceof ShotError) break;
      throw e;
    }
  }
  return { game, angles, clears };
}

/** Writes a finished run and the shots that made it, so it replays like any other. */
function saveRun(table: "runs" | "tournament_entries", id: string, runKey: string, started: number, run: ReturnType<typeof playRun>, now: number) {
  const db = database();
  const ops: Statement[] = run.angles.map((shot, i) =>
    db
      .prepare("INSERT OR IGNORE INTO run_shots(run_key, revision, angle, created, ticks, aim) VALUES(?, ?, ?, ?, ?, NULL)")
      // The shots are spread across the time the run was supposed to take.
      .bind(runKey, i, shot.angle, started + Math.round(((now - started) * (i + 1)) / (run.angles.length + 1)), shot.ticks),
  );
  ops.push(
    db
      .prepare(`UPDATE ${table} SET state = ?, score = ?, done = 1, clears = ?, finished = ?, revision = ? WHERE id = ? AND done = 0`)
      .bind(JSON.stringify(run.game), run.game.score, run.clears, now, run.angles.length, id),
  );
  return db.batch(ops);
}

/** Where a bot's own pace comes from: a run takes between one and five minutes. */
const runTime = (key: string) => 60_000 + hashed(key) * 240_000;

/**
 * One turn of the house's players. Bounded on purpose: it runs inside ordinary
 * requests, so it does a little and comes back.
 */
export async function tickBots(now = Date.now()) {
  const config = await botConfig();
  if (!config.enabled || !config.count) return { played: 0, entered: 0, joined: 0 };
  const db = database();
  let budget = WORK_PER_TICK;
  const done = { played: 0, entered: 0, joined: 0 };

  // Runs that have had their time: play them out and settle the match.
  const { results: running } = await db
    .prepare(
      `SELECT r.id, r.match_id, r.created, m.seed, m.ruleset, m.row_key, m.asset, p.id AS uid
       FROM runs r JOIN matches m ON m.id = r.match_id JOIN players p ON p.id = r.user_id
       WHERE p.bot = 1 AND r.done = 0 ORDER BY r.created LIMIT 8`,
    )
    .all<{ id: string; match_id: string; created: number; seed: number; ruleset: number; row_key: string | null; uid: string }>();
  for (const run of running) {
    if (budget <= 0) break;
    if (now - run.created < runTime(run.id)) continue;
    const skill = skillFor(run.uid, config);
    const played = playRun(run.seed, run.ruleset, run.row_key, skill, seeded(run.id));
    await saveRun("runs", run.id, `m-${run.id}`, run.created, played, now);
    await settle(run.match_id).catch((e) => console.error("A bot's match could not settle", e));
    budget--;
    done.played++;
  }

  // Tournament runs, once the bot's own start time has come.
  if (config.tournaments) {
    const { results: entries } = await db
      .prepare(
        `SELECT e.id, e.tournament_id, e.registered, t.seed, t.ruleset, t.row_key, t.starts_at, t.ends_at, p.id AS uid
         FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id JOIN players p ON p.id = e.user_id
         WHERE p.bot = 1 AND e.done = 0 AND t.status = 'running' AND t.starts_at <= ? AND t.ends_at > ? LIMIT 8`,
      )
      .bind(now, now)
      .all<{ id: string; tournament_id: string; registered: number; seed: number; ruleset: number; row_key: string | null; starts_at: number; ends_at: number; uid: string }>();
    for (const entry of entries) {
      if (budget <= 0) break;
      // Somewhere in the first two thirds of the window, then a run's length.
      const window = entry.ends_at - entry.starts_at;
      const begins = entry.starts_at + hashed(entry.id) * window * 0.6;
      if (now < begins + runTime(entry.id)) continue;
      const skill = skillFor(entry.uid, config);
      const played = playRun(entry.seed, entry.ruleset, entry.row_key, skill, seeded(entry.id));
      await db.prepare("UPDATE tournament_entries SET started = COALESCE(started, ?) WHERE id = ?").bind(Math.round(begins), entry.id).run();
      await saveRun("tournament_entries", entry.id, `t-${entry.id}`, Math.round(begins), played, now);
      budget--;
      done.played++;
    }
  }

  if (budget <= 0) return done;
  await ensureBots(now);
  // They are on the site, so they count as on the site.
  await db.prepare("UPDATE players SET last_seen = ? WHERE bot = 1 AND deleted IS NULL").bind(now).run();

  // A seat somebody opened and nobody took: sit down at it.
  const roster = await activeBots(config);
  const { results: seats } = await db
    .prepare(
      `SELECT m.id, m.stake, m.asset FROM matches m JOIN players p ON p.id = m.p1
       WHERE m.settled = 0 AND m.p2 IS NULL AND m.invite IS NULL AND p.bot = 0 AND m.created < ?
       ORDER BY m.created LIMIT 4`,
    )
    // A seat is given a moment to find a person before the house takes it.
    .bind(now - 45_000)
    .all<{ id: string; stake: number; asset: string }>();
  for (const seat of seats) {
    if (budget <= 0) break;
    const free = await freeBot(roster, seat.stake, seat.asset);
    if (!free) continue;
    try {
      await startMatch(free, seat.stake, seat.asset);
      budget--;
      done.joined++;
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
    }
  }

  // And a tournament that could use a field.
  if (config.tournaments && budget > 0) {
    const { results: cups } = await db
      .prepare(
        `SELECT t.id, t.entry_fee, t.asset, t.places, t.starts_at,
           (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants
         FROM tournaments t WHERE t.status = 'scheduled' AND t.starts_at > ? ORDER BY t.starts_at LIMIT 3`,
      )
      .bind(now)
      .all<{ id: string; entry_fee: number; asset: string; places: number; starts_at: number; entrants: number }>();
    for (const cup of cups) {
      if (budget <= 0) break;
      // A bot joins a cup only once the humans have had their chance at it.
      if (cup.entrants >= cup.places || now < cup.starts_at - 45 * 60_000) continue;
      const free = await freeBot(roster, cup.entry_fee, cup.asset, cup.id);
      if (!free) continue;
      try {
        await registerForTournament(free, cup.id, now);
        budget--;
        done.entered++;
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
    }
  }
  return done;
}

/** Administrator: puts the house's players on every seat a cup has left. */
export async function fillTournament(adminUid: string, idInput: unknown, now = Date.now()) {
  const id = String(idInput ?? "");
  const config = await botConfig();
  if (!config.count) throw new GameError("Turn the house players on first.");
  await ensureBots(now);
  const db = database();
  const cup = await db
    .prepare(
      `SELECT t.id, t.entry_fee, t.asset, t.places, t.status,
         (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants
       FROM tournaments t WHERE t.id = ?`,
    )
    .bind(id)
    .first<{ id: string; entry_fee: number; asset: string; places: number; status: string; entrants: number }>();
  if (!cup) throw new GameError("No such tournament.", 404);
  if (cup.status !== "scheduled") throw new GameError("Only a tournament that has not started can be filled.", 409);
  const roster = await activeBots(config);
  let filled = 0;
  for (const uid of roster) {
    if (cup.entrants + filled >= cup.places) break;
    try {
      await registerForTournament(uid, cup.id, now);
      filled++;
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
    }
  }
  await db
    .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'bots.fill', ?, ?, ?)")
    .bind(crypto.randomUUID(), adminUid, cup.id, `${filled} house ${filled === 1 ? "player" : "players"} entered`, now)
    .run();
  return { filled, entrants: cup.entrants + filled, places: cup.places };
}

/**
 * Launch day: takes the house's players off the site. Their rows stay, because
 * the matches they played are their opponents' history too, but they are closed,
 * their names are freed and whatever they hold goes back to the treasury.
 */
export async function removeBots(adminUid: string, now = Date.now()) {
  const db = database();
  const { results } = await db
    .prepare(
      `SELECT p.id, COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS sol
       FROM players p WHERE p.bot = 1 AND p.deleted IS NULL`,
    )
    .all<{ id: string; sol: number }>();
  let swept = 0;
  for (const bot of results) {
    const amount = Number(bot.sol);
    if (amount > 0) {
      await ensureCashAccount(HOUSE);
      const reference = `bot-return:${bot.id}:${now}`;
      await db.batch([
        db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:bot`, cashAccountId(bot.id), -amount, reference, now),
        db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:house`, cashAccountId(HOUSE), amount, reference, now),
      ]);
      swept += amount;
    }
    await db.prepare("UPDATE players SET deleted = ?, name = ?, bot = 1 WHERE id = ?").bind(now, `retired_${bot.id.slice(4, 12)}`, bot.id).run();
  }
  await setBotConfig(adminUid, { enabled: false, count: 0 }, now);
  await db
    .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'bots.remove', 'bots', ?, ?)")
    .bind(crypto.randomUUID(), adminUid, `${results.length} house players retired`, now)
    .run();
  return { retired: results.length, swept };
}

/** The bots currently in service: the first `count` of the roster. */
async function activeBots(config: BotConfig) {
  const { results } = await database().prepare("SELECT id FROM players WHERE bot = 1 AND deleted IS NULL").all<{ id: string }>();
  const live = new Set(results.map((row) => row.id));
  return Array.from({ length: config.count }, (_, i) => botId(i)).filter((id) => live.has(id));
}

const skillFor = (uid: string, config: BotConfig) => skillOf(Math.max(0, ROSTER.findIndex((name) => `bot:${name.toLowerCase()}` === uid)), config.skills);

/** The first bot with nothing on, enough money for the entry, and not already in. */
async function freeBot(roster: string[], stake: number, asset: string, tournamentId?: string) {
  const db = database();
  for (const uid of roster) {
    const busy = await db.prepare("SELECT 1 AS yes FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.user_id = ? AND r.done = 0 AND m.settled = 0").bind(uid).first();
    if (busy) continue;
    if (tournamentId) {
      const already = await db.prepare("SELECT 1 AS yes FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").bind(tournamentId, uid).first();
      if (already) continue;
    }
    if (asset === "devnet") {
      const account = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(uid)).first<{ balance: number }>();
      if (Number(account?.balance ?? 0) < stake) continue;
    } else {
      const player = await db.prepare("SELECT balance FROM players WHERE id = ?").bind(uid).first<{ balance: number }>();
      if (Number(player?.balance ?? 0) < stake) continue;
    }
    return uid;
  }
  return null;
}

/** A run's own dice: the same run always plays the same way. */
function seeded(key: string) {
  let state = Math.floor(hashed(key) * 2 ** 31) || 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

let lastTick = 0;
/**
 * Called from ordinary requests: runs the house's players now and then, never
 * blocks the caller, and never lets two ticks overlap on one instance.
 */
export function nudgeBots(now = Date.now()) {
  if (now - lastTick < TICK_EVERY) return;
  lastTick = now;
  void tickBots(now).catch((e) => console.error("The house players could not take their turn", e));
}

/** Tests: forget when this instance last ticked. */
export const forgetTick = () => void (lastTick = 0);
