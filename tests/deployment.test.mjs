import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDatabase } from "./helpers/test-env.mjs";
import { vercelBuild, runNode } from "../scripts/vercel-build.mjs";

const { sqlite, close } = await createDatabase();
try {
  // Reproduce a deployed database on 0003 while the app expects public_id.
  sqlite.exec("DROP TRIGGER player_public_id; DROP INDEX player_public_id_unique; ALTER TABLE players DROP COLUMN public_id; DELETE FROM _ricochet_migrations WHERE name = '0004_public_player_ids';");
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES('private-login-test', 'LoginTester', 1)").run();
  const { playerSnapshot } = await import("../lib/matches.ts");
  await assert.rejects(() => playerSnapshot("private-login-test", "gems"), /no such column: public_id/);

  const file = sqlite.prepare("PRAGMA database_list").get().file;
  const env = { ...process.env, VERCEL_ENV: "production", TURSO_DATABASE_URL: `file:${file.replaceAll("\\", "/")}`, TURSO_AUTH_TOKEN: "" };
  let built = false;
  vercelBuild(env, (script, args, childEnv) => {
    if (script.endsWith("migrate.mjs")) runNode(script, args, childEnv);
    else {
      assert.match(sqlite.prepare("SELECT public_id FROM players").get().public_id, /^[a-f0-9]{32}$/);
      assert.deepEqual(args, ["build", "--webpack"]);
      built = true;
    }
  });
  assert.ok(built, "The application builds only after the migration succeeds");
  const snapshot = await playerSnapshot("private-login-test", "gems");
  assert.equal(snapshot.player.name, "LoginTester");
  assert.equal(snapshot.player.balance, 2000, "Migration preserves balances");
  assert.match(snapshot.player.publicId, /^[a-f0-9]{32}$/);

  let calls = 0;
  assert.throws(() => vercelBuild(env, () => { calls++; throw new Error("Migration rejected"); }), /Migration rejected/);
  assert.equal(calls, 1, "Migration failure prevents publishing the application");
  assert.throws(() => vercelBuild({ VERCEL_ENV: "production" }, () => assert.fail("Must not build without production DB configuration")), /TURSO_DATABASE_URL/);
  for (const mode of ["preview", "development", undefined]) {
    const scripts = [];
    vercelBuild({ ...env, VERCEL_ENV: mode }, (script) => scripts.push(script));
    assert.equal(scripts.length, 1);
    assert.ok(!scripts[0].endsWith("migrate.mjs"), "Non-production builds do not migrate shared databases");
  }
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(vercel.buildCommand, "npm run build:vercel");
  assert.equal(pkg.scripts["build:vercel"], "node scripts/vercel-build.mjs");
  console.log("PASS: reproduced missing-column login failure, production migration restores accounts, balances preserved, deployment blocked on migration failure, preview databases unchanged.");
} finally { close(); }
