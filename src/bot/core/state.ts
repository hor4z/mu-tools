/**
 * Estado compartido del bot. Un proceso = un personaje (la estación lanza el del personaje), así
 * que son singletons de módulo. Lo que varios módulos escriben vive en objetos explícitos (`world`,
 * `bot`): los `let` de un módulo ES no se pueden asignar desde otro.
 *
 *   world    lo que el bot cree de sí mismo y de su alrededor, según los packets S2C
 *   bot      decisiones y estado para el panel (spot, modo, cacería, órdenes pendientes...)
 */
import { CHAR_NAME, type StatName } from './config';
import { ExpLog } from '../brain/farming';
import { monsters, onGameData } from './gamedata';

// Tablas derivadas de la de monstruos del cliente (base, `gamedata.ts`): se llenan cuando los datos llegan y se rehacen si se recargan.
// MONSTER_TYPE_NUMBERS: los tipos que son monstruos de verdad (AttType != 0, se mueven y tienen vida). Los NPC de pueblo y los custom del server
// que no atacan (vendedores, cofres: AttType 0) quedan afuera, así que el bot no los toma por algo atacable. Sin tope de Move: los de nivel alto
// (Deathvim Knight, Phantom Knight, Gaint Drakan…) se mueven mucho.
export const MONSTER_TYPE_NUMBERS = new Set<number>();
const MONSTER_NAMES = new Map<number, string>();
const MONSTER_MAX_HP = new Map<number, number>();
const MONSTER_LEVELS = new Map<number, number>();
onGameData('state', () => {
  MONSTER_TYPE_NUMBERS.clear(); MONSTER_NAMES.clear(); MONSTER_MAX_HP.clear(); MONSTER_LEVELS.clear();
  for (const m of monsters) {
    if (m.AttType !== 0 && m.Move > 0 && m.HP > 0) MONSTER_TYPE_NUMBERS.add(m.Numb);
    MONSTER_NAMES.set(m.Numb, m.Name);
    if (m.HP > 0) MONSTER_MAX_HP.set(m.Numb, m.HP);
    MONSTER_LEVELS.set(m.Numb, m.Level);
  }
});

/** Vida máxima de un tipo de monstruo según la tabla del cliente (null: sin dato). */
export const monsterMaxHp = (type: number): number | null => MONSTER_MAX_HP.get(type) ?? null;

/**
 * Lo último que se sabe de la vida de un monstruo golpeado (id → estado). `pct` viene del server (ObjectHitExtended: la barra roja del
 * cliente) y es null si todavía no llegó; `dealt` es el daño que suma lo que vimos (0x15), para estimarla si el server no la manda.
 */
export type HitInfo = { pct: number | null; dealt: number; at: number };

export type ScopedNpc = { id: number; type: number; x: number; y: number };
/** `raw`: los 5 bytes del ítem tal como llegaron (el packet de mover ítem los lleva). */
export type ItemSlot = { slot: number; group: number; num: number; level?: number; excellent?: boolean; raw?: Uint8Array };
export type SkillInfo = { index: number; number: number; level: number };

export const monsterName = (type: number) => MONSTER_NAMES.get(type) ?? `tipo ${type}`;
export const monsterLevel = (type: number): number | null => MONSTER_LEVELS.get(type) ?? null;
// ---------------------------------------------------------------------------
// Estado del mundo (lo que el bot cree de sí mismo) — se actualiza con los
// packets S2C (world.ts). Es la única fuente de verdad del loop autónomo.
// ---------------------------------------------------------------------------
export const world = {
  x: 0,
  y: 0,
  map: 0,
  hp: 0,
  maxHp: 0,
  mana: 0,
  maxMana: 0,
  level: 0,
  levelUpPoints: 0,
  /** Exp total (la de CharacterInformation al entrar más lo que llega por ExperienceGained) y la que pide el server para el nivel siguiente. */
  exp: 0,
  expForNext: 0,
  stats: { str: 0, agi: 0, vit: 0, ene: 0 } as Record<StatName, number>,
  skills: new Map<number, SkillInfo>(), // por número de skill
  inventory: new Map<number, ItemSlot>(), // por slot de inventario
  pendingDrop: null as number | null, // casilla del ítem que se pidió tirar (la respuesta del server no la trae)
  npcs: new Map<number, ScopedNpc>(), // solo monstruos (isMonsterType)
  hits: new Map<number, HitInfo>(), // vida conocida de los golpeados (ver HitInfo)
  // Otros jugadores en scope (para no competirles el objetivo, ver farming.ts).
  players: new Map<number, { x: number; y: number; name?: string }>(),
  // NPC de pueblo/servicio (TypeNumber 200-299) en scope: no son monstruos.
  townNpcs: new Map<number, ScopedNpc>(),
  // Clase cruda del CharacterList (ver parseCharacterList097); null = no se sabe.
  classId: null as number | null,
};

