import test from 'node:test';
import assert from 'node:assert/strict';
test('pin and expansion operations can run independently while duplicate lane work is guarded', async () => {
  process.env.DB_PATH = ':memory:';
  const { exclusive } = await import('../src/limits.js');
  let finishExpansion!: () => void;
  const expansion = exclusive(() => new Promise<void>(resolve => { finishExpansion = resolve; }), 'expand');
  await Promise.resolve();

  assert.equal(await exclusive(async () => 'pinned', 'pin'), 'pinned');
  await assert.rejects(exclusive(async () => 'duplicate', 'expand'), /Another operation of this type/);

  finishExpansion();
  await expansion;
  assert.equal(await exclusive(async () => 'next expansion', 'expand'), 'next expansion');
});
