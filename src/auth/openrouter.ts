import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { callChat, callJev } from '../pipeline/provider.js';
import type { ModelSettings } from '../config.js';

const storedPath = join(dirname(process.env.DB_PATH ?? './data/idea.db'), 'keys', 'openrouter');
const managedPath = process.env.OPENROUTER_API_KEY_FILE;
export async function getKey(): Promise<string | null> {
  try { return (await readFile(managedPath || storedPath, 'utf8')).trim(); }
  catch { return null; }
}
export async function keyStatus() {
  const key = await getKey();
  return { status: key ? (managedPath ? 'managed' : 'set') : 'none', masked: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null };
}
export async function saveKey(key: string, models: ModelSettings) {
  if (managedPath) throw new Error('Key is managed by a mounted file.');
  if (!/^sk-or-[\w-]{15,}$/.test(key)) throw new Error('Expected an OpenRouter API key.');
  await callChat(key, { model: models.dreamer, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 5 }, 'validation');
  await callJev(key, { model: models.jev, state: 'hello', questions: { ok: { type: 'noul', instructions: 'Is this a greeting?' } } }, 'validation');
  await mkdir(dirname(storedPath), { recursive: true, mode: 0o700 });
  const tmp = `${storedPath}.${randomUUID()}`;
  await writeFile(tmp, key, { mode: 0o600, flag: 'wx' });
  await rename(tmp, storedPath);
}
export async function removeKey() {
  if (managedPath) throw new Error('Key is managed by a mounted file.');
  await unlink(storedPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
}
