// Usage: TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm db:migrate
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate.mjs";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for a remote database).");
  process.exit(1);
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  await migrate(client, console.log);
  console.log("Database is up to date.");
} finally {
  client.close();
}
