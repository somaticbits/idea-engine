import { reserve } from '../limits.js';

const BASE = 'https://openrouter.ai/api/v1';
export class ProviderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class ResultError extends Error {}

async function post(key: string, path: string, body: object, role: string, operationId?: string) {
  // This ZDR flash route has been live-tested in ~2s. Fail promptly if routing degrades.
  const timeoutMs = 30_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const settle = reserve(operationId ?? null, role);
    const startedAt = performance.now();
    let cost: number | undefined;
    let settled = false;
    const finish = (value?: number, result?: Record<string, any>) => {
      settle(value, {
        requestId: typeof result?.id === 'string' ? result.id : undefined,
        provider: typeof result?.provider === 'string' ? result.provider : undefined,
        model: typeof result?.model === 'string' ? result.model : 'model' in body && typeof body.model === 'string' ? body.model : undefined,
        inputTokens: result?.usage?.input_tokens ?? result?.usage?.prompt_tokens,
        outputTokens: result?.usage?.output_tokens ?? result?.usage?.completion_tokens,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      settled = true;
    };
    try {
      const response = await fetch(`${BASE}/${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if ((response.status === 429 || response.status === 529) && attempt < 2) {
        finish(0);
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      if (!response.ok) { finish(0); throw new ProviderError(response.status, `OpenRouter ${path} returned ${response.status}.`); }
      const result = await response.json();
      cost = typeof result.usage?.cost === 'number' ? result.usage.cost : undefined;
      finish(cost, result);
      return result;
    } catch (error) {
      if (!settled) finish();
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`The provider timed out after ${timeoutMs / 1000} seconds. This call may have been billed; review it before retrying.`);
      }
      throw error;
    }
  }
  throw new Error('Provider retry limit reached.');
}

export function callChat(key: string, body: object, role: string, operationId?: string) {
  // Prefer the consistently quick ZDR-compatible endpoints from recorded calls;
  // OpenRouter may still fall back to another compliant provider if these fail.
  return post(key, 'chat/completions', { ...body, provider: {
    data_collection: 'deny', zdr: true,
    order: ['together', 'coreweave/fp8', 'novita/fp8'],
  } }, role, operationId);
}
export function callJev(key: string, body: object, role = 'jev', operationId?: string) {
  // System One privacy-routing support requires live verification before public release.
  return post(key, 'systemone', body, role, operationId);
}
