import { database } from "@/db/raw";

/** Public names only. With friendOf, suggest only players available to add. */
export async function searchPlayerNames(input: string, friendOf?: string): Promise<string[]> {
  const query = input.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,20}$/.test(query)) return [];
  const { results } = await database()
    .prepare(
      `SELECT p.name FROM players p
       WHERE p.deleted IS NULL AND instr(lower(p.name), ?) > 0
       ${friendOf ? `AND p.id <> ?
         AND NOT EXISTS (SELECT 1 FROM blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = p.id) OR (b.blocked_id = ? AND b.blocker_id = p.id))
         AND NOT EXISTS (SELECT 1 FROM friend_links f
           WHERE (f.low_id = ? AND f.high_id = p.id) OR (f.high_id = ? AND f.low_id = p.id))` : ""}
       ORDER BY CASE WHEN lower(p.name) = ? THEN 0 WHEN instr(lower(p.name), ?) = 1 THEN 1 ELSE 2 END,
         p.name COLLATE NOCASE
       LIMIT 8`,
    )
    .bind(query, ...(friendOf ? [friendOf, friendOf, friendOf, friendOf, friendOf] : []), query, query)
    .all<{ name: string }>();
  return results.map((row) => row.name);
}
