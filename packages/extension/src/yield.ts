/**
 * Rendimiento: cuánta experiencia y Zen da el farmeo, por zona y por monstruo. Lleva la cuenta de la sesión para el panel (funciona sin servidor) y
 * anota en ClickHouse por la telemetría (bot/core/telemetry.ts → bridge → packages/server):
 *  - `ticks` cada 5 s: dónde está, nivel, exp total, si el automático está prendido (`mode` assist/manual) y si pelea (`phase` fight).
 *  - `kill`: num1 = tipo de monstruo, num2 = su experiencia (ExperienceGained trae el id del muerto), data = {ms}: cuánto tardó desde que fue el
 *    objetivo. Se anota en la casilla del personaje, como los ticks: así el tiempo y los kills de una zona salen del mismo lugar.
 *  - `zen`: num1 = el Zen que entró al levantar, num2 = el monstruo que lo soltó (0 si no se sabe). En este server el Zen cae como ítem y el monto
 *    no viene en el drop: se sabe recién al levantarlo. Cada drop de Zen queda anotado con el kill más cercano (≤2 casillas, de 1,5 s antes a
 *    2,5 s después: el drop suele llegar antes que la experiencia), y al levantar se busca el drop de Zen más cercano al personaje.
 *  - `potion`: num1 = 0 vida, 1 maná. `death`: el personaje murió.
 */
import type { ZoneLive } from '@mutool/protocol';
import { ExperienceGainedPacket } from './bot/packets';
import { EventBus } from './bot/net/eventBus';
import { drops } from './bot/core/loot-state';
import { mapName } from './bot/core/panel-logic';
import { assist, bot, monsterName, world } from './bot/core/state';
import { newSession, track } from './bot/core/telemetry';
import { onZenPicked } from './bot/core/world';
import { bridgeGet, bridgeOn } from './page/db-bridge';

const TICK_MS = 5_000;
const SAMPLE_MS = 200;
/** Cuánto se espera después de la muerte para juntar la exp partida en varios paquetes y el Zen que suelta. */
const KILL_SETTLE_MS = 2_500;
const ZEN_DROP_TILES = 2;
/** Ventana de "ahora" del panel. */
export const RECENT_MS = 10 * 60_000;

/** x/y: dónde estaba el monstruo (para el Zen que suelta); me: dónde estaba el personaje (la zona del kill). */
type Kill = { id: number; type: number; x: number; y: number; me: { x: number; y: number }; at: number; exp: number; ms: number };
/** Un drop de Zen en el piso o recién ido; owner: el tipo de monstruo que lo soltó (0 si no se sabe). */
type MoneyDrop = { x: number; y: number; at: number; owner: number; goneAt?: number; picked?: boolean };
type Mark = { at: number; exp: number; zen: number; kills: number; potions: number };

const pending = new Map<number, Kill>();
/** Desde cuándo cada monstruo es el objetivo del asistente (para los segundos por kill). */
const engagedAt = new Map<number, number>();
const typeOf = new Map<number, number>();
/** Drops de Zen en el piso (id → drop). Se pasan a `goneMoney` al salir de `drops`: el server reusa los ids. */
const seenMoneyDrops = new Map<number, MoneyDrop>();
/** El drop de Zen llega antes que ExperienceGained: un kill nuevo mira los drops de hasta este tiempo atrás. */
const DROP_BEFORE_KILL_MS = 1_500;
/** Drops de Zen que se fueron del piso hace poco: el que se levantó puede irse un instante antes de que llegue el Zen. */
const goneMoney: MoneyDrop[] = [];
const GONE_MEMORY_MS = 3_000;
/** Al levantar, el drop tiene que estar a esta distancia del personaje: si no hay ninguno, el Zen vino de otro lado (baúl, trade). */
const PICK_TILES = 3;
/** Lo que pasó, en orden, para la ventana reciente y la exp de 1 min. */
const marks: Mark[] = [];
const session = { since: 0, exp: 0, zen: 0, kills: 0, potions: 0 };

