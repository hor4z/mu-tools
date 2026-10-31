/**
 * Content script en el mundo aislado: pasa los pedidos de la página (page/db-bridge.ts) al service worker (background.ts) y le devuelve la
 * respuesta. Solo deja pasar las dos operaciones conocidas; la página no elige la URL del servidor.
 */
import { BRIDGE_TAG, type BridgeRequest, type BridgeResponse, type WorkerRequest, type WorkerResponse } from './bridge-protocol';

declare const chrome: { runtime: { sendMessage(m: WorkerRequest): Promise<WorkerResponse> } };

const reply = (r: Omit<BridgeResponse, 'tag' | 'dir'>) => window.postMessage({ ...r, tag: BRIDGE_TAG, dir: 'res' } satisfies BridgeResponse, '*');

window.addEventListener('message', async (e) => {
  if (e.source !== window) return;
  const m = e.data as BridgeRequest | undefined;
  if (!m || m.tag !== BRIDGE_TAG || m.dir !== 'req' || typeof m.id !== 'number') return;
  if (m.op === 'hello') return reply({ id: m.id, op: 'hello', ok: true });
  let req: WorkerRequest | null = null;
  if (m.op === 'ingest' && typeof m.table === 'string' && Array.isArray(m.rows)) req = { op: 'ingest', table: m.table, rows: m.rows };
  else if (m.op === 'get' && typeof m.path === 'string' && m.path.startsWith('/api/')) req = { op: 'get', path: m.path };
  if (!req) return reply({ id: m.id, op: m.op, ok: false, error: 'pedido inválido' });
  try {
    const r = await chrome.runtime.sendMessage(req);
    reply({ id: m.id, op: m.op, ok: !!r?.ok, data: r?.data, error: r?.error });
  } catch (err) {
    reply({ id: m.id, op: m.op, ok: false, error: (err as Error).message });
  }
});

// Los dos scripts cargan en document_start sin orden fijo: avisamos que el bridge está, y la página también pregunta (op hello).
reply({ id: 0, op: 'hello', ok: true });
