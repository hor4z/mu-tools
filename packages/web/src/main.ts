/**
 * Página de rendimiento de mutool (la sirve packages/server en http://127.0.0.1:8787). Dónde rinde más el farmeo en Zen y experiencia, por zona de
 * 16×16 casillas y por monstruo, y las sesiones. Todo sale de la API del servidor (/api/zones, /api/monsters, /api/sessions, /api/health).
 */
import { MIN_MINUTES, type Health, type Monster, type Session, type Zone } from '@mutool/protocol';

/** Para "el monstruo que más Zen da" hacen falta varios kills. */
const MIN_KILLS = 20;
const DAYS = [1, 7, 14, 30, 90];
/** Donde arranca la rampa del mapa de calor (% de color sobre la superficie): más abajo, un valor chico no se distingue de una celda vacía. */
const RAMP_FLOOR = 22;
/** Filas por tabla antes de "Ver todas". */
const TABLE_ROWS = 20;
const PREFS_KEY = 'mutool-web';

type Metric = 'zen' | 'exp';
type Prefs = { days: number; minLevel: number; metric: Metric; potionPrice: number; theme?: 'light' | 'dark' };
const prefs: Prefs = { days: 14, minLevel: 0, metric: 'zen', potionPrice: 0 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')); } catch { /* sin almacenamiento */ }
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento */ } };
if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;

let data: { zones: Zone[]; monsters: Monster[]; sessions: Session[]; health: Health | null } = { zones: [], monsters: [], sessions: [], health: null };
let loadError = '';

// --- formato ---------------------------------------------------------------------------------------------------------------------------------

