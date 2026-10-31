/** Lo que se pasan la extensión, el servidor local y la página de rendimiento. Solo tipos y constantes. */

/** Puerto del servidor local; tiene que coincidir con `host_permissions` del manifest de la extensión. */
export const SERVER_PORT = 8787;
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
  /** Promedio por kill. */
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
/** Filtros de la API: días hacia atrás y nivel mínimo del personaje en las filas. */
export type Range = { days: number; minLevel: number };
