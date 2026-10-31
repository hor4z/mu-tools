/** Service worker: el único que habla con el servidor local (packages/server). Lo llama el content script bridge.ts. */
import { INGEST_TIMEOUT_MS } from '@mutool/protocol';
import { SERVER_URL, type WorkerRequest, type WorkerResponse } from './bridge-protocol';

declare const chrome: {
  runtime: { onMessage: { addListener(fn: (m: WorkerRequest, sender: unknown, send: (r: WorkerResponse) => void) => boolean | void): void } };
};

const API_TIMEOUT_MS = 6_000;

async function handle(m: WorkerRequest): Promise<WorkerResponse> {
  try {
    const r = m.op === 'ingest'
      ? await fetch(`${SERVER_URL}/ingest`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: m.table, rows: m.rows }), signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      })
      : await fetch(`${SERVER_URL}${m.path}`, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `servidor ${r.status}: ${text.slice(0, 200)}` };
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  void handle(m).then(send);
  return true; // la respuesta llega después
});
