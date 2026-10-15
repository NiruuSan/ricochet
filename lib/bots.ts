import { database, type Statement } from "@/db/raw";
import { initial, simulate, simulateShot, ShotError, type Game } from "./engine";
import { GameError, settle, takeSeat } from "./matches";
import { botSkillFor, ranksFor, setBotRatings } from "./ranked";
import { RANKED, seasonAt } from "./ranked-rules";
import { rankFor } from "./levels";
import { isLimited, rankBlock, rankLimitLabel, type RankLimits } from "./rank-limits";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";
import { rowsFor } from "./secret-rows";
import { endIfEveryoneFinished, escrowOwner, registerForTournament, tournamentStatus } from "./tournaments";

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

/** The names the first twenty of the house's players go by, in this order. */
const ROSTER = [
  "Bumper", "Cinder", "Halcyon", "Juniper", "Karst", "Lumen", "Mistral", "Nimbus",
  "Onyx", "Peregrine", "Quill", "Ridge", "Sable", "Tessellate", "Umbra", "Vellum",
  "Wren", "Xenon", "Yarrow", "Zephyr",
] as const;
/**
 * Past the first twenty, a name is made of two halves — Amber and Finch make
 * AmberFinch — and past every pairing, a number goes on the end. Every half is
 * short enough that the longest name still fits the twenty characters a player
 * name is allowed.
 */
const FIRST = ["Amber", "Basalt", "Cobalt", "Dusk", "Ember", "Flint", "Garnet", "Hazel", "Indigo", "Jasper", "Kestrel", "Lapis", "Marble", "Nova", "Opal", "Pewter", "Quartz", "Russet", "Slate", "Topaz", "Umber", "Violet", "Willow", "Zinc"];
const SECOND = ["Finch", "Heron", "Lynx", "Otter", "Raven", "Viper", "Falcon", "Badger", "Comet", "Pike", "Moth", "Ibis", "Marten", "Swift", "Crane", "Gecko", "Puma", "Orca", "Stoat", "Kite", "Bison", "Hare", "Newt", "Wolf"];

