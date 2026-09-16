import { database } from "@/db/raw";
import type { Asset, PublicPlayerProfile } from "./api-types";
import { playerLevel } from "./experience";
import { avatarUrl, GameError } from "./matches";

type PlayerRow = { id: string; public_id: string; name: string; avatar: string | null; created: number };

/** A public name, or `{ id }` for the signed-in player's own profile. */
export type PlayerRef = string | { id: string };

export async function findPlayer(ref: PlayerRef): Promise<PlayerRow> {
  const db = database();
  if (typeof ref === "string" && !/^[a-zA-Z0-9_]{3,20}$/.test(ref)) throw new GameError("Player not found.", 404);
  const player = await (typeof ref === "string"
    ? db.prepare("SELECT id, public_id, name, avatar, created FROM players WHERE lower(name) = lower(?)").bind(ref)
    : db.prepare("SELECT id, public_id, name, avatar, created FROM players WHERE id = ?").bind(ref.id)
  ).first<PlayerRow>();
  if (!player) throw new GameError("Player not found.", 404);
  return player;
}

/** Only display information and settled match statistics are public. */
export async function publicProfile(ref: PlayerRef | PlayerRow, viewer?: string): Promise<PublicPlayerProfile> {
  const db = database();
  const player = typeof ref === "object" && "public_id" in ref ? ref : await findPlayer(ref);
  const [games, gems, devnet, level] = await Promise.all([
    db.prepare(`SELECT asset, COUNT(*) AS games, SUM(CASE WHEN winner = ? THEN 1 ELSE 0 END) AS wins
      FROM matches WHERE settled = 1 AND (p1 = ? OR p2 = ?) GROUP BY asset`)
      .bind(player.id, player.id, player.id).all<{ asset: Asset; games: number; wins: number }>(),
    db.prepare(`SELECT COALESCE(SUM(l.amount), 0) AS pnl FROM ledger l
      JOIN matches m ON m.id = l.match_id AND m.settled = 1 AND m.asset = 'gems'
      WHERE l.user_id = ?`).bind(player.id).first<{ pnl: number }>(),
    db.prepare(`SELECT COALESCE(SUM(l.amount), 0) AS pnl FROM cash_ledger l
      JOIN cash_accounts a ON a.id = l.account_id AND a.network = 'devnet'
      JOIN matches m ON m.id = l.reference AND m.settled = 1 AND m.asset = 'devnet'
      WHERE a.user_id = ? AND l.kind IN ('match_entry', 'match_payout', 'match_refund')`)
      .bind(player.id).first<{ pnl: number }>(),
    playerLevel(player.id),
  ]);
  const stats: PublicPlayerProfile["stats"] = {
    gems: { pnl: Number(gems?.pnl ?? 0), games: 0, wins: 0 },
    devnet: { pnl: Number(devnet?.pnl ?? 0), games: 0, wins: 0 },
  };
  for (const row of games.results) {
    if (row.asset === "gems" || row.asset === "devnet") Object.assign(stats[row.asset], { games: Number(row.games), wins: Number(row.wins) });
  }
  return { publicId: player.public_id, name: player.name, avatar: avatarUrl(player.avatar), created: player.created, isYou: viewer === player.id, level, stats };
}
