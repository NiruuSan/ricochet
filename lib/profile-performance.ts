import { database } from "@/db/raw";
import type { Asset, PnlRange, ProfileMatch, ProfilePerformance } from "./api-types";
import { avatarUrl, GameError } from "./matches";
import { cashAccountId } from "./payments/accounts";

const DAY = 86_400_000;

/** Cumulative settled PNL within each range, with a zero baseline. */
export function pnlSeries(history: ProfileMatch[], now: number): ProfilePerformance["series"] {
  const settled = history.filter((match) => match.settled && match.ended <= now);
  const earliest = settled.reduce((start, match) => Math.min(start, match.ended), now - DAY);
  const windows: Record<PnlRange, [number, number]> = {
    day: [now - DAY, 24], week: [now - 7 * DAY, 28], month: [now - 30 * DAY, 60],
    year: [now - 365 * DAY, 100], all: [earliest, 100],
  };
  const series = {} as ProfilePerformance["series"];
  for (const range of Object.keys(windows) as PnlRange[]) {
    const [start, count] = windows[range];
    const step = (now - start) / count;
    const buckets = Array<number>(count).fill(0);
    for (const match of settled) {
      if (match.ended < start) continue;
      const index = Math.min(count - 1, Math.floor((match.ended - start) / step));
      buckets[index] += match.net;
    }
    let value = 0;
    const points = [{ at: start, value: 0 }, ...buckets.map((delta, i) => ({ at: start + (i + 1) * step, value: value += delta }))];
    series[range] = { total: value, points };
  }
  return series;
}

/** Match-only public history. Wallet balances, tips and unfinished scores stay private. */
export async function profilePerformance(name: string, asset: Asset, now = Date.now()): Promise<ProfilePerformance> {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) throw new GameError("Player not found.", 404);
  const db = database();
  const player = await db.prepare("SELECT id FROM players WHERE lower(name) = lower(?)").bind(name).first<{ id: string }>();
  if (!player) throw new GameError("Player not found.", 404);
  const gems = asset === "gems";
  const table = gems ? "ledger" : "cash_ledger";
  const reference = gems ? "match_id" : "reference";
  const owner = gems ? "user_id" : "account_id";
  const kinds = gems ? "'entry', 'payout', 'refund'" : "'match_entry', 'match_payout', 'match_refund'";
  const { results } = await db.prepare(`
    SELECT m.id, m.stake, m.created, m.settled, p.name AS opponent, p.avatar AS opponentAvatar,
      CASE WHEN m.settled = 0 THEN NULL WHEN m.cancelled = 1 THEN 'cancelled'
        WHEN m.winner IS NULL THEN 'draw' WHEN m.winner = ? THEN 'win' ELSE 'loss' END AS result,
      CASE WHEN m.settled = 1 THEN COALESCE(SUM(CASE WHEN l.${owner} = ? THEN l.amount ELSE 0 END), 0) ELSE 0 END AS net,
      COALESCE(MAX(l.created), m.created) AS ended
    FROM matches m
    LEFT JOIN ${table} l ON l.${reference} = m.id AND l.kind IN (${kinds})
    LEFT JOIN players p ON p.id = CASE WHEN m.p1 = ? THEN m.p2 ELSE m.p1 END
    WHERE m.asset = ? AND (m.p1 = ? OR m.p2 = ?)
    GROUP BY m.id ORDER BY m.created DESC, m.id DESC
  `).bind(player.id, gems ? player.id : cashAccountId(player.id), player.id, asset, player.id, player.id).all<ProfileMatch>();
  const history = results.map((match) => ({ ...match, opponentAvatar: avatarUrl(match.opponentAvatar) }));
  return {
    asset, generated: now, played: history.length,
    openEntries: history.reduce((sum, match) => sum + (match.settled ? 0 : match.stake), 0),
    bestWin: history.reduce((best, match) => Math.max(best, match.net), 0),
    history: history.slice(0, 100),
    series: pnlSeries(history, now),
  };
}
