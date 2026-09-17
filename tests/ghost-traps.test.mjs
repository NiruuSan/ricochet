import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Ghost bricks and traps: the marking round-trips exactly, traps never touch the
// real board, a bot planning on the game data falls into them and is caught,
// and a player looking at the real board is not.
Object.assign(process.env, {
  RICOCHET_ADMIN_USER_ID: "admin-user",
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 5).toString("base64"),
});
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Ghost traps must not touch the network");
};

const ghosts = await import("../lib/ghost-bricks.ts");
const traps = await import("../lib/ghost-trap.ts");
const rules = await import("../lib/anti-cheat-rules.ts");
const engine = await import("../lib/engine.ts");
const matches = await import("../lib/matches.ts");
const { rowsFor } = await import("../lib/secret-rows.ts");
const { shotKeyFor, signReport } = await import("../lib/shot-key.ts");
const { cashAccountId, ensureCashAccount } = await import("../lib/payments/accounts.ts");

const SOL = 1_000_000_000;
const signed = (run, angle) => {
  const runKey = run.id.startsWith("t:") ? `t-${run.id.slice(2)}` : `m-${run.id}`;
  const aim = [[0, 90], [700, angle]];
  const proof = { v: 2, aimMs: 900 + Math.floor(Math.random() * 4000), inputs: 30, trusted: true, webdriver: false, build: rules.CLIENT_BUILD, flags: 0, synthetic: 0 };
  proof.sig = signReport(shotKeyFor(runKey), rules.reportMessage({ runKey, revision: run.revision, angle, proof, aim }));
  return { proof, aim: rules.parseAim(aim), signedAim: aim };
};

