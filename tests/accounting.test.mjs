import assert from "node:assert/strict";
import { createDatabase } from "./helpers/worker-env.mjs";

// Database-level guarantees of the demo ledger, independent of app code.
const { sqlite: c } = createDatabase();
const balance = (uid) => c.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;

for (const uid of ["a", "b"]) c.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(uid, uid);
c.exec("INSERT INTO matches(id, seed, stake, p1, p2, created) VALUES('m', 1, 1000000000, 'a', 'b', 0)");
for (const uid of ["a", "b"]) c.prepare("INSERT INTO ledger VALUES(?, ?, 'm', 'entry', -1000000000, 0)").run(uid + "entry", uid);
for (let i = 0; i < 2; i++) c.exec("INSERT OR IGNORE INTO ledger VALUES('payout', 'a', 'm', 'payout', 1760000000, 0)");
assert.equal(balance("a"), 20_760_000_000);
assert.equal(balance("b"), 19_000_000_000);
assert.equal(c.prepare("SELECT SUM(balance) AS total FROM players").get().total, 39_760_000_000);

assert.throws(() => c.exec("INSERT INTO ledger VALUES('overdraw', 'b', 'm', 'entry', -99900000000, 0)"), /CHECK constraint/);
assert.equal(c.prepare("SELECT 1 FROM ledger WHERE id = 'overdraw'").get(), undefined);

// A full tie refund restores both entries and takes no fee.
for (const uid of ["a", "b"]) {
  const before = balance(uid);
  c.prepare("INSERT INTO ledger VALUES(?, ?, 'tie', 'entry', -50000000, 0)").run(uid + "tie", uid);
  c.prepare("INSERT INTO ledger VALUES(?, ?, 'tie', 'payout', 50000000, 0)").run(uid + "refund", uid);
  assert.equal(balance(uid), before);
}

c.exec("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('r', 'm', 'a', '{}', 0)");
assert.throws(() => c.exec("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('r2', 'm2', 'a', '{}', 0)"), /UNIQUE/);
assert.equal(c.prepare("UPDATE runs SET revision = revision + 1 WHERE id = 'r' AND revision = 0").run().changes, 1);
assert.equal(c.prepare("UPDATE runs SET revision = revision + 1 WHERE id = 'r' AND revision = 0").run().changes, 0);

// Migration 0002 defaults: pre-existing matches are ruleset 2 and not cancelled.
assert.deepEqual({ ...c.prepare("SELECT ruleset, cancelled FROM matches WHERE id = 'm'").get() }, { ruleset: 2, cancelled: 0 });

console.log("PASS: 12% per-entry economics, idempotent payouts, conservation, overdraft rejection, tie refunds, one active run, optimistic shot revisions, migration defaults.");
c.close();
