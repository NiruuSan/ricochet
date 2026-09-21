import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createDatabase } from "./helpers/test-env.mjs";

const { sqlite, close } = await createDatabase();
const { searchPlayerNames } = await import("../lib/player-search.ts");
const add = (name) => sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(name, name);
// Exercise real endpoint guards and SQL, replacing only authentication.
globalThis.playerSearchUser = null;
const authHook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "@/lib/auth-user" ? { url: "test:player-search-auth", shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === "test:player-search-auth" ? { format: "module", shortCircuit: true, source: `
      export async function currentUser() { return globalThis.playerSearchUser; }
      export async function administrator() { const u = globalThis.playerSearchUser; return u?.userId === 'operator' ? u : null; }
    ` } : next(url, context);
  },
});

try {
  for (const name of ["Ana", "Ann", "Anna", "Banana", "Blue_Bird", "BlueXBird", "Closed"]) add(name);
  sqlite.prepare("UPDATE players SET deleted = 1 WHERE name = 'Closed'").run();
  assert.deepEqual(await searchPlayerNames(" ANn "), ["Ann", "Anna"], "Matches ignore case and whitespace, with exact names first");
  assert.deepEqual(await searchPlayerNames("a"), ["Ana", "Ann", "Anna", "Banana"], "One character finds prefixes before substring matches");
  assert.deepEqual(await searchPlayerNames("blue_"), ["Blue_Bird"], "Underscores are literal, not SQL wildcards");
  for (const query of ["", "   ", "%", "' OR 1=1 --", "a".repeat(21), "Closed", "nobody"]) {
    assert.deepEqual(await searchPlayerNames(query), [], `No suggestions for ${JSON.stringify(query)}`);
  }
  sqlite.prepare("INSERT INTO friend_links(low_id, high_id, requested_by, status, created) VALUES('Ana', 'Ann', 'Ana', 'pending', 0)").run();
  sqlite.prepare("INSERT INTO blocks(blocker_id, blocked_id, created) VALUES('Anna', 'Ana', 0)").run();
  assert.deepEqual(await searchPlayerNames("a", "Ana"), ["Banana"], "Friend search excludes self, pending requests and players who blocked the caller");
  sqlite.prepare("UPDATE friend_links SET status = 'accepted'").run();
  sqlite.prepare("INSERT INTO blocks(blocker_id, blocked_id, created) VALUES('Ana', 'Banana', 0)").run();
  assert.deepEqual(await searchPlayerNames("a", "Ana"), [], "Accepted friends and blocks in either direction are excluded");
  assert.deepEqual(await searchPlayerNames("a"), ["Ana", "Ann", "Anna", "Banana"], "Admin search is unaffected by friend relationships");
  for (let i = 0; i < 12; i++) add(`Player${i.toString().padStart(2, "0")}`);
  assert.equal((await searchPlayerNames("player")).length, 8, "Results are bounded");
  assert.equal((await searchPlayerNames("player11"))[0], "Player11", "Exact lookup can find names outside the first eight results");

  const { GET } = await import("../app/api/players/search/route.ts");
  const get = (query = "q=a") => GET(new Request(`https://ricochet.test/api/players/search?${query}`));
  assert.equal((await get()).status, 401, "Anonymous searches are refused");
  globalThis.playerSearchUser = { userId: "Ana" };
  assert.equal((await get("scope=admin&q=a")).status, 403, "An ordinary player cannot use admin search");
  assert.deepEqual(await (await get("q=ann")).json(), [], "The endpoint applies friend exclusions");
  globalThis.playerSearchUser = { userId: "operator" };
  const response = await get("scope=admin&q=a");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), ["Ana", "Ann", "Anna", "Banana", "Player00", "Player01", "Player02", "Player03"], "Admin search returns only public names");
  assert.equal((await get("scope=unknown&q=a")).status, 400);
  sqlite.prepare('UPDATE rate_limits SET count = 120 WHERE key = ? AND "window" = ?').run("gameRead:operator", Math.floor(Date.now() / 60_000));
  assert.equal((await get("scope=admin&q=a")).status, 429, "Search requests respect rate limits");
  console.log("PASS: player suggestions (partial names, ranking, literal underscores, bounds, exclusions, authentication, admin access and rate limits).");
} finally {
  authHook.deregister();
  delete globalThis.playerSearchUser;
  close();
}
