import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGraph, normalizeIdea, placeChildren, resolveNodeCollisions } from '../src/graph-layout.js';

test('overview fit contains all graph bounds and centers around current idea', () => {
  const nodes = [{ x: -1200, y: -600 }, { x: 0, y: 0 }, { x: 1800, y: 900 }];
  const result = fitGraph(nodes, 1000, 600, nodes[1]);
  const graphCenterX = (Math.min(...nodes.map(node => node.x)) + Math.max(...nodes.map(node => node.x))) / 2;
  const graphCenterY = (Math.min(...nodes.map(node => node.y)) + Math.max(...nodes.map(node => node.y))) / 2;
  assert.ok(result.zoom > 0 && result.zoom < 1);
  assert.equal(result.panX, (nodes[1].x - graphCenterX) * result.zoom);
  assert.equal(result.panY, (nodes[1].y - graphCenterY) * result.zoom);
  assert.ok((1800 - -1200 + 220) * result.zoom <= 1000 - 72);
  assert.ok((900 - -600 + 150) * result.zoom <= 600 - 72);
});

test('overview fit uses identity camera for an empty graph', () => {
  assert.deepEqual(fitGraph([], 800, 500, { x: 0, y: 0 }), { zoom: 1, panX: 0, panY: 0 });
});

test('node collision pass separates variable-width labels deterministically without mutating saved coordinates', () => {
  const nodes = [
    { id: 'root', parent_id: null, label: 'Starting point', x: 0, y: 0 },
    { id: 'short', parent_id: 'root', label: 'Short', x: 25, y: 0 },
    { id: 'long', parent_id: 'root', label: 'A considerably longer branch label', x: 28, y: 8 },
    { id: 'other', parent_id: 'short', label: 'Another nearby idea', x: 45, y: 14 },
  ];
  const original = structuredClone(nodes);
  const resolved = resolveNodeCollisions(nodes);
  assert.deepEqual(resolveNodeCollisions(nodes), resolved);
  assert.deepEqual(nodes, original);
  assert.deepEqual(resolved.find(node => node.id === 'root') && { x: resolved[0].x, y: resolved[0].y }, { x: 0, y: 0 });

  for (let i = 0; i < resolved.length; i++) {
    const a = resolved[i];
    const aWidth = Math.min(190, Math.max(64, a.label.length * 7.4 + 22));
    const aHeight = 64 + Math.max(1, Math.ceil((a.label.length * 7.4) / (aWidth - 18))) * 18;
    for (const b of resolved.slice(i + 1)) {
      const bWidth = Math.min(190, Math.max(64, b.label.length * 7.4 + 22));
      const bHeight = 64 + Math.max(1, Math.ceil((b.label.length * 7.4) / (bWidth - 18))) * 18;
      const overlapsX = Math.abs(a.x - b.x) < (aWidth + bWidth) / 2 + 16;
      const overlapsY = Math.abs(a.y - b.y) < (aHeight + bHeight) / 2 + 16;
      assert.ok(!(overlapsX && overlapsY), `${a.label} overlaps ${b.label}`);
    }
  }
});

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
