/** Mensajes entre la página (page/db-bridge.ts), el content script (bridge.ts) y el service worker (background.ts). */
import { SERVER_PORT } from '@mutool/protocol';
export const BRIDGE_TAG = 'mutool-bridge';

/** El servidor local (packages/server). Tiene que coincidir con `host_permissions` del manifest. */
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

export type BridgeOp = 'hello' | 'ingest' | 'get';
export type BridgeRequest = { tag: typeof BRIDGE_TAG; dir: 'req'; id: number; op: BridgeOp; table?: string; rows?: object[]; path?: string };
export type BridgeResponse = { tag: typeof BRIDGE_TAG; dir: 'res'; id: number; op: BridgeOp; ok: boolean; data?: unknown; error?: string };
/** Lo que el content script le pasa al service worker. */
export type WorkerRequest = { op: 'ingest'; table: string; rows: object[] } | { op: 'get'; path: string };
export type WorkerResponse = { ok: boolean; data?: unknown; error?: string };
