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
  transform?: { pos: { x: number; z: number }; rot: { y: number } };
  movement?: { velocity?: { x: number; y: number } };
};
type GameWorld = {
  netObjsQuery: unknown;
  playerEntity?: Entity;
  getByNetId(id: number): Entity | undefined;
  castRequest: unknown;
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

/**
 * Pide al cliente el skill elegido contra el monstruo, como con el click apretado. false solo si no hay mundo del cliente: entonces el asistente
 * manda el paquete. Con el cliente disponible nunca hay que caer al paquete (sale sin animación, hacia donde estaba el monstruo): un monstruo que
 * ya no está o se está muriendo simplemente no se pide.
 */
export function castNative(targetId: number): boolean {
  const w = gameWorld;
  if (!clientReady(w)) return false;
  const t = w.getByNetId(targetId);
  if (t?.transform && !t.dying && !w.castRequest) w.castRequest = { target: t, point: { x: t.transform.pos.x, y: t.transform.pos.z } };
  return true;
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
