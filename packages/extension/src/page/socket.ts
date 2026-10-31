/**
 * Engancha el WebSocket del game server de la página (el segundo socket; el primero es el connect server). Cada frame que entra y cada frame que
 * sale pasa por el asistente, y lo que el asistente manda se escribe con el `send` original: no vuelve a pasar por el gancho.
 */
export type SocketHandlers = {
  /** Se abrió (o reabrió) el socket del juego. */
  opened(): void;
  closed(): void;
  /** Un frame del servidor, en orden. */
  serverFrame(bytes: Uint8Array): void;
  /** Un frame que la página va a mandar. true: ya salió por el asistente y no hay que mandarlo. */
  pageSend(bytes: Uint8Array): boolean;
};

const CONNECT_SERVER_PORT = '44405';
const NativeWS = window.WebSocket;
const nativeSend = NativeWS.prototype.send;

let gameSock: WebSocket | null = null;
let created = 0;
let chain: Promise<void> = Promise.resolve();

function isGameSocket(url: string): boolean {
  const port = /[?&]port=(\d+)/.exec(url)?.[1];
  return port ? port !== CONNECT_SERVER_PORT : created > 1; // sin puerto en la URL: el primer socket es el connect server
}

const toBytes = (d: ArrayBuffer | ArrayBufferView) => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));

export function hookGameSocket(h: SocketHandlers) {
  class HookedWebSocket extends NativeWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      created++;
      if (!isGameSocket(String(url))) return;
      gameSock = this;
      h.opened();
      this.addEventListener('message', (e) => {
        const d = e.data;
        if (typeof d === 'string') return;
        // En orden aunque algún mensaje llegue como Blob (que se lee de forma asíncrona).
        chain = chain.then(async () => h.serverFrame(new Uint8Array(d instanceof Blob ? await d.arrayBuffer() : (d as ArrayBuffer))));
      });
      this.addEventListener('close', () => { if (gameSock === this) { gameSock = null; h.closed(); } });
    }
  }
  NativeWS.prototype.send = function (this: WebSocket, data: Parameters<WebSocket['send']>[0]) {
    if (this === gameSock && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
      // Los C3 de la página se vuelven a cifrar con el contador compartido y salen desde el asistente.
      if (h.pageSend(Uint8Array.from(toBytes(data)))) return;
    }
    return nativeSend.call(this, data);
  };
  window.WebSocket = HookedWebSocket as unknown as typeof WebSocket;
}

/** Escribe bytes ya cifrados en el socket del juego, con el `send` original. */
export function writeToGame(bytes: Uint8Array) {
  if (gameSock && gameSock.readyState === NativeWS.OPEN) nativeSend.call(gameSock, bytes);
}
