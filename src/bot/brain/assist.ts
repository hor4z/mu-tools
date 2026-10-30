/**
 * Cerebro del asistente de la extensión: el auto attack, las pociones por atajo y levantar lo que vale (Zen, joyas, excelentes). Corre dentro de
 * la página del juego, empaquetado por la extensión (src/assistant.ts, que le da los frames y escribe lo que se manda). Lo que
 * el usuario prende vive en `assist` (core/state.ts). Los loops terminan cuando `assist.reload` se pone en true.
 */
import { ATTACK_PACE_MS, HEAL_AT_PCT } from '../core/config';
import { sendHit, sendPickup } from '../core/actions';
import { drops } from '../core/loot-state';
import { itemInfo } from '../core/panel-logic';
import { assist, bot, world } from '../core/state';
import { chebyshev, directionTowards, humanPace, log, sleep } from '../core/util';
import { SKILL_TABLE, castReach, pickAttackSkill, useSkill } from './combat';
import { isJewel } from './farming';
import { bagRoom, watchDrops } from './loot';

// --- Pociones por atajo ---------------------------------------------------------------------------------------------------------------------
/** Teclas del hotbar del juego: lo que el usuario tenga ahí se toma, como si apretara la tecla (sin buscar casilleros en el inventario). */
const HEAL_KEY = 'q';
const MANA_KEY = 'w';
/** Con menos maná que esto se toma una poción azul: antes de quedarse sin skill. */
const MANA_LOW_PCT = 40;
/** Entre una poción y la siguiente de la misma clase (el server las espacia). */
const POTION_GAP_MS = 1500;
let lastHealAt = 0;
let lastManaAt = 0;

/** Toma la poción de vida o de maná con el atajo si hace falta. true si apretó una tecla. */
function drinkIfNeeded(): boolean {
  if (!assist.press) return false;
  const now = Date.now();
  if (world.maxHp > 0 && (world.hp / world.maxHp) * 100 <= HEAL_AT_PCT && now - lastHealAt >= POTION_GAP_MS) {
    lastHealAt = now;
    log(`Asistente: vida ${world.hp}/${world.maxHp}, aprieto ${HEAL_KEY.toUpperCase()}.`);
    assist.press(HEAL_KEY);
    return true;
  }
  if (world.maxMana > 0 && (world.mana / world.maxMana) * 100 <= MANA_LOW_PCT && now - lastManaAt >= POTION_GAP_MS) {
    lastManaAt = now;
    log(`Asistente: maná ${world.mana}/${world.maxMana}, aprieto ${MANA_KEY.toUpperCase()}.`);
    assist.press(MANA_KEY);
    return true;
  }
  return false;
}

// Si el usuario mandó algo a mano hace menos de esto, el asistente no ataca ni pide ítems: evita que su C3/C4
// y el del usuario compartan el contador de cifrado al mismo tiempo (eso desincronizaba el descifrado de la
// página y terminaba descartando los clicks del usuario en silencio). Las pociones por atajo (drinkIfNeeded)
// no cuentan: van por teclado, no por C3, así que no compiten por el contador.
const MANUAL_PAUSE_MS = 2500;

// --- Auto attack ------------------------------------------------------------------------------------------------------------------------------
/** Ritmo del skill del asistente: el mismo que manda el cliente del usuario con el click apretado (medido: un Giro cada 500 ms, 223 envíos). */
const ASSIST_SKILL_PACE_MS = 500;
/** Cada cuánto se repone el pedido de skill al cliente (assist.cast): el ritmo real lo pone el cliente, como con el click apretado. */
const NATIVE_CAST_POLL_MS = 50;
/**
 * El skill con el que se ataca. Si el cliente lanza por el asistente (assist.cast), es el elegido en la barra del juego: el cliente lanza ese y el
 * alcance tiene que ser el suyo. Un buff ahí no ataca (undefined: golpe común). Si no, el que elige el cerebro.
 */
function attackSkill() {
  if (!assist.cast || !assist.clientSkill) return pickAttackSkill();
  const s = world.skills.get(assist.clientSkill);
  return s && SKILL_TABLE.get(s.number)?.type !== 'Buff' ? s : undefined;
}

