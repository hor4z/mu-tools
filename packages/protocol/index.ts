/** Lo que se pasan la extensión, el servidor local y la página de rendimiento. Solo tipos y constantes. */

/** Puerto del servidor local; tiene que coincidir con `host_permissions` del manifest de la extensión. */
export const SERVER_PORT = 8787;
/**
 * Cortes de la ingesta, de adentro hacia afuera: la base (10 s, en el servidor) < el service worker < la página. Cada uno espera más que el de
 * adentro, para que un envío lento no se tome por fallido y se reenvíe (duplicaría kills y Zen).
 */
export const INGEST_TIMEOUT_MS = 15_000;
export const PAGE_TIMEOUT_MS = 20_000;
/** Tablas de ClickHouse (base `mubot_slow`, las mismas de mutbot) en las que la extensión puede escribir. */
export const INGEST_TABLES = ['ticks', 'events'] as const;
export type IngestTable = (typeof INGEST_TABLES)[number];
export type IngestBody = { table: IngestTable; rows: Record<string, unknown>[] };
/** Prefijo de `version` de las filas de la extensión: el servidor no acepta otras y consulta solo estas. */
export const VERSION_PREFIX = 'mutool-';

/** Una zona: mapa y cuadro de 16×16 casillas (como `v_cell_rate` de mutbot). */
export type Zone = {
  map: number; mapName: string; cx: number; cy: number; name: string;
  /** Minutos jugados ahí (fotos de 5 s), sesiones y última vez. */
  minutes: number; sessions: number; last: string; level: number;
  exp: number; zen: number; kills: number; potions: number; deaths: number;
  expH: number; zenH: number; killsH: number; potionsH: number;
  /** Los monstruos que más se mataron ahí. */
  monsters: string[];
};
export type Monster = {
  type: number; name: string; kills: number;
  /** Promedio por kill. El Zen es el levantado de sus drops (el monto no viene en el drop), así que depende de levantar el Zen. */
  exp: number; zen: number;
  /** Mediana de segundos desde que fue el objetivo hasta que murió (0 si no hay datos). */
  seconds: number;
  /** exp y zen por minuto de pelea contra ese monstruo (por kill / segundos por kill). */
  expMin: number; zenMin: number;
  maps: string[]; level: number;
};
export type Session = { session: string; start: string; end: string; minutes: number; level: number; mapName: string; exp: number; zen: number; kills: number; expH: number; zenH: number };
export type ZoneLive = { here: { name: string; expH: number; zenH: number; minutes: number } | null; best: { name: string; expH: number; zenH: number } | null };
export type Health = { db: boolean; error?: string; rows?: { ticks: number; events: number } };
/** Filtros de la API: días hacia atrás y nivel del personaje en las filas (maxLevel sin tope si falta). */
export type Range = { days: number; minLevel: number; maxLevel?: number };

/** Menos minutos que esto en una zona no alcanzan para comparar por hora (servidor y página). */
export const MIN_MINUTES = 3;

/** Índices de mapa del 0.97d. */
export const MAP_NAMES: Record<number, string> = {
  0: 'Lorencia', 1: 'Dungeon', 2: 'Devias', 3: 'Noria', 4: 'Lost Tower', 6: 'Arena',
  7: 'Atlans', 8: 'Tarkan', 10: 'Icarus', 33: 'Aida',
};
export const mapName = (n: number): string => MAP_NAMES[n] ?? `mapa ${n}`;

/** Distancia en casillas como la cuenta el juego (la mayor de las dos diferencias). */
export const tileDist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** 1234 → 1,2k; 3456789 → 3,5M (panel y página). */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  const f = (v: number, u: string) => `${v.toLocaleString('es-AR', { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })}${u}`;
  if (a >= 1e9) return f(n / 1e9, 'G');
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e3) return f(n / 1e3, 'k');
  return Math.round(n).toLocaleString('es-AR');
}
