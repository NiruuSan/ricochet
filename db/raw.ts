import { createClient, type Client, type InStatement, type InValue, type ResultSet } from "@libsql/client";

// A small prepared-statement interface over libSQL (Turso). Game and payment code only
// needs prepared statements and atomic batches, and keeps its plain SQL.

export type Row = Record<string, unknown>;

export interface Statement {
  bind(...args: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
  readonly statement: InStatement;
}

export interface Database {
  prepare(sql: string): Statement;
  /** Runs every statement in one write transaction: all apply or none do. */
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
}

type Options = { onQuery?: (sql: string) => void };

function toRows<T>(result: ResultSet): T[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i]])) as T);
}

export function createDatabase(client: Client, { onQuery }: Options = {}): Database {
  const statement = (sql: string, args: InValue[] = []): Statement => {
    const execute = () => {
      onQuery?.(sql);
      return client.execute({ sql, args });
    };
    return {
      statement: { sql, args },
      bind: (...next) => statement(sql, next as InValue[]),
      first: async <T>() => toRows<T>(await execute())[0] ?? null,
      all: async <T>() => ({ results: toRows<T>(await execute()) }),
      run: async () => ({ meta: { changes: (await execute()).rowsAffected } }),
    };
  };
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      for (const s of statements) onQuery?.(typeof s.statement === "string" ? s.statement : s.statement.sql);
      const results = await client.batch(statements.map((s) => s.statement), "write");
      return results.map((r) => ({ meta: { changes: r.rowsAffected } }));
    },
  };
}

const globalForDatabase = globalThis as unknown as { __ricochetDatabase?: Database };

export function database(): Database {
  if (!globalForDatabase.__ricochetDatabase) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw Error("Demo accounts are temporarily unavailable. Practice is still available.");
    globalForDatabase.__ricochetDatabase = createDatabase(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  }
  return globalForDatabase.__ricochetDatabase;
}

/** Test hook: route all database access to the given instance. */
export function setDatabase(db: Database) {
  globalForDatabase.__ricochetDatabase = db;
}

export function adminId() {
  return process.env.RICOCHET_ADMIN_USER_ID;
}
