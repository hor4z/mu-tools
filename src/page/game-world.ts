/**
 * El mundo del cliente del juego: para que el ataque del asistente se vea como jugar a mano.
 *
 * Con el eco de un skill propio (AreaSkillAnimation) el cliente no gira ni anima al personaje: lo hizo al hacer click. Un paquete del asistente
 * salía sin nada de eso y el Giro se veía hacia cualquier lado y con el cuerpo quieto (forzarle la animación desde afuera quedó peor: se cortaba).
 * Lo que sí anda igual que a mano es pedirle el ataque al cliente, como su MU Helper: `world.castRequest = { target, point }` lanza el skill
 * elegido (gira, anima, respeta su tiempo entre skills y manda el paquete). El golpe común no: `world.attackTarget` queda pegado y el cliente
 * seguiría pegando con el asistente apagado.
 *
 * El cliente no expone su mundo. Se toma cuando el constructor hace `this.scene = scene`: `scene` no es un campo declarado, así que la asignación
 * pasa por un setter en Object.prototype, que deja la propiedad propia como si nada. Por eso este archivo tiene que cargar antes que el cliente.
 */
type Entity = {
  dying?: boolean;
  netId?: number;
  playerMoveTo?: { point: { x: number; y: number }; handled: boolean; sendToServer: boolean };
  transform?: { pos: { x: number; z: number }; rot: { y: number } };
  movement?: { velocity?: { x: number; y: number } };
};
type GameWorld = {
  netObjsQuery: unknown;
  playerEntity?: Entity;
  getByNetId(id: number): Entity | undefined;
  castRequest: { target?: Entity } | null;
  castApproach: unknown;
  pickupTarget: Entity | null;
};

let gameWorld: GameWorld | null = null;

export function captureGameWorld() {
  Object.defineProperty(Object.prototype, 'scene', {
    configurable: true,
    get: () => undefined,
    set(this: Partial<GameWorld>, v: unknown) {
      Object.defineProperty(this, 'scene', { value: v, writable: true, enumerable: true, configurable: true });
      if (this.netObjsQuery && typeof this.getByNetId === 'function') gameWorld = this as GameWorld;
    },
  });
}

/** Para probar en vivo desde la consola: `__muDebug.opts.native = false` vuelve a mandar los paquetes desde el asistente. */
export const castOpts = { native: true };
export const debugWorld = () => gameWorld;

const clientReady = (w: GameWorld | null): w is GameWorld => castOpts.native && !!w?.playerEntity;

/** Los pedidos que hizo el asistente (no los del usuario): solo esos se reemplazan o se cancelan. */
let ownCast: GameWorld['castRequest'] = null;
let ownPickup: Entity | null = null;
/** Adónde mandó a caminar el asistente (volver al ancla). Si el destino del cliente cambió, la caminata ya es tuya y no se frena. */
let ownWalk: { x: number; y: number } | null = null;

/**
 * Pide al cliente el skill elegido contra el monstruo, como con el click apretado. false solo si no hay mundo del cliente: entonces el asistente
 * manda el paquete. Con el cliente disponible nunca hay que caer al paquete (sale sin animación, hacia donde estaba el monstruo): un monstruo que
 * ya no está o se está muriendo simplemente no se pide.
 * Si el monstruo está fuera de alcance, el cliente camina hasta tenerlo a tiro (su `castApproach`, con su pathfinding) y recién ahí lanza. Un
 * pedido propio a otro monstruo, o a uno que se está muriendo, se reemplaza: si no, seguía caminando hacia el que ya no vale.
 */
export function castNative(targetId: number): boolean {
  const w = gameWorld;
  if (!clientReady(w)) return false;
  const t = w.getByNetId(targetId);
  if (!t?.transform || t.dying) return true;
  const req = w.castRequest;
  if (req && (req !== ownCast || req.target === t)) return true;
  w.castRequest = ownCast = { target: t, point: { x: t.transform.pos.x, y: t.transform.pos.z } } as GameWorld['castRequest'];
  return true;
}

