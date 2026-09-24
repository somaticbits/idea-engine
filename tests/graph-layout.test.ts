import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdea, placeChildren } from '../src/graph-layout.js';

test('child positions are deterministic and avoid existing idea positions', () => {
  const parent = { x: 0, y: 0 };
  const occupied = [{ x: 300, y: 0 }, { x: -300, y: 0 }];
  const first = placeChildren('parent-1', parent, 8, occupied);
  assert.deepEqual(placeChildren('parent-1', parent, 8, occupied), first);
  for (const point of first) {
    for (const other of [...occupied, ...first.filter(candidate => candidate !== point)]) {
      assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= 155);
    }
  }
});

test('idea matching ignores case and punctuation while preserving words', () => {
  assert.equal(normalizeIdea('  Paper—Heartbeat! '), 'paper heartbeat');
  assert.equal(normalizeIdea('PAPER heartbeat'), normalizeIdea('paper-heartbeat'));
});
