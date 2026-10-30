/**
 * Reparto de stats con clicks reales en la ventana de personaje del cliente, no con paquetes: el cliente los manda con su propio contador de
 * cifrado y no hay nada que desincronizar (lo que rompía el ataque y el `/add` por chat cuando el usuario jugaba a la vez que el asistente).
 * Shift+click = +10, Cmd/Ctrl+click = +100, click solo = +1 (lo dice el propio panel).
 */
import { clickElement } from './input';

type StatRow = { label: string; value: number; btn: HTMLElement };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statRows(): StatRow[] {
  const panel = document.querySelector('.v097d-window.v097d-character');
  if (!panel) return [];
  const rows: StatRow[] = [];
  let pending: { label: string; value: number } | null = null;
  for (const el of Array.from(panel.children) as HTMLElement[]) {
    if (el.classList.contains('v097d-stat-name')) {
      const m = /^(Str|Agi|Vit|Ene):\s*(\d+)/.exec(el.textContent ?? '');
      pending = m ? { label: m[1]!, value: Number(m[2]) } : null;
    } else if (pending && el.classList.contains('v097d-button')) {
      rows.push({ ...pending, btn: el });
      pending = null;
    }
  }
  return rows;
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

/**
 * Energía hasta que fuerza − 2000 − energía llegue a 0 (ahí el giro de Twisting Slash rinde igual por punto en los dos), después mitad y mitad
 * entre fuerza y energía. Sin vitalidad (pedido del usuario, 2026-10-29).
 */
export async function investStats() {
  const rows = statRows();
  const str = rows.find((r) => r.label === 'Str');
  const ene = rows.find((r) => r.label === 'Ene');
  const points = readPoints();
  if (!str || !ene || points <= 0) return;
  const toEne = Math.min(points, Math.max(0, str.value - 2000 - ene.value));
  const half = Math.floor((points - toEne) / 2);
  const eneN = toEne + half;
  const strN = points - eneN;
  if (eneN > 0) await addToStat(ene.btn, eneN);
  if (strN > 0) await addToStat(str.btn, strN);
}