/** Pide al cliente que levante el drop, como un click en su nombre: camina hasta él si hace falta. false si no hay mundo del cliente o drop. */
export function pickupNative(dropId: number): boolean {
  const w = gameWorld;
  if (!clientReady(w)) return false;
  const d = w.getByNetId(dropId);
  if (!d?.transform) return false;
  // Aunque el cliente ya fuera hacia ese drop (lo clickeaste vos): queda como pedido del asistente, si no se tomaba como ya mandado.
  w.pickupTarget = ownPickup = d;
  return true;
}

/** true mientras el cliente todavía va hacia el drop que le pidió el asistente: al llegar manda el pedido y suelta su `pickupTarget`. */
export function pickupPending(): boolean {
  return !!ownPickup && gameWorld?.pickupTarget === ownPickup;
}

/** Camina hasta la casilla con el pathfinding del cliente, como un click en el piso. */
export function walkNative(x: number, y: number): boolean {
  const w = gameWorld;
  const mv = w?.playerEntity?.playerMoveTo;
  if (!clientReady(w) || !mv) return false;
  mv.point.x = x + 0.5;
  mv.point.y = y + 0.5;
  mv.handled = false;
  mv.sendToServer = true;
  ownWalk = { x: mv.point.x, y: mv.point.y };
  return true;
}

/**
 * Al apagar: cancela lo que pidió el asistente (ataque, acercarse, levantar) y frena en el acto. Para frenar se le pide al cliente caminar a la
 * casilla donde está, como un click al lado tuyo: frena con su propia lógica y avisa al server con su paquete, así las posiciones no quedan
 * distintas. Antes terminaba el camino que había empezado (varias casillas) y parecía que seguía prendido.
 */
export function stopNative() {
  const w = gameWorld;
  let had = false;
  if (w && ownCast && w.castRequest === ownCast) { w.castRequest = null; w.castApproach = null; had = true; }
  if (w && ownPickup && w.pickupTarget === ownPickup) { w.pickupTarget = null; had = true; }
  ownCast = null;
  ownPickup = null;
  const p = w?.playerEntity;
  const v = p?.movement?.velocity;
  const mv = p?.playerMoveTo;
  const walkIsOurs = !!ownWalk && !!mv && mv.point.x === ownWalk.x && mv.point.y === ownWalk.y;
  const here = playerTile();
  if (here && (had || walkIsOurs) && v && (v.x !== 0 || v.y !== 0)) walkNative(here.x, here.y);
  ownWalk = null;
}

/** Dónde está un monstruo (u otro objeto) para el cliente (la casilla), o null si el cliente no lo tiene. */
export function tileOf(netId: number): { x: number; y: number } | null {
  const t = gameWorld?.getByNetId(netId)?.transform;
  return t ? { x: Math.floor(t.pos.x), y: Math.floor(t.pos.z) } : null;
}

/** Dónde está el personaje para el cliente (la casilla), o null. */
export function playerTile(): { x: number; y: number } | null {
  const t = gameWorld?.playerEntity?.transform;
  return t ? { x: Math.floor(t.pos.x), y: Math.floor(t.pos.z) } : null;
}

/**
 * Si el monstruo sigue vivo para el cliente. El asistente saca los monstruos de su lista recién cuando salen de la vista, así que sin esto le
 * apuntaba a los que se estaban muriendo. Sin mundo del cliente no se sabe: true.
 */
export function isAlive(targetId: number): boolean {
  const w = gameWorld;
  if (!clientReady(w)) return true;
  const t = w.getByNetId(targetId);
  return !!t?.transform && !t.dying;
}

/** Cuando el golpe lo manda el asistente: al menos mira hacia el monstruo (sin tocar la animación). */
export function faceTowards(x: number, y: number) {
  const h = gameWorld?.playerEntity;
  if (!h?.transform) return;
  // Caminando no: el cliente tampoco gira al atacar en movimiento (le cambiaría el rumbo a la mitad del paso).
  const v = h.movement?.velocity;
  if (v && (v.x !== 0 || v.y !== 0)) return;
  const dx = x - h.transform.pos.x;
  const dz = y - h.transform.pos.z;
  if (dx * dx + dz * dz > 1e-6) h.transform.rot.y = Math.atan2(dz, dx) + Math.PI / 2; // la misma cuenta que el auto attack del cliente
}
