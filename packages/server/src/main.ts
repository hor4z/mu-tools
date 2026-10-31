/**
 * Servidor local de mutool: recibe las filas de la extensión (POST /ingest, desde su service worker), las guarda en ClickHouse, responde la API de
 * rendimiento (/api/…) y sirve la página (packages/web/dist). Escucha solo en 127.0.0.1.
 *   bun run server
 */
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { INGEST_TABLES, SERVER_PORT, VERSION_PREFIX, type Health, type IngestBody, type Range } from '@mutool/protocol';
import { dbConfigured, dbInsert, dbName, dbRows } from './db';
import { live, monsters, sessions, zones } from './queries';

const MAX_ROWS = 5_000;
const WEB_DIR = join(import.meta.dir, '../../web/dist');

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, error: string) => json({ error }, status);

function range(u: URL, fallbackDays = 14): Range {
  const n = (k: string, d: number, max: number) => Math.min(max, Math.max(0, Math.floor(Number(u.searchParams.get(k) ?? d) || 0)));
  return { days: n('days', fallbackDays, 3650) || fallbackDays, minLevel: n('minLevel', 0, 1000) };
}

/** Las filas tienen que ser de la extensión (`version` mutool-…): las tablas son las mismas que usa mutbot y no hay que ensuciarlas. */
function validIngest(b: unknown): b is IngestBody {
  if (!b || typeof b !== 'object') return false;
  const { table, rows } = b as Partial<IngestBody>;
  if (!INGEST_TABLES.includes(table as never) || !Array.isArray(rows) || rows.length > MAX_ROWS) return false;
  return rows.every((r) => r && typeof r === 'object' && !Array.isArray(r) && typeof r.version === 'string' && r.version.startsWith(VERSION_PREFIX));
}

async function health(): Promise<Health> {
  if (!dbConfigured()) return { db: false, error: 'falta MUBOT_DB_URL (~/.mubot/.env.db)' };
  try {
    const [c] = await dbRows<{ ticks: number; events: number }>(
      `SELECT (SELECT count() FROM ticks WHERE version LIKE '${VERSION_PREFIX}%') AS ticks, (SELECT count() FROM events WHERE version LIKE '${VERSION_PREFIX}%') AS events`);
    return { db: true, rows: c };
  } catch (e) {
    return { db: false, error: (e as Error).message };
  }
}

async function api(u: URL): Promise<Response> {
  const r = range(u);
  switch (u.pathname) {
    case '/api/health': return json(await health());
    case '/api/zones': return json(await zones(r));
    case '/api/monsters': return json(await monsters(r));
    case '/api/sessions': return json(await sessions(r));
    case '/api/live': {
      const n = (k: string) => Number(u.searchParams.get(k) ?? NaN);
      const [map, x, y, level] = [n('map'), n('x'), n('y'), n('level')];
      if (![map, x, y].every(Number.isFinite)) return fail(400, 'faltan map, x, y');
      // La mejor zona para este nivel: lo que se farmeó con hasta 10 niveles menos.
      return json(await live(map, x, y, { days: r.days, minLevel: Number.isFinite(level) ? Math.max(0, level - 10) : r.minLevel }));
    }
  }
  return fail(404, 'no existe');
}

function staticFile(pathname: string): Response {
  if (!existsSync(WEB_DIR)) return new Response('Falta compilar la página: bun run web:build', { status: 404 });
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const f = Bun.file(join(WEB_DIR, rel));
  return new Response(f.size ? f : Bun.file(join(WEB_DIR, 'index.html')));
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.MUTOOL_PORT ?? SERVER_PORT),
  async fetch(req) {
    const u = new URL(req.url);
    try {
      if (u.pathname === '/ingest') {
        // Solo el service worker de la extensión: una página cualquiera del navegador no puede escribir acá.
        if (req.method !== 'POST') return fail(405, 'POST');
        if (!(req.headers.get('origin') ?? '').startsWith('chrome-extension://')) return fail(403, 'solo la extensión');
        const body = await req.json().catch(() => null);
        if (!validIngest(body)) return fail(400, 'filas inválidas');
        await dbInsert(body.table, body.rows);
        return json({ ok: true, rows: body.rows.length });
      }
      if (u.pathname.startsWith('/api/')) return req.method === 'GET' ? await api(u) : fail(405, 'GET');
      return staticFile(u.pathname);
    } catch (e) {
      console.error(`${req.method} ${u.pathname}: ${(e as Error).message}`);
      return fail(502, (e as Error).message);
    }
  },
});

console.log(`mutool server en http://${server.hostname}:${server.port} · base ${dbName}${dbConfigured() ? '' : ' (sin configurar: falta ~/.mubot/.env.db)'}`);
