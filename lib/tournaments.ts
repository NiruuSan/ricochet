import { database, type Statement } from "@/db/raw";
import { initial, isSupportedRuleset, RULESET, ShotError, simulate, validAngle, type Game } from "./engine";
import {
  PAYOUT_SHARES,
  TOURNAMENT_FEE_PERCENT,
  type AdminTournament,
  type Asset,
  type PayoutPreset,
  type Run,
  type TournamentDetail,
  type TournamentNotification,
  type TournamentStanding,
  type TournamentSummary,
} from "./api-types";
import { avatarUrl, GameError } from "./matches";
import { notificationInsert } from "./notifications";
import { cashAccountId, ensureCashAccount, HOUSE, settings } from "./payments/accounts";
import { parseSol, requireDevnet } from "./payments/policy";
import { newRowKey, rowsFor } from "./secret-rows";
import { shotInsert } from "./spectate-shots";
import { tournamentStatus } from "./tournament-history";

export { tournamentStatus };

// Score tournaments: every entrant plays one run on the same seed between the
// start and the end, and the pot is split by rank when the tournament closes.
//
// Money follows the match model. Devnet SOL entries move into a tournament
// escrow account (`escrow:tournament:<id>`, counted as escrow by the treasury);
// a free SOL tournament is funded from the house balance at creation. Gem
// entries are debited from the player, and gem prizes are paid by the house.

const MINUTE = 60_000;
const DAY = 86_400_000;
export const MAX_PLACES = 1000;

type TournamentRow = {
  id: string;
  name: string;
  asset: Asset;
  entry_fee: number;
  prize: number;
  payout: PayoutPreset;
  places: number;
  seed: number;
  ruleset: number;
  /** Secret row key (ruleset 6+). Never leaves the server. */
  row_key: string | null;
  starts_at: number;
  ends_at: number;
  status: "scheduled" | "settled" | "cancelled";
  created: number;
};

type EntryRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  state: string | null;
  revision: number;
  score: number;
  clears: number;
  done: number;
  forfeit: number;
  registered: number;
  started: number | null;
  finished: number | null;
  rank: number | null;
  payout: number;
};

const escrowOwner = (id: string) => `escrow:tournament:${id}`;
const isPreset = (value: unknown): value is PayoutPreset => typeof value === "string" && value in PAYOUT_SHARES;

/** The pot for a given number of entrants: the house prize, or entries minus the house share. */
export function potFor(t: Pick<TournamentRow, "asset" | "entry_fee" | "prize">, entrants: number) {
  if (!t.entry_fee) return t.prize;
  return Math.floor((t.entry_fee * entrants * (100 - TOURNAMENT_FEE_PERCENT[t.asset])) / 100);
}

/**
 * Splits `pot` between players ordered by score (highest first). Shares follow
 * the preset; with fewer players than paid places, the shares that remain are
 * scaled up so the whole pot is paid. Players on the same score share the
 * places they occupy equally. Rounding dust goes to the top-ranked player.
 */
export function distribute(pot: number, preset: PayoutPreset, scores: number[]) {
  const shares = PAYOUT_SHARES[preset].slice(0, scores.length);
  const total = shares.reduce((sum, share) => sum + share, 0);
  const amounts = scores.map(() => 0);
  const ranks = scores.map(() => 0);
  for (let i = 0; i < scores.length; ) {
    let j = i;
    while (j < scores.length && scores[j] === scores[i]) j++;
    const groupShare = shares.slice(i, j).reduce((sum, share) => sum + share, 0);
    for (let k = i; k < j; k++) {
      ranks[k] = i + 1;
      amounts[k] = total ? Math.floor((pot * groupShare) / total / (j - i)) : 0;
    }
    i = j;
  }
  if (scores.length && total) amounts[0] += pot - amounts.reduce((sum, amount) => sum + amount, 0);
  return { amounts, ranks };
}

function parseAmount(asset: Asset, value: unknown, label: string) {
  if (asset === "devnet") return parseSol(value);
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new GameError(`${label} must be a whole number of gems between 1 and 1,000,000.`);
  return amount;
}

