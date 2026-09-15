import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { migrate } from "../db/migrate.mjs";

// Migration 0003 on a database holding pre-gem data: demo SOL becomes gems
// (1 SOL = 100 gems), balances are rebuilt from the converted ledger, duplicate
// names are made unique, and the ledger balance trigger survives the rebuild.
const dir = mkdtempSync(path.join(tmpdir(), "ricochet-migration-"));
const client = createClient({ url: "file:" + path.join(dir, "legacy.db").replaceAll("\\", "/") });
const all = readdirSync(new URL("../drizzle/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
assert.ok(all[3].startsWith("0003_"), "0003 is the gems migration");

// Apply 0000–0002 by recording 0003+ as already applied, then remove that record.
await client.execute("CREATE TABLE _ricochet_migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL)");
const later = all.slice(3).map((f) => f.replace(/\.sql$/, ""));
for (const name of later) await client.execute({ sql: "INSERT INTO _ricochet_migrations VALUES(?, 0)", args: [name] });
await migrate(client);
await client.execute({ sql: `DELETE FROM _ricochet_migrations WHERE name IN (${later.map(() => "?").join(",")})`, args: later });

await client.batch(
  [
    "INSERT INTO players(id, name, created) VALUES('github:1', 'Alice', 1), ('github:2', 'alice', 2), ('github:3', 'bob', 3)",
    "INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created, ruleset) VALUES('m1', 1, 1000000000, 'demo', 'github:1', 'github:3', 1, 'github:1', 240000000, 1, 3), ('m2', 1, 1000000000, 'devnet', 'github:1', NULL, 0, NULL, 0, 1, 3)",
    "INSERT INTO ledger VALUES('a', 'github:1', 'm1', 'entry', -1000000000, 1), ('b', 'github:3', 'm1', 'entry', -1000000000, 1), ('c', 'github:1', 'm1', 'payout', 1760000000, 2)",
  ],
  "write",
);
await migrate(client);

const rows = async (sql) => (await client.execute(sql)).rows.map((r) => ({ ...r }));
const publicIds = await rows("SELECT public_id FROM players ORDER BY id");
assert.ok(publicIds.every((p) => /^[a-f0-9]{32}$/.test(p.public_id)), "Existing players receive opaque public IDs");
assert.equal(new Set(publicIds.map((p) => p.public_id)).size, 3);
await migrate(client);
assert.deepEqual(await rows("SELECT public_id FROM players ORDER BY id"), publicIds, "Migration reruns preserve public IDs");
const players = await rows("SELECT id, name, balance, last_seen, avatar FROM players ORDER BY id");
assert.deepEqual(
  players.map((p) => [p.id, p.balance, p.last_seen, p.avatar]),
  [
    ["github:1", 2076, 0, null],
    ["github:2", 2000, 0, null],
    ["github:3", 1900, 0, null],
  ],
);
assert.equal(players[0].name, "Alice");
assert.match(players[1].name, /^alice_[0-9a-f]{4}$/, "The later duplicate name gets a suffix");
assert.deepEqual(await rows("SELECT id, stake, asset, fee FROM matches ORDER BY id"), [
  { id: "m1", stake: 100, asset: "gems", fee: 24 },
  { id: "m2", stake: 1000000000, asset: "devnet", fee: 0 },
]);
await client.execute("INSERT INTO ledger VALUES('d', 'github:3', 'm1', 'refund', 7, 3)");
assert.equal((await rows("SELECT balance FROM players WHERE id = 'github:3'"))[0].balance, 1907, "Ledger trigger still applies");
await assert.rejects(() => client.execute("INSERT INTO players(id, name, created) VALUES('github:9', 'BOB', 1)"), /UNIQUE/);
await assert.rejects(() => client.execute("INSERT INTO ledger VALUES('e', 'github:2', 'm1', 'entry', -5000, 3)"), /CHECK/);

client.close();
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows may still hold the file briefly; it is only a temp directory.
}
console.log("PASS: legacy demo SOL converts to gems, balances rebuild from the ledger, unique names, trigger and checks survive the table rebuild.");