/** 1234 → 1,2 k; 3456789 → 3,5 M. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  const f = (v: number, u: string) => `${v.toLocaleString('es-AR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u}`;
  if (a >= 1e9) return f(n / 1e9, 'G');
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e3) return f(n / 1e3, 'k');
  return Math.round(n).toLocaleString('es-AR');
}
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const when = (ts: string) => new Date(ts.replace(' ', 'T') + 'Z').toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const netZenH = (z: Zone) => z.zenH - z.potionsH * prefs.potionPrice;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

// --- datos -----------------------------------------------------------------------------------------------------------------------------------

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const body = await r.json();
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

async function load() {
  const q = `?days=${prefs.days}&minLevel=${prefs.minLevel}`;
  try {
    const [zones, monsters, sessions, health] = await Promise.all([
      get<Zone[]>(`/api/zones${q}`), get<Monster[]>(`/api/monsters${q}`), get<Session[]>(`/api/sessions${q}`), get<Health>('/api/health'),
    ]);
    data = { zones, monsters, sessions, health };
    loadError = '';
  } catch (e) {
    loadError = (e as Error).message;
  }
  render();
}

// --- tooltip ---------------------------------------------------------------------------------------------------------------------------------

const tip = h('div', { class: 'tip', role: 'tooltip' });
tip.hidden = true;
function showTip(target: HTMLElement, title: string, rows: [string, string][]) {
  tip.replaceChildren(h('b', {}, title), ...rows.map(([k, v]) => h('div', { class: 'row' }, h('span', {}, k), h('span', {}, v))));
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const w = tip.offsetWidth, ht = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - ht - 8 < 8 ? r.bottom + 8 : r.top - ht - 8}px`;
}
const hideTip = () => { tip.hidden = true; };

// --- piezas ----------------------------------------------------------------------------------------------------------------------------------

function segmented<T extends string | number>(options: { value: T; label: string }[], current: T, onPick: (v: T) => void) {
  const seg = h('div', { class: 'seg', role: 'group' });
  for (const o of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === current) }, o.label);
    if (o.value === current) b.classList.add('on');
    b.onclick = () => onPick(o.value);
    seg.append(b);
  }
  return seg;
}

function filters() {
  const level = h('input', { type: 'number', min: '0', max: '1000', value: String(prefs.minLevel), 'aria-label': 'Nivel mínimo' });
  level.onchange = () => { prefs.minLevel = Math.max(0, Math.floor(Number(level.value) || 0)); savePrefs(); void load(); };
  const price = h('input', { type: 'number', min: '0', step: '10', value: String(prefs.potionPrice), 'aria-label': 'Precio por poción' });
  price.onchange = () => { prefs.potionPrice = Math.max(0, Number(price.value) || 0); savePrefs(); render(); };
  return h('div', { class: 'filters' },
    h('label', {}, 'Días', segmented(DAYS.map((d) => ({ value: d, label: String(d) })), prefs.days, (d) => { prefs.days = d; savePrefs(); void load(); })),
    h('label', {}, 'Mapa de calor', segmented<Metric>([{ value: 'zen', label: 'Zen/h' }, { value: 'exp', label: 'Exp/h' }], prefs.metric, (m) => { prefs.metric = m; savePrefs(); render(); })),
    h('label', {}, 'Nivel desde', level),
    h('label', { title: 'Lo que te cuesta cada poción en Zen: resta del Zen/h para el Zen neto' }, 'Poción (zen)', price),
  );
}

function kpi(label: string, value: string, sub: string, color?: string) {
  const lab = h('div', { class: 'lab' });
  if (color) lab.append(h('span', { class: 'swatch', style: `background: var(${color})` }));
  lab.append(label);
  return h('div', { class: 'kpi' }, lab, h('div', { class: 'num' }, value), h('div', { class: 'sub' }, sub));
}

function kpis(zones: Zone[]) {
  const best = (f: (z: Zone) => number) => zones.reduce<Zone | null>((b, z) => (!b || f(z) > f(b) ? z : b), null);
  const bz = best((z) => z.zenH), be = best((z) => z.expH);
  const rich = data.monsters.filter((m) => m.kills >= MIN_KILLS && m.zen > 0).reduce<Monster | null>((b, m) => (!b || m.zen > b.zen ? m : b), null);
  const total = data.zones.reduce((t, z) => t + z.minutes, 0);
  return h('div', { class: 'kpis' },
    kpi('Mejor zona por Zen', bz && bz.zenH > 0 ? `${compact(bz.zenH)} /h` : '–', bz && bz.zenH > 0 ? `${bz.name} · ${minutes(bz.minutes)} medidos` : 'Todavía sin Zen levantado', '--zen'),
    kpi('Mejor zona por experiencia', be && be.expH > 0 ? `${compact(be.expH)} /h` : '–', be && be.expH > 0 ? `${be.name} · ${minutes(be.minutes)} medidos` : 'Faltan datos', '--exp'),
    kpi('Monstruo que más Zen suelta', rich ? `${compact(rich.zen)} /kill` : '–', rich ? `${rich.name} · ${rich.kills} kills` : `Con ${MIN_KILLS} kills o más y algo de Zen`),
    kpi('Tiempo registrado', minutes(total), `${data.sessions.length} sesiones · últimos ${prefs.days} días`),
  );
}

/** Un mapa de calor por mapa: cuadros de 16×16 casillas, color por la métrica elegida (rampa de un tono). */
function heatmaps(zones: Zone[]) {
  const metric = prefs.metric;
  const color = metric === 'zen' ? '--zen' : '--exp';
  const value = (z: Zone) => (metric === 'zen' ? z.zenH : z.expH);
  const max = Math.max(0, ...zones.filter((z) => z.minutes >= MIN_MINUTES).map(value));
  const byMap = new Map<number, Zone[]>();
  for (const z of zones) byMap.set(z.map, [...(byMap.get(z.map) ?? []), z]);
  // Solo los mapas con alguna zona que se pueda comparar; el mejor mapa primero.
  const bestOf = (list: Zone[]) => Math.max(0, ...list.filter((z) => z.minutes >= MIN_MINUTES).map(value));
  for (const [map, list] of byMap) if (!list.some((z) => z.minutes >= MIN_MINUTES)) byMap.delete(map);
  const wrap = h('div', { class: 'maps' });
  for (const [, list] of [...byMap].sort((a, b) => bestOf(b[1]) - bestOf(a[1]) || a[0] - b[0])) {
    const grid = h('div', { class: 'grid', role: 'group', 'aria-label': `Mapa de calor de ${list[0]!.mapName}` });
    const cells = new Map(list.map((z) => [z.cy * 16 + z.cx, z]));
    for (let cy = 0; cy < 16; cy++) {
      for (let cx = 0; cx < 16; cx++) {
        const z = cells.get(cy * 16 + cx);
        const c = h('div', { class: 'cell' });
        if (z) {
          const enough = z.minutes >= MIN_MINUTES;
          const t = enough && max > 0 ? value(z) / max : 0;
          c.classList.add('data');
          c.tabIndex = 0;
          c.style.background = enough ? `color-mix(in oklab, var(${color}) ${Math.round(RAMP_FLOOR + (100 - RAMP_FLOOR) * t)}%, var(--surface))` : 'var(--few)';
          const rows: [string, string][] = [
            ['Zen/h', compact(z.zenH)], ['Exp/h', compact(z.expH)], ['Kills/h', compact(z.killsH)], ['Pociones/h', compact(z.potionsH)],
            ['Tiempo', minutes(z.minutes)], ['Muertes', String(z.deaths)],
          ];
          if (z.monsters.length) rows.push(['Monstruos', z.monsters.join(', ')]);
          if (!enough) rows.push(['', 'Pocos minutos: no se compara']);
          const show = () => showTip(c, z.name, rows);
          c.addEventListener('pointerenter', show);
          c.addEventListener('focus', show);
          c.addEventListener('pointerleave', hideTip);
          c.addEventListener('blur', hideTip);
          c.setAttribute('aria-label', `${z.name}: ${compact(value(z))} ${metric}/h`);
        }
        grid.append(c);
      }
    }
    wrap.append(h('div', { class: 'map' }, h('h3', {}, list[0]!.mapName), grid));
  }
  const legend = h('div', { class: 'legend' }, '0',
    h('span', { class: 'ramp', style: `background: linear-gradient(90deg, color-mix(in oklab, var(${color}) ${RAMP_FLOOR}%, var(--surface)), var(${color}))` }),
    `${compact(max)} ${metric === 'zen' ? 'Zen' : 'exp'}/h`, h('span', { class: 'swatch-few' }), `menos de ${MIN_MINUTES} min`);
  return [wrap, legend];
}