export type TournamentInput = {
  name?: unknown;
  asset?: unknown;
  entry?: unknown;
  entryFee?: unknown;
  prize?: unknown;
  payout?: unknown;
  places?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

/** Administrator: creates a tournament. A free SOL tournament reserves its prize from the house balance. */
export async function createTournament(input: TournamentInput, now = Date.now()) {
  const name = String(input.name ?? "").trim();
  if (name.length < 3 || name.length > 60) throw new GameError("Give the tournament a name of 3–60 characters.");
  const asset = input.asset;
  if (asset !== "gems" && asset !== "devnet") throw new GameError("Choose devnet SOL or gems.");
  if (asset === "devnet") requireDevnet(settings());
  const payout = input.payout;
  if (!isPreset(payout)) throw new GameError("Choose how the prize is split.");
  const places = Number(input.places);
  if (!Number.isInteger(places) || places < 2 || places > MAX_PLACES) throw new GameError(`Places must be a whole number between 2 and ${MAX_PLACES}.`);
  if (PAYOUT_SHARES[payout].length > places) throw new GameError(`Paying the top ${PAYOUT_SHARES[payout].length} needs at least that many places.`);
  const paid = input.entry === "paid";
  if (!paid && input.entry !== "free") throw new GameError("Choose a paid or free entry.");
  const entryFee = paid ? parseAmount(asset, input.entryFee, "The entry fee") : 0;
  const prize = paid ? 0 : parseAmount(asset, input.prize, "The prize");
  const startsAt = Number(input.startsAt);
  const endsAt = Number(input.endsAt);
  if (!Number.isSafeInteger(startsAt) || startsAt < now - MINUTE) throw new GameError("The start must be in the future.");
  if (!Number.isSafeInteger(endsAt) || endsAt < startsAt + 5 * MINUTE) throw new GameError("The tournament must last at least 5 minutes.");
  if (endsAt > now + 90 * DAY) throw new GameError("The tournament must end within 90 days.");

  const db = database();
  const id = crypto.randomUUID();
  const ops: Statement[] = [
    db
      .prepare(
        `INSERT INTO tournaments(id, name, asset, entry_fee, prize, payout, places, seed, ruleset, row_key, starts_at, ends_at, created)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, name, asset, entryFee, prize, payout, places, crypto.getRandomValues(new Uint32Array(1))[0], RULESET, newRowKey(), startsAt, endsAt, now),
  ];
  if (asset === "devnet" && !paid) {
    await Promise.all([ensureCashAccount(HOUSE), ensureCashAccount(escrowOwner(id))]);
    ops.push(
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'tournament_funding', ?, ?, ?)")
        .bind(`tournament:${id}:funding`, cashAccountId(HOUSE), -prize, id, now),
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'tournament_escrow', ?, ?, ?)")
        .bind(`tournament:${id}:escrow`, cashAccountId(escrowOwner(id)), prize, id, now),
    );
  }
  try {
    await db.batch(ops);
  } catch (e) {
    if (e instanceof Error && /cash balance insufficient/.test(e.message)) throw new GameError("The treasury balance cannot cover this prize.");
    throw e;
  }
  return id;
}

async function loadTournament(id: string) {
  const t = await database().prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first<TournamentRow>();
  if (!t) throw new GameError("Tournament not found.", 404);
  return t;
}

/** Registers the player before the start. A paid entry is taken in the same batch as the seat. */
export async function registerForTournament(uid: string, idInput: unknown, now = Date.now()) {
  const t = await loadTournament(String(idInput ?? ""));
  if (tournamentStatus(t, now) !== "registration") throw new GameError("Registration for this tournament is closed.", 409);
  const db = database();
  if (!(await db.prepare("SELECT 1 FROM players WHERE id = ?").bind(uid).first())) throw new GameError("Create your player profile first.", 403);
  if (await db.prepare("SELECT 1 FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").bind(t.id, uid).first()) {
    throw new GameError("You are already registered.", 409);
  }
  if (t.asset === "devnet") requireDevnet(settings());
  const entryId = crypto.randomUUID();
  // The seat only exists if the tournament is still open and not full; the entry
  // fee is only taken if the seat exists.
  const ops: Statement[] = [
    db
      .prepare(
        `INSERT INTO tournament_entries(id, tournament_id, user_id, registered)
         SELECT ?, id, ?, ? FROM tournaments
         WHERE id = ? AND status = 'scheduled' AND starts_at > ?
           AND (SELECT COUNT(*) FROM tournament_entries WHERE tournament_id = tournaments.id) < places`,
      )
      .bind(entryId, uid, now, t.id, now),
  ];
  if (t.entry_fee && t.asset === "devnet") {
    await Promise.all([ensureCashAccount(uid), ensureCashAccount(escrowOwner(t.id))]);
    ops.push(
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'tournament_entry', ?, ?, ? FROM tournament_entries WHERE id = ?")
        .bind(`tournament:${entryId}:entry`, cashAccountId(uid), -t.entry_fee, t.id, now, entryId),
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'tournament_escrow', ?, ?, ? FROM tournament_entries WHERE id = ?")
        .bind(`tournament:${entryId}:escrow`, cashAccountId(escrowOwner(t.id)), t.entry_fee, t.id, now, entryId),
    );
  } else if (t.entry_fee) {
    ops.push(
      db
        .prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, 'tournament_entry', ?, ? FROM tournament_entries WHERE id = ?")
        .bind(`tournament:${entryId}:entry`, uid, t.id, -t.entry_fee, now, entryId),
    );
  }
  try {
    await db.batch(ops);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/one_entry_per_player|UNIQUE constraint failed: tournament_entries/.test(message)) throw new GameError("You are already registered.", 409);
    if (/cash balance insufficient|balance_nonnegative|CHECK constraint/.test(message)) {
      throw new GameError(t.asset === "gems" ? "Not enough gems for this entry." : "Not enough devnet SOL for this entry. Fund your wallet first.");
    }
    throw e;
  }
  if (!(await db.prepare("SELECT 1 FROM tournament_entries WHERE id = ?").bind(entryId).first())) {
    throw new GameError("This tournament just filled up or closed registration.", 409);
  }
}

const toRun = (t: Pick<TournamentRow, "id" | "asset" | "ruleset">, e: EntryRow): Run => ({
  id: `t:${e.id}`,
  match_id: `t:${t.id}`,
  tournamentId: t.id,
  asset: t.asset,
  ruleset: t.ruleset,
  state: JSON.parse(e.state!) as Game,
  revision: e.revision,
  score: e.score,
  done: e.done,
  forfeit: e.forfeit,
  clears: e.clears,
});

/** Starts (or resumes) the player's single run while the tournament is live. */
export async function startTournamentRun(uid: string, idInput: unknown, now = Date.now()): Promise<Run> {
  const t = await loadTournament(String(idInput ?? ""));
  const status = tournamentStatus(t, now);
  if (status === "registration") throw new GameError("This tournament has not started yet.", 409);
  if (status !== "live") throw new GameError("This tournament has ended.", 409);
  const db = database();
  const load = () => db.prepare("SELECT * FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").bind(t.id, uid).first<EntryRow>();
  let entry = await load();
  if (!entry) throw new GameError("You are not registered for this tournament.", 403);
  if (entry.done) throw new GameError("You have already played your run in this tournament.", 409);
  if (!entry.state) {
    await db.prepare("UPDATE tournament_entries SET state = ?, started = ? WHERE id = ? AND state IS NULL").bind(JSON.stringify(initial(t.seed, rowsFor(t.ruleset, t.row_key))), now, entry.id).run();
    entry = (await load())!;
  }
  return toRun(t, entry);
}

/** One shot or a forfeit on a tournament run; the same rules as a match shot, until the tournament ends. */
export async function playTournamentShot(
  uid: string,
  entryIdInput: unknown,
  revision: unknown,
  action: "shot" | "forfeit",
  angle?: unknown,
  allowed: Promise<boolean> | boolean = true,
  now = Date.now(),
): Promise<Run> {
  const db = database();
  const [row, permitted] = await Promise.all([
    db
      .prepare(
        `SELECT e.*, t.asset, t.ruleset, t.row_key, t.status AS t_status, t.starts_at, t.ends_at
         FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
         WHERE e.id = ? AND e.user_id = ?`,
      )
      .bind(String(entryIdInput), uid)
      .first<EntryRow & { asset: Asset; ruleset: number; row_key: string | null; t_status: TournamentRow["status"]; starts_at: number; ends_at: number }>(),
    allowed,
  ]);
  if (!permitted) throw new GameError("Too many requests. Wait a minute before trying again.", 429);
  if (!row || !row.state) throw new GameError("Game not found.", 404);
  if (tournamentStatus({ status: row.t_status, starts_at: row.starts_at, ends_at: row.ends_at }, now) !== "live") {
    throw new GameError("This tournament has ended. Your score so far counts.", 409);
  }
  if (row.done || row.revision !== revision) throw new GameError("This game changed in another tab. Reload to resume.", 409);

  let state = JSON.parse(row.state) as Game;
  const forfeit = action === "forfeit";
  if (forfeit) {
    state.over = true;
  } else {
    if (!validAngle(angle)) throw new GameError("Invalid aim angle.");
    if (!isSupportedRuleset(row.ruleset)) throw new GameError("This tournament uses a retired ruleset.", 409);
    try {
      state = simulate(state, angle, row.ruleset, rowsFor(row.ruleset, row.row_key));
    } catch (e) {
      if (e instanceof ShotError) throw new GameError(e.message);
      throw e;
    }
  }
  const clears = row.clears + (!forfeit && state.bonus ? 1 : 0);
  const done = state.over ? 1 : 0;
  const [result] = await db.batch([
    db
      .prepare(
        `UPDATE tournament_entries SET state = ?, score = ?, done = ?, forfeit = ?, clears = ?, finished = ?, revision = revision + 1
         WHERE id = ? AND user_id = ? AND revision = ? AND done = 0`,
      )
      .bind(JSON.stringify(state), state.score, done, forfeit ? 1 : 0, clears, done ? now : null, row.id, uid, row.revision),
    shotInsert(db, `t-${row.id}`, "tournament_entries", row.id, row.revision, forfeit ? null : (angle as number), now),
  ]);
  if (!result.meta.changes) throw new GameError("This shot was already processed. Reload to resume.", 409);
  if (done) {
    // The run is saved; if the payout fails here, the next visit after the new end settles it.
    await endIfEveryoneFinished(row.tournament_id, now).catch((e) => console.error("Could not end the tournament early", e));
  }
  return toRun(
    { id: row.tournament_id, asset: row.asset, ruleset: row.ruleset },
    { ...row, state: JSON.stringify(state), score: state.score, done, forfeit: forfeit ? 1 : 0, clears, revision: row.revision + 1 },
  );
}

/**
 * Ends a live tournament as soon as every entrant has finished their run, and
 * pays it out. Registration closes at the start, so the entrants are final.
 */
async function endIfEveryoneFinished(id: string, now: number) {
  const db = database();
  const ended = await db
    .prepare(
      `UPDATE tournaments SET ends_at = ?
       WHERE id = ? AND status = 'scheduled' AND starts_at <= ? AND ends_at > ?
         AND NOT EXISTS (SELECT 1 FROM tournament_entries e WHERE e.tournament_id = tournaments.id AND e.done = 0)`,
    )
    .bind(now, id, now, now)
    .run();
  if (ended.meta.changes) await settleTournament(id, now);
}

/** Entrants who played, best score first; ties keep the order they finished in. */
function rankable<T extends EntryRow>(entries: T[]) {
  return entries
    .filter((e) => e.state !== null)
    .sort((a, b) => b.score - a.score || (a.finished ?? Infinity) - (b.finished ?? Infinity) || a.registered - b.registered);
}

/**
 * Pays out a tournament whose end has passed. Idempotent: the status update is
 * conditional and every ledger row and notification has a deterministic ID.
 * If nobody played, paid entries are refunded and a house prize returns.
 */
export async function settleTournament(id: string, now = Date.now()) {
  const db = database();
  const t = await db.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first<TournamentRow>();
  if (!t || tournamentStatus(t, now) !== "closing") return;
  const entries = (await db.prepare("SELECT * FROM tournament_entries WHERE tournament_id = ?").bind(id).all<EntryRow>()).results;
  const ranked = rankable(entries);
  const pot = potFor(t, entries.length);
  const { amounts, ranks } = distribute(pot, t.payout, ranked.map((e) => e.score));
  const settled = "FROM tournaments WHERE id = ? AND status = 'settled'";
  const ops: Statement[] = [db.prepare("UPDATE tournaments SET status = 'settled' WHERE id = ? AND status = 'scheduled' AND ends_at <= ?").bind(id, now)];
  const sol = t.asset === "devnet";
  if (sol) await Promise.all([ensureCashAccount(HOUSE), ensureCashAccount(escrowOwner(id)), ...entries.map((e) => ensureCashAccount(e.user_id))]);

  const credit = (key: string, uid: string, kind: string, amount: number) =>
    sol
      ? db
          .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, '${kind}', ?, ?, ? ${settled}`)
          .bind(key, cashAccountId(uid), amount, id, now, id)
      : db
          .prepare(`INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, '${kind}', ?, ? ${settled}`)
          .bind(key, uid, id, amount, now, id);
  const escrowed = t.entry_fee ? t.entry_fee * entries.length : t.prize;

  const refunds = new Map<string, number>();
  if (!ranked.length) {
    // Nobody played: entries go back, and so does a house prize.
    if (t.entry_fee) for (const e of entries) refunds.set(e.id, t.entry_fee);
    for (const e of entries) if (refunds.get(e.id)) ops.push(credit(`tournament:${e.id}:refund`, e.user_id, "tournament_refund", t.entry_fee));
    if (sol && !t.entry_fee) ops.push(credit(`tournament:${id}:return`, HOUSE, "tournament_return", t.prize));
  } else {
    ranked.forEach((e, i) => amounts[i] > 0 && ops.push(credit(`tournament:${e.id}:prize`, e.user_id, "tournament_prize", amounts[i])));
    const paidOut = amounts.reduce((sum, amount) => sum + amount, 0);
    if (sol && escrowed > paidOut) ops.push(credit(`tournament:${id}:fee`, HOUSE, "house_fee", escrowed - paidOut));
  }
  if (sol && escrowed) {
    ops.push(
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_release', ?, ?, ? ${settled}`)
        .bind(`tournament:${id}:release`, cashAccountId(escrowOwner(id)), -escrowed, id, now, id),
    );
  }

  const rankOf = new Map(ranked.map((e, i) => [e.id, { rank: ranks[i], payout: amounts[i] }]));
  for (const e of entries) {
    const placed = rankOf.get(e.id);
    ops.push(
      db
        .prepare(`UPDATE tournament_entries SET done = 1, finished = COALESCE(finished, ?), rank = ?, payout = ? WHERE id = ? AND EXISTS (SELECT 1 ${settled})`)
        .bind(now, placed?.rank ?? null, placed?.payout ?? 0, e.id, id),
    );
    const data: TournamentNotification = {
      tournamentId: id,
      name: t.name,
      asset: t.asset,
      rank: placed?.rank ?? null,
      players: ranked.length,
      payout: placed?.payout ?? 0,
      refund: refunds.get(e.id) ?? 0,
    };
    // Entry IDs are random, so the notification ID reveals nothing about the player.
    ops.push(notificationInsert(db, `tournament:${e.id}:result`, e.user_id, "tournament_result", data, now));
  }
  await db.batch(ops);
}

/** Settles every tournament whose end has passed. Cheap when there is nothing to do. */
export async function settleDueTournaments(now = Date.now()) {
  const due = await database()
    .prepare("SELECT id FROM tournaments WHERE status = 'scheduled' AND ends_at <= ? ORDER BY ends_at LIMIT 10")
    .bind(now)
    .all<{ id: string }>();
  for (const { id } of due.results) await settleTournament(id, now);
}

/** Administrator: cancels a tournament that has not been paid out, returning every entry and a house prize. */
export async function cancelTournament(idInput: unknown, now = Date.now()) {
  const id = String(idInput ?? "");
  const t = await loadTournament(id);
  if (t.status !== "scheduled") throw new GameError("Only a tournament that has not been paid out can be cancelled.", 409);
  const db = database();
  const entries = (await db.prepare("SELECT * FROM tournament_entries WHERE tournament_id = ?").bind(id).all<EntryRow>()).results;
  const sol = t.asset === "devnet";
  if (sol) await Promise.all([ensureCashAccount(HOUSE), ensureCashAccount(escrowOwner(id)), ...entries.map((e) => ensureCashAccount(e.user_id))]);
  const cancelled = "FROM tournaments WHERE id = ? AND status = 'cancelled'";
  const ops: Statement[] = [db.prepare("UPDATE tournaments SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'").bind(id)];
  const credit = (key: string, uid: string, kind: string, amount: number) =>
    sol
      ? db
          .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, '${kind}', ?, ?, ? ${cancelled}`)
          .bind(key, cashAccountId(uid), amount, id, now, id)
      : db
          .prepare(`INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, '${kind}', ?, ? ${cancelled}`)
          .bind(key, uid, id, amount, now, id);
  if (t.entry_fee) for (const e of entries) ops.push(credit(`tournament:${e.id}:refund`, e.user_id, "tournament_refund", t.entry_fee));
  if (sol && !t.entry_fee) ops.push(credit(`tournament:${id}:return`, HOUSE, "tournament_return", t.prize));
  const escrowed = t.entry_fee ? t.entry_fee * entries.length : t.prize;
  if (sol && escrowed) {
    ops.push(
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_release', ?, ?, ? ${cancelled}`)
        .bind(`tournament:${id}:release`, cashAccountId(escrowOwner(id)), -escrowed, id, now, id),
    );
  }
  for (const e of entries) {
    const data: TournamentNotification = { tournamentId: id, name: t.name, asset: t.asset, rank: null, players: 0, payout: 0, refund: t.entry_fee };
    ops.push(notificationInsert(db, `tournament:${e.id}:result`, e.user_id, "tournament_result", data, now));
  }
  await db.batch(ops);
}

