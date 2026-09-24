import { db, id } from './db.js';

const estimates: Record<string, number> = { dreamer: 0.004, jev: 0.003, narrator: 0.005, validation: 0.008 };
const busy = new Set<string>();
export async function exclusive<T>(fn: () => Promise<T>, lane = 'settings'): Promise<T> {
  if (busy.has(lane)) throw new Error('Another operation of this type is in progress. Try again shortly.');
  busy.add(lane);
  try { return await fn(); } finally { busy.delete(lane); }
}

export function reserve(operationId: string | null, role: string) {
  const reservation = estimates[role] ?? 0.01;
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() as { hourly_spend_limit: number; daily_expansion_cap: number; daily_pin_cap: number };
  const spend = db.prepare("SELECT COALESCE(SUM(COALESCE(cost,reservation)),0) AS total FROM model_calls WHERE created_at >= datetime('now','-1 hour')").get() as { total: number };
  if (spend.total + reservation > settings.hourly_spend_limit) throw new Error('Hourly spend limit reached. Try again later.');
  const callId = id();
  db.prepare('INSERT INTO model_calls(id,operation_id,role,reservation,status) VALUES(?,?,?,?,?)').run(callId, operationId, role, reservation, 'pending');
  return (cost?: number, details?: { requestId?: string; provider?: string; model?: string; inputTokens?: number; outputTokens?: number; latencyMs?: number }) => db.prepare('UPDATE model_calls SET cost=?,status=?,provider_request_id=?,provider=?,model=?,input_tokens=?,output_tokens=?,latency_ms=? WHERE id=?').run(
    typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    typeof cost === 'number' ? 'complete' : 'uncertain', details?.requestId ?? null, details?.provider ?? null,
    details?.model ?? null, details?.inputTokens ?? null, details?.outputTokens ?? null, details?.latencyMs ?? null, callId,
  );
}

export function checkDaily(kind: 'expand' | 'pin') {
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() as { daily_expansion_cap: number; daily_pin_cap: number };
  const count = db.prepare("SELECT COUNT(*) AS total FROM operations WHERE kind=? AND created_at >= date('now')").get(kind) as { total: number };
  if (count.total >= (kind === 'expand' ? settings.daily_expansion_cap : settings.daily_pin_cap)) throw new Error(`Daily ${kind} limit reached (resets at 00:00 UTC).`);
}

export function spendToday() {
  return (db.prepare("SELECT COALESCE(SUM(COALESCE(cost,reservation)),0) AS total FROM model_calls WHERE created_at >= date('now')").get() as { total: number }).total;
}
