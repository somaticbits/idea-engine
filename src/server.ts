import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { readFile } from 'node:fs/promises';
import { db, id, getNode, getGraph, getTrip, children, chain, createTrip, operation } from './db.js';
import { getKey, keyStatus, removeKey, saveKey } from './auth/openrouter.js';
import { MAX_REQUEST_BYTES, type Dose } from './config.js';
import { tripSchema, expandSchema, kitSchema } from './schema.js';
import { checkDaily, exclusive, spendToday } from './limits.js';
import { dream } from './pipeline/dream.js';
import { filter } from './pipeline/filter.js';
import { narrate } from './pipeline/narrate.js';
import { exportCard } from './export.js';
import { ProviderError, ResultError } from './pipeline/provider.js';
import { normalizeIdea, placeChildren } from './graph-layout.js';
import { retryForUsableAssociations } from './pipeline/association-retry.js';

const app = new Hono();
const origin = 'http://127.0.0.1:8080';
app.use('*', async (c, next) => {
  const host = c.req.header('host');
  if (host && !['127.0.0.1:8080', 'localhost:8080', '127.0.0.1:5173', 'localhost:5173'].includes(host)) return c.text('Invalid host', 403);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const requestOrigin = c.req.header('origin');
    if (requestOrigin && ![origin, 'http://localhost:8080', 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(requestOrigin)) return c.text('Invalid origin', 403);
    if ((Number(c.req.header('content-length')) || 0) > MAX_REQUEST_BYTES) return c.text('Request too large', 413);
    if (c.req.header('content-type')?.split(';')[0] !== 'application/json' && c.req.path !== '/api/data') return c.text('Expected JSON', 415);
    if (c.req.path !== '/api/data' && (await c.req.raw.clone().text()).length > MAX_REQUEST_BYTES) return c.text('Request too large', 413);
  }
  await next();
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});
app.onError((error, c) => {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(JSON.stringify({ route: c.req.path, error: message.replace(/sk-or-[\w-]+/g, '[redacted]') }));
  return c.json({ error: message.replace(/sk-or-[\w-]+/g, '[redacted]') }, 400);
});
app.get('/healthz', c => c.json({ ok: true }));
app.get('/api/setup', async c => c.json(await keyStatus()));
app.put('/api/setup/key', async c => {
  const { key } = await c.req.json();
  if (typeof key !== 'string') return c.json({ error: 'Key is required.' }, 400);
  await exclusive(() => saveKey(key.trim()));
  return c.json(await keyStatus());
});
app.delete('/api/setup/key', async c => { await removeKey(); return c.json(await keyStatus()); });
app.get('/api/settings', c => c.json({ ...(db.prepare('SELECT daily_expansion_cap,daily_pin_cap,hourly_spend_limit FROM settings WHERE id=1').get() as object), spend_today: spendToday() }));
app.put('/api/settings', async c => {
  const body = await c.req.json();
  const { daily_expansion_cap, daily_pin_cap, hourly_spend_limit } = body;
  if (!Number.isInteger(daily_expansion_cap) || daily_expansion_cap < 1 || daily_expansion_cap > 1000 || !Number.isInteger(daily_pin_cap) || daily_pin_cap < 1 || daily_pin_cap > 1000 || typeof hourly_spend_limit !== 'number' || hourly_spend_limit < 0.01 || hourly_spend_limit > 100) return c.json({ error: 'Invalid limits.' }, 400);
  db.prepare('UPDATE settings SET daily_expansion_cap=?,daily_pin_cap=?,hourly_spend_limit=? WHERE id=1').run(daily_expansion_cap, daily_pin_cap, hourly_spend_limit);
  return c.json(db.prepare('SELECT * FROM settings WHERE id=1').get());
});
app.get('/api/kit', c => c.json(JSON.parse((db.prepare('SELECT items FROM kit WHERE id=1').get() as { items: string }).items)));
app.put('/api/kit', async c => { const kit = kitSchema.parse(await c.req.json()); db.prepare('UPDATE kit SET items=? WHERE id=1').run(JSON.stringify(kit)); return c.json(kit); });
app.post('/api/trips', async c => {
  const parsed = tripSchema.parse(await c.req.json());
  const kit = parsed.kit ?? JSON.parse((db.prepare('SELECT items FROM kit WHERE id=1').get() as { items: string }).items);
  return c.json(createTrip(parsed.seed, parsed.dose, kit), 201);
});
app.get('/api/trips', c => c.json(db.prepare('SELECT * FROM trips ORDER BY created_at DESC LIMIT 100').all()));
app.get('/api/trips/:id', c => { const graph = getGraph(c.req.param('id')); return graph ? c.json(graph) : c.json({ error: 'Trip not found.' }, 404); });
app.put('/api/trips/:id/route', async c => {
  const tripId = c.req.param('id');
  if (!getTrip(tripId)) return c.json({ error: 'Trip not found.' }, 404);
  const body = await c.req.json();
  if (!Array.isArray(body?.nodes) || !body.nodes.length || body.nodes.length > 2000 || !body.nodes.every((nodeId: unknown) => typeof nodeId === 'string') || !Number.isInteger(body.cursor) || body.cursor < 0 || body.cursor >= body.nodes.length) return c.json({ error: 'Invalid route.' }, 400);
  const routeNodes = body.nodes as string[];
  const validNodes = new Set((db.prepare('SELECT id FROM nodes WHERE trip_id=?').all(tripId) as { id: string }[]).map(node => node.id));
  if (routeNodes.some(nodeId => !validNodes.has(nodeId))) return c.json({ error: 'Route contains an idea outside this trip.' }, 400);
  for (let index = 1; index < routeNodes.length; index++) {
    const from = routeNodes[index - 1], to = routeNodes[index];
    const treeEdge = db.prepare('SELECT 1 FROM nodes WHERE (id=? AND parent_id=?) OR (id=? AND parent_id=?)').get(to, from, from, to);
    const loopEdge = db.prepare('SELECT 1 FROM connections WHERE (from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?)').get(from, to, to, from);
    if (!treeEdge && !loopEdge) return c.json({ error: 'Route includes a connection that does not exist.' }, 400);
  }
  db.prepare(`INSERT INTO trip_routes(trip_id,nodes,cursor) VALUES(?,?,?)
    ON CONFLICT(trip_id) DO UPDATE SET nodes=excluded.nodes,cursor=excluded.cursor`).run(tripId, JSON.stringify(routeNodes), body.cursor);
  return c.json({ ok: true });
});
app.post('/api/operations/:kind/:target/retry', async c => {
  const kind = c.req.param('kind'), target = c.req.param('target');
  if (kind !== 'expand' && kind !== 'pin') return c.json({ error: 'Unknown operation.' }, 404);
  const body = await c.req.json();
  if (body?.confirmUncertain !== true || Object.keys(body).length !== 1) return c.json({ error: 'Explicit confirmation is required.' }, 400);
  return exclusive(async () => {
    const previous = operation(kind, target), node = getNode(target);
    if (!node || previous?.status !== 'uncertain') return c.json({ error: 'No uncertain operation to retry.' }, 409);
    if (kind === 'expand' && node.expanded || kind === 'pin' && db.prepare('SELECT id FROM cards WHERE node_id=?').get(target)) return c.json({ error: 'The result already exists. Reload this trip.' }, 409);
    db.prepare("UPDATE operations SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(previous.id);
    return c.json({ ok: true, note: 'The earlier attempt may have been billed; retrying will make another paid call.' });
  });
});

async function runOperation<T>(kind: 'expand' | 'pin', target: string, dose: Dose | null, task: (key: string, opId: string) => Promise<T>, persist: (result: T, opId: string) => unknown) {
  return exclusive(async () => {
    const previous = operation(kind, target);
    if (previous?.status === 'complete') return previous.result_id;
    if (previous && previous.status !== 'failed') throw new Error('This operation has an uncertain outcome; it will not be replayed automatically.');
    if (!previous) checkDaily(kind);
    const key = await getKey();
    if (!key) throw new Error('Connect an OpenRouter key in Setup first.');
    const opId = previous?.id ?? id();
    if (previous) db.prepare("UPDATE operations SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(opId);
    else db.prepare('INSERT INTO operations(id,kind,target_id,status,dose) VALUES(?,?,?,?,?)').run(opId, kind, target, 'running', dose);
    try {
      const result = await task(key, opId);
      return db.transaction(() => {
        const resultId = persist(result, opId);
        db.prepare("UPDATE operations SET status='complete',result_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(resultId, opId);
        return resultId;
      })();
    } catch (error) {
      // Definite HTTP rejections cannot have produced a successful graph/card; timeouts remain uncertain.
      const status = error instanceof ProviderError || error instanceof ResultError ? 'failed' : 'uncertain';
      db.prepare('UPDATE operations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, opId);
      throw error;
    }
  }, kind);
}

app.post('/api/nodes/:id/expand', async c => {
  const node = getNode(c.req.param('id'));
  if (!node) return c.json({ error: 'Node not found.' }, 404);
  const { dose } = expandSchema.parse(await c.req.json());
  if (node.expanded) return c.json(children(node.id));
  const trip = getTrip(node.trip_id)!;
  const kit = JSON.parse(trip.kit) as string[];
  const run = async (progress: (stage: string) => void) => {
    await runOperation('expand', node.id, dose, async (key, opId) => {
    return retryForUsableAssociations(async () => {
      progress('Dreaming of associations');
      const candidates = await dream(key, trip.seed, chain(node), kit, dose, opId);
      if (candidates.length === 0) throw new ResultError('Dreamer returned no usable association phrases.');
      progress('Filtering with Jev');
      return filter(key, trip.seed, node.label, kit, candidates, dose, opId);
    }, results => {
      const tripNodes = db.prepare('SELECT id,parent_id,label FROM nodes WHERE trip_id=?').all(node.trip_id) as Pick<import('./db.js').Node, 'id' | 'parent_id' | 'label'>[];
      const labels = new Map(tripNodes.map(existing => [normalizeIdea(existing.label), existing]));
      return results.some(item => {
        const match = labels.get(normalizeIdea(item.label));
        return !match || (match.id !== node.id && match.parent_id !== node.id);
      });
    }, attempt => progress(`Searching for usable branches · attempt ${attempt}/3`));
    }, results => {
    const tripNodes = db.prepare('SELECT * FROM nodes WHERE trip_id=? ORDER BY created_at,id').all(node.trip_id) as import('./db.js').Node[];
    const labels = new Map(tripNodes.map(existing => [normalizeIdea(existing.label), existing]));
    const novel: typeof results = [];
    const loops: Array<{ source: string; target: string }> = [];
    for (const item of results) {
      const match = labels.get(normalizeIdea(item.label));
      if (match) {
        if (match.id !== node.id && match.parent_id !== node.id) loops.push({ source: node.id, target: match.id });
      } else {
        novel.push(item);
        // Avoid duplicate ideas in the same returned batch without creating duplicate nodes.
        labels.set(normalizeIdea(item.label), { id: `batch:${novel.length}`, parent_id: node.id } as import('./db.js').Node);
      }
    }
    const occupied = tripNodes.filter(existing => Number.isFinite(existing.x) && Number.isFinite(existing.y)).map(existing => ({ x: existing.x, y: existing.y }));
    const positions = placeChildren(node.id, node, novel.length, occupied);
    novel.forEach((item, index) => db.prepare('INSERT INTO nodes(id,trip_id,parent_id,label,scores,x,y) VALUES(?,?,?,?,?,?,?)').run(id(), node.trip_id, node.id, item.label, JSON.stringify(item.scores), positions[index].x, positions[index].y));
    for (const loop of loops) db.prepare("INSERT OR IGNORE INTO connections(id,from_node_id,to_node_id,kind) VALUES(?,?,?,'loop')").run(id(), loop.source, loop.target);
    db.prepare('UPDATE nodes SET expanded=1 WHERE id=?').run(node.id);
    return node.id;
    });
    return children(node.id);
  };
  if (c.req.header('accept') === 'text/event-stream') {
    return streamSSE(c, async stream => {
      let stage = 'Starting expansion';
      const started = Date.now();
      const sendProgress = (message: string) => { void stream.writeSSE({ event: 'progress', data: JSON.stringify({ stage: message }) }).catch(() => {}); };
      const progress = (message: string) => { stage = message; sendProgress(message); };
      const heartbeat = setInterval(() => sendProgress(`${stage} · provider still responding (${Math.floor((Date.now() - started) / 1000)}s)`), 12_000);
      try {
        const result = await run(progress);
        await stream.writeSSE({ event: 'result', data: JSON.stringify(result) }).catch(() => {});
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Expansion failed.';
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: message }) }).catch(() => {});
      } finally {
        clearInterval(heartbeat);
      }
    });
  }
  return c.json(await run(() => {}));
});
app.post('/api/nodes/:id/pin', async c => {
  const node = getNode(c.req.param('id'));
  if (!node) return c.json({ error: 'Node not found.' }, 404);
  const existing = db.prepare('SELECT * FROM cards WHERE node_id=?').get(node.id);
  if (existing) return c.json(existing);
  const body = await c.req.json().catch(() => ({}));
  const routeSnapshot = Array.isArray(body?.route) && body.route.length <= 2000 && body.route.every((routeId: unknown) => typeof routeId === 'string')
    ? body.route as string[]
    : [];
  const tripNodeIds = new Set((db.prepare('SELECT id FROM nodes WHERE trip_id=?').all(node.trip_id) as { id: string }[]).map(row => row.id));
  if (routeSnapshot.some(routeId => !tripNodeIds.has(routeId)) || (routeSnapshot.length && routeSnapshot.at(-1) !== node.id)) return c.json({ error: 'Invalid route snapshot.' }, 400);
  const trip = getTrip(node.trip_id)!;
  await runOperation('pin', node.id, null, (key, opId) => narrate(key, chain(node), JSON.parse(trip.kit), opId), card => {
    const cardId = id();
    db.prepare('INSERT INTO cards(id,node_id,pitch,chain,stack,prototype,wildcard,route_snapshot) VALUES(?,?,?,?,?,?,?,?)').run(cardId, node.id, card.pitch, JSON.stringify(card.chain), card.stack, card.prototype, card.wildcard, JSON.stringify(routeSnapshot));
    db.prepare('UPDATE nodes SET pinned=1 WHERE id=?').run(node.id);
    return cardId;
  });
  return c.json(db.prepare('SELECT * FROM cards WHERE node_id=?').get(node.id));
});
app.get('/api/cards/:id/export', c => {
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(c.req.param('id')) as { pitch: string; chain: string; stack: string; prototype: string; wildcard: string } | undefined;
  if (!card) return c.json({ error: 'Card not found.' }, 404);
  const format = c.req.query('format') === 'agent' ? 'agent' : 'markdown';
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(exportCard({ ...card, chain: JSON.parse(card.chain) }, format));
});
app.delete('/api/data', c => { db.transaction(() => { db.prepare('DELETE FROM trips').run(); db.prepare('DELETE FROM operations').run(); })(); return c.json({ ok: true }); });

app.all('/api/*', c => c.json({ error: 'API route not found.' }, 404));
app.use('/*', serveStatic({ root: './public' }));
app.get('*', async c => c.html(await readFile('./public/index.html', 'utf8')));
serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('Idea Engine listening on port 8080');
