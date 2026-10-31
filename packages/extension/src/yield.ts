/**
 * Rendimiento: cuánta experiencia y Zen da el farmeo, por zona y por monstruo. Lleva la cuenta de la sesión para el panel (funciona sin servidor) y
 * anota en ClickHouse por la telemetría (bot/core/telemetry.ts → bridge → packages/server):
 *  - `ticks` cada 5 s: dónde está, nivel, exp total, si el automático está prendido (`mode` assist/manual) y si pelea (`phase` fight).
 *  - `kill`: num1 = tipo de monstruo, num2 = su experiencia (ExperienceGained trae el id del muerto), data = {ms, zen}: cuánto tardó desde que fue
 *    el objetivo y el Zen que soltó (el drop de Zen que cae a ≤2 casillas en los 2,5 s siguientes).
 *  - `zen`: num1 = el Zen que entró al levantar. `potion`: num1 = 0 vida, 1 maná. `death`: el personaje murió.
 */
import type { ZoneLive } from '@mutool/protocol';
import { ExperienceGainedPacket } from './bot/packets';
import { EventBus } from './bot/net/eventBus';
import { drops } from './bot/core/loot-state';
import { mapName } from './bot/core/panel-logic';
import { assist, bot, monsterName, world } from './bot/core/state';
import { track } from './bot/core/telemetry';
import { onZenPicked } from './bot/core/world';
import { bridgeGet, bridgeOn } from './page/db-bridge';

const TICK_MS = 5_000;
const SAMPLE_MS = 200;
/** Cuánto se espera después de la muerte para juntar la exp partida en varios paquetes y el Zen que suelta. */
const KILL_SETTLE_MS = 2_500;
const ZEN_DROP_TILES = 2;
/** Ventana de "ahora" del panel. */
export const RECENT_MS = 10 * 60_000;

type Kill = { id: number; type: number; x: number; y: number; at: number; exp: number; zen: number; ms: number };
type Mark = { at: number; exp: number; zen: number; kills: number; potions: number };

const pending = new Map<number, Kill>();
/** Desde cuándo cada monstruo es el objetivo del asistente (para los segundos por kill). */
const engagedAt = new Map<number, number>();
const typeOf = new Map<number, number>();
const seenMoneyDrops = new Set<number>();
/** Lo que pasó, en orden, para la ventana reciente y la exp de 1 min. */
const marks: Mark[] = [];
const session = { since: 0, exp: 0, zen: 0, kills: 0, potions: 0 };

function mark(m: Partial<Mark>) {
  const now = Date.now();
  marks.push({ at: now, exp: 0, zen: 0, kills: 0, potions: 0, ...m });
  while (marks.length && now - marks[0]!.at > RECENT_MS) marks.shift();
}

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
    k = { id, type, x: at?.x ?? world.x, y: at?.y ?? world.y, at: now, exp: 0, zen: 0, ms: since ? now - since : 0 };
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
  if (k) event('kill', monsterName(k.type), k.type, k.exp, { ms: k.ms, zen: k.zen }, k);
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
  for (const d of drops.values()) {
    if (!d.isMoney || seenMoneyDrops.has(d.id)) continue;
    seenMoneyDrops.add(d.id);
    let best: Kill | null = null;
    for (const k of pending.values()) {
      if (Math.max(Math.abs(k.x - d.x), Math.abs(k.y - d.y)) <= ZEN_DROP_TILES && (!best || k.at > best.at)) best = k;
    }
    if (best) best.zen += d.amount ?? 0;
  }
  if (seenMoneyDrops.size > 500) seenMoneyDrops.clear();
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

let started = false;
export function startYield() {
  if (started) return;
  started = true;
  EventBus.on('ExperienceGained', onExp);
  onZenPicked((amount) => {
    session.zen += amount;
    mark({ zen: amount });
    event('zen', 'levantado', amount);
  });
  setInterval(() => { if (bot.inGameAt && !session.since) session.since = Date.now(); sample(); }, SAMPLE_MS);
  setInterval(tick, TICK_MS);
  setTimeout(() => void fetchLive(), 10_000);
  setInterval(() => void fetchLive(), LIVE_MS);
}
