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
    return Response.json({ choices: [{ message: { content: requests.length === 1 ? '1. underground knock\n2. paper heartbeat' : JSON.stringify({ pitch: 'A tactile message', chain: ['doorbell', 'underground knock'], stack: 'ESP32', prototype: 'Blink on a knock', wildcard: 'A printer' }) } }], usage: { cost: .00014 } });
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