/** Un golpe o skill por ritmo humano al monstruo más cercano que esté al alcance. No camina. */
async function assistLoop() {
  // Tras un golpe ya se esperó el ritmo completo: el sondeo de 150 ms solo corre cuando no se atacó (si no, se sumaba a cada golpe).
  let attacked = false;
  while (!assist.reload) {
    if (!attacked) await sleep(150);
    attacked = false;
    if (!assist.enabled || !bot.inGameAt || bot.kicked || world.hp <= 0) continue;
    if (Date.now() - bot.lastManualActionAt < MANUAL_PAUSE_MS) continue;
    if (drinkIfNeeded()) await sleep(150);
    const skill = attackSkill();
    const reach = skill ? castReach(skill.number) : 1;
    let best: { id: number; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const n of world.npcs.values()) {
      const d = chebyshev(world.x, world.y, n.x, n.y);
      if (d <= reach && d < bestD && (assist.alive?.(n.id) ?? true)) { best = n; bestD = d; }
    }
    if (!best) { assist.target = 0; continue; }
    assist.target = best.id;
    if (skill && assist.cast?.(best.id)) {
      // El cliente lo lanza como con el click apretado (gira, anima y espera su propio tiempo entre skills): el pedido se repone apenas lo usa.
      // Esperar acá el ritmo del asistente dejaba huecos entre un Giro y el siguiente.
      assist.nativeCastAt = Date.now();
      await sleep(NATIVE_CAST_POLL_MS);
      attacked = true;
    }
    else if (skill && useSkill(best.id, skill)) {
      assist.face?.(best.x, best.y);
      await sleep(humanPace(ASSIST_SKILL_PACE_MS));
      attacked = true;
    }
    else if (bestD <= 1) { sendHit(best.id, directionTowards(world.x, world.y, best.x, best.y)); assist.face?.(best.x, best.y); await sleep(humanPace(ATTACK_PACE_MS)); attacked = true; }
  }
}

// --- Levantar lo que vale ------------------------------------------------------------------------------------------------------------------------
/** Hasta dónde se pide el ítem sin caminar (el bot camina hasta 1; acá no se camina, así que se prueba un poco más lejos) y hasta dónde se avisa. */
const PICK_REACH = 2;
const ALERT_TILES = 20;
const PICK_RETRY_MS = 600;
export type PickKind = keyof typeof assist.pick;
type Drop = { group: number; num: number; isMoney?: boolean; excellent?: boolean };
/** Qué clase de drop es, para el interruptor que le toca (el Broken Sword de la quest ya no se junta: se consiguió). */
function pickKind(d: Drop): PickKind | null {
  if (d.isMoney) return 'zen';
  if (d.group === 14 && d.num === 24) return null;
  if (isJewel(d)) return 'jewels';
  return d.excellent ? 'excellent' : null;
}
const askedAt = new Map<number, number>();

/** El drop más cercano de las clases prendidas. */
function nearestWanted() {
  let best: { id: number; x: number; y: number; group: number; num: number; kind: PickKind; d: number } | null = null;
  for (const dr of drops.values()) {
    const kind = pickKind(dr);
    if (!kind || !assist.pick[kind]) continue;
    const d = chebyshev(world.x, world.y, dr.x, dr.y);
    if (!best || d < best.d) best = { id: dr.id, x: dr.x, y: dr.y, group: dr.group, num: dr.num, kind, d };
  }
  return best;
}

async function pickLoop() {
  while (!assist.reload) {
    await sleep(100);
    const { zen, jewels, excellent } = assist.pick;
    if (!(zen || jewels || excellent) || !bot.inGameAt || bot.kicked || world.hp <= 0) continue;
    if (Date.now() - bot.lastManualActionAt < MANUAL_PAUSE_MS) continue;
    const t = nearestWanted();
    if (!t || t.d > PICK_REACH || (t.kind !== 'zen' && bagRoom() <= 0)) continue;
    const now = Date.now();
    if (now - (askedAt.get(t.id) ?? 0) < PICK_RETRY_MS) continue;
    askedAt.set(t.id, now);
    log(`Levantar: pido ${t.kind === 'zen' ? 'Zen' : itemInfo(t.group, t.num).name} (a ${t.d} casillas).`);
    sendPickup(t.id);
  }
}

// --- Lo que el panel de la extensión le muestra al usuario -----------------------------------------------------------------------------------------------
// El reparto de stats ("Repartir puntos" del panel) no pasa por acá: la extensión clickea los íconos reales del panel de personaje
// (src/page/stats.ts), sin mandar ningún paquete por el bot. Eso evita compartir el contador de cifrado con lo que el usuario
// hace a mano (ver onPageSend en src/assistant.ts).
/** El drop prendido más cercano dentro de lo que se ve, con su dirección, para mostrarlo (y avisar si es una joya o un excelente). */
export function lootHint() {
  const t = nearestWanted();
  if (!t || t.d > ALERT_TILES) return null;
  const dx = t.x - world.x, dy = t.y - world.y;
  const dir = (dy < 0 ? 'N' : dy > 0 ? 'S' : '') + (dx > 0 ? 'E' : dx < 0 ? 'O' : '');
  return { id: t.id, name: t.kind === 'zen' ? 'Zen' : itemInfo(t.group, t.num).name, kind: t.kind, dist: t.d, dir };
}

/** El asistente está esperando porque el usuario jugó a mano hace un momento. */
export const pausedByUser = () => Date.now() - bot.lastManualActionAt < MANUAL_PAUSE_MS;

export function skillName(): string {
  const s = attackSkill();
  return s ? SKILL_TABLE.get(s.number)?.name ?? `skill ${s.number}` : 'golpe';
}

export const skillNumber = () => attackSkill()?.number ?? 0;

/** Corre los loops hasta que cambie el cerebro (`assist.reload`). */
export async function run(): Promise<void> {
  const stopWatchingDrops = watchDrops();
  try {
    await Promise.all([assistLoop(), pickLoop()]);
  } finally {
    stopWatchingDrops();
  }
}
