// Unit checks for the room plumbing that doesn't need a browser: pose packets and edit splitting.
// Run: node --experimental-strip-types dev/unit/net.test.mjs
import assert from 'node:assert/strict';
import { hash32, newPose, packPose, playerNumber, unpackPose } from '../../src/net/pose.ts';

const p = newPose();
p.kind = 1;
p.holding = true;
p.room = hash32('99BR5') & 0xffff;
p.player = playerNumber('k3x9qz');
p.color = 5;
p.held = hash32('k3x9qz.17');
const q = [0.1826, 0.3651, 0.5477, 0.7303]; // unit quaternion
for (let k = 0; k < 4; k++) p.xf.set([k * 0.25 - 0.4, 1.6 - k * 0.1, -2.345 + k, ...q], k * 7);
const s = packPose(p);
assert.equal(s.length, 64, 'fits the relay field');
const o = newPose();
assert.ok(unpackPose(s, o));
assert.equal(o.kind, 1);
assert.equal(o.holding, true);
assert.equal(o.room, p.room);
assert.equal(o.player, p.player);
assert.equal(o.color, 5);
assert.equal(o.held, p.held);
for (let i = 0; i < 28; i++) {
  const tol = i % 7 < 3 ? 0.0006 : 0.012;
  assert.ok(Math.abs(o.xf[i] - p.xf[i]) <= tol, `xf[${i}] ${o.xf[i]} vs ${p.xf[i]}`);
}
// A negative-w quaternion comes back as the same rotation.
p.xf.set([0, 0, 0, -0.5, -0.5, -0.5, -0.5], 0);
unpackPose(packPose(p), o);
const dot = o.xf[3] * -0.5 + o.xf[4] * -0.5 + o.xf[5] * -0.5 + o.xf[6] * -0.5;
assert.ok(Math.abs(Math.abs(dot) - 1) < 0.01, 'same rotation');
assert.equal(unpackPose('x'.repeat(64), o), false, 'rejects junk');
assert.equal(unpackPose('short', o), false);
console.log('pose ok');

const { splitEdit, applyToMap } = await import('../../src/edits.ts');
const big = { set: [], bounds: [{ x0: 0, x1: 0, z0: 0, z1: 0 }, { x0: -4, x1: 4, z0: -4, z1: 4 }] };
for (let i = 0; i < 900; i++) big.set.push([`p.${i}`, null, `3001|4|plastic|${'0.12345,'.repeat(15)}1`]);
const parts = splitEdit(big, 20_000);
assert.ok(parts.length > 1, 'split');
for (const e of parts) assert.ok(JSON.stringify(e).length <= 20_000, 'each part fits');
assert.equal(parts.filter((e) => e.bounds).length, 1, 'bounds travel once');
const m1 = new Map();
const m2 = new Map();
applyToMap(m1, big);
for (const e of parts) applyToMap(m2, e);
assert.deepEqual([...m2], [...m1], 'parts add up to the whole');
assert.equal(splitEdit({ set: [['a', null, 'x']] }).length, 1, 'small edits stay whole');
console.log('splitEdit ok');

const { mergeEdits, invert } = await import('../../src/edits.ts');
const b0 = { x0: 0, x1: 1, z0: 0, z1: 1 };
const b1 = { x0: 0, x1: 2, z0: 0, z1: 1 };
const e1 = { set: [['a', null, 'A1'], ['b', 'B0', 'B1']], bounds: [b0, b1] };
const e2 = { set: [['a', 'A1', 'A2'], ['c', null, 'C1']] };
const e3 = { set: [['c', 'C1', null]], bounds: [b1, b0] };
const merged = mergeEdits([e1, e2, e3]);
assert.deepEqual(merged, { set: [['a', null, 'A2'], ['b', 'B0', 'B1']] }, 'merged, round trips and no-op bounds dropped');
const mm = new Map([['b', 'B0']]);
applyToMap(mm, merged);
const ms = new Map([['b', 'B0']]);
for (const e of [e1, e2, e3]) applyToMap(ms, e);
assert.deepEqual([...mm].sort(), [...ms].sort(), 'same result as one by one');
assert.deepEqual(mergeEdits([e1, invert(e1)]), { set: [] }, 'an edit and its undo cancel');
console.log('mergeEdits ok');
