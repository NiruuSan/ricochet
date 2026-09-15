// Runs the real Worker modules under Node: `cloudflare:workers` resolves to a
// test env whose D1 binding is an in-memory SQLite database built from the
// committed migrations. Import this module before importing any app module.
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../../", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__workerTestEnv", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(specifier.slice(2) + ".ts", root).href, context);
    if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.(ts|mjs|js)$/.test(specifier)) return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});

export function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations = readdirSync(new URL("drizzle/", root)).filter((f) => f.endsWith(".sql")).sort();
  for (const name of migrations) sqlite.exec(readFileSync(new URL("drizzle/" + name, root), "utf8"));

  const statements = [];
  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.sql, args);
    }
    async first() {
      statements.push(this.sql);
      return sqlite.prepare(this.sql).get(...this.args) ?? null;
    }
    async all() {
      statements.push(this.sql);
      return { results: sqlite.prepare(this.sql).all(...this.args) };
    }
    async run() {
      statements.push(this.sql);
      const r = sqlite.prepare(this.sql).run(...this.args);
      return { meta: { changes: Number(r.changes) } };
    }
  }
  const DB = {
    prepare: (sql) => new Statement(sql),
    // D1 batches are atomic transactions.
    async batch(ops) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const op of ops) results.push(await op.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { sqlite, DB, statements };
}
