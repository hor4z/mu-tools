/**
 * El asistente, dentro de la página del juego, sin proceso aparte: inject.ts le da cada frame que
 * entra y cada frame que sale del socket de la página, acá se lee el mundo con las piezas del bot (EventBus, world.ts) y el cerebro
 * (src/bot/brain/assist.ts) decide a quién pegarle, qué levantar y cuándo tomar una poción. Todo lo que se manda sale por el MISMO socket de la
 * página, cifrado con el mismo contador que los paquetes del cliente: es una sola secuencia, y como todo corre en el mismo hilo de la página
 * ningún paquete nuestro puede cruzarse con uno del usuario a mitad de camino.
 *
 * Nada sale de la máquina que no sea lo que ya manda el cliente al servidor del juego: ni puente local, ni base de datos.
 */
import './stubs/shim';
import { SimpleModulusDecryptor, Xor32Decryptor } from './bot/net/encryption';
import { EventBus } from './bot/net/eventBus';
import { createPacketReader } from './bot/net/socket';
import { XOR32_KEY_097D, attachFakeGameSocket, detachFakeGameSocket, resendPageFrame, syncGameCounter } from './bot/core/connection';
import { trackPanelPackets } from './bot/core/events';
import { assist, bot, world } from './bot/core/state';
import { notePotion, startYield, yieldSummary, type YieldSummary } from './yield';
import { onMapArrival, parseCharacterInformation097, parseCharacterList097, resetHp, trackWorld, watchMoney } from './bot/core/world';
import { watchChat } from './bot/core/chat';
import { DIR_DELTA, log, sleep } from './bot/core/util';
import { skills as gameSkills } from './bot/core/gamedata';
import { GameServerEnteredPacket } from './bot/packets';
import * as bundledBrain from './bot/brain/assist';
import { HOST_MODS } from './host-mods';
import { loadEmbeddedGameData } from './seed-data';

type Brain = typeof bundledBrain;
/** El cerebro en uso: el que viene en la extensión o el que se cargó después con `window.__mu.swapBrain` (recarga en caliente, sin recargar la página). */
let brain: Brain = bundledBrain;

export type SkillInfo = { num: number; name: string; buff: boolean };
export type Status = {
  enabled: boolean; pick: typeof assist.pick; inGame: boolean; ready: boolean; paused: boolean; name: string; hp: number; maxHp: number;
  mana: number; maxMana: number; monsters: number; skill: string; target: number; loot: ReturnType<Brain['lootHint']>;
  /** Los skills que conoce el personaje y el elegido en la barra del juego (0 si ninguno). */
  skills: SkillInfo[]; selectedSkill: number;
  /** Hasta cuántas casillas se mueve a buscar (0: quieto) y qué está haciendo ahora. */
  roam: number; doing: typeof assist.doing;
  /** Experiencia, Zen, kills y pociones de la sesión y de los últimos 10 min, y la zona según el servidor local (src/yield.ts). */
  yield: YieldSummary;
};
export type PickKind = keyof typeof assist.pick;

export type Io = {
  /** Escribe bytes ya cifrados en el socket del juego de la página, con el `send` original (no vuelve a pasar por el gancho). */
  write(bytes: Uint8Array): void;
  /** Aprieta una tecla del hotbar en la página (pociones). */
  press(key: string): void;
  /** Gira al personaje de la página hacia una casilla (cuando el golpe lo manda el asistente). */
  face(x: number, y: number): void;
  /** Le pide al cliente que lance el skill elegido contra el monstruo, como un click. false si no pudo. */
  cast(targetId: number): boolean;
  /** Si el monstruo sigue vivo para el cliente. */
  alive(targetId: number): boolean;
  /** Le pide al cliente que levante el drop (camina hasta él si hace falta). false si no pudo. */
  pickup(dropId: number): boolean;
  /** true mientras el cliente va hacia el drop pedido. */
  picking(): boolean;
  /** Camina hasta la casilla con el pathfinding del cliente. */
  walk(x: number, y: number): boolean;
  /** Cancela lo que el asistente le pidió al cliente. */
  stop(): void;
  /** La casilla donde está el personaje para el cliente, o null. */
  here(): { x: number; y: number } | null;
  /** La casilla donde está un monstruo para el cliente, o null. */
  posOf(id: number): { x: number; y: number } | null;
  /** El nombre del skill elegido en la barra del juego, o null. */
  selectedSkill(): string | null;
};

