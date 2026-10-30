/**
 * Reparto de stats con clicks reales en la ventana de personaje del cliente, no con paquetes: el cliente los manda con su propio contador de
 * cifrado y no hay nada que desincronizar (lo que rompía el ataque y el `/add` por chat cuando el usuario jugaba a la vez que el asistente).
 * Shift+click = +10, Cmd/Ctrl+click = +100, click solo = +1 (lo dice el propio panel).
 */
import { clickElement } from './input';

type StatRow = { label: string; value: number; btn: HTMLElement };

/** Los nombres de los stats en la ventana del juego, en inglés o en castellano (el cliente cambió a "Fue" y dejó de repartir sin avisar). */
const STAT_RE = /^(Str|Fue|For|Agi|Vit|Ene):\s*(\d+)/;
const STAT_LABEL: Record<string, string> = { Fue: 'Str', For: 'Str' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statRows(): StatRow[] {
  const panel = document.querySelector('.v097d-window.v097d-character');
  if (!panel) return [];
  const rows: StatRow[] = [];
  let pending: { label: string; value: number } | null = null;
  for (const el of Array.from(panel.children) as HTMLElement[]) {
    if (el.classList.contains('v097d-stat-name')) {
      const m = STAT_RE.exec(el.textContent ?? '');
      pending = m ? { label: STAT_LABEL[m[1]!] ?? m[1]!, value: Number(m[2]) } : null;
    } else if (pending && el.classList.contains('v097d-button')) {
      rows.push({ ...pending, btn: el });
      pending = null;
    }
  }
  return rows;
}

/** La velocidad de ataque que muestra la ventana ("Vel. ataque: 201" o "Atk speed: 201"), o null. */
function readAttackSpeed(): number | null {
  const el = Array.from(document.querySelectorAll('.v097d-window.v097d-character *'))
    .find((e) => e.children.length === 0 && /(Vel\. ataque|Atk speed|Attack speed):\s*\d+/i.test(e.textContent ?? ''));
  const m = /:\s*(\d+)/.exec(el?.textContent ?? '');
  return m ? Number(m[1]) : null;
}

/** Puntos libres, leídos de la ventana de personaje (0 si está cerrada). */
export function readPoints(): number {
  const el = Array.from(document.querySelectorAll('.v097d-window.v097d-character *'))
    .find((e) => e.children.length === 0 && /^Point:\s*\d+/.test(e.textContent ?? ''));
  return Number(/Point:\s*(\d+)/.exec(el?.textContent ?? '')?.[1] ?? 0);
}

/** Un stat hasta sumar `n` puntos: de a 100 (cmd), 10 (shift) y 1 (solo), con una pausa chica entre cada click. */
async function addToStat(btn: HTMLElement, n: number) {
  const steps: [number, { shift?: boolean; cmd?: boolean }][] = [[100, { cmd: true }], [10, { shift: true }], [1, {}]];
  for (const [step, mods] of steps) {
    while (n >= step) { clickElement(btn, mods); n -= step; await sleep(120); }
  }
}

export type StatPlan = { str: number; agi: number; ene: number };

/**
 * Hasta dónde sube la velocidad de ataque. La animación del skill va a `base + velocidad × 0.004` hasta 508; de 509 en adelante el cliente usa
 * otro factor (0.0026) y la animación se vuelve MÁS lenta (S6 en el bundle del juego, style-*.js). Pasarse de acá pierde ataques.
 */
const MAX_ATTACK_SPEED = 508;
/** Velocidad de animación de Twisting Slash (PLAYER_ATTACK_SKILL_WHEEL) sin velocidad de ataque, y cuánto suma cada punto de velocidad. */
const WHEEL_BASE = 0.24;
const SPEED_PER_AS = 0.004;
/** Agilidad por punto de velocidad de ataque del DK (Agi / 15). */
const AGI_PER_AS = 15;
/** Fuerza y energía rinden igual por punto cuando energía = fuerza − STR_ENE_GAP (regla del giro, medida antes). */
const STR_ENE_GAP = 2000;

/**
 * Reparto que más sube el daño por segundo del giro, punto por punto: cada punto va al stat con mayor ganancia relativa.
 *  - Agilidad: más velocidad de ataque es más giros por segundo (la animación manda: el mínimo del cliente entre skills, 231 ms con 200 de
 *    velocidad, es menor que el giro medido de ~550 ms). Ganancia = (0.004 / 15) / (0.24 + 0.004 × velocidad), hasta MAX_ATTACK_SPEED.
 *  - Fuerza y energía: daño por giro, 1 / (fuerza − 2000) y 1 / energía (iguales en energía = fuerza − 2000).
 *  - Vitalidad: nada (pedido del usuario, 2026-10-30: los monstruos no le hacen daño).
 * Lógica pura: entra lo que muestra la ventana, sale cuánto a cada stat.
 */
export function planStats(points: number, cur: { str: number; agi: number; ene: number; speed: number }): StatPlan {
  const plan: StatPlan = { str: 0, agi: 0, ene: 0 };
  let { str, ene } = cur;
  let agiSince = 0;
  for (let i = 0; i < points; i++) {
    const speed = cur.speed + agiSince / AGI_PER_AS;
    const gAgi = speed + 1 / AGI_PER_AS <= MAX_ATTACK_SPEED ? SPEED_PER_AS / AGI_PER_AS / (WHEEL_BASE + SPEED_PER_AS * speed) : 0;
    const gStr = 1 / Math.max(1, str - STR_ENE_GAP);
    const gEne = 1 / Math.max(1, ene);
    if (gAgi >= gStr && gAgi >= gEne) { plan.agi++; agiSince++; }
    else if (gStr >= gEne) { plan.str++; str++; }
    else { plan.ene++; ene++; }
  }
  return plan;
}

function currentPlan(): { plan: StatPlan; rows: StatRow[] } | string {
  const rows = statRows();
  const get = (l: string) => rows.find((r) => r.label === l);
  const str = get('Str'), agi = get('Agi'), ene = get('Ene');
  const points = readPoints();
  if (points <= 0) return 'No hay puntos para repartir (abrí la ventana de personaje con C).';
  if (!str || !agi || !ene) return 'No encuentro fuerza, agilidad y energía en la ventana de personaje.';
  const speed = readAttackSpeed() ?? Math.floor(agi.value / AGI_PER_AS);
  return { plan: planStats(points, { str: str.value, agi: agi.value, ene: ene.value, speed }), rows };
}

/** Cómo se repartirían los puntos ahora ("+120 Agi · +100 Fue · +70 Ene"), para el panel; null si no hay nada que repartir. */
export function previewStats(): string | null {
  const p = currentPlan();
  if (typeof p === 'string') return null;
  const parts = [['Agi', p.plan.agi], ['Fue', p.plan.str], ['Ene', p.plan.ene]].filter(([, n]) => (n as number) > 0).map(([l, n]) => `+${n} ${l}`);
  return parts.join(' · ');
}

/** Reparte los puntos libres según `planStats`. Devuelve el motivo si no pudo. */
export async function investStats(): Promise<string | null> {
  const p = currentPlan();
  if (typeof p === 'string') return p;
  const btn = (l: string) => p.rows.find((r) => r.label === l)!.btn;
  if (p.plan.agi > 0) await addToStat(btn('Agi'), p.plan.agi);
  if (p.plan.str > 0) await addToStat(btn('Str'), p.plan.str);
  if (p.plan.ene > 0) await addToStat(btn('Ene'), p.plan.ene);
  return null;
}
