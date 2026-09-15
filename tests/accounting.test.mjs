import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Database-level guarantees of the gem ledger, independent of app code.
const { sqlite: c, close } = await createDatabase();
const balance = (uid) => c.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;

for (const uid of ["a", "b"]) c.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(uid, uid);
assert.equal(balance("a"), 2000, "New profiles start with 2,000 gems");
c.exec("INSERT INTO matches(id, seed, stake, p1, p2, created) VALUES('m', 1, 100, 'a', 'b', 0)");
for (const uid of ["a", "b"]) c.prepare("INSERT INTO ledger VALUES(?, ?, 'm', 'entry', -100, 0)").run(uid + "entry", uid);
for (let i = 0; i < 2; i++) c.exec("INSERT OR IGNORE INTO ledger VALUES('payout', 'a', 'm', 'payout', 200, 0)");
assert.equal(balance("a"), 2100);
assert.equal(balance("b"), 1900);
assert.equal(c.prepare("SELECT SUM(balance) AS total FROM players").get().total, 4000);

assert.throws(() => c.exec("INSERT INTO ledger VALUES('overdraw', 'b', 'm', 'entry', -99999, 0)"), /CHECK constraint/);
assert.equal(c.prepare("SELECT 1 FROM ledger WHERE id = 'overdraw'").get(), undefined);

// A full tie refund restores both entries and takes no fee.
for (const uid of ["a", "b"]) {
  const before = balance(uid);
  c.prepare("INSERT INTO ledger VALUES(?, ?, 'tie', 'entry', -25, 0)").run(uid + "tie", uid);
  c.prepare("INSERT INTO ledger VALUES(?, ?, 'tie', 'payout', 25, 0)").run(uid + "refund", uid);
  assert.equal(balance(uid), before);
}

c.exec("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('r', 'm', 'a', '{}', 0)");
assert.throws(() => c.exec("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('r2', 'm2', 'a', '{}', 0)"), /UNIQUE/);
assert.equal(c.prepare("UPDATE runs SET revision = revision + 1 WHERE id = 'r' AND revision = 0").run().changes, 1);
assert.equal(c.prepare("UPDATE runs SET revision = revision + 1 WHERE id = 'r' AND revision = 0").run().changes, 0);

// Schema defaults: new matches are gem matches on ruleset 2 unless stated, and player names are unique regardless of case.
assert.deepEqual({ ...c.prepare("SELECT asset, ruleset, cancelled FROM matches WHERE id = 'm'").get() }, { asset: "gems", ruleset: 2, cancelled: 0 });
assert.throws(() => c.exec("INSERT INTO players(id, name, created) VALUES('c', 'A', 0)"), /UNIQUE/);

console.log("PASS: gem starting balance, fee-free gem payouts, idempotent payouts, conservation, overdraft rejection, tie refunds, one active run, optimistic shot revisions, schema defaults, unique names.");
close();