let io: Io | null = null;
let characters: any[] = [];
let reader = createPacketReader('[asistente]');
const xor = new Xor32Decryptor();
xor.xor32Key = XOR32_KEY_097D;
let pageDecryptor = newPageDecryptor();
let started = false;

function newPageDecryptor() {
  const d = new SimpleModulusDecryptor();
  d.decryptionKeys = SimpleModulusDecryptor.DefaultServerKey;
  return d;
}

/**
 * Los C3 (skills, recoger ítems) llevan un contador que el server exige en orden. La página cuenta los suyos y nosotros los nuestros, así que si
 * salieran los dos tal cual se pisarían. Por eso TODOS los C3 de la página (con el asistente prendido o no) se descifran y se vuelven a cifrar con
 * un único contador, el nuestro, que arranca donde iba la página en el primero que se ve. Pasan por acá en el mismo hilo, sin esperas: una sola
 * secuencia, sin repetidos ni saltos, y apagar o prender el asistente no cambia nada del cifrado.
 */
let counterSynced = false;

/** Hasta cuánto después de pedirle un skill al cliente su paquete se toma como del asistente y no como tuyo. */
const NATIVE_CAST_WINDOW_MS = 1500;

/** Un frame que la página va a mandar al servidor. true: ya salió por acá (con el contador compartido), el gancho no debe mandarlo. */
export function onPageSend(frame: Uint8Array): boolean {
  if (frame[0] === 0xc3 || frame[0] === 0xc4) {
    try {
      // El contador viene dentro del paquete: así sirve aunque el asistente se haya enganchado con el juego ya empezado.
      const [count, plain] = (pageDecryptor as unknown as { DecryptC3(d: Uint8Array): [number, Uint8Array] }).DecryptC3(Uint8Array.from(frame));
      // El latido del cliente (C3 0E, cada 5 s) no es una acción tuya: si pausara al asistente, lo frenaba la mitad del tiempo.
      // Tampoco el skill o el levantar que el asistente le pidió al cliente (assist.cast, assist.pickup): salen por la página, pero no son tuyos.
      // Hoy nadie lo lee (el automático no se pausa solo); queda para detectar el juego a mano bien (issue #3).
      const assistCast = (plain[2] === 0x1e || plain[2] === 0x19 || plain[2] === 0x22) && Date.now() - assist.nativeCastAt < NATIVE_CAST_WINDOW_MS;
      if (plain[2] !== 0x0e && !assistCast) bot.lastManualActionAt = Date.now();
      if (!counterSynced) { syncGameCounter(count); counterSynced = true; }
      resendPageFrame(plain);
      return true;
    } catch { log('Asistente: no pude leer un C3 de la página; sale tal cual.'); }
    return false;
  }
  if (frame[0] !== 0xc1 || frame.length < 4) return false;
  const p = xor.Decrypt(Uint8Array.from(frame))[1];
  if (p[2] === 0x10 && p.length >= 6) {
    // WalkRequest075: C1 len 10 <x> <y> <rot<<4 | pasos> <direcciones de a dos por byte>
    let x = p[3], y = p[4];
    const n = p[5] & 15;
    for (let i = 0; i < n; i++) {
      const d = (p[6 + (i >> 1)] >> (i % 2 === 0 ? 4 : 0)) & 15;
      const delta = DIR_DELTA[d];
      if (delta) { x += delta[0]; y += delta[1]; }
    }
    world.x = x;
    world.y = y;
  } else if (p[2] === 0xf3 && p[3] === 0x03 && p.length >= 14) {
    const name = new TextDecoder('latin1').decode(p.subarray(4, 14)).replace(/\0.*$/, '');
    bot.charName = name;
    log(`Personaje elegido en el navegador: ${name}.`);
  }
  return false;
}

