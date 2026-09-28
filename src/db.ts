import Database from 'better-sqlite3';
import { v7 } from 'uuid';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { placeChildren } from './graph-layout.js';
import { DEFAULT_MODELS, type ModelSettings } from './config.js';

const dbPath = process.env.DB_PATH ?? './data/idea.db';
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, seed TEXT NOT NULL, dose TEXT NOT NULL, kit TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE, label TEXT NOT NULL, scores TEXT, expanded INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS nodes_trip_parent ON nodes(trip_id,parent_id);
CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, from_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, to_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'loop', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(from_node_id,to_node_id,kind));
CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, node_id TEXT UNIQUE NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, pitch TEXT NOT NULL, chain TEXT NOT NULL, stack TEXT NOT NULL, prototype TEXT NOT NULL, wildcard TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS trip_routes (trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE, nodes TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS kit (id INTEGER PRIMARY KEY CHECK(id=1), items TEXT NOT NULL DEFAULT '[]');
INSERT OR IGNORE INTO kit(id,items) VALUES(1,'[]');
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  daily_expansion_cap INTEGER NOT NULL DEFAULT 200,
  daily_pin_cap INTEGER NOT NULL DEFAULT 30,
  hourly_spend_limit REAL NOT NULL DEFAULT 2,
  dreamer_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.dreamer}',
  jev_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.jev}',
  narrator_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.narrator}'
);
INSERT OR IGNORE INTO settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, status TEXT NOT NULL, result_id TEXT, dose TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(kind,target_id));
CREATE TABLE IF NOT EXISTS model_calls (id TEXT PRIMARY KEY, operation_id TEXT, role TEXT NOT NULL, cost REAL, reservation REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
export function migrateModelSettings(database: Database.Database) {
  const columns = new Set((database.pragma('table_info(settings)') as { name: string }[]).map(column => column.name));
  const defaults: Array<[string, string]> = [
    ['dreamer_model', DEFAULT_MODELS.dreamer],
    ['jev_model', DEFAULT_MODELS.jev],
    ['narrator_model', DEFAULT_MODELS.narrator],
  ];
  for (const [name, value] of defaults) {
    if (!columns.has(name)) database.exec(`ALTER TABLE settings ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${value}'`);
  }
}
migrateModelSettings(db);
const cardColumns = new Set((db.pragma('table_info(cards)') as { name: string }[]).map(column => column.name));
if (!cardColumns.has('route_snapshot')) db.exec("ALTER TABLE cards ADD COLUMN route_snapshot TEXT NOT NULL DEFAULT '[]'");
const nodeColumns = new Set((db.pragma('table_info(nodes)') as { name: string }[]).map(column => column.name));
if (!nodeColumns.has('x')) db.exec('ALTER TABLE nodes ADD COLUMN x REAL');
if (!nodeColumns.has('y')) db.exec('ALTER TABLE nodes ADD COLUMN y REAL');
// Place nodes from older installs once; existing positions are never recalculated.
const unplacedRoots = db.prepare('SELECT id FROM nodes WHERE parent_id IS NULL AND (x IS NULL OR y IS NULL) ORDER BY created_at,id').all() as { id: string }[];
for (const root of unplacedRoots) db.prepare('UPDATE nodes SET x=0,y=0 WHERE id=?').run(root.id);
while (true) {
  const parents = db.prepare(`SELECT DISTINCT p.id,p.x,p.y FROM nodes p JOIN nodes n ON n.parent_id=p.id
    WHERE (n.x IS NULL OR n.y IS NULL) AND p.x IS NOT NULL AND p.y IS NOT NULL`).all() as { id: string; x: number; y: number }[];
  if (!parents.length) break;
  for (const parent of parents) {
    const unplaced = db.prepare('SELECT id FROM nodes WHERE parent_id=? AND (x IS NULL OR y IS NULL) ORDER BY created_at,id').all(parent.id) as { id: string }[];
    const occupied = db.prepare('SELECT x,y FROM nodes WHERE trip_id=(SELECT trip_id FROM nodes WHERE id=?) AND x IS NOT NULL AND y IS NOT NULL').all(parent.id) as { x: number; y: number }[];
    const points = placeChildren(parent.id, parent, unplaced.length, occupied);
    unplaced.forEach((node, index) => db.prepare('UPDATE nodes SET x=?,y=? WHERE id=?').run(points[index].x, points[index].y, node.id));
  }
}
db.prepare(`INSERT OR IGNORE INTO trip_routes(trip_id,nodes,cursor)
  SELECT t.id,json_array((SELECT n.id FROM nodes n WHERE n.trip_id=t.id AND n.parent_id IS NULL ORDER BY n.created_at LIMIT 1)),0 FROM trips t`).run();
// Additive migration for installations created before live provider verification.
const modelCallColumns = new Set((db.pragma('table_info(model_calls)') as { name: string }[]).map(column => column.name));
for (const column of ['provider_request_id TEXT', 'provider TEXT', 'model TEXT', 'input_tokens INTEGER', 'output_tokens INTEGER', 'latency_ms INTEGER']) {
  if (!modelCallColumns.has(column.split(' ')[0])) db.exec(`ALTER TABLE model_calls ADD COLUMN ${column}`);
}

export type Trip = { id: string; seed: string; dose: string; kit: string; created_at: string };
export type Node = { id: string; trip_id: string; parent_id: string | null; label: string; scores: string | null; expanded: number; pinned: number; x: number; y: number };
export type Connection = { id: string; from_node_id: string; to_node_id: string; kind: string };
export type Operation = { id: string; kind: string; target_id: string; status: string; result_id: string | null };
export function getModelSettings(): ModelSettings {
  const row = db.prepare('SELECT dreamer_model,jev_model,narrator_model FROM settings WHERE id=1').get() as {
    dreamer_model: string; jev_model: string; narrator_model: string;
  };
  return { dreamer: row.dreamer_model, jev: row.jev_model, narrator: row.narrator_model };
}
export function setModelSettings(models: ModelSettings) {
  db.prepare('UPDATE settings SET dreamer_model=?,jev_model=?,narrator_model=? WHERE id=1').run(models.dreamer, models.jev, models.narrator);
  return getModelSettings();
}
export const id = () => v7();
export const getTrip = (tripId: string) => db.prepare('SELECT * FROM trips WHERE id=?').get(tripId) as Trip | undefined;
export const getNode = (nodeId: string) => db.prepare('SELECT * FROM nodes WHERE id=?').get(nodeId) as Node | undefined;
export const children = (nodeId: string) => db.prepare('SELECT * FROM nodes WHERE parent_id=? ORDER BY created_at,id').all(nodeId) as Node[];
export const operation = (kind: string, target: string) => db.prepare('SELECT * FROM operations WHERE kind=? AND target_id=?').get(kind, target) as Operation | undefined;

export function createTrip(seed: string, dose: string, kit: string[]) {
  const tripId = id(), rootId = id();
  db.transaction(() => {
    db.prepare('INSERT INTO trips(id,seed,dose,kit) VALUES(?,?,?,?)').run(tripId, seed, dose, JSON.stringify(kit));
    db.prepare('INSERT INTO nodes(id,trip_id,label,x,y) VALUES(?,?,?,0,0)').run(rootId, tripId, seed);
    db.prepare('INSERT INTO trip_routes(trip_id,nodes,cursor) VALUES(?,?,0)').run(tripId, JSON.stringify([rootId]));
  })();
  return { trip: getTrip(tripId)!, nodes: [getNode(rootId)!] };
}

export function getGraph(tripId: string) {
  const trip = getTrip(tripId);
  if (!trip) return undefined;
  const route = db.prepare('SELECT nodes,cursor FROM trip_routes WHERE trip_id=?').get(tripId) as { nodes: string; cursor: number } | undefined;
  return {
    trip,
    nodes: db.prepare('SELECT * FROM nodes WHERE trip_id=? ORDER BY created_at,id').all(tripId) as Node[],
    cards: db.prepare('SELECT cards.id,cards.node_id,cards.pitch,cards.chain,cards.stack,cards.prototype,cards.wildcard,cards.route_snapshot,cards.created_at FROM cards JOIN nodes ON cards.node_id=nodes.id WHERE nodes.trip_id=?').all(tripId),
    connections: db.prepare('SELECT c.* FROM connections c JOIN nodes n ON n.id=c.from_node_id WHERE n.trip_id=?').all(tripId) as Connection[],
    route: route ? { nodes: JSON.parse(route.nodes) as string[], cursor: route.cursor } : { nodes: [], cursor: 0 },
  };
}

export function chain(node: Node) {
  const labels: string[] = [];
  let cursor: Node | undefined = node;
  while (cursor) { labels.unshift(cursor.label); cursor = cursor.parent_id ? getNode(cursor.parent_id) : undefined; }
  return labels;
}

// Peel old, unpinned leaves until no eligible branch remains. Pinned nodes and
// their ancestors remain reachable; card chains are independently persisted.
export function pruneOldBranches() {
  const stmt = db.prepare(`DELETE FROM nodes WHERE id IN (
    SELECT n.id FROM nodes n WHERE n.parent_id IS NOT NULL AND n.pinned=0
      AND n.created_at < datetime('now','-90 days')
      AND NOT EXISTS (SELECT 1 FROM nodes child WHERE child.parent_id=n.id)
  )`);
  let changes = 0;
  do { changes = stmt.run().changes; } while (changes > 0);
}
pruneOldBranches();