type Col<T> = { key: string; label: string; value: (r: T) => number | string; cell?: (r: T, max: number) => Node | string; bar?: string; title?: string };

/** Tabla ordenable; las columnas con `bar` llevan una barra de su color proporcional al máximo de la columna y marcan al mejor. */
function table<T>(id: string, rows: T[], cols: Col<T>[], initial: string, limit = Infinity) {
  const state = (sortState[id] ??= { key: initial, desc: true });
  const col = cols.find((c) => c.key === state.key) ?? cols[0]!;
  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return state.desc ? -d : d;
  });
  const maxOf = new Map(cols.map((c) => [c.key, Math.max(0, ...rows.map((r) => Number(c.value(r)) || 0))]));
  const head = h('tr', {}, ...cols.map((c) => {
    const th = h('th', { scope: 'col', 'aria-sort': c.key === state.key ? (state.desc ? 'descending' : 'ascending') : 'none' }, c.label + (c.key === state.key ? (state.desc ? ' ↓' : ' ↑') : ''));
    if (c.title) th.title = c.title;
    if (c.key === state.key) th.classList.add('sorted');
    th.onclick = () => { sortState[id] = { key: c.key, desc: c.key === state.key ? !state.desc : true }; render(); };
    return th;
  }));
  const all = expanded.has(id);
  const body = sorted.slice(0, all ? undefined : limit).map((r) => h('tr', {}, ...cols.map((c) => {
    const max = maxOf.get(c.key) ?? 0;
    if (c.cell) return h('td', {}, c.cell(r, max));
    const v = c.value(r);
    if (typeof v !== 'number' || !c.bar) return h('td', {}, typeof v === 'number' ? compact(v) : v);
    const td = h('td', {});
    if (v > 0 && max > 0) td.append(h('span', { class: 'bar', style: `width: ${Math.max(2, Math.round((v / max) * 70))}px; background: var(${c.bar})` }));
    td.append(v > 0 && v === max ? h('span', { class: 'best' }, compact(v)) : compact(v));
    return td;
  })));
  const wrap = h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
  if (sorted.length <= limit) return wrap;
  const more = h('button', { class: 'more', type: 'button' }, all ? 'Ver menos' : `Ver todas (${sorted.length})`);
  more.onclick = () => { if (all) expanded.delete(id); else expanded.add(id); render(); };
  return h('div', {}, wrap, more);
}
const sortState: Record<string, { key: string; desc: boolean }> = {};
const expanded = new Set<string>();

function zonesSection() {
  const ok = data.zones.filter((z) => z.minutes >= MIN_MINUTES && (z.kills > 0 || z.zen > 0));
  const s = h('section', {}, h('h2', {}, 'Zonas'),
    h('p', { class: 'lede' }, `Cuadros de 16×16 casillas, con al menos ${MIN_MINUTES} minutos jugados. El Zen es el que levantaste; las pociones, las que tomó el asistente.`));
  if (!data.zones.length) { s.append(h('p', { class: 'empty' }, 'Todavía no hay datos: jugá con la extensión y el servidor prendidos.')); return s; }
  // El mapa también muestra (en gris) las zonas con kills o Zen pero pocos minutos; la tabla, solo las comparables.
  s.append(...heatmaps(data.zones.filter((z) => z.kills > 0 || z.zen > 0)));
  const cols: Col<Zone>[] = [
    { key: 'name', label: 'Zona', value: (z) => z.name, cell: (z) => h('span', {}, z.name, z.monsters[0] ? h('span', { class: 'tag' }, z.monsters.join(' · ')) : '') },
    { key: 'zenH', label: 'Zen/h', value: (z) => z.zenH, bar: '--zen' },
    { key: 'expH', label: 'Exp/h', value: (z) => z.expH, bar: '--exp' },
  ];
  if (prefs.potionPrice > 0) cols.push({ key: 'net', label: 'Zen neto/h', value: netZenH, title: 'Zen/h menos lo que costaron las pociones' });
  cols.push(
    { key: 'killsH', label: 'Kills/h', value: (z) => z.killsH },
    { key: 'potionsH', label: 'Pociones/h', value: (z) => z.potionsH },
    { key: 'deaths', label: 'Muertes', value: (z) => z.deaths },
    { key: 'minutes', label: 'Tiempo', value: (z) => z.minutes, cell: (z) => minutes(z.minutes) },
    { key: 'last', label: 'Última vez', value: (z) => z.last, cell: (z) => when(z.last) },
  );
  s.append(table('zones', ok, cols, prefs.metric === 'zen' ? 'zenH' : 'expH', TABLE_ROWS));
  return s;
}