/** Administrator: ends a live or upcoming tournament now and pays it out. */
export async function closeTournamentNow(idInput: unknown, now = Date.now()) {
  const id = String(idInput ?? "");
  const t = await loadTournament(id);
  if (t.status !== "scheduled") throw new GameError("This tournament is already closed.", 409);
  await database().prepare("UPDATE tournaments SET ends_at = ?, starts_at = MIN(starts_at, ?) WHERE id = ? AND status = 'scheduled'").bind(now, now, id).run();
  await settleTournament(id, now);
}

type SummaryRow = TournamentRow & { entrants: number; played: number; finished_count: number };

function summary(t: SummaryRow, you: EntryRow | undefined, now: number): TournamentSummary {
  return {
    id: t.id,
    name: t.name,
    asset: t.asset,
    entryFee: t.entry_fee,
    payout: t.payout,
    places: t.places,
    entrants: t.entrants,
    pot: potFor(t, t.entrants),
    maxPot: potFor(t, t.places),
    startsAt: t.starts_at,
    endsAt: t.ends_at,
    status: tournamentStatus(t, now),
    you: you ? { score: you.score, done: !!you.done, started: you.state !== null, rank: you.rank, payout: you.payout } : null,
  };
}

const SUMMARY_SQL = `SELECT t.*,
    (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants,
    (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id AND e.state IS NOT NULL) AS played,
    (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id AND e.done = 1) AS finished_count
  FROM tournaments t`;

