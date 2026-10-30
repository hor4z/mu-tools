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
/**
 * Seguro: si tres pociones de vida seguidas dejan la vida exactamente igual, el porcentaje está mal leído (pasó con un máximo viejo de Swell Life): deja de
 * tomar un rato en vez de vaciar el inventario.
 */
const USELESS_HEALS = 3;
const HEAL_BACKOFF_MS = 30_000;
let heals = { count: 0, hpAt: 0, until: 0 };

/** Toma la poción de vida o de maná con el atajo si hace falta. true si apretó una tecla. */
function drinkIfNeeded(): boolean {
  if (!assist.press) return false;
  const now = Date.now();
  if (world.maxHp > 0 && (world.hp / world.maxHp) * 100 <= HEAL_AT_PCT && now - lastHealAt >= POTION_GAP_MS && now >= heals.until) {
    lastHealAt = now;
    // Solo si la vida quedó EXACTAMENTE igual: peleando baja aunque las pociones anden, y ahí no hay que dejar de curarse.
    heals = world.hp !== heals.hpAt || !heals.count ? { count: 1, hpAt: world.hp, until: 0 } : { ...heals, count: heals.count + 1 };
    if (heals.count > USELESS_HEALS) {
      log(`Asistente: ${USELESS_HEALS} pociones no cambiaron la vida (${world.hp}/${world.maxHp}); dejo de tomar ${HEAL_BACKOFF_MS / 1000} s.`);
      heals = { count: 0, hpAt: 0, until: now + HEAL_BACKOFF_MS };
      return false;
    }
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

// El automático no se pausa solo cuando jugás a mano: lo prendés y lo apagás vos con el interruptor (pedido del usuario, 2026-10-30). La pausa
// automática se activaba con paquetes que no eran tuyos (las pociones del propio asistente) y lo dejaba casi siempre quieto. Detectarlo bien
// queda para más adelante (issue en hor4z/mu-tools). Ya no hace falta por el cifrado: todo sale por un único contador (assistant.ts).

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

// --- Buscar y moverse -------------------------------------------------------------------------------------------------------------------------
// Antes atacaba solo lo que ya estaba al alcance y no caminaba: con monstruos a 3 o 4 casillas se quedaba parado. Ahora le pide al cliente el
// skill contra un monstruo de la zona y el cliente camina hasta tenerlo a tiro (su castApproach, con su pathfinding), como el MU Helper del juego.
/** Monstruos alrededor del objetivo que cuentan como grupo (los skills de área los agarran juntos). */
const GROUP_TILES = 2;
/** Si en este tiempo no llegó a tener a tiro al objetivo (pared, otro jugador en el medio), se lo saltea un rato. */
const STUCK_MS = 4000;
const SKIP_MS = 15000;
/** Con menos vida que esto no va a buscar: pelea solo lo que tiene al alcance mientras toma pociones. */
const ROAM_MIN_HP_PCT = 50;
/** Sin nada que hacer este tiempo, vuelve al ancla (no al instante: entre un monstruo y el siguiente suele aparecer otro). */
const RETURN_IDLE_MS = 1200;
const RETURN_PACE_MS = 1000;
/** Hasta cuánto espera a que el cliente levante un drop antes de dejarlo y seguir. */
const PICKUP_WAIT_MS = 4000;
/**
 * Si el cliente ya mandó el pedido y el drop sigue ahí este tiempo después, el server no lo dio (de otro jugador, sin lugar): se deja y no se
 * vuelve a pedir en PICKUP_REFUSED_MS. Antes se esperaban los 4 s enteros parado.
 */
const PICKUP_ANSWER_MS = 600;
const PICKUP_REFUSED_MS = 30000;

type Npc = { id: number; x: number; y: number };
/** Dónde está el personaje: la del cliente si está (world.x/y dice el destino mientras camina, ver assist.here). */
const me = () => assist.here?.() ?? { x: world.x, y: world.y };
/** Los monstruos vivos con la posición del cliente (la del bot puede estar varias casillas atrasada, ver assist.posOf). */
function liveMonsters(): Npc[] {
  const out: Npc[] = [];
  for (const n of world.npcs.values()) {
    if (!(assist.alive?.(n.id) ?? true)) continue;
    const p = assist.posOf?.(n.id);
    out.push(p ? { id: n.id, x: p.x, y: p.y } : n);
  }
  return out;
}
const skipUntil = new Map<number, number>();
let chosen = { id: 0, since: 0 };
let idleSince = 0;
let lastReturnAt = 0;
/** Hay un pedido de acercarse a un monstruo en curso: si el objetivo se va de la zona o se saltea, se cancela (si no, el cliente lo sigue). */
let approaching = false;
/** El maná de la vuelta anterior: si bajó, el cliente lanzó (le está pegando al objetivo aunque esté en el borde del alcance). */
let lastMana = 0;

/**
 * Si el monstruo está a tiro. Con el cliente lanzando manda su regla (skillCasting del juego): distancia real hasta `distance + 0.5` del skill,
 * o 1.8 sin distancia. Antes se usaba el alcance del bot (1 para Twisting Slash): caminaba hacia monstruos que ya tenía a tiro, y a los 4 s los
 * salteaba como inalcanzables mientras les pegaba. Acá sin el +0.5 (sin distancia, 1.5 en vez de 1.8): el cliente mide desde la posición con decimales y el cerebro desde la
 * casilla, y en el borde el cerebro lo daba a tiro mientras el cliente caminaba (medido: 12 s de 32 caminando con un monstruo a 2,5).
 */
function reachTest(skill: ReturnType<typeof attackSkill>, native: boolean, at: { x: number; y: number }): (n: Npc) => boolean {
  if (native && skill) {
    const dist = SKILL_TABLE.get(skill.number)?.distance ?? 0;
    const r = dist > 0 ? dist : 1.5; // 1.5: el pegado en diagonal (1.41) cuenta; el cliente llega hasta 1.8
    return (n) => Math.hypot(n.x - at.x, n.y - at.y) <= r;
  }
  const reach = skill ? castReach(skill.number) : 1;
  return (n) => chebyshev(at.x, at.y, n.x, n.y) <= reach;
}

const hpPct = () => (world.maxHp > 0 ? (world.hp / world.maxHp) * 100 : 100);
/** Hasta dónde puede ir a buscar ahora (0: solo lo que está al alcance). */
const roamNow = () => (assist.roam > 0 && hpPct() >= ROAM_MIN_HP_PCT ? assist.roam : 0);

/**
 * A quién pegarle. Sigue con el que eligió mientras viva y esté en la zona (no salta de uno a otro), salvo que esté lejos y otro ya lo tenga a
 * tiro: primero lo que le puede pegar. Si elige de nuevo: lo que está al alcance antes que lo que hay que ir a buscar, y entre esos el que tiene
 * más monstruos alrededor (un skill de área los agarra juntos) y está más cerca.
 */
function chooseTarget(at: { x: number; y: number }, inReach: (n: Npc) => boolean, roam: number): Npc | null {
  const now = Date.now();
  const anchor = assist.anchor ?? at;
  const alive = liveMonsters().filter((n) => (skipUntil.get(n.id) ?? 0) < now);
  const dist = (n: Npc) => chebyshev(at.x, at.y, n.x, n.y);
  const inZone = (n: Npc) => inReach(n) || (roam > 0 && chebyshev(anchor.x, anchor.y, n.x, n.y) <= roam);
  const cur = alive.find((n) => n.id === chosen.id);
  if (cur && inZone(cur) && (inReach(cur) || !alive.some(inReach))) return cur;
  let best: Npc | null = null;
  let bestScore = Infinity;
  for (const n of alive) {
    if (!inZone(n)) continue;
    let group = 0;
    for (const o of alive) if (o !== n && chebyshev(o.x, o.y, n.x, n.y) <= GROUP_TILES) group++;
    const score = (inReach(n) ? 0 : 100 + dist(n)) - 1.5 * group;
    if (score < bestScore) { best = n; bestScore = score; }
  }
  return best;
}

/** Un drop prendido en la zona, si no hay monstruos a tiro (como el MU Helper: entre un monstruo y el siguiente). Lo levanta el cliente. */
async function pickupOnTheWay(at: { x: number; y: number }, inReach: (n: Npc) => boolean, roam: number): Promise<boolean> {
  if (!assist.pickup) return false;
  const threat = () => liveMonsters().some(inReach);
  if (threat()) return false;
  const t = nearestWanted(true);
  if (!t || (t.kind !== 'zen' && bagRoom() <= 0)) return false;
  const anchor = assist.anchor ?? at;
  if (t.d > PICK_REACH && chebyshev(anchor.x, anchor.y, t.x, t.y) > roam) return false;
  const now = Date.now();
  askedAt.set(t.id, now);
  if (!assist.pickup(t.id)) {
    // Sin el mundo del cliente: el pedido de antes, sin caminar.
    if (t.d > PICK_REACH) return false;
    sendPickup(t.id);
    return true;
  }
  assist.doing = 'pickup';
  log(`Levantar: voy por ${t.kind === 'zen' ? 'Zen' : itemInfo(t.group, t.num).name} (a ${t.d} casillas).`);
  let sentAt = 0;
  while (drops.has(t.id) && Date.now() - now < PICKUP_WAIT_MS && assist.enabled && !assist.reload) {
    assist.nativeCastAt = Date.now(); // el pedido de levantar sale por la página: no es tuyo
    await sleep(100);
    if (!sentAt && !(assist.picking?.() ?? true)) sentAt = Date.now();
    if (sentAt && Date.now() - sentAt > PICKUP_ANSWER_MS && drops.has(t.id)) {
      log('Levantar: el server no lo dio (¿de otro jugador?); lo dejo.');
      refusedUntil.set(t.id, Date.now() + PICKUP_REFUSED_MS);
      break;
    }
    // Si mientras va llega un monstruo a tiro, primero el monstruo: el drop se vuelve a pedir después.
    inReach = reachTest(attackSkill(), !!assist.cast && assist.clientSkill > 0 && !!assist.here?.(), me());
    if (threat()) { assist.stop?.(); askedAt.delete(t.id); break; }
  }
  // Se pasó el tiempo: que el cliente no siga yendo al drop mientras el cerebro hace otra cosa.
  if (drops.has(t.id)) assist.stop?.();
  assist.doing = '';
  return true;
}

/** Ataca al objetivo de la zona: si está lejos, el cliente camina hasta él. Sin nada, levanta lo prendido y vuelve al ancla. */
async function assistLoop() {
  // Tras un golpe ya se esperó el ritmo completo: el sondeo de 150 ms solo corre cuando no se atacó (si no, se sumaba a cada golpe).
  let attacked = false;
  while (!assist.reload) {
    if (!attacked) await sleep(150);
    attacked = false;
    if (!assist.enabled || !bot.inGameAt || bot.kicked || world.hp <= 0) { assist.doing = ''; continue; }
    if (drinkIfNeeded()) await sleep(150);
    const skill = attackSkill();
    // El cliente lanza el skill elegido en su barra (assist.clientSkill); sin eso, el paquete lo manda el asistente.
    // Con el mundo del cliente (here no es null): sin él, el paquete del asistente no camina y no hay que elegir monstruos lejos.
    const native = !!assist.cast && assist.clientSkill > 0 && !!assist.here?.();
    const at = me();
    const inReach = reachTest(skill, native, at);
    // Ir a buscar solo con el cliente lanzando: un paquete del asistente a un monstruo lejos no camina, solo erraría.
    const roam = skill && native ? roamNow() : 0;
    const best = chooseTarget(at, inReach, roam);
    const now = Date.now();
    if (!best) {
      assist.target = 0;
      chosen = { id: 0, since: 0 };
      if (approaching) { assist.stop?.(); approaching = false; }
      if (await pickupOnTheWay(at, inReach, roam)) { idleSince = 0; continue; }
      const a = assist.anchor;
      if (!idleSince) idleSince = now;
      if (a && assist.roam > 0 && chebyshev(at.x, at.y, a.x, a.y) > 1) {
        if (now - idleSince >= RETURN_IDLE_MS && now - lastReturnAt >= RETURN_PACE_MS && assist.walk?.(a.x, a.y)) { lastReturnAt = now; assist.doing = 'return'; }
      } else assist.doing = '';
      continue;
    }
    idleSince = 0;
    const d = chebyshev(at.x, at.y, best.x, best.y);
    const atHand = inReach(best);
    const casted = world.mana < lastMana;
    lastMana = world.mana;
    if (best.id !== chosen.id || atHand || casted) chosen = { id: best.id, since: now };
    else if (now - chosen.since > STUCK_MS) {
      log(`Asistente: no llego al monstruo ${best.id} en ${STUCK_MS / 1000} s; lo salteo un rato.`);
      skipUntil.set(best.id, now + SKIP_MS);
      continue;
    }
    assist.target = best.id;
    if (skill && assist.cast?.(best.id)) {
      // El cliente lo lanza como con el click apretado (gira, anima y espera su propio tiempo entre skills), o camina hasta tenerlo a tiro: el
      // pedido se repone apenas lo usa. Esperar acá el ritmo del asistente dejaba huecos entre un Giro y el siguiente.
      assist.doing = atHand ? '' : 'approach';
      approaching = !atHand;
      assist.nativeCastAt = now;
      await sleep(NATIVE_CAST_POLL_MS);
      attacked = true;
      continue;
    }
    assist.doing = '';
    if (!atHand) continue;
    if (skill && useSkill(best.id, skill)) {
      assist.face?.(best.x, best.y);
      await sleep(humanPace(ASSIST_SKILL_PACE_MS));
      attacked = true;
    }
    else if (d <= 1) { sendHit(best.id, directionTowards(world.x, world.y, best.x, best.y)); assist.face?.(best.x, best.y); await sleep(humanPace(ATTACK_PACE_MS)); attacked = true; }
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
const refusedUntil = new Map<number, number>();

/** El drop más cercano de las clases prendidas. `ready`: solo los que se pueden pedir ya (ni rechazados ni recién pedidos). */
function nearestWanted(ready = false) {
  let best: { id: number; x: number; y: number; group: number; num: number; kind: PickKind; d: number } | null = null;
  const now = Date.now();
  const p = me();
  for (const dr of drops.values()) {
    const kind = pickKind(dr);
    if (!kind || !assist.pick[kind]) continue;
    if (now < (refusedUntil.get(dr.id) ?? 0)) continue;
    if (ready && now - (askedAt.get(dr.id) ?? 0) < PICKUP_WAIT_MS * 2) continue;
    const d = chebyshev(p.x, p.y, dr.x, dr.y);
    if (!best || d < best.d) best = { id: dr.id, x: dr.x, y: dr.y, group: dr.group, num: dr.num, kind, d };
  }
  return best;
}

async function pickLoop() {
  while (!assist.reload) {
    await sleep(100);
    const { zen, jewels, excellent } = assist.pick;
    if (!(zen || jewels || excellent) || !bot.inGameAt || bot.kicked || world.hp <= 0) continue;
    // Mientras va a levantar caminando (pickupOnTheWay) no se pide nada más. Si no, lo que está a PICK_REACH se pide también atacando: en un
    // spot lleno nunca queda un momento sin monstruos y pickupOnTheWay no corre.
    if (assist.doing === 'pickup') continue;
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
  const p = me();
  const dx = t.x - p.x, dy = t.y - p.y;
  const dir = (dy < 0 ? 'N' : dy > 0 ? 'S' : '') + (dx > 0 ? 'E' : dx < 0 ? 'O' : '');
  return { id: t.id, name: t.kind === 'zen' ? 'Zen' : itemInfo(t.group, t.num).name, kind: t.kind, dist: t.d, dir };
}

/** Ya no se pausa solo (ver el comentario antes de "Auto attack"): el panel lo sigue preguntando. */
export const pausedByUser = () => false;

export function skillName(): string {
  const s = attackSkill();
  return s ? SKILL_TABLE.get(s.number)?.name ?? `skill ${s.number}` : 'golpe';
}

/** Monstruos vivos a la vista (hasta 10 casillas), para el panel: la lista del bot guarda muertos y lejanos hasta que salen de la vista. */
export function monstersNear(): number {
  const p = me();
  let n = 0;
  for (const m of liveMonsters()) if (chebyshev(p.x, p.y, m.x, m.y) <= 10) n++;
  return n;
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