/** Un frame que el servidor le manda a la página. */
export function onServerFrame(bytes: Uint8Array) {
  reader.push(bytes);
}

/** La página abrió (o reabrió) el socket del juego: se empieza de cero, cada conexión lleva su propio contador. */
export function onGameSocket() {
  turnEverythingOff();
  pageDecryptor = newPageDecryptor();
  counterSynced = false;
  reader = createPacketReader('[asistente]');
  world.npcs.clear();
  attachFakeGameSocket((b) => io?.write(b));
}

export function onGameSocketClosed() {
  turnEverythingOff();
  detachFakeGameSocket();
}

/** Cada conexión empieza con todo apagado: lo que estaba prendido era para el personaje y el mundo de antes. */
function turnEverythingOff() {
  assist.enabled = false;
  assist.anchor = null;
  assist.doing = '';
  assist.pick = { zen: false, jewels: false, excellent: false };
  bot.inGameAt = 0;
}

function applyCharacterInfo(raw: any) {
  const info = parseCharacterInformation097(raw);
  const mine = characters.find((c) => c.Name === bot.charName) ?? characters[0];
  Object.assign(world, {
    x: info.x, y: info.y, map: info.map, hp: info.hp, mana: info.mana, maxMana: info.maxMana,
    level: mine?.Level ?? world.level, classId: mine?.ClassId ?? null, levelUpPoints: info.levelUpPoints, exp: info.exp, expForNext: info.expForNext,
    stats: { str: info.str, agi: info.agi, vit: info.vit, ene: info.ene },
  });
  resetHp(info.maxHp);
  bot.lastMoney = info.money;
  bot.inGameAt = Date.now();
  bot.kicked = false;
  onMapArrival();
  log(`Asistente: ${bot.charName} en (${info.x},${info.y}) mapa ${info.map}, nivel ${world.level}.`);
}

/** Corre el cerebro; cuando termina (cambió el cerebro: `assist.reload`) arranca el nuevo, y si se cae lo reintenta. */
async function runBrain() {
  while (true) {
    assist.reload = false;
    try { await brain.run(); } catch (e) { log(`El asistente falló al correr (${(e as Error).message}); reintento.`); await sleep(3000); }
  }
}

/**
 * Recarga en caliente del cerebro: `code` es el resultado de `bun run brain` (dist/brain.js). Se evalúa en la página, usa el estado vivo del núcleo
 * (`window.__mu.mods`) y reemplaza al cerebro actual sin cortar el juego ni recargar. Devuelve un error si el cerebro nuevo no carga.
 */
function swapBrain(code: string): string | null {
  const w = window as unknown as { __muNext?: Brain };
  try {
    w.__muNext = undefined;
    (0, eval)(code);
    const next = w.__muNext as Brain | undefined;
    if (!next || typeof (next as { run?: unknown }).run !== 'function') return 'el código no trae un cerebro válido';
    brain = next;
    w.__muNext = undefined;
    assist.reload = true; // los loops del cerebro anterior terminan limpio y runBrain arranca el nuevo
    log('Cerebro del asistente recargado en caliente.');
    return null;
  } catch (e) {
    return `el cerebro nuevo no carga: ${(e as Error).message}`;
  }
}