function monstersSection() {
  const s = h('section', {}, h('h2', {}, 'Monstruos'),
    h('p', { class: 'lede' }, 'Por kill propio. Los segundos son desde que fue el objetivo hasta que murió; con skills de área se pelea con varios a la vez, así que el rendimiento por minuto real es mayor.'));
  if (!data.monsters.length) { s.append(h('p', { class: 'empty' }, 'Sin kills registrados en este período.')); return s; }
  s.append(table('monsters', data.monsters, [
    { key: 'name', label: 'Monstruo', value: (m) => m.name, cell: (m) => h('span', {}, m.name, h('span', { class: 'tag' }, m.maps.join(' · '))) },
    { key: 'zen', label: 'Zen/kill', value: (m) => m.zen, bar: '--zen' },
    { key: 'exp', label: 'Exp/kill', value: (m) => m.exp, bar: '--exp' },
    { key: 'seconds', label: 'Seg/kill', value: (m) => m.seconds, cell: (m) => (m.seconds ? m.seconds.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '–') },
    { key: 'zenMin', label: 'Zen/min', value: (m) => m.zenMin },
    { key: 'expMin', label: 'Exp/min', value: (m) => m.expMin },
    { key: 'kills', label: 'Kills', value: (m) => m.kills },
  ], prefs.metric === 'zen' ? 'zen' : 'exp', TABLE_ROWS));
  return s;
}

function sessionsSection() {
  const s = h('section', {}, h('h2', {}, 'Sesiones'), h('p', { class: 'lede' }, 'Cada carga de la página del juego.'));
  if (!data.sessions.length) { s.append(h('p', { class: 'empty' }, 'Sin sesiones en este período.')); return s; }
  s.append(table('sessions', data.sessions, [
    { key: 'start', label: 'Inicio', value: (x) => x.start, cell: (x) => when(x.start) },
    { key: 'mapName', label: 'Mapa', value: (x) => x.mapName },
    { key: 'level', label: 'Nivel', value: (x) => x.level, cell: (x) => String(x.level) },
    { key: 'minutes', label: 'Duración', value: (x) => x.minutes, cell: (x) => minutes(x.minutes) },
    { key: 'zenH', label: 'Zen/h', value: (x) => x.zenH, bar: '--zen' },
    { key: 'expH', label: 'Exp/h', value: (x) => x.expH, bar: '--exp' },
    { key: 'zen', label: 'Zen', value: (x) => x.zen },
    { key: 'exp', label: 'Exp', value: (x) => x.exp },
    { key: 'kills', label: 'Kills', value: (x) => x.kills, cell: (x) => String(x.kills) },
  ], 'start', TABLE_ROWS));
  return s;
}

function statusText(): { text: string; err: boolean } {
  if (loadError) return { text: `Error: ${loadError}`, err: true };
  const hl = data.health;
  if (!hl) return { text: 'Cargando…', err: false };
  if (!hl.db) return { text: `Sin base: ${hl.error ?? ''}`, err: true };
  return { text: `ClickHouse ok · ${compact(hl.rows?.ticks ?? 0)} fotos · ${compact(hl.rows?.events ?? 0)} eventos`, err: false };
}

function render() {
  const app = document.getElementById('app')!;
  const st = statusText();
  const theme = h('button', { class: 'theme', type: 'button' }, document.documentElement.dataset.theme === 'dark' ? 'Tema claro' : 'Tema oscuro');
  theme.onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    prefs.theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = prefs.theme;
    savePrefs();
    render();
  };
  const ok = data.zones.filter((z) => z.minutes >= MIN_MINUTES && (z.kills > 0 || z.zen > 0));
  hideTip();
  app.replaceChildren(h('div', { class: 'wrap' },
    h('header', {}, h('h1', {}, 'Rendimiento'), h('span', { class: `status${st.err ? ' err' : ''}` }, st.text), theme),
    filters(), kpis(ok), zonesSection(), monstersSection(), sessionsSection(),
  ), tip);
}

render();
void load();
setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
