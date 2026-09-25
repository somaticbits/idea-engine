import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ASSOCIATION_ATTEMPTS, retryForUsableAssociations } from '../src/pipeline/association-retry.js';
import { ProviderError, ResultError } from '../src/pipeline/provider.js';

test('association search retries unusable batches and returns the first usable result', async () => {
  let calls = 0;
  const progress: number[] = [];
  const result = await retryForUsableAssociations(
    async () => ++calls < 3 ? [] : ['paper heartbeat'],
    items => items.length > 0,
    attempt => progress.push(attempt),
  );

  assert.deepEqual(result, ['paper heartbeat']);
  assert.equal(calls, 3);
  assert.deepEqual(progress, [1, 2, 3]);
});

test('association search retries invalid model results but stops after its limit', async () => {
  let calls = 0;
  await assert.rejects(
    retryForUsableAssociations(async () => {
      calls++;
      throw new ResultError('Jev returned no answers.');
    }, () => true),
    new RegExp(`after ${MAX_ASSOCIATION_ATTEMPTS} attempts.*Jev returned no answers`),
  );
  assert.equal(calls, MAX_ASSOCIATION_ATTEMPTS);
});

test('association search does not retry provider failures', async () => {
  let calls = 0;
  await assert.rejects(
    retryForUsableAssociations(async () => {
      calls++;
      throw new ProviderError(401, 'Unauthorized');
    }, () => true),
    error => error instanceof ProviderError && error.status === 401,
  );
  assert.equal(calls, 1);
});
