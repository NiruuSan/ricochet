import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  brickHp,
  GROUND,
  initial,
  launch,
  MAX_BALL_STEPS,
  portableSinCos,
  random,
  RULESET,
  ShotError,
  simulate,
  step,
  SUPPORTED_RULESETS,
  type Game,
} from "../lib/engine.ts";

// Deterministic mechanics, for every supported ruleset.
for (const ruleset of SUPPORTED_RULESETS) {
  const first = initial(42076);
  assert.deepEqual(first, initial(42076));
  assert.ok(first.bricks.length >= 1 && first.bricks.length <= 7);
  assert.equal(new Set(first.bricks.map((b) => b.col)).size, first.bricks.length);
  assert.ok(first.bricks.every((b) => b.row === 7 && b.hp === 1));

  let left = initial(9988);
  let right = initial(9988);
  for (let i = 0; i < 20 && !left.over; i++) {
    left = simulate(left, 60 + (i % 40), ruleset);
    right = simulate(right, 60 + (i % 40), ruleset);
    assert.deepEqual(left, right);
  }

  const clear = initial(23);
  clear.bricks = [{ col: 3, row: 7, hp: 1 }];
  const cleared = simulate(clear, 90, ruleset);
  assert.equal(cleared.score, 1);
  assert.equal(cleared.balls, 6);
  assert.equal(cleared.bonus, true);
  assert.equal(cleared.round, 2);
  assert.ok(cleared.bricks.every((b) => b.row === 7 && b.hp === 2));

  const miss = initial(23);
  miss.bricks = [{ col: 0, row: 2, hp: 999 }];
  const lost = simulate(miss, 90, ruleset);
  assert.equal(lost.over, true);
  assert.equal(lost.bricks[0].row, 1);
  assert.equal(lost.balls, 2);

  const multi = initial(123);
  multi.balls = 3;
  multi.bricks = [{ col: 3, row: 7, hp: 1 }];
  const f = launch(multi, 90, ruleset);
  assert.equal(f.balls[1].delay, 9);
  assert.deepEqual([f.balls[0].vx, f.balls[0].vy], [f.balls[2].vx, f.balls[2].vy]);
  while (!f.done) step(f);
  assert.equal(f.game.score, 1);
  assert.equal(f.game.balls, 8);
  assert.ok(f.balls.every((b) => b.done && b.y === GROUND));

  assert.throws(() => launch(first, 0, ruleset), ShotError);
  assert.throws(() => launch(first, NaN, ruleset), ShotError);

  // Decorative gutters must not act as channels through neighboring live bricks.
  // Start a volley just outside a seam and verify it reflects off the outer face.
  for (const horizontal of [false, true]) {
    const g = initial(1);
    g.bricks = horizontal
      ? [
          { col: 2, row: 4, hp: 100 },
          { col: 2, row: 5, hp: 100 },
        ]
      : [
          { col: 1, row: 4, hp: 100 },
          { col: 2, row: 4, hp: 100 },
        ];
    const seam = launch(g, 90, ruleset);
    const ball = seam.balls[0];
    const cw = 472 / 7;
    const rh = 612 / 9;
    Object.assign(ball, horizontal ? { x: 2 * cw - 6, y: 4 * rh, vx: 4.5, vy: 0 } : { x: 2 * cw, y: 5 * rh + 6, vx: 0, vy: -4.5 });
    for (let i = 0; i < 6; i++) step(seam);
    assert.ok(horizontal ? ball.vx < 0 : ball.vy > 0, "Ball must bounce off an adjacent-brick seam");
    assert.equal(seam.game.score, 1, "A seam must produce one hit, not repeated damage while slipping through");
  }
  // A truly empty cell remains a valid route between separated bricks.
  const gap = initial(1);
  gap.x = 472 / 2;
  gap.bricks = [
    { col: 2, row: 4, hp: 100 },
    { col: 4, row: 4, hp: 100 },
  ];
  const gapFlight = launch(gap, 90, ruleset);
  while (gapFlight.balls[0].y > 3 * (612 / 9)) step(gapFlight);
  assert.equal(gapFlight.game.score, 0);
}
console.log("PASS: deterministic replay, spawn bounds, unique columns, HP progression, clear bonus, descent loss, multi-ball, solid seams, open gaps (rulesets " + SUPPORTED_RULESETS.join(", ") + ").");

// Ruleset 2 must replay exactly as the original engine did, so matches created
// before this release settle on the rules they were played under. The fixture
// was recorded with the original implementation using this same generator.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/engine-ruleset2.json", import.meta.url), "utf8"));
for (const { seed, shots, digest } of fixture.cases) {
  const rng = random(seed * 7919);
  let g: Game = initial((seed * 104729) >>> 0);
  const hash = createHash("sha256");
  let played = 0;
  for (; played < 40 && !g.over; played++) {
    g = simulate(g, 8 + rng() * 164, 2);
    hash.update(JSON.stringify(g));
  }
  const late = initial(seed);
  late.round = 40 + seed;
  late.balls = 30 + seed * 3;
  late.bricks = [];
  for (let row = 2; row <= 7; row++) for (let col = 0; col < 7; col++) if (rng() < 0.6) late.bricks.push({ col, row, hp: 1 + Math.floor(rng() * late.round) });
  let lg = late;
  for (let i = 0; i < 5 && !lg.over; i++) {
    lg = simulate(lg, 8 + rng() * 164, 2);
    hash.update(JSON.stringify(lg));
  }
  assert.equal(played, shots, `seed ${seed}: shot count changed`);
  assert.equal(hash.digest("hex"), digest, `seed ${seed}: ruleset 2 replay diverged from the original engine`);
}
console.log(`PASS: ruleset 2 reproduces ${fixture.cases.length} recorded replays bit for bit.`);

