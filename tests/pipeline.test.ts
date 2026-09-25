import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

test('Dreamer → Jev → card uses fixed model calls and records provider cost', async () => {
  const { dream } = await import('../src/pipeline/dream.js');
  const { filter } = await import('../src/pipeline/filter.js');
  const { narrate } = await import('../src/pipeline/narrate.js');
  const { db } = await import('../src/db.js');
  const original = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const deadlines: number[] = [];
  AbortSignal.timeout = (milliseconds: number) => { deadlines.push(milliseconds); return new AbortController().signal; };
  const requests: Array<{ path: string; body: any }> = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url), body = JSON.parse(String(init?.body));
    requests.push({ path, body });
    if (path.endsWith('/systemone')) {
      const answers = Object.fromEntries(Object.keys(body.questions).map(id => [id,
        id.endsWith('surprise') ? { type: 'score', score: 2.7 } : { type: 'noul', noul: .95 },
      ]));
      return Response.json({ answers, usage: { cost: .00003 } });
    }
    return Response.json({ choices: [{ message: { content: requests.length === 1 ? '1. underground knock\n2. paper heartbeat' : JSON.stringify({ pitch: 'A tactile message', stack: 'ESP32', prototype: 'Blink on a knock', wildcard: 'A printer' }) } }], usage: { cost: .00014 } });
  };
  try {
    const candidates = await dream('fake-key', 'doorbell', ['doorbell'], [], 'medium', 'fixture-operation');
    const kept = await filter('fake-key', 'doorbell', 'doorbell', [], candidates, 'medium', 'fixture-operation');
    const card = await narrate('fake-key', ['doorbell', kept[0].label], [], 'fixture-operation');
    assert.equal(kept.length, 2);
    assert.deepEqual(card.chain, ['doorbell', kept[0].label]);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].body.provider.zdr, true);
    assert.equal(requests[0].body.provider.data_collection, 'deny');
    assert.deepEqual(requests[0].body.provider.order, ['together', 'coreweave/fp8', 'novita/fp8']);
    assert.deepEqual(requests[2].body.provider, requests[0].body.provider);
    assert.match(requests[2].body.messages[1].content, /do not repeat it in the output/i);
    assert.equal(requests[1].body.model, 'jev-1.13');
    assert.deepEqual(deadlines, [30_000, 30_000, 30_000]);
    assert.equal((db.prepare('SELECT SUM(cost) AS total FROM model_calls').get() as { total: number }).total, .00031);
    const call = db.prepare("SELECT model,latency_ms FROM model_calls WHERE role='dreamer'").get() as { model: string; latency_ms: number };
    assert.equal(call.model, 'deepseek/deepseek-v4.1-flash');
    assert.ok(call.latency_ms >= 0);
  } finally { globalThis.fetch = original; AbortSignal.timeout = originalTimeout; }
});

test('timed-out chat calls preserve spend reservations and explain manual retry', async () => {
  const { callChat } = await import('../src/pipeline/provider.js');
  const { db } = await import('../src/db.js');
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'TimeoutError'); };
  try {
    await assert.rejects(callChat('fake-key', { model: 'deepseek/deepseek-v4.1-flash', messages: [] }, 'dreamer'), /timed out after 30 seconds.*may have been billed/);
    const call = db.prepare("SELECT status,cost,reservation FROM model_calls WHERE role='dreamer' ORDER BY rowid DESC LIMIT 1").get() as { status: string; cost: number | null; reservation: number };
    assert.equal(call.status, 'uncertain');
    assert.equal(call.cost, null);
    assert.ok(call.reservation > 0);
  } finally { globalThis.fetch = original; }
});

test('Narrator retries invalid concept output up to three total calls', async () => {
  const { narrate } = await import('../src/pipeline/narrate.js');
  const { db } = await import('../src/db.js');
  const original = globalThis.fetch;
  const requests: Array<{ body: any }> = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ body });
    const content = requests.length < 3
      ? JSON.stringify({ pitch: 'A concept without its required fields' })
      : JSON.stringify({ pitch: 'A tactile doorbell', stack: 'ESP32', prototype: 'Blink on a knock', wildcard: 'A paper heartbeat' });
    return Response.json({ choices: [{ message: { content } }], usage: { cost: .0001 } });
  };
  try {
    const path = ['doorbell', 'paper heartbeat'];
    const card = await narrate('fake-key', path, [], 'narrator-retry-test');
    assert.equal(requests.length, 3);
    assert.match(requests[1].body.messages[1].content, /previous JSON did not satisfy the required fields/i);
    assert.match(requests[2].body.messages[1].content, /previous JSON did not satisfy the required fields/i);
    assert.deepEqual(card.chain, path);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM model_calls WHERE operation_id='narrator-retry-test'").get()?.total, 3);
  } finally { globalThis.fetch = original; }
});

test('Narrator reports a clear failure after three invalid concepts', async () => {
  const { narrate } = await import('../src/pipeline/narrate.js');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: '{"pitch":"incomplete"}' } }], usage: { cost: .0001 } });
  };
  try {
    await assert.rejects(narrate('fake-key', ['doorbell'], [], 'narrator-failed-retry-test'), /valid card after 3 attempts/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