/**
 * Lo que el cerebro (farm-loop, area, combat, learning…, recargable en caliente: hot.ts) le muestra al núcleo (panel, telemetría). El cerebro los
 * instala al cargarse (brain.ts `install`); mientras tanto valen los defaults. Así el núcleo nunca importa el cerebro.
 */
export const hooks = {
  /** Nombre del lugar donde farmea (para ticks y eventos). */
  placeName: (): string => '',
  /** Exp que da un tipo de monstruo (para resaltar en el radar). */
  value: (_type: number): number => 0,
  /** Skill de ataque actual. */
  skill: (): { number: number; name: string } | null => null,
  /** Plan de reparto de puntos. */
  plan: (): { agiTarget: number; shares: { str: number; agi: number; vit: number; ene: number }; batch: number } | null => null,
};

export const bot = {
  // Id propio en el game server (GameServerEntered), sin el bit alto.
  playerId: -1,
  // Se cerró el socket del game server: el loop termina y main() reconecta.
  kicked: false,
  // Servidor de telemetría opcional (--ws-port). Solo lectura: ver ws-server.ts.
  // El servidor de telemetría y el spot del bot sin navegador (mutbot) no existen en la extensión: quedan los campos, sin tipo propio.
  statusServer: undefined as unknown,
  // 0 = fuera del mundo (conectando, en la selección de personaje).
  inGameAt: 0,
  charName: CHAR_NAME,
  // El bot no compra ni vende (pedido del usuario): solo lleva el zen para el panel.
  lastMoney: 0,
  currentSpot: null as unknown,
  // Se puede adoptar el mapa actual como spot sin warpear (al entrar al mundo);
  // tras una muerte no (respawnea en el pueblo: hay que volver a warpear).
  canAdopt: true,
  // Último spot en el que estuvo (tras morir se vuelve a esa entrada).
  lastSpotIndex: null as number | null,
  lastWarpAt: 0,
  // Último MapChanged / entrada al mundo (el hambre no mira el primer minuto).
  lastArrivalAt: Date.now(),
  // Pausa: el loop no camina, no pelea ni warpea; las pociones siguen.
  paused: false,
  // Orden del panel: ir a Lorencia y quedarse en pausa (lo consume el loop en pausa).
  townNow: false,
  // El loop descarta su objetivo en el próximo tick (cambio de modo).
  retarget: false,
  // En party (PartyList recibido; RemovePartyMember lo saca).
  inParty: false,
  // Cambió el cerebro (hot.ts): el loop termina limpio y la sesión lo vuelve a arrancar con el nuevo, sin reconectar.
  reloadBrain: false,
  // La sesión terminó por ceguera (farm-loop): la reconexión espera más (el server suelta la vieja).
  blind: false,
  // Frase corta de lo que hace ahora (la pone el loop).
  doing: 'conectando',
  // Punto al que va ahora (campamento, salida, celda de la cacería).
  goalPoint: null as [number, number] | null,
  // Modo asistente (extensión): último C3/C4 que mandó la página sola (el usuario jugando a mano), no lo
  // que manda el bot. El asistente se pausa un rato después de esto para no compartir el contador de
  // cifrado con el usuario al mismo tiempo (ver brain/assist.ts, el problema que desconectaba).
  lastManualActionAt: 0,
};