/** Arranca el asistente (una vez por página). */
export function startAssistant(deps: Io) {
  io = deps;
  if (started) return;
  started = true;
  assist.press = (key) => { if (!io) return; notePotion(key); io.press(key); };
  assist.face = (x, y) => io?.face(x, y);
  assist.cast = (id) => io?.cast(id) ?? false;
  assist.alive = (id) => io?.alive(id) ?? true;
  assist.pickup = (id) => io?.pickup(id) ?? false;
  assist.picking = () => io?.picking() ?? false;
  assist.walk = (x, y) => io?.walk(x, y) ?? false;
  assist.stop = () => io?.stop();
  assist.here = () => io?.here() ?? null;
  assist.posOf = (id) => io?.posOf(id) ?? null;
  setInterval(syncClientSkill, CLIENT_SKILL_SYNC_MS);
  (window as unknown as { __mu?: unknown }).__mu = { mods: HOST_MODS, swapBrain, state: { world, bot, assist }, status: () => status() };
  loadEmbeddedGameData();
  trackWorld();
  trackPanelPackets();
  watchMoney();
  startYield();
  EventBus.on('CharacterList', (raw: any) => { characters = parseCharacterList097(raw); });
  EventBus.on('CharacterInformation', applyCharacterInfo);
  EventBus.on('GameServerEntered', (raw: any) => { bot.playerId = new GameServerEnteredPacket(raw).PlayerId & 0x7fff; });
  watchChat(); // los avisos del server ("no es tuyo", "sin lugar") quedan en la consola: dicen por qué un pedido de ítem no entra
  void runBrain();
}

/** Cada cuánto se lee el skill elegido en la barra del juego (el usuario lo puede cambiar a mano en cualquier momento). */
const CLIENT_SKILL_SYNC_MS = 300;

function knownSkills(): SkillInfo[] {
  return [...world.skills.values()].map((s) => {
    const row = gameSkills.find((r) => r.num === s.number);
    return { num: s.number, name: row?.name ?? `Skill ${s.number}`, buff: row?.type === 'Buff' };
  });
}

function syncClientSkill() {
  const name = io?.selectedSkill();
  assist.clientSkill = (name && knownSkills().find((k) => k.name === name)?.num) || 0;
}

/** Por qué todavía no se puede prender nada, o null si ya se puede. */
function notReadyReason(): string | null {
  if (!bot.inGameAt) return 'Entrá al mundo con el personaje.';
  if (!counterSynced) return 'Sincronizando con el juego: esperá unos segundos (el cliente manda su latido cada 5 s).';
  return null;
}

/** Prende o apaga el auto attack o una clase de cosas para levantar. Devuelve el motivo si no se pudo. */
export function setAssist(change: { attack?: boolean; pick?: PickKind; roam?: number }): string | null {
  if (change.roam !== undefined) { assist.roam = change.roam; assist.anchor = assist.here?.() ?? { x: world.x, y: world.y }; assist.stop?.(); log(`Moverse: hasta ${change.roam} casillas.`); }
  const turningOn = change.attack === true || (change.pick !== undefined && !assist.pick[change.pick]);
  const reason = turningOn ? notReadyReason() : null;
  if (reason) return reason;
  if (change.attack !== undefined) {
    assist.enabled = change.attack;
    // Caza alrededor de donde lo prendiste; al apagar se cancela lo que le había pedido al cliente (no sigue caminando hacia un monstruo).
    assist.anchor = change.attack ? assist.here?.() ?? { x: world.x, y: world.y } : null;
    assist.doing = '';
    if (!change.attack) assist.stop?.();
    log(`Auto attack ${assist.enabled ? 'prendido' : 'apagado'}.`);
  }
  if (change.pick !== undefined) {
    assist.pick = { ...assist.pick, [change.pick]: !assist.pick[change.pick] };
    log(`Levantar ${change.pick}: ${assist.pick[change.pick] ? 'sí' : 'no'}.`);
  }
  return null;
}

export function status(): Status {
  return {
    enabled: assist.enabled, pick: assist.pick, inGame: !!bot.inGameAt, ready: !notReadyReason(), paused: brain.pausedByUser?.() ?? false,
    name: bot.charName, hp: world.hp, maxHp: world.maxHp, mana: world.mana, maxMana: world.maxMana, monsters: brain.monstersNear?.() ?? world.npcs.size,
    skill: brain.skillName(), target: assist.target, loot: brain.lootHint(), skills: knownSkills(), selectedSkill: assist.clientSkill,
    roam: assist.roam, doing: assist.doing, yield: yieldSummary(),
  };
}
