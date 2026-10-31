/**
 * ClickHouse por HTTP, como `mutbot/packages/db/src/index.ts`. Credenciales del entorno (`MUBOT_DB_URL`, `MUBOT_DB_USER`, `MUBOT_DB_PASSWORD`,
 * `MUBOT_DB_NAME`); si no están, se leen de `~/.mubot/.env.db` (el archivo de mutbot). Nunca van en el repo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.MUBOT_DB_URL) loadEnvFile(process.env.MUTOOL_ENV_FILE ?? join(homedir(), '.mubot', '.env.db'));

const DB_URL = process.env.MUBOT_DB_URL ?? '';
const DB_NAME = process.env.MUBOT_DB_NAME ?? 'mubot_slow';
const headers = { 'X-ClickHouse-User': process.env.MUBOT_DB_USER ?? 'mubot', 'X-ClickHouse-Key': process.env.MUBOT_DB_PASSWORD ?? '' };

export const dbConfigured = () => DB_URL !== '';
export const dbName = DB_NAME;

/** Consulta de lectura: filas JSONEachRow. Tira si la base no responde o la consulta falla. */
export async function dbRows<T = Record<string, unknown>>(sql: string, timeoutMs = 10_000): Promise<T[]> {
  if (!DB_URL) throw new Error('falta MUBOT_DB_URL (~/.mubot/.env.db)');
  const r = await fetch(`${DB_URL}/?database=${DB_NAME}&output_format_json_quote_64bit_integers=0`, {
    method: 'POST', body: `${sql} FORMAT JSONEachRow`, headers, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ClickHouse ${r.status}: ${text.slice(0, 300)}`);
  return text.trim() ? text.trim().split('\n').map((l) => JSON.parse(l) as T) : [];
}

/** Inserta filas (JSONEachRow); los campos que la tabla no tiene se ignoran. */
export async function dbInsert(table: string, rows: object[], timeoutMs = 15_000): Promise<void> {
  if (!DB_URL) throw new Error('falta MUBOT_DB_URL (~/.mubot/.env.db)');
  if (!rows.length) return;
  const q = encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`);
  const r = await fetch(`${DB_URL}/?database=${DB_NAME}&query=${q}&input_format_skip_unknown_fields=1`, {
    method: 'POST', body: rows.map((x) => JSON.stringify(x)).join('\n'), headers, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`ClickHouse ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