// Ruleset 3 trigonometry: accurate, and built only from exactly specified operations.
for (let angle = 8; angle <= 172; angle += 0.25) {
  const u = ((90 - angle) * Math.PI) / 180;
  const [s, c] = portableSinCos(u);
  assert.ok(Math.abs(s - Math.sin(u)) < 1e-15 && Math.abs(c - Math.cos(u)) < 1e-15, `portable trig drifted at ${angle}°`);
}
const straightUp = launch(initial(5), 90, 3);
assert.equal(straightUp.balls[0].vx, 0);
assert.equal(straightUp.balls[0].vy, -4.5);
assert.equal(RULESET, 4);
// Frozen ruleset 3 outcome: changing it would break replays of live matches.
let v3 = initial(777);
for (const angle of [33.3, 90, 147.25, 61.5, 12]) if (!v3.over) v3 = simulate(v3, angle, 3);
assert.equal(createHash("sha256").update(JSON.stringify(v3)).digest("hex").slice(0, 16), "0f1baef4e93a1baa");
console.log("PASS: ruleset 3 portable trigonometry and frozen replay.");

// Ruleset 4: bricks toughen faster, from +1 HP per round up to +4 per round at round 10.
assert.deepEqual(Array.from({ length: 12 }, (_, i) => brickHp(i + 1, 4)), [1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 24, 28]);
const increments = Array.from({ length: 30 }, (_, i) => brickHp(i + 2, 4) - brickHp(i + 1, 4));
assert.ok(increments.every((d, i) => d >= 1 && d <= 4 && (i === 0 || d >= increments[i - 1])), "The per-round increase never shrinks and stays between +1 and +4");
assert.equal(brickHp(217, 4), 848);
for (const legacy of [2, 3]) assert.equal(brickHp(217, legacy), 217, "Earlier rulesets keep HP equal to the round");
const round9 = initial(4242);
round9.round = 9;
round9.bricks = [{ col: 0, row: 7, hp: 999 }];
const round10 = simulate(round9, 150, 4);
assert.equal(round10.round, 10);
assert.ok(round10.bricks.filter((b) => b.row === 7).every((b) => b.hp === 20), "Round 10 spawns 20-HP bricks");
assert.ok(simulate(round9, 150, 3).bricks.filter((b) => b.row === 7).every((b) => b.hp === 10), "Ruleset 3 still spawns round-number HP");
// Frozen ruleset 4 outcome: changing it would break replays of live matches.
let v4 = initial(777);
for (const angle of [33.3, 90, 147.25, 61.5, 12, 75, 100, 45, 130, 88]) if (!v4.over) v4 = simulate(v4, angle, 4);
assert.equal(createHash("sha256").update(JSON.stringify(v4)).digest("hex").slice(0, 16), "a22061d08978aab3");
console.log("PASS: ruleset 4 brick HP progression and frozen replay.");

// Work budget: a shot that costs too much is rejected rather than burning CPU.
// 8,000 balls on a shallow angle each fly for ~1,700 ticks: about 14M ball-steps.
const heavy = initial(1);
heavy.balls = 8000;
heavy.bricks = [];
const heavyFlight = launch(heavy, 8, 3);
while (!heavyFlight.done && !heavyFlight.aborted) step(heavyFlight);
assert.equal(heavyFlight.aborted, true);
assert.ok(heavyFlight.ballSteps <= MAX_BALL_STEPS + heavy.balls);
assert.throws(() => simulate(heavy, 8, 3), /simulation limit/);
assert.throws(() => launch(initial(1), 90, 1), /retired ruleset/);
console.log("PASS: per-shot work budget and retired rulesets.");

// A realistic late-game shot stays well inside the budget.
const late = initial(3);
late.round = 300;
late.balls = 400;
late.bricks = [];
for (let row = 2; row <= 7; row++) for (let col = 0; col < 7; col++) if ((row * 7 + col) % 3) late.bricks.push({ col, row, hp: 300 });
const lateFlight = launch(late, 8.5, 3);
while (!lateFlight.done && !lateFlight.aborted) step(lateFlight);
assert.equal(lateFlight.aborted, false);
assert.ok(lateFlight.ballSteps < MAX_BALL_STEPS / 5);
// Ruleset 4's tougher bricks keep more of the board alive for the whole shot.
for (const b of late.bricks) b.hp = brickHp(late.round, 4);
const tougherFlight = launch(late, 8.5, 4);
while (!tougherFlight.done && !tougherFlight.aborted) step(tougherFlight);
assert.equal(tougherFlight.aborted, false);
assert.ok(tougherFlight.ballSteps < MAX_BALL_STEPS / 5);
console.log("PASS: late-game shots fit the budget with headroom.");
