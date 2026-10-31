/**
 * Las consultas de rendimiento sobre las filas de la extensión (`version LIKE 'mutool-%'`) en `ticks` y `events` de `mubot_slow`:
 *  - el tiempo sale de las fotos de 5 s (`ticks`), por zona de 16×16 casillas;
 *  - la experiencia y el Zen, de los eventos `kill` (num2 = exp, data.zen = Zen que soltó), `zen` (num1 = Zen levantado), `potion` y `death`.
 * Las tasas por hora se calculan acá, no en SQL, para que una zona con pocos minutos no dé números absurdos (ver MIN_MINUTES).
 */
import { MIN_MINUTES, VERSION_PREFIX, mapName, type Monster, type Range, type Session, type Zone, type ZoneLive } from '@mutool/protocol';
import { dbRows } from './db';

const TICK_MIN = 5 / 60;
const ZONE_TILES = 16;

const mine = `version LIKE '${VERSION_PREFIX}%'`;
const when = (r: Range) => `ts > now() - INTERVAL ${r.days} DAY AND level >= ${r.minLevel}${r.maxLevel != null ? ` AND level <= ${r.maxLevel}` : ''}`;
const perHour = (v: number, minutes: number) => (minutes > 0 ? (v * 60) / minutes : 0);
/** Nombre corto de una zona: mapa y su cuadro (las coordenadas del centro, como se ven en el juego). */
const zoneName = (map: number, cx: number, cy: number) => `${mapName(map)} ${cx * ZONE_TILES + 8},${cy * ZONE_TILES + 8}`;

export async function zones(r: Range): Promise<Zone[]> {
  type Row = {
    map: number; cx: number; cy: number; ticks: number; sessions: number; last: string; lvl: number;
    exp: number; zen: number; kills: number; potions: number; deaths: number; monsters: string[];
  };
  const rows = await dbRows<Row>(`
    WITH t AS (
      SELECT map, intDiv(x, ${ZONE_TILES}) AS cx, intDiv(y, ${ZONE_TILES}) AS cy, count() AS ticks, uniq(session) AS sessions,
             toString(max(ts)) AS last, round(avg(level)) AS lvl
      FROM ticks WHERE ${mine} AND ${when(r)} GROUP BY map, cx, cy
    ), e AS (
      SELECT map, intDiv(x, ${ZONE_TILES}) AS cx, intDiv(y, ${ZONE_TILES}) AS cy,
             sumIf(num2, kind = 'kill') AS exp, sumIf(num1, kind = 'zen') AS zen, countIf(kind = 'kill') AS kills,
             countIf(kind = 'potion') AS potions, countIf(kind = 'death') AS deaths, topKIf(3)(text, kind = 'kill') AS monsters
      FROM events WHERE ${mine} AND ${when(r)} AND kind IN ('kill', 'zen', 'potion', 'death') GROUP BY map, cx, cy
    )
    SELECT t.map AS map, t.cx AS cx, t.cy AS cy, t.ticks AS ticks, t.sessions AS sessions, t.last AS last, t.lvl AS lvl,
           e.exp AS exp, e.zen AS zen, e.kills AS kills, e.potions AS potions, e.deaths AS deaths, e.monsters AS monsters
    FROM t LEFT JOIN e ON t.map = e.map AND t.cx = e.cx AND t.cy = e.cy`);
  return rows.map((z) => {
    const minutes = z.ticks * TICK_MIN;
    return {
      map: z.map, mapName: mapName(z.map), cx: z.cx, cy: z.cy, name: zoneName(z.map, z.cx, z.cy),
      minutes, sessions: z.sessions, last: z.last, level: z.lvl,
      exp: z.exp, zen: z.zen, kills: z.kills, potions: z.potions, deaths: z.deaths,
      expH: perHour(z.exp, minutes), zenH: perHour(z.zen, minutes), killsH: perHour(z.kills, minutes), potionsH: perHour(z.potions, minutes),
      monsters: z.monsters ?? [],
    };
  });
}

export async function monsters(r: Range): Promise<Monster[]> {
  type Row = { type: number; name: string; kills: number; exp: number; zen: number; ms: number; maps: number[]; lvl: number };
  const rows = await dbRows<Row>(`
    SELECT toUInt32(num1) AS type, any(text) AS name, count() AS kills, avg(num2) AS exp, avg(JSONExtractUInt(data, 'zen')) AS zen,
           quantileExactIf(0.5)(JSONExtractUInt(data, 'ms'), JSONExtractUInt(data, 'ms') > 0) AS ms,
           groupUniqArray(3)(map) AS maps, round(avg(level)) AS lvl
    FROM events WHERE ${mine} AND ${when(r)} AND kind = 'kill'
    GROUP BY type ORDER BY kills DESC`);
  return rows.map((m) => {
    const seconds = (m.ms || 0) / 1000;
    return {
      type: m.type, name: m.name, kills: m.kills, exp: m.exp, zen: m.zen, seconds,
      expMin: seconds > 0 ? (m.exp * 60) / seconds : 0, zenMin: seconds > 0 ? (m.zen * 60) / seconds : 0,
      maps: m.maps.map(mapName), level: m.lvl,
    };
  });
}

export async function sessions(r: Range): Promise<Session[]> {
  type T = { session: string; start: string; end: string; ticks: number; lvl: number; top_map: number; exp: number };
  type E = { session: string; zen: number; kills: number };
  const [t, e] = await Promise.all([
    dbRows<T>(`
      SELECT session, toString(min(ts)) AS start, toString(max(ts)) AS end, count() AS ticks, argMax(level, ts) AS lvl,
             topK(1)(map)[1] AS top_map, max(exp_total) - min(exp_total) AS exp
      FROM ticks WHERE ${mine} AND ${when(r)} GROUP BY session ORDER BY start DESC LIMIT 60`),
    dbRows<E>(`
      SELECT session, sumIf(num1, kind = 'zen') AS zen, countIf(kind = 'kill') AS kills
      FROM events WHERE ${mine} AND ${when(r)} AND kind IN ('zen', 'kill') GROUP BY session`),
  ]);
  const byId = new Map(e.map((x) => [x.session, x]));
  return t.map((s) => {
    const minutes = s.ticks * TICK_MIN;
    const x = byId.get(s.session);
    const zen = x?.zen ?? 0;
    return {
      session: s.session, start: s.start, end: s.end, minutes, level: s.lvl, mapName: mapName(s.top_map),
      exp: s.exp, zen, kills: x?.kills ?? 0, expH: perHour(s.exp, minutes), zenH: perHour(zen, minutes),
    };
  });
}

/** La zona donde está el personaje contra la mejor conocida por Zen/h (para el panel del juego). */
export async function live(map: number, x: number, y: number, r: Range): Promise<ZoneLive> {
  const all = (await zones(r)).filter((z) => z.minutes >= MIN_MINUTES && z.kills > 0);
  const cx = Math.floor(x / ZONE_TILES), cy = Math.floor(y / ZONE_TILES);
  const here = all.find((z) => z.map === map && z.cx === cx && z.cy === cy);
  // Por Zen/h; si empatan (zonas sin Zen), por exp/h.
  const best = all.reduce<Zone | null>((b, z) => (!b || z.zenH > b.zenH || (z.zenH === b.zenH && z.expH > b.expH) ? z : b), null);
  return {
    here: here ? { name: here.name, expH: here.expH, zenH: here.zenH, minutes: here.minutes } : null,
    best: best ? { name: best.name, expH: best.expH, zenH: best.zenH } : null,
  };
}