/**
 * El asistente de la extensión (mutool): lo que el usuario prende en el panel. Lo lee el cerebro del asistente (brain/assist.ts, recargable en
 * caliente: hot.ts); vive acá, en el núcleo, para que sobreviva a cada recarga.
 */
export const assist = {
  enabled: false,
  /** Qué levanta el asistente al alcance, cada cosa con su interruptor: Zen, joyas (y plumas) y excelentes. */
  pick: { zen: false, jewels: false, excellent: false },
  /** Monstruo al que apunta ahora (lo muestra el flotante). */
  target: 0,
  /** Cambió el cerebro del asistente: los loops terminan limpio y se arrancan los nuevos. */
  reload: false,
  /** Aprieta una tecla del hotbar en la página del juego (la pone la extensión). */
  press: null as null | ((key: string) => void),
  /**
   * Le pide al cliente de la página que lance el skill elegido contra el monstruo, como un click (la pone la extensión): el cliente gira, anima y
   * manda el paquete. false si no pudo; entonces el paquete lo manda el asistente. El cliente no anima al personaje propio con el eco del server.
   */
  cast: null as null | ((targetId: number) => boolean),
  /** El skill elegido en la barra del cliente (número; 0 si no se sabe): es el que lanza el cliente con `cast` (lo pone la extensión). */
  clientSkill: 0,
  /** Cuándo se pidió el último `cast`: su paquete sale por la página y no tiene que contar como jugada a mano. */
  nativeCastAt: 0,
  /**
   * Cuándo el asistente apretó una tecla (pociones): el paquete de usar el ítem sale por la página y tampoco es tuyo. Antes contaba como jugada a
   * mano y cada poción lo ponía 2,5 s en pausa.
   */
  ownKeyAt: 0,
  /** Si el monstruo sigue vivo en el cliente de la página (la pone la extensión): la lista propia guarda los muertos hasta que salen de la vista. */
  alive: null as null | ((targetId: number) => boolean),
  /** Gira al personaje de la página hacia la casilla del golpe cuando el paquete lo manda el asistente (la pone la extensión). */
  face: null as null | ((x: number, y: number) => void),
  /**
   * Cuánto se aleja a buscar monstruos y drops, en casillas desde el ancla (0: quieto, solo lo que está al alcance). El ancla es donde estaba al
   * prender el auto attack, y se mueve con el personaje mientras jugás a mano: al soltar, caza alrededor de donde lo dejaste.
   */
  roam: 5,
  anchor: null as null | { x: number; y: number },
  /** Qué está haciendo, para el panel: '' (atacando o esperando), 'approach' (yendo al monstruo), 'pickup' (yendo al drop), 'return' (volviendo). */
  doing: '' as '' | 'approach' | 'pickup' | 'return',
  /** Pide al cliente que levante el drop caminando si hace falta (la pone la extensión). false si no pudo. */
  pickup: null as null | ((dropId: number) => boolean),
  /** true mientras el cliente va hacia el drop pedido; false cuando ya mandó el pedido (la pone la extensión). */
  picking: null as null | (() => boolean),
  /** Camina hasta la casilla con el pathfinding del cliente (la pone la extensión). */
  walk: null as null | ((x: number, y: number) => boolean),
  /** Cancela los pedidos del asistente al cliente (la pone la extensión). */
  stop: null as null | (() => void),
  /**
   * Dónde está el personaje ahora para el cliente (la pone la extensión). `world.x/y` sale del paquete de caminar, que trae el camino entero:
   * mientras camina dice el destino, no dónde está, y con eso el cerebro creía tener a tiro lo que no y cambiaba de objetivo de un lado al otro.
   */
  here: null as null | (() => { x: number; y: number } | null),
  /**
   * Dónde está un monstruo para el cliente (la pone la extensión). La lista del bot no sigue bien cómo caminan: medido, el objetivo pegado para
   * el bot estaba a 5 casillas para el cliente, y el personaje caminaba mientras el cerebro creía tenerlo encima.
   */
  posOf: null as null | ((id: number) => { x: number; y: number } | null),
};

// Registro de exp por segundo (farming.ts, ExpLog): TODAS las mediciones de exp/min salen de acá.
export const expLog = new ExpLog(Date.now());

