/**
 * Datos al servidor local (packages/server) desde la página. La página no tiene permisos de red hacia localhost ni claves: le pasa los pedidos por
 * `postMessage` al content script `bridge.ts` (mundo aislado), que se los da al service worker `background.ts`, que hace el fetch.
 * Si el bridge no contesta (extensión vieja o sin servidor), todo sigue igual: `bridgeOn()` queda en false y no se anota nada.
 */
import { PAGE_TIMEOUT_MS } from '@mutool/protocol';
import { BRIDGE_TAG, type BridgeRequest, type BridgeResponse } from '../bridge-protocol';

const TIMEOUT_MS = PAGE_TIMEOUT_MS;
let nextId = 1;
let ready = false;
const waiting = new Map<number, (r: BridgeResponse) => void>();

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const m = e.data as BridgeResponse | undefined;
  if (!m || m.tag !== BRIDGE_TAG || m.dir !== 'res') return;
  if (m.op === 'hello') { ready = true; return; }
  waiting.get(m.id)?.(m);
  waiting.delete(m.id);
});

// Por si el bridge cargó antes que este script y su aviso se perdió.
window.postMessage({ tag: BRIDGE_TAG, dir: 'req', id: 0, op: 'hello' } satisfies BridgeRequest, '*');

/** Un pedido al servidor por el bridge; tira si no contesta o el servidor responde error. */
function ask(req: Omit<BridgeRequest, 'tag' | 'dir' | 'id'>): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('el servidor local no contestó')); }, TIMEOUT_MS);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      if (r.ok) resolve(r.data);
      else reject(new Error(r.error ?? 'error del servidor local'));
    });
    window.postMessage({ ...req, tag: BRIDGE_TAG, dir: 'req', id } satisfies BridgeRequest, '*');
  });
}

/** El bridge está cargado (la extensión trae el content script). No dice si el servidor está prendido. */
export const bridgeOn = () => ready;

/** Manda filas de una tabla (ticks, events, players_seen). */
export async function bridgeInsert(table: string, rows: object[], _timeoutMs?: number): Promise<void> {
  if (rows.length) await ask({ op: 'ingest', table, rows });
}

/** Lee de la API del servidor (`/api/...`). */
export const bridgeGet = <T>(path: string): Promise<T> => ask({ op: 'get', path }) as Promise<T>;