export type BotConfig = {
  /** Off means nothing new is entered; runs already under way still finish. */
  enabled: boolean;
  /** How many of them sit on the site. */
  count: number;
  /** Which skills they are drawn from, in the order the roster is filled. */
  skills: BotSkill[];
  /** Stakes a bot will take a seat at, in lamports. */
  stakes: number[];
  /** Topped up from the treasury whenever a bot falls below this, in lamports. */
  floor: number;
  /** How much each bot is given: its wallet is brought up to this, in lamports. */
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

/**
 * The most the house will seat, as a guard against a slip of the keyboard
 * rather than a design limit: every one of them is a row, a wallet and a turn
 * to take.
 */
export const MAX_BOTS = 1_000;
/** The most a bot can be given, and the least worth giving, in lamports. */
export const MAX_TOP_UP = 1_000 * SOL;
export const MIN_TOP_UP = SOL / 1_000;

/** The name of the bot in place `n` of the roster: always the same one. */
export function botName(n: number) {
  if (n < ROSTER.length) return ROSTER[n];
  const k = n - ROSTER.length;
  const first = k % FIRST.length;
  const round = Math.floor(k / FIRST.length);
  // Shifting the second half each round keeps neighbours from sharing it.
  const second = (first + round) % SECOND.length;
  const lap = Math.floor(k / (FIRST.length * SECOND.length));
  return `${FIRST[first]}${SECOND[second]}${lap ? lap + 1 : ""}`;
}
export const botId = (n: number) => `bot:${botName(n).toLowerCase()}`;

const places = new Map<string, number>();
let placed = 0;
/** Where a bot sits in the roster, from its id. */
function botIndex(uid: string) {
  const known = places.get(uid);
  if (known !== undefined) return known;
  while (placed < MAX_BOTS) {
    const id = botId(placed);
    places.set(id, placed++);
    if (id === uid) return placed - 1;
  }
  return 0;
}

/** A whole number of lamports within `[min, max]`, or the fallback when it is not a number at all. */
const lamports = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** The switch and its settings, as an administrator left them. */
export async function botConfig(): Promise<BotConfig> {
  const row = await database().prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING).first<{ value: string }>();
  if (!row) return DEFAULTS;
  try {
    const saved = JSON.parse(row.value) as Partial<BotConfig>;
    const topUp = lamports(saved.topUp, MIN_TOP_UP, MAX_TOP_UP, DEFAULTS.topUp);
    return {
      ...DEFAULTS,
      ...saved,
      count: Math.max(0, Math.min(MAX_BOTS, Math.floor(Number(saved.count ?? DEFAULTS.count)))),
      skills: (saved.skills ?? DEFAULTS.skills).filter((s): s is BotSkill => s in SKILLS),
      stakes: (saved.stakes ?? DEFAULTS.stakes).filter((s) => Number.isFinite(s) && s > 0),
      topUp,
      floor: lamports(saved.floor, 0, topUp, Math.min(DEFAULTS.floor, topUp)),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Administrator: changes the settings, and records who changed them. */
export async function setBotConfig(adminUid: string, patch: Partial<BotConfig>, now = Date.now()) {
  const current = await botConfig();
  // A field the request left out keeps its value rather than becoming undefined.
  const next: BotConfig = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  if (!next.skills.length) next.skills = DEFAULTS.skills;
  if (!next.stakes.length) next.stakes = DEFAULTS.stakes;
  next.count = Math.max(0, Math.min(MAX_BOTS, Math.floor(Number(next.count) || 0)));
  next.topUp = lamports(next.topUp, MIN_TOP_UP, MAX_TOP_UP, current.topUp);
  // Topping up starts below the amount given, never above it.
  next.floor = lamports(next.floor, 0, next.topUp, Math.min(current.floor, next.topUp));
  const db = database();
  await db.batch([
    db
      .prepare("INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated = excluded.updated")
      .bind(SETTING, JSON.stringify(next), adminUid, now),
    db
      .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'bots', 'bots', ?, ?)")
      .bind(crypto.randomUUID(), adminUid, `Bots ${next.enabled ? "on" : "off"} · ${next.count} on the site · ${next.topUp / SOL} SOL each, topped up below ${next.floor / SOL} SOL`, now),
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
  // Only the ones actually on the site count: a retired row keeps its flag, and
  // turning them back on has to bring it back rather than skip it.
  const { results: existing } = await db.prepare("SELECT id FROM players WHERE bot = 1 AND deleted IS NULL").all<{ id: string }>();
  const have = new Set(existing.map((row) => row.id));
  const missing = Array.from({ length: config.count }, (_, i) => i).filter((i) => !have.has(botId(i)));
  // Two plain statements rather than an upsert: inside an upsert, SQLite hands
  // its own conflict handling down to the `activity_signup` and
  // `activity_presence` triggers, and their `INSERT OR IGNORE` into
  // player_activity becomes an abort as soon as that row already exists.
  const seat = (i: number) => [
    db
      .prepare("INSERT OR IGNORE INTO players(id, name, balance, created, last_seen, bot) VALUES(?, ?, ?, ?, ?, 1)")
      // Older rows first, so the roster reads in the order it was filled.
      .bind(botId(i), botName(i), 5_000, now - (MAX_BOTS - i) * 60_000, now),
    // And back from retirement, under their own name again.
    db.prepare("UPDATE players SET bot = 1, deleted = NULL, name = ?, last_seen = ? WHERE id = ?").bind(botName(i), now, botId(i)),
  ];
  // A roster of hundreds is seated a few dozen at a time, one round trip each.
  for (let start = 0; start < missing.length; start += 40) {
    const chunk = missing.slice(start, start + 40);
    try {
      await db.batch(chunk.flatMap(seat));
    } catch (e) {
      if (!(e instanceof Error) || !/UNIQUE/i.test(e.message)) throw e;
      // Somebody took one of the names while that bot was away: it stays off
      // the site rather than holding up the rest of the roster.
      for (const i of chunk) {
        try {
          await db.batch(seat(i));
        } catch (err) {
          if (!(err instanceof Error) || !/UNIQUE/i.test(err.message)) throw err;
        }
      }
    }
  }
  await rateBots(config, now);
  await fundBots(now);
}

/**
 * Each bot in service holds the fixed ranked rating of its skill for the
 * season (lib/ranked.ts): written when it is missing or the skills changed,
 * so an ordinary turn reads one row set and writes nothing.
 */
async function rateBots(config: BotConfig, now: number) {
  const serving = await activeBots(config);
  if (!serving.length) return;
  const { results } = await database()
    .prepare("SELECT user_id, rating FROM ranked_ratings WHERE season = ? AND user_id IN (SELECT id FROM players WHERE bot = 1)")
    .bind(seasonAt(now))
    .all<{ user_id: string; rating: number }>();
  const held = new Map(results.map((row) => [row.user_id, row.rating]));
  const wrong = serving.map((id) => ({ id, skill: skillFor(id, config) })).filter((bot) => held.get(bot.id) !== RANKED.bots[bot.skill]);
  await setBotRatings(wrong, now);
}

/**
 * Gives the bots in service their money from the treasury, and says what moved.
 *
 * On an ordinary turn only a bot that has fallen below the floor is topped up.
 * `everyone` is the administrator's button: every bot below the amount it is
 * given is brought up to it, which is how a new amount reaches the whole
 * roster at once. Either way the treasury never goes short to do it: a bot it
 * cannot afford is left as it is and counted.
 */
export async function fundBots(now = Date.now(), { everyone = false } = {}) {
  const config = await botConfig();
  const db = database();
  const serving = new Set(await activeBots(config));
  const { results } = await db
    .prepare(
      `SELECT p.id, COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS sol
       FROM players p WHERE p.bot = 1 AND p.deleted IS NULL`,
    )
    .all<{ id: string; sol: number }>();
  const short = results.filter((row) => serving.has(row.id) && Number(row.sol) < (everyone ? config.topUp : config.floor));
  const result = { moved: 0, funded: 0, unaffordable: 0 };
  if (!short.length) return result;
  await db.batch(
    [HOUSE, ...short.map((row) => row.id)].map((uid) =>
      db.prepare("INSERT OR IGNORE INTO cash_accounts(id, network, user_id, created) VALUES(?, 'devnet', ?, ?)").bind(cashAccountId(uid), uid, now),
    ),
  );
  const house = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(HOUSE)).first<{ balance: number }>();
  let left = Number(house?.balance ?? 0);
  const grants: { id: string; amount: number }[] = [];
  for (const row of short) {
    const amount = config.topUp - Number(row.sol);
    if (amount <= 0) continue;
    if (amount > left) {
      result.unaffordable++;
      continue;
    }
    grants.push({ id: row.id, amount });
    left -= amount;
  }
  const ledger = (grant: { id: string; amount: number }) => {
    const reference = `bot-funding:${grant.id}:${now}`;
    return [
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:house`, cashAccountId(HOUSE), -grant.amount, reference, now),
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:bot`, cashAccountId(grant.id), grant.amount, reference, now),
    ];
  };
  const paid = (grants: { amount: number }[]) => {
    for (const grant of grants) {
      result.moved += grant.amount;
      result.funded++;
    }
  };
  for (let start = 0; start < grants.length; start += 40) {
    const chunk = grants.slice(start, start + 40);
    try {
      await db.batch(chunk.flatMap(ledger));
      paid(chunk);
    } catch {
      // Something else spent from the treasury in the meantime: the ledger
      // refuses to let it go below zero, so pay what it still can, one by one.
      for (const grant of chunk) {
        try {
          await db.batch(ledger(grant));
          paid([grant]);
        } catch {
          result.unaffordable++;
        }
      }
    }
  }
  return result;
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
 * One turn of the house's players. An ordinary turn is bounded on purpose: it
 * runs inside ordinary requests, so it does a little and comes back.
 *
 * An administrator's turn is not: `immediate` drops the pauses that make them
 * look human and the cap on how much one turn takes on, so every run waiting,
 * every open seat and every cup with room is dealt with. What stops it is the
 * clock — `seconds` — so one request never outlives the server's limit; a turn
 * that ran out of time says `more`, and the caller simply asks again.
 */
export async function tickBots(now = Date.now(), options: { budget?: number; immediate?: boolean; seconds?: number } = {}) {
  const config = await botConfig();
  if (!config.enabled || !config.count) return { played: 0, entered: 0, joined: 0, more: false };
  const db = database();
  const immediate = !!options.immediate;
  let budget = options.budget ?? (immediate ? Number.POSITIVE_INFINITY : WORK_PER_TICK);
  const stopAt = options.seconds ? Date.now() + options.seconds * 1000 : Number.POSITIVE_INFINITY;
  const done = { played: 0, entered: 0, joined: 0, more: false };
  /** Out of work allowed or out of time: whatever is left waits for the next turn. */
  const spent = () => {
    if (budget > 0 && Date.now() < stopAt) return false;
    done.more = true;
    return true;
  };
  // SQLite reads a negative LIMIT as none at all.
  const upTo = (ordinary: number) => (immediate ? -1 : ordinary);

  // Runs that have had their time: play them out and settle the match.
  const { results: running } = await db
    .prepare(
      `SELECT r.id, r.match_id, r.created, m.seed, m.ruleset, m.row_key, m.asset, p.id AS uid
       FROM runs r JOIN matches m ON m.id = r.match_id JOIN players p ON p.id = r.user_id
       WHERE p.bot = 1 AND r.done = 0 ORDER BY r.created LIMIT ?`,
    )
    .bind(upTo(8))
    .all<{ id: string; match_id: string; created: number; seed: number; ruleset: number; row_key: string | null; uid: string }>();
  for (const run of running) {
    if (spent()) break;
    if (!immediate && now - run.created < runTime(run.id)) continue;
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
         -- A cup that has started is still 'scheduled' in the table: live is the
         -- clock, not a column (lib/tournament-history.ts).
         WHERE p.bot = 1 AND e.done = 0 AND t.status = 'scheduled' AND t.starts_at <= ? AND t.ends_at > ? LIMIT ?`,
      )
      .bind(now, now, upTo(8))
      .all<{ id: string; tournament_id: string; registered: number; seed: number; ruleset: number; row_key: string | null; starts_at: number; ends_at: number; uid: string }>();
    for (const entry of entries) {
      if (spent()) break;
      // Early in the window and never more than twenty-five minutes in, so a
      // cup has scores on the board while people are still looking at it.
      const window = entry.ends_at - entry.starts_at;
      const begins = entry.starts_at + hashed(entry.id) * Math.min(window * 0.2, 25 * 60_000);
      if (!immediate && now < begins + runTime(entry.id)) continue;
      const skill = skillFor(entry.uid, config);
      const played = playRun(entry.seed, entry.ruleset, entry.row_key, skill, seeded(entry.id));
      await db.prepare("UPDATE tournament_entries SET started = COALESCE(started, ?) WHERE id = ?").bind(Math.round(begins), entry.id).run();
      await saveRun("tournament_entries", entry.id, `t-${entry.id}`, Math.round(begins), played, now);
      await endIfEveryoneFinished(entry.tournament_id, now).catch((e) => console.error("Could not end the tournament early", e));
      budget--;
      done.played++;
    }
  }

  if (spent()) return done;
  await ensureBots(now);
  // They are on the site, so they count as on the site.
  await db.prepare("UPDATE players SET last_seen = ? WHERE bot = 1 AND deleted IS NULL").bind(now).run();

  // A seat somebody opened and nobody took: sit down at it.
  const roster = await activeBots(config);
  const { results: seats } = await db
    .prepare(
      `SELECT m.id, m.stake, m.asset, m.p1 FROM matches m JOIN players p ON p.id = m.p1
       WHERE m.settled = 0 AND m.p2 IS NULL AND m.invite IS NULL AND p.bot = 0 AND m.created < ?
       ORDER BY m.created LIMIT ?`,
    )
    // A seat is given a moment to find a person before the house takes it.
    .bind(immediate ? now : now - 45_000, upTo(4))
    .all<{ id: string; stake: number; asset: string; p1: string }>();
  // A ranked seat gets a bot of about the opener's strength: a rookie for an
  // Iron or Bronze player, a sharp one for Platinum and up.
  const openers = await ranksFor(seats.filter((s) => s.asset === "devnet").map((s) => s.p1), now);
  for (const seat of seats) {
    if (spent()) break;
    const opener = openers.get(seat.p1);
    const wanted = opener ? botSkillFor(opener.rating) : null;
    const matching = wanted ? roster.filter((id) => skillFor(id, config) === wanted) : [];
    const free = (matching.length ? await freeBot(matching, seat.stake, seat.asset, undefined, now, seat.id) : null) ?? (await freeBot(roster, seat.stake, seat.asset, undefined, now, seat.id));
    if (!free) continue;
    try {
      await takeSeat(free, seat.id);
      budget--;
      done.joined++;
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
    }
  }

  // And a tournament that could use a field.
  if (config.tournaments && !spent()) {
    const { results: cups } = await db
      .prepare(
        `SELECT t.id, t.entry_fee, t.asset, t.places, t.starts_at, t.min_rank, t.max_rank,
           (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants
         FROM tournaments t WHERE t.status = 'scheduled' AND t.starts_at > ? ORDER BY t.starts_at LIMIT ?`,
      )
      .bind(now, upTo(3))
      .all<{ id: string; entry_fee: number; asset: string; places: number; starts_at: number; entrants: number; min_rank: number | null; max_rank: number | null }>();
    for (const cup of cups) {
      if (spent()) break;
      // A bot joins a cup only once the humans have had their chance at it.
      if (cup.entrants >= cup.places || (!immediate && now < cup.starts_at - 45 * 60_000)) continue;
      const fitting = botsFitting(roster, config, { min: cup.min_rank, max: cup.max_rank });
      const free = await freeBot(fitting, cup.entry_fee, cup.asset, cup.id, now, `${cup.id}:${cup.entrants}`);
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

/** What the house's players still owe: a run in a match, or a run in a cup. */
export async function botWork(now = Date.now()) {
  const row = await database()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM runs r JOIN matches m ON m.id = r.match_id JOIN players p ON p.id = r.user_id
          WHERE p.bot = 1 AND r.done = 0 AND m.settled = 0) AS matches,
         (SELECT COUNT(*) FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id JOIN players p ON p.id = e.user_id
          WHERE p.bot = 1 AND e.done = 0 AND t.status = 'scheduled' AND t.starts_at <= ? AND t.ends_at > ?) AS cupRuns,
         (SELECT COUNT(*) FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id JOIN players p ON p.id = e.user_id
          WHERE p.bot = 1 AND e.done = 0 AND t.status = 'scheduled' AND t.starts_at > ?) AS cupsAhead`,
    )
    .bind(now, now, now)
    .first<{ matches: number; cupRuns: number; cupsAhead: number }>();
  return { matches: Number(row?.matches ?? 0), cupRuns: Number(row?.cupRuns ?? 0), cupsAhead: Number(row?.cupsAhead ?? 0) };
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
      `SELECT t.id, t.entry_fee, t.asset, t.places, t.status, t.starts_at, t.ends_at, t.min_rank, t.max_rank,
         (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants
       FROM tournaments t WHERE t.id = ?`,
    )
    .bind(id)
    .first<{ id: string; entry_fee: number; asset: string; places: number; status: string; starts_at: number; ends_at: number; entrants: number; min_rank: number | null; max_rank: number | null }>();
  if (!cup) throw new GameError("No such tournament.", 404);
  if (tournamentStatus(cup, now) !== "registration") throw new GameError("Only a tournament that has not started can be filled.", 409);
  const limits = { min: cup.min_rank, max: cup.max_rank };
  const roster = botsFitting(await activeBots(config), config, limits);
  if (!roster.length) {
    const held = [...new Set(config.skills)].map((skill) => rankFor(RANKED.bots[skill] ?? RANKED.start).name).join(", ");
    throw new GameError(`No house player fits ${rankLimitLabel(limits)}: they play at ${held}.`);
  }
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

/** Runs `make` over `items` a few dozen at a time, one round trip a chunk. */
async function inChunks<T>(items: T[], make: (item: T) => Statement[]) {
  const db = database();
  for (let start = 0; start < items.length; start += 40) {
    const ops = items.slice(start, start + 40).flatMap(make);
    if (ops.length) await db.batch(ops);
  }
}

/**
 * Launch day: takes the house's players off the site. Their rows stay, because
 * the matches they played are their opponents' history too, but nothing they
 * were part of is left hanging, in this order:
 *
 * 1. a match run they had not played yet ends where it is — as the 24-hour
 *    sweep would end it — and the match settles once its player is done;
 * 2. they leave every tournament that has not started, with their entry given
 *    back, so the places are free for people;
 * 3. whatever they hold goes back to the treasury;
 * 4. each row is closed under a retired name of its own, so their names are
 *    free again.
 *
 * Every step can be run again: a press that stopped half-way is finished by
 * the next one. A roster of hundreds goes a few dozen at a time.
 */
export async function removeBots(adminUid: string, now = Date.now()) {
  const db = database();
  // The switch goes off first, so no turn starts anything new while they leave.
  await setBotConfig(adminUid, { enabled: false, count: 0 }, now);

  // 1. Runs owed in 1v1 matches.
  const { results: owed } = await db
    .prepare(
      `SELECT r.id, r.match_id FROM runs r JOIN matches m ON m.id = r.match_id JOIN players p ON p.id = r.user_id
       WHERE p.bot = 1 AND r.done = 0 AND m.settled = 0`,
    )
    .all<{ id: string; match_id: string }>();
  await inChunks(owed, (run) => [db.prepare("UPDATE runs SET done = 1, forfeit = 1, finished = COALESCE(finished, ?) WHERE id = ? AND done = 0").bind(now, run.id)]);
  for (const run of owed) await settle(run.match_id).catch((e) => console.error("A retired bot's match could not settle yet", e));

  // 2. Places in tournaments that have not started, entry refunded. The refund
  // is only written while the entry is still there, so a second press refunds nothing twice.
  const { results: entries } = await db
    .prepare(
      `SELECT e.id, e.user_id, e.tournament_id, t.asset, t.entry_fee FROM tournament_entries e
       JOIN tournaments t ON t.id = e.tournament_id JOIN players p ON p.id = e.user_id
       WHERE p.bot = 1 AND t.status = 'scheduled' AND t.starts_at > ?`,
    )
    .bind(now)
    .all<{ id: string; user_id: string; tournament_id: string; asset: string; entry_fee: number }>();
  const stillThere = "FROM tournament_entries WHERE id = ?";
  await inChunks(entries, (e) => {
    const fee = Number(e.entry_fee);
    const refund: Statement[] = !fee
      ? []
      : e.asset === "devnet"
        ? [
            db
              .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_release', ?, ?, ? ${stillThere}`)
              .bind(`tournament:${e.id}:withdrawn:escrow`, cashAccountId(escrowOwner(e.tournament_id)), -fee, e.tournament_id, now, e.id),
            db
              .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'tournament_refund', ?, ?, ? ${stillThere}`)
              .bind(`tournament:${e.id}:withdrawn`, cashAccountId(e.user_id), fee, e.tournament_id, now, e.id),
          ]
        : [
            db
              .prepare(`INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, 'tournament_refund', ?, ? ${stillThere}`)
              .bind(`tournament:${e.id}:withdrawn`, e.user_id, e.tournament_id, fee, now, e.id),
          ];
    return [...refund, db.prepare("DELETE FROM tournament_entries WHERE id = ?").bind(e.id)];
  });

  // 3. Their SOL back to the treasury — every bot row, retired or not, so a
  // match that settled in a bot's favour after an earlier press is collected too.
  const { results: wallets } = await db
    .prepare(
      `SELECT p.id, COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS sol
       FROM players p WHERE p.bot = 1`,
    )
    .all<{ id: string; sol: number }>();
  const holding = wallets.filter((bot) => Number(bot.sol) > 0);
  if (holding.length) await ensureCashAccount(HOUSE);
  await inChunks(holding, (bot) => {
    const reference = `bot-return:${bot.id}:${now}`;
    return [
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:bot`, cashAccountId(bot.id), -Number(bot.sol), reference, now),
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'bot_funding', ?, ?, ?)").bind(`${reference}:house`, cashAccountId(HOUSE), Number(bot.sol), reference, now),
    ];
  });
  const swept = holding.reduce((sum, bot) => sum + Number(bot.sol), 0);

  // 4. The rows, closed. A retired name is the bot's whole id, so no two can
  // clash; one that somebody has taken all the same gets a random one instead.
  const { results: serving } = await db.prepare("SELECT id FROM players WHERE bot = 1 AND deleted IS NULL").all<{ id: string }>();
  const close = (id: string, name: string) => db.prepare("UPDATE players SET deleted = ?, name = ?, bot = 1 WHERE id = ?").bind(now, name, id);
  for (let start = 0; start < serving.length; start += 40) {
    const chunk = serving.slice(start, start + 40);
    try {
      await db.batch(chunk.map((bot) => close(bot.id, `retired_${bot.id.slice(4)}`)));
    } catch (e) {
      if (!(e instanceof Error) || !/UNIQUE/i.test(e.message)) throw e;
      for (const bot of chunk) {
        try {
          await close(bot.id, `retired_${bot.id.slice(4)}`).run();
        } catch (err) {
          if (!(err instanceof Error) || !/UNIQUE/i.test(err.message)) throw err;
          await close(bot.id, `retired_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`).run();
        }
      }
    }
  }

  await db
    .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'bots.remove', 'bots', ?, ?)")
    .bind(
      crypto.randomUUID(),
      adminUid,
      `${serving.length} house players retired · ${owed.length} unplayed match runs ended · ${entries.length} tournament places given back · ${swept / SOL} SOL to the treasury`,
      now,
    )
    .run();
  return { retired: serving.length, swept, ended: owed.length, withdrawn: entries.length };
}

/** The bots currently in service: the first `count` of the roster. */
async function activeBots(config: BotConfig) {
  const { results } = await database().prepare("SELECT id FROM players WHERE bot = 1 AND deleted IS NULL").all<{ id: string }>();
  const live = new Set(results.map((row) => row.id));
  return Array.from({ length: config.count }, (_, i) => botId(i)).filter((id) => live.has(id));
}

const skillFor = (uid: string, config: BotConfig) => skillOf(botIndex(uid), config.skills);

/**
 * The bots a cup limited by rank would take: each holds the fixed rating of
 * its skill (lib/ranked.ts), so whether it fits is known before it tries.
 */
function botsFitting(roster: string[], config: BotConfig, limits: RankLimits) {
  if (!isLimited(limits)) return roster;
  return roster.filter((uid) => !rankBlock(rankFor(RANKED.bots[skillFor(uid, config)] ?? RANKED.start), limits));
}

/**
 * A bot with nothing on, enough money for the entry, and not already in. The
 * search starts at a place picked by `key`, so the work is spread across the
 * roster instead of falling on the first few names; and it costs four queries
 * however long the roster is.
 */
async function freeBot(roster: string[], stake: number, asset: string, tournamentId?: string, now = Date.now(), key = "") {
  if (!roster.length) return null;
  const db = database();
  const none = { results: [] as { id: string }[] };
  const [busy, owes, entered, wallets] = await Promise.all([
    db
      .prepare("SELECT DISTINCT r.user_id AS id FROM runs r JOIN matches m ON m.id = r.match_id JOIN players p ON p.id = r.user_id WHERE p.bot = 1 AND r.done = 0 AND m.settled = 0")
      .all<{ id: string }>(),
    // A cup it has entered and not played comes before anything else.
    db
      .prepare(
        `SELECT DISTINCT e.user_id AS id FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id JOIN players p ON p.id = e.user_id
         WHERE p.bot = 1 AND e.done = 0 AND t.status = 'scheduled' AND t.starts_at <= ? AND t.ends_at > ?`,
      )
      .bind(now, now)
      .all<{ id: string }>(),
    tournamentId ? db.prepare("SELECT user_id AS id FROM tournament_entries WHERE tournament_id = ?").bind(tournamentId).all<{ id: string }>() : Promise.resolve(none),
    asset === "devnet"
      ? db
          .prepare("SELECT p.id, COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS balance FROM players p WHERE p.bot = 1 AND p.deleted IS NULL")
          .all<{ id: string; balance: number }>()
      : db.prepare("SELECT id, balance FROM players WHERE bot = 1 AND deleted IS NULL").all<{ id: string; balance: number }>(),
  ]);
  const taken = new Set([...busy.results, ...owes.results, ...entered.results].map((row) => row.id));
  const money = new Map(wallets.results.map((row) => [row.id, Number(row.balance)]));
  const start = key ? Math.floor(hashed(key) * roster.length) : 0;
  for (let k = 0; k < roster.length; k++) {
    const uid = roster[(start + k) % roster.length];
    if (!taken.has(uid) && (money.get(uid) ?? 0) >= stake) return uid;
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