function prune(now: number) {
  while (marks.length && now - marks[0]!.at > RECENT_MS) marks.shift();
}
function mark(m: Partial<Mark>) {
  const now = Date.now();
  marks.push({ at: now, exp: 0, zen: 0, kills: 0, potions: 0, ...m });
  prune(now);
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= ZEN_DROP_TILES;
const posOf = (id: number) => assist.posOf?.(id) ?? world.npcs.get(id) ?? null;
const myTile = () => assist.here?.() ?? { x: world.x, y: world.y };

/**
 * Un evento como `trackEvent` de la telemetría, pero en la casilla que dice el cliente (o la del monstruo, para un kill): `world.x/y` es el destino
 * del último paso y queda atrasado, y la zona de 16×16 sale de esta posición.
 */
function event(kind: string, text: string, num1: number, num2 = 0, data: Record<string, unknown> = {}, at = myTile()) {
  track('events', { kind, spot: mapName(world.map), map: world.map, x: at.x, y: at.y, level: world.level, num1, num2, text, data: JSON.stringify(data) });
}

function onExp(raw: unknown) {
  const p = new ExperienceGainedPacket(raw as never);
  const exp = p.AddedExperience;
  const id = p.KilledObjectId & 0x7fff;
  session.exp += exp;
  mark({ exp });
  const type = typeOf.get(id) ?? world.npcs.get(id)?.type;
  if (!id || type == null) return;
  let k = pending.get(id);
  if (!k) {
    const now = Date.now();
    const at = posOf(id);
    const since = engagedAt.get(id);
    k = { id, type, x: at?.x ?? world.x, y: at?.y ?? world.y, me: myTile(), at: now, exp: 0, ms: since ? now - since : 0 };
    for (const d of seenMoneyDrops.values()) if (!d.owner && now - d.at <= DROP_BEFORE_KILL_MS && near(k, d)) d.owner = type;
    pending.set(id, k);
    engagedAt.delete(id);
    session.kills++;
    mark({ kills: 1 });
    setTimeout(() => settle(id), KILL_SETTLE_MS);
  }
  k.exp += exp;
}

function settle(id: number) {
  const k = pending.get(id);
  pending.delete(id);
  typeOf.delete(id);
  if (k) event('kill', monsterName(k.type), k.type, k.exp, { ms: k.ms }, k.me);
}

let wasAlive = false;

/** Cada 200 ms: muertes propias, el objetivo de ahora, los tipos de los monstruos a la vista y el Zen que cae al lado de un kill reciente. */
function sample() {
  const now = Date.now();
  const alive = world.hp > 0;
  if (bot.inGameAt && wasAlive && !alive) event('death', 'muerte', 0);
  wasAlive = alive;
  for (const n of world.npcs.values()) typeOf.set(n.id, n.type);
  if (assist.enabled && assist.target && !engagedAt.has(assist.target)) engagedAt.set(assist.target, now);
  for (const [id, at] of engagedAt) if (now - at > 120_000) engagedAt.delete(id);
  for (const [id, m] of seenMoneyDrops) {
    if (drops.get(id)?.isMoney) continue;
    seenMoneyDrops.delete(id);
    if (!m.picked) goneMoney.push({ ...m, goneAt: now });
  }
  while (goneMoney.length && now - goneMoney[0]!.goneAt! > GONE_MEMORY_MS) goneMoney.shift();
  for (const d of drops.values()) {
    if (!d.isMoney || seenMoneyDrops.has(d.id)) continue;
    let best: Kill | null = null;
    for (const k of pending.values()) if (near(k, d) && (!best || k.at > best.at)) best = k;
    seenMoneyDrops.set(d.id, { x: d.x, y: d.y, at: now, owner: best?.type ?? 0 });
  }
}

/** Exp de los últimos 60 s, por minuto (la columna exp_min_1m de ticks). */
function expLastMinute(now: number) {
  let e = 0;
  for (const m of marks) if (now - m.at <= 60_000) e += m.exp;
  return e;
}

function tick() {
  if (!bot.inGameAt || bot.kicked) return;
  const now = Date.now();
  const here = myTile();
  let near = 0;
  for (const n of world.npcs.values()) {
    const at = posOf(n.id);
    if (at && Math.max(Math.abs(at.x - here.x), Math.abs(at.y - here.y)) <= 10) near++;
  }
  track('ticks', {
    map: world.map, x: here.x, y: here.y, level: world.level, exp_total: world.exp, exp_min_1m: expLastMinute(now),
    hp: Math.max(0, world.hp), mp: Math.max(0, world.mana), mode: assist.enabled ? 'assist' : 'manual', phase: assist.target ? 'fight' : 'idle',
    spot: mapName(world.map), monsters_near: near, doing: assist.doing, skill: assist.clientSkill,
  }, now);
}

/** Pociones que tomó el asistente (Q vida, W maná). */
export function notePotion(key: string) {
  const k = key.toLowerCase();
  if (k !== 'q' && k !== 'w') return;
  session.potions++;
  mark({ potions: 1 });
  event('potion', k === 'q' ? 'vida' : 'maná', k === 'q' ? 0 : 1);
}

export type YieldWindow = { minutes: number; expH: number; zenH: number; killsH: number; potionsH: number; exp: number; zen: number; kills: number };
/** `zone`: lo que dice el servidor local de la zona de ahora contra la mejor conocida (GET /api/live). */
export type YieldSummary = { session: YieldWindow; recent: YieldWindow; zone: ZoneLive | null; server: boolean };

function rates(minutes: number, exp: number, zen: number, kills: number, potions: number): YieldWindow {
  const h = Math.max(minutes, 1) / 60;
  return { minutes, exp, zen, kills, expH: exp / h, zenH: zen / h, killsH: kills / h, potionsH: potions / h };
}

/** Lo que muestra el panel: la sesión y los últimos 10 minutos. */
export function yieldSummary(): YieldSummary {
  const now = Date.now();
  const since = session.since || now;
  prune(now);
  const r = { exp: 0, zen: 0, kills: 0, potions: 0 };
  for (const m of marks) { r.exp += m.exp; r.zen += m.zen; r.kills += m.kills; r.potions += m.potions; }
  const recentMin = Math.min(RECENT_MS, now - since) / 60_000;
  return {
    session: rates((now - since) / 60_000, session.exp, session.zen, session.kills, session.potions),
    recent: rates(recentMin, r.exp, r.zen, r.kills, r.potions),
    zone: live, server: serverOk,
  };
}

const LIVE_MS = 60_000;
let live: ZoneLive | null = null;
let serverOk = false;
async function fetchLive() {
  if (!bridgeOn() || !bot.inGameAt) return;
  const here = myTile();
  try {
    live = await bridgeGet<ZoneLive>(`/api/live?map=${world.map}&x=${here.x}&y=${here.y}&level=${world.level}`);
    serverOk = true;
  } catch {
    serverOk = false;
  }
}

/** Zen levantado: se le atribuye al drop de Zen más cercano (en el piso o recién ido). Sin ninguno cerca no fue un drop y no cuenta. */
function onPicked(amount: number) {
  sample(); // que el drop recién levantado ya figure como ido
  const me = myTile();
  const dist = (d: MoneyDrop) => Math.max(Math.abs(d.x - me.x), Math.abs(d.y - me.y));
  let best: MoneyDrop | null = null;
  for (const d of [...goneMoney, ...seenMoneyDrops.values()]) if (!d.picked && dist(d) <= PICK_TILES && (!best || dist(d) < dist(best))) best = d;
  if (!best) return;
  best.picked = true; // un drop se levanta una vez
  session.zen += amount;
  mark({ zen: amount });
  event('zen', best.owner ? monsterName(best.owner) : 'levantado', amount, best.owner);
}

/**
 * Una sesión nueva al volver a entrar después de salir (desconexión, vuelta a elegir personaje) o con otro personaje: no se mezclan totales ni el
 * tiempo desconectado. El server repite CharacterInformation estando adentro (al viajar, por ejemplo) y eso no corta la sesión.
 */
let sessionChar: string | null = null;
let wentOut = false;
function followSession() {
  if (!bot.inGameAt) { if (sessionChar !== null) wentOut = true; return; }
  if (sessionChar === bot.charName && !wentOut) return;
  if (sessionChar !== null) newSession();
  sessionChar = bot.charName;
  wentOut = false;
  Object.assign(session, { since: Date.now(), exp: 0, zen: 0, kills: 0, potions: 0 });
  marks.length = 0;
  pending.clear();
  engagedAt.clear();
  live = null;
}

let started = false;
export function startYield() {
  if (started) return;
  started = true;
  EventBus.on('ExperienceGained', onExp);
  onZenPicked(onPicked);
  setInterval(() => { followSession(); sample(); }, SAMPLE_MS);
  setInterval(tick, TICK_MS);
  setTimeout(() => void fetchLive(), 10_000);
  setInterval(() => void fetchLive(), LIVE_MS);
}