/** Upcoming, live and recent tournaments for the lobby, with the player's own entries. */
export async function listTournaments(uid: string | null, now = Date.now()): Promise<TournamentSummary[]> {
  await settleDueTournaments(now);
  const db = database();
  const [rows, mine] = await Promise.all([
    db
      .prepare(`${SUMMARY_SQL} WHERE t.status = 'scheduled' OR t.ends_at >= ? ORDER BY CASE WHEN t.status = 'scheduled' THEN 0 ELSE 1 END, t.starts_at ASC LIMIT 50`)
      .bind(now - 7 * DAY)
      .all<SummaryRow>(),
    uid ? db.prepare("SELECT * FROM tournament_entries WHERE user_id = ?").bind(uid).all<EntryRow>() : Promise.resolve({ results: [] as EntryRow[] }),
  ]);
  return rows.results.map((t) => summary(t, mine.results.find((e) => e.tournament_id === t.id), now));
}

/** One tournament with its prize ladder and standings. Standings carry names, never player IDs. */
export async function tournamentDetail(uid: string | null, idInput: unknown, now = Date.now()): Promise<TournamentDetail> {
  const id = String(idInput ?? "");
  await settleTournament(id, now);
  const db = database();
  const [t, entries] = await Promise.all([
    db.prepare(`${SUMMARY_SQL} WHERE t.id = ?`).bind(id).first<SummaryRow>(),
    db
      .prepare("SELECT e.*, p.name, p.avatar FROM tournament_entries e JOIN players p ON p.id = e.user_id WHERE e.tournament_id = ?")
      .bind(id)
      .all<EntryRow & { name: string; avatar: string | null }>(),
  ]);
  if (!t) throw new GameError("Tournament not found.", 404);
  const you = uid ? entries.results.find((e) => e.user_id === uid) : undefined;
  const base = summary(t, you, now);
  const ranked = rankable(entries.results);
  const live = t.status === "scheduled";
  // Spectating follows lib/spectate.ts: while you still have a run to play here, only your own run can be watched.
  const blocked = base.status === "live" && !!you && !you.done;
  const watchId = (e: EntryRow & { user_id: string }) => (e.state !== null && (!blocked || e.user_id === uid) ? `t-${e.id}` : null);
  // While running, rank provisionally with the current pot; once settled, show what was paid.
  const projected = distribute(base.pot, t.payout, ranked.map((e) => e.score));
  const standings: TournamentStanding[] = [
    ...ranked.map((e, i) => ({
      rank: live ? projected.ranks[i] : e.rank,
      name: e.name,
      avatar: avatarUrl(e.avatar),
      score: e.score,
      done: !!e.done,
      started: true,
      payout: live ? projected.amounts[i] : e.payout,
      isYou: e.user_id === uid,
      watchId: watchId(e),
    })),
    ...entries.results
      .filter((e) => e.state === null)
      .map((e) => ({ rank: null, name: e.name, avatar: avatarUrl(e.avatar), score: 0, done: !!e.done, started: false, payout: 0, isYou: e.user_id === uid, watchId: null })),
  ];
  const ladder = distribute(base.status === "registration" ? base.maxPot : base.pot, t.payout, PAYOUT_SHARES[t.payout].map((_, i) => -i));
  return { ...base, prizes: ladder.amounts, standings: standings.slice(0, 200) };
}

/** Administrator list, including counts of who played and finished. */
export async function adminTournaments(now = Date.now()): Promise<AdminTournament[]> {
  await settleDueTournaments(now);
  const rows = await database().prepare(`${SUMMARY_SQL} ORDER BY t.created DESC LIMIT 100`).all<SummaryRow>();
  return rows.results.map((t) => ({ ...summary(t, undefined, now), played: t.played, finished: t.finished_count }));
}