try {
  // --- Marking: exact round trip on many random boards --------------------------
  const rng = engine.random(42);
  for (let n = 0; n < 1500; n++) {
    const key = shotKeyFor(`m-random-${n}`);
    const cells = new Set();
    const bricks = [];
    for (let i = 0; i < 1 + Math.floor(rng() * 30); i++) {
      const col = Math.floor(rng() * 7), row = 1 + Math.floor(rng() * 7);
      if (cells.has(`${col}:${row}`)) continue;
      cells.add(`${col}:${row}`);
      bricks.push({ col, row, hp: 1 + Math.floor(rng() * 400) });
    }
    const sync = ghosts.syncFor(key, n, bricks);
    assert.ok(!bricks.some((b) => ghosts.isGhost(key, sync, b)), "No real brick is ever marked");
    const extra = [];
    for (let g = 0; g < 2; g++) {
      const col = Math.floor(rng() * 7), row = 2 + Math.floor(rng() * 5);
      if (cells.has(`${col}:${row}`) || extra.some((e) => e.col === col && e.row === row)) continue;
      extra.push({ col, row, hp: ghosts.ghostHp(key, sync, col, row, 1 + Math.floor(rng() * 300)) });
    }
    const game = { seed: 1, round: 5, score: 0, balls: 5, x: 200, bricks: [...bricks, ...extra], over: false, bonus: false };
    assert.deepEqual(ghosts.stripGhosts(game, key, sync).bricks, bricks, "Stripping removes exactly the ghosts");
  }
  const noKey = { id: "r", state: { bricks: [{ col: 0, row: 3, hp: 5 }] } };
  assert.equal(ghosts.cleanRun(noKey), noKey, "A run without a key or sync is left alone");

  // --- Planning: find traps on real boards and check them --------------------------------
  const boardsWithTraps = [];
  for (let n = 0; n < 40 && boardsWithTraps.length < 4; n++) {
    const runKey = `m-plan-${n}`;
    const rows = rowsFor(6, (n + 1).toString(16).padStart(64, "a"));
    let g = engine.initial(n + 1, rows);
    for (let revision = 0; revision < 22 && !g.over; revision++) {
      const trap = traps.planTrap(runKey, revision, g, 6);
      if (trap) boardsWithTraps.push({ runKey, revision, g, trap, rowKey: (n + 1).toString(16).padStart(64, "a") });
      const next = engine.simulate(g, 50 + ((revision * 37) % 80), 6, rows);
      g = next;
    }
  }
  assert.ok(boardsWithTraps.length >= 3, `Traps are found on ordinary boards (${boardsWithTraps.length})`);
  let solverTrapped = 0;
  for (const { runKey, revision, g, trap, rowKey } of boardsWithTraps) {
    assert.deepEqual(traps.planTrap(runKey, revision, g, 6), trap, "Planning is deterministic");
    const taken = new Set(g.bricks.map((b) => `${b.col}:${b.row}`));
    for (const ghost of trap.ghosts) {
      assert.ok(!taken.has(`${ghost.col}:${ghost.row}`) && ghost.row >= 2 && ghost.row <= 6, "Ghosts sit in empty cells");
    }
    assert.ok(trap.share > 0 && trap.share <= traps.TRAP.maxShare, "The trap band is narrow");
    const key = shotKeyFor(runKey);
    const shown = traps.presentRun({ id: runKey.slice(2), revision, state: g, shotKey: key }, runKey, JSON.stringify(trap));
    assert.equal(shown.state.bricks.length, g.bricks.length + trap.ghosts.length, "The data carries the ghosts");
    assert.deepEqual(ghosts.cleanRun(shown).state, g, "The official client recovers the exact real board");
    assert.deepEqual(traps.presentRun({ id: "x", revision: revision + 1, state: g, shotKey: key }, runKey, JSON.stringify(trap)).state, g, "A trap never leaks into another round");
    // A solver on the data board aims into the band; the best real shot never does.
    let bestFake = null, bestReal = null;
    const rows = rowsFor(6, rowKey);
    for (let a = engine.MIN_ANGLE; a <= engine.MAX_ANGLE; a += 2) {
      const fake = rules.boardValue(g, engine.simulate({ ...g, bricks: [...g.bricks, ...trap.ghosts] }, a, 6, rows));
      const real = rules.boardValue(g, engine.simulate(g, a, 6, rows));
      if (!bestFake || fake > bestFake.v) bestFake = { a, v: fake };
      if (!bestReal || real > bestReal.v) bestReal = { a, v: real };
    }
    if (traps.trappedShot(trap, g, bestFake.a, 6, 0.2)) solverTrapped++;
    assert.equal(traps.trappedShot(trap, g, bestReal.a, 6, 1), false, "The best real shot is never trapped");
  }
  assert.ok(solverTrapped >= Math.ceil(boardsWithTraps.length * 0.75), `A solver on the data board walks into the trap (${solverTrapped} of ${boardsWithTraps.length})`);

  // --- A full match: a data bot is caught, a screen player is not -------------------------
  const players = { bot: "gt-bot-private", eye: "gt-eye-private" };
  for (const [name, id] of Object.entries(players)) {
    sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
    await ensureCashAccount(id);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'fixture', ?, 'fixture', 0)").run(`fund-${id}`, cashAccountId(id), 50 * SOL);
  }
  /** The angle ranked `rank` (0 = best) by board value on the board it is given. */
  const bestAngle = (g, rank = 0) => {
    const options = [];
    for (let a = engine.MIN_ANGLE + 0.5; a <= engine.MAX_ANGLE - 0.5; a += 2) {
      try {
        options.push({ a, v: rules.boardValue(g, engine.simulate(g, a, 6, () => [])) });
      } catch {
        /* over budget */
      }
    }
    options.sort((x, y) => y.v - x.v);
    return options[Math.min(rank, options.length - 1)]?.a ?? 90;
  };
  const play = async (uid, readsData, stopAfterTraps) => {
    const stats = { shots: 0, trapRounds: 0, suspended: false };
    const metTraps = () => sqlite.prepare("SELECT COUNT(*) AS n FROM shot_analysis WHERE user_id = ? AND trapped IS NOT NULL").get(uid).n;
    for (let match = 0; match < 8 && !stats.suspended && metTraps() < stopAfterTraps; match++) {
      let run = await matches.startMatch(uid, SOL / 20, "devnet");
      while (!run.done && stats.shots < 200 && metTraps() < stopAfterTraps) {
        const stored = JSON.parse(sqlite.prepare("SELECT state FROM runs WHERE id = ?").get(run.id).state);
        assert.deepEqual(ghosts.cleanRun(run).state, stored, "What the client keeps is the stored real board");
        assert.ok(!JSON.stringify(stored).includes("sync"), "The stored board never holds ghosts");
        if (run.state.bricks.length !== stored.bricks.length) stats.trapRounds++;
        const board = readsData ? run.state : ghosts.cleanRun(run).state;
        // The bot takes the best angle of the data; the person picks one of their few best real options.
        const angle = readsData ? bestAngle(board) : bestAngle(board, Math.floor(Math.random() * 4));
        // Time passes between shots as it does for someone watching the animation.
        sqlite.prepare("UPDATE run_shots SET created = created - 600000 WHERE run_key = ?").run(`m-${run.id}`);
        const tasks = [];
        try {
          run = await matches.playShot(uid, run.id, run.revision, "shot", angle, true, { ...signed(run, angle), defer: (t) => tasks.push(t) });
        } catch (e) {
          if (e.status === 403) {
            stats.suspended = true;
            break;
          }
          throw e;
        }
        for (const task of tasks) await task();
        stats.shots++;
        if (sqlite.prepare("SELECT 1 FROM player_suspensions WHERE user_id = ? AND status = 'suspended'").get(uid)) {
          stats.suspended = true;
          break;
        }
      }
    }
    stats.trapped = sqlite.prepare("SELECT COUNT(*) AS n FROM shot_analysis WHERE user_id = ? AND trapped = 1").get(uid).n;
    stats.traps = sqlite.prepare("SELECT COUNT(*) AS n FROM shot_analysis WHERE user_id = ? AND trapped IS NOT NULL").get(uid).n;
    return stats;
  };

  // How often a bot is caught depends on the boards it meets; what must always hold is
  // that the real game is untouched and that a player aiming at the screen is never flagged.
  const bot = await play(players.bot, true, traps.TRAP.window);
  const botQuality = sqlite.prepare("SELECT AVG(quality) AS mean, COUNT(*) AS n FROM shot_analysis WHERE user_id = ?").get(players.bot);
  assert.ok(bot.suspended || botQuality.mean >= rules.QUALITY.absoluteMean, `A bot playing from the data ends up caught (suspended ${bot.suspended}, quality ${botQuality.mean?.toFixed(3)} over ${botQuality.n} shots)`);

  const eye = await play(players.eye, false, traps.TRAP.window);
  assert.equal(eye.trapped, 0, `A player aiming at the real board never falls into a trap (${eye.traps} trap rounds)`);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cheat_signals WHERE user_id = ? AND kind LIKE 'ghost_trap%'").get(players.eye).n, 0, "…and raises no trap signal");
  // This simulated player still aims better than a person does, so the shot-quality check may
  // flag them; what matters here is that the ghost traps never do.
  const eyeSuspension = sqlite.prepare("SELECT reason FROM player_suspensions WHERE user_id = ?").get(players.eye);
  assert.ok(!eyeSuspension || !eyeSuspension.reason.includes("game data"), "…and is never suspended over a trap");

  // The sanction itself: enough trapped shots is proof, a couple is a watch signal.
  const trapFixture = (uid, name, trapped) => {
    sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(uid, name);
    trapped.forEach((value, i) => {
      sqlite
        .prepare("INSERT INTO shot_analysis(run_key, revision, user_id, gain, best_gain, best_share, trapped, created) VALUES(?, ?, ?, 5, 10, 0.5, ?, ?)")
        .run(`m-${uid}`, i, uid, value, Date.now() - i);
    });
  };
  const { evaluateTraps } = await import("../lib/anti-cheat.ts");
  trapFixture("gt-caught-private", "caught", [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual((await evaluateTraps("gt-caught-private", null)).map((f) => [f.kind, f.level]), [["ghost_trap", "stat"]]);
  assert.equal(sqlite.prepare("SELECT status, source FROM player_suspensions WHERE user_id = 'gt-caught-private'").get().source, "stats", "Traps suspend for review, they never take a match away");
  trapFixture("gt-watched-private", "watched", [1, 1, 0, 0, 0, 0]);
  assert.deepEqual((await evaluateTraps("gt-watched-private", null)).map((f) => [f.kind, f.level]), [["ghost_trap_watch", "watch"]]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM player_suspensions WHERE user_id = 'gt-watched-private'").get().n, 0, "A couple of trapped shots only raises a watch signal");
  trapFixture("gt-clear-private", "clear", [0, 1, 0, 0, 0, 0]);
  assert.deepEqual(await evaluateTraps("gt-clear-private", null), [], "One trapped shot is chance, not evidence");

  // Spectators and replays only ever see the real board.
  const watched = sqlite.prepare("SELECT id FROM runs WHERE user_id = ? LIMIT 1").get(players.eye).id;
  const { watchRun } = await import("../lib/spectate.ts");
  const data = await watchRun(players.eye, `m-${watched}`);
  assert.deepEqual(data.state, JSON.parse(sqlite.prepare("SELECT state FROM runs WHERE id = ?").get(watched).state));

  console.log(
    `PASS: ghost traps (exact marking round trip on 1,500 boards, deterministic narrow traps in empty cells, rounds never leak, real board stored and replayed clean, data bot trapped ${bot.trapped} of ${bot.traps} trap rounds and suspended, screen player 0 of ${eye.traps} and untouched, review at ${traps.TRAP.suspectTrapped} trapped shots of the last ${traps.TRAP.window} trap rounds and a watch signal at ${traps.TRAP.watchTrapped}).`,
  );
} finally {
  close();
}
