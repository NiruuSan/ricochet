import assert from 'node:assert/strict';
import {initial,simulate,spawn,launch,step,GROUND} from '../lib/engine.ts';
const first=initial(42076);assert.deepEqual(first,initial(42076));assert.ok(first.bricks.length>=1&&first.bricks.length<=7);assert.equal(new Set(first.bricks.map(b=>b.col)).size,first.bricks.length);assert.ok(first.bricks.every(b=>b.row===7&&b.hp===1));
let left=initial(9988),right=initial(9988);for(let i=0;i<20&&!left.over;i++){left=simulate(left,60+i%40);right=simulate(right,60+i%40);assert.deepEqual(left,right)}
const clear=initial(23);clear.bricks=[{col:3,row:7,hp:1}];const cleared=simulate(clear,90);assert.equal(cleared.score,1);assert.equal(cleared.balls,6);assert.equal(cleared.bonus,true);assert.equal(cleared.round,2);assert.ok(cleared.bricks.every(b=>b.row===7&&b.hp===2));
const miss=initial(23);miss.bricks=[{col:0,row:2,hp:999}];const lost=simulate(miss,90);assert.equal(lost.over,true);assert.equal(lost.bricks[0].row,1);assert.equal(lost.balls,2);
const multi=initial(123);multi.balls=3;multi.bricks=[{col:3,row:7,hp:1}];const f=launch(multi,90);assert.equal(f.balls[1].delay,9);assert.deepEqual([f.balls[0].vx,f.balls[0].vy],[f.balls[2].vx,f.balls[2].vy]);while(!f.done)step(f);assert.equal(f.game.score,1);assert.equal(f.game.balls,8);assert.ok(f.balls.every(b=>b.done&&b.y===GROUND));
assert.throws(()=>launch(first,0));assert.throws(()=>launch(first,NaN));
console.log('PASS: deterministic replay, spawn bounds, unique columns, HP progression, clear bonus, descent loss, sequential multi-ball destruction, return line and aim validation.');

// Decorative gutters must not act as channels through neighboring live bricks.
// Start a volley just outside a seam and verify it reflects off the outer face.
for (const horizontal of [false,true]) {
  const g=initial(1);
  g.bricks=horizontal ? [{col:2,row:4,hp:100},{col:2,row:5,hp:100}] : [{col:1,row:4,hp:100},{col:2,row:4,hp:100}];
  const f=launch(g,90);
  const ball=f.balls[0];
  const cw=472/7,rh=612/9;
  Object.assign(ball,horizontal ? {x:2*cw-6,y:4*rh,vx:4.5,vy:0} : {x:2*cw,y:5*rh+6,vx:0,vy:-4.5});
  for(let i=0;i<6;i++)step(f);
  assert.ok(horizontal?ball.vx<0:ball.vy>0,'Ball must bounce off an adjacent-brick seam');
  assert.equal(f.game.score,1,'A seam must produce one hit, not repeated damage while slipping through');
}
// A truly empty cell remains a valid route between separated bricks.
const gap=initial(1);gap.x=472/2;gap.bricks=[{col:2,row:4,hp:100},{col:4,row:4,hp:100}];
const gapFlight=launch(gap,90);
while(gapFlight.balls[0].y>3*(612/9))step(gapFlight);
assert.equal(gapFlight.game.score,0);
console.log('PASS: neighboring vertical/horizontal seams are solid; empty cells remain open.');
