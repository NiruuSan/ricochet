import { readFileSync, readdirSync } from "node:fs";

const MIGRATIONS_DIR = new URL("../drizzle/", import.meta.url);

/**
 * Applies committed drizzle SQL migrations that have not run yet, in order.
 * Each file runs in one write transaction together with its bookkeeping row,
 * so a failed migration leaves nothing half-applied.
 */
export async function migrate(client, log = () => {}) {
  await client.execute("CREATE TABLE IF NOT EXISTS _ricochet_migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL)");
  const applied = new Set((await client.execute("SELECT name FROM _ricochet_migrations")).rows.map((row) => row.name));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    if (applied.has(name)) continue;
    const statements = readFileSync(new URL(file, MIGRATIONS_DIR), "utf8")
      .split("--> statement-breakpoint")
      .map((sql) => sql.trim())
      .filter(Boolean);
    await client.batch([...statements, { sql: "INSERT INTO _ricochet_migrations(name, applied) VALUES(?, ?)", args: [name, Date.now()] }], "write");
    log(`applied ${name}`);
  }
}
