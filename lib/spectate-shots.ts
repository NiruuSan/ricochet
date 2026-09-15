import type { Database } from "@/db/raw";

/**
 * Records one shot for spectators, in the same batch as the run update. The row
 * is only written when the update applied: the run's revision must now be one
 * past the shot's. A concurrent request that won the race already wrote its own
 * row for that revision, so the insert is ignored rather than duplicated.
 */
export function shotInsert(db: Database, runKey: string, table: "runs" | "tournament_entries", id: string, revision: number, angle: number | null, now: number) {
  return db
    .prepare(`INSERT OR IGNORE INTO run_shots(run_key, revision, angle, created) SELECT ?, ?, ?, ? FROM ${table} WHERE id = ? AND revision = ?`)
    .bind(runKey, revision, angle, now, id, revision + 1);
}
