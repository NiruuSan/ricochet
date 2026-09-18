import { database } from "@/db/raw";
import { avatarUrl } from "./matches";

// Two accounts in the same hands are the cheapest way to move real money: one
// loses to the other on purpose. No shot looks wrong, so the shot checks
// (lib/anti-cheat.ts) never see it. What gives it away is the pattern of a pair:
// they mostly play each other, one of them wins nearly every time, and the money
// only ever travels one way. This only reports pairs for review; the
// administrator decides, because friends do play each other a lot.

/** A pair of players whose real-money history together is worth a look. */
export type CollusionPair = {
  players: [CollusionSide, CollusionSide];
  matches: number;
  /** Lamports the first player took from the second; negative the other way. */
  net: number;
  /** Tips between them in the window, and their total in lamports. */
  tips: number;
  tipped: number;
  lastAt: number;
  reasons: ("mostly_each_other" | "one_sided" | "tips_between")[];
};
export type CollusionSide = { name: string; avatar: string | null; wins: number; /** This pair as a share of their real-money matches. */ share: number };

export const COLLUSION = {
  windowMs: 30 * 24 * 60 * 60_000,
  /** Below this many settled matches together, a pattern means nothing. */
  minMatches: 5,
  /** This pair is that share of either player's real-money matches. */
  pairShare: 0.6,
  /** One of them takes at least this share of the wins. */
  oneSided: 0.85,
  /** Pairs listed per review. */
  limit: 30,
};

type PairRow = { a: string; b: string; n: number; wins_a: number; wins_b: number; net_a: number; last_at: number; name_a: string; name_b: string; avatar_a: string | null; avatar_b: string | null };
type TipRow = { sender: string; recipient: string; n: number; total: number };

/** Why a pair is listed, in the order an administrator would check it. */
function reasonsFor(row: PairRow, shareA: number, shareB: number, tips: number) {
  const reasons: CollusionPair["reasons"] = [];
  const oneSided = Math.max(row.wins_a, row.wins_b) / row.n;
  if (Math.max(shareA, shareB) >= COLLUSION.pairShare) reasons.push("mostly_each_other");
  if (oneSided >= COLLUSION.oneSided) reasons.push("one_sided");
  if (tips > 0) reasons.push("tips_between");
  return reasons;
}

/**
 * Pairs of players whose real-money history together looks arranged rather than
 * played, most money moved first. Nothing is sanctioned here.
 */
export async function collusionPairs(now = Date.now()): Promise<CollusionPair[]> {
  const db = database();
  const since = now - COLLUSION.windowMs;
  const duels = `SELECT
      CASE WHEN m.p1 < m.p2 THEN m.p1 ELSE m.p2 END AS a,
      CASE WHEN m.p1 < m.p2 THEN m.p2 ELSE m.p1 END AS b,
      m.stake, m.fee, m.winner, m.created
    FROM matches m
    WHERE m.asset = 'devnet' AND m.settled = 1 AND m.cancelled = 0 AND m.p2 IS NOT NULL AND m.created >= ?`;
  const [pairs, totals, tips] = await Promise.all([
    db
      .prepare(
        `WITH duels AS (${duels})
         SELECT d.a, d.b, COUNT(*) AS n,
           SUM(CASE WHEN d.winner = d.a THEN 1 ELSE 0 END) AS wins_a,
           SUM(CASE WHEN d.winner = d.b THEN 1 ELSE 0 END) AS wins_b,
           SUM(CASE WHEN d.winner = d.a THEN d.stake - d.fee WHEN d.winner = d.b THEN -d.stake ELSE 0 END) AS net_a,
           MAX(d.created) AS last_at,
           pa.name AS name_a, pb.name AS name_b, pa.avatar AS avatar_a, pb.avatar AS avatar_b
         FROM duels d JOIN players pa ON pa.id = d.a JOIN players pb ON pb.id = d.b
         GROUP BY d.a, d.b HAVING n >= ? ORDER BY n DESC LIMIT ?`,
      )
      .bind(since, COLLUSION.minMatches, COLLUSION.limit)
      .all<PairRow>(),
    db
      .prepare(
        `SELECT uid, COUNT(*) AS n FROM (
           SELECT m.p1 AS uid FROM matches m WHERE m.asset = 'devnet' AND m.settled = 1 AND m.cancelled = 0 AND m.p2 IS NOT NULL AND m.created >= ?
           UNION ALL
           SELECT m.p2 AS uid FROM matches m WHERE m.asset = 'devnet' AND m.settled = 1 AND m.cancelled = 0 AND m.p2 IS NOT NULL AND m.created >= ?
         ) GROUP BY uid`,
      )
      .bind(since, since)
      .all<{ uid: string; n: number }>(),
    db
      .prepare(
        `SELECT substr(s.account_id, 8) AS sender, substr(r.account_id, 8) AS recipient, COUNT(*) AS n, COALESCE(SUM(r.amount), 0) AS total
         FROM cash_ledger s JOIN cash_ledger r ON r.reference = s.reference AND r.kind = 'tip_received'
         WHERE s.kind = 'tip_sent' AND s.created >= ?
         GROUP BY sender, recipient`,
      )
      .bind(since)
      .all<TipRow>(),
  ]);
  const played = new Map(totals.results.map((row) => [row.uid, row.n]));
  const tipsBetween = (x: string, y: string) =>
    tips.results
      .filter((t) => (t.sender === x && t.recipient === y) || (t.sender === y && t.recipient === x))
      .reduce((sum, t) => ({ count: sum.count + t.n, total: sum.total + t.total }), { count: 0, total: 0 });

  return pairs.results
    .map((row): CollusionPair => {
      const shareA = row.n / Math.max(1, played.get(row.a) ?? row.n);
      const shareB = row.n / Math.max(1, played.get(row.b) ?? row.n);
      const tip = tipsBetween(row.a, row.b);
      return {
        players: [
          { name: row.name_a, avatar: avatarUrl(row.avatar_a), wins: row.wins_a, share: Math.round(shareA * 100) / 100 },
          { name: row.name_b, avatar: avatarUrl(row.avatar_b), wins: row.wins_b, share: Math.round(shareB * 100) / 100 },
        ],
        matches: row.n,
        // Positive: the first player took that much from the second.
        net: row.net_a,
        tips: tip.count,
        tipped: tip.total,
        lastAt: row.last_at,
        reasons: reasonsFor(row, shareA, shareB, tip.count),
      };
    })
    .filter((pair) => pair.reasons.some((reason) => reason !== "tips_between"))
    .sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
}
