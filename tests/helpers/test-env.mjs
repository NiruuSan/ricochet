// Runs the real server modules under Node against a throwaway libSQL database
// file built by the real migration runner. App code goes through the same
// adapter it uses against Turso; tests also get a synchronous SQLite handle on
// the same file for fixtures and assertions.
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
import { migrate } from "../../db/migrate.mjs";

const root = new URL("../../", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(specifier.slice(2) + ".ts", root).href, context);
    // A module imported with a cache-busting query (`next.config.ts?production`) is still TypeScript.
    if (context.parentURL?.split("?")[0].endsWith(".ts") && specifier.startsWith(".") && !/\.(ts|mjs|js)$/.test(specifier)) return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});

export async function createDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ricochet-test-"));
  const file = path.join(dir, "test.db");
  const client = createClient({ url: "file:" + file.replaceAll("\\", "/") });
  await migrate(client);

  const statements = [];
  const { createDatabase: adapt, setDatabase } = await import("../../db/raw.ts");
  const DB = adapt(client, { onQuery: (sql) => statements.push(sql) });
  setDatabase(DB);

  const sqlite = new DatabaseSync(file);
  const close = () => {
    sqlite.close();
    client.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may still hold the file briefly; it is only a temp directory.
    }
  };
  return { sqlite, DB, statements, close };
}
