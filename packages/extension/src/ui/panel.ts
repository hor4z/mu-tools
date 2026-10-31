/**
 * El panel del asistente, arriba del juego: prende el auto attack, elige qué levantar (Zen, joyas, excelentes), reparte puntos y dice qué está
 * haciendo y por qué. Vive en un Shadow DOM: los estilos del juego no lo tocan y los suyos no tocan el juego. Se arrastra del título, se achica
 * con el botón y recuerda posición, tamaño y la campanita.
 */
import type { PickKind, Status } from '../assistant';
import { EXT_BUILD, EXT_VERSION } from '../build-info';
import { CHANGELOG } from '../changelog';
import { previewStats, readPoints } from '../page/stats';
import { chime, unlockSound } from './sound';

export type PanelDeps = {
  status(): Status;
  /** Devuelve el motivo si no se pudo. */
  setAssist(change: { attack?: boolean; pick?: PickKind; roam?: number }): string | null;
  /** Reparte los puntos libres; devuelve el motivo si no pudo. */
  investStats(): Promise<string | null>;
  /** Elige un skill en la barra del juego. true si quedó elegido. */
  selectSkill(name: string): Promise<boolean>;
};

const PREFS_KEY = 'asistente-prefs';
type Prefs = { x?: number; y?: number; collapsed?: boolean; sound?: boolean; seenVersion?: string; roam?: number };
const PICKS: { kind: PickKind; label: string; hint: string }[] = [
  { kind: 'zen', label: 'Zen', hint: 'Levanta el Zen: a 2 casillas, o en la zona de Moverse con el auto attack prendido' },
  { kind: 'jewels', label: 'Joyas', hint: 'Joyas y plumas, como el Zen (si hay lugar en la bolsa)' },
  { kind: 'excellent', label: 'Excelentes', hint: 'Ítems excelentes, como el Zen (si hay lugar en la bolsa)' },
];
/** Hasta dónde va a buscar monstruos y drops, en casillas desde donde lo prendiste. */
const ROAMS: { roam: number; label: string; hint: string }[] = [
  { roam: 0, label: 'Quieto', hint: 'No camina: ataca solo lo que tiene al alcance' },
  { roam: 5, label: 'Cerca', hint: 'Va a buscar monstruos y drops hasta 5 casillas de donde lo prendiste, y vuelve' },
  { roam: 9, label: 'Lejos', hint: 'Hasta 9 casillas de donde lo prendiste, y vuelve' },
];
const REFRESH_MS = 300;
const POINTS_REFRESH_MS = 1000;
const ERROR_MS = 4000;
const SWITCH_GUARD_MS = 400;

const CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483647; width: 232px; font: 12px/1.35 system-ui, -apple-system, Segoe UI, sans-serif; color: #e9e4d8;
  background: rgba(18, 16, 14, .94); border: 1px solid #6b5631; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.5); user-select: none;
  display: flex; flex-direction: column; max-height: 100vh; box-sizing: border-box; }
.head { display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 10px; cursor: move; border-bottom: 1px solid #3a3022; }
.title { flex: 1; font-weight: 700; color: #f0c86a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #666; flex: none; }
.dot.on { background: #3fcf74; box-shadow: 0 0 6px #3fcf74; }
.dot.paused { background: #e3a53a; }
.icon { all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 5px; color: #bfb39a; font-size: 13px; }
.icon:hover { background: #2c251b; color: #fff; }
.icon.off { opacity: .45; }
.body { padding: 9px 10px 10px; display: grid; gap: 9px; overflow-y: auto; min-height: 0; }
.collapsed .body { display: none; }
.collapsed .head { border-bottom: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.label { font-weight: 600; }
.sub { color: #9d927d; font-size: 11px; }
.switch { all: unset; cursor: pointer; width: 38px; height: 21px; border-radius: 11px; background: #4a4337; position: relative; flex: none; transition: background .15s; }
.switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #d9d2c3; transition: left .15s; }
.switch.on { background: #2e9e5b; }
.switch.on::after { left: 20px; background: #fff; }
.switch:disabled, .chip:disabled, .btn:disabled { cursor: not-allowed; opacity: .45; }
.section { color: #9d927d; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
.chips { display: flex; gap: 5px; }
.chip { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 5px 0; border-radius: 6px; border: 1px solid #4a4337; color: #cfc6b3; font-weight: 600; }
.chip:hover:not(:disabled) { border-color: #8a7444; }
.chip.on { background: #3a2f17; border-color: #d4a947; color: #f6d47c; }
.skills { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.skills .chip { font-weight: 500; font-size: 11px; padding: 5px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { padding: 6px 8px; border-radius: 6px; background: #221d16; color: #cfc6b3; min-height: 16px; }
.status.warn { background: #3a2a10; color: #f0c06a; }
.status.err { background: #3a1616; color: #ff9b8f; }
.loot { display: flex; gap: 6px; align-items: center; color: #f6d47c; font-weight: 600; }
.loot[hidden] { display: none; }
.btn { all: unset; cursor: pointer; text-align: center; padding: 6px 0; border-radius: 6px; background: #3b3328; color: #f1e9d8; font-weight: 600; }
.btn:hover:not(:disabled) { background: #4d4232; }
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: -2px; }
.ver { all: unset; cursor: pointer; color: #6f6656; font-size: 10px; }
.ver:hover { color: #bfb39a; }
.new { color: #f0c86a; font-weight: 700; margin-left: 4px; }
.news { display: none; max-height: 180px; overflow: auto; padding: 7px 8px; border-radius: 6px; background: #221d16; font-size: 11px; color: #cfc6b3; }
.news.open { display: block; }
.news h4 { margin: 0 0 3px; font-size: 11px; color: #f0c86a; }
.news h4 span { color: #6f6656; font-weight: 400; }
.news ul { margin: 0 0 7px; padding-left: 14px; }
.news li { margin-bottom: 2px; }
`;

function loadPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs; } catch { return {}; }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
/** Cambia el texto solo si cambió: el panel se refresca seguido y no hay que tocar el DOM de más. */
function setText(e: HTMLElement, text: string) {
  if (e.textContent !== text) e.textContent = text;
}

export function mountPanel(deps: PanelDeps) {
  const prefs = loadPrefs();
  const host = el('div');
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = CSS;

  const box = el('div', 'box');
  const head = el('div', 'head');
  const dot = el('span', 'dot');
  const title = el('span', 'title', 'mutool');
  const bell = el('button', 'icon');
  const fold = el('button', 'icon');
  head.append(dot, title, bell, fold);

  const body = el('div', 'body');
  const attackRow = el('div', 'row');
  const attackText = el('div');
  const attackLabel = el('div', 'label', 'Auto attack');
  const attackSub = el('div', 'sub');
  attackText.append(attackLabel, attackSub);
  const attackSwitch = el('button', 'switch');
  attackSwitch.title = 'Pega al monstruo más cercano al alcance con el skill elegido. No camina: lo movés vos.';
  attackRow.append(attackText, attackSwitch);

  // El skill de ataque: el elegido en la barra del juego (lo lanza el juego). Elegirlo acá es elegirlo en la barra, como a mano.
  const skillBox = el('div');
  const skillGrid = el('div', 'skills');
  skillBox.append(el('div', 'section', 'Skill'), skillGrid);
  let skillKey = '';
  const skillEls = new Map<number, HTMLButtonElement>();
  function renderSkills(s: Status) {
    const attacks = s.skills.filter((k) => !k.buff);
    const key = attacks.map((k) => k.num).join(',');
    if (key === skillKey) return;
    skillKey = key;
    skillGrid.replaceChildren();
    skillEls.clear();
    for (const k of attacks) {
      const c = el('button', 'chip', k.name);
      c.title = `Elegir ${k.name} en la barra del juego`;
      c.onclick = async () => {
        const ok = await deps.selectSkill(k.name);
        if (!ok) error = { text: `No pude elegir ${k.name}: abrí la barra de skills del juego.`, until: Date.now() + ERROR_MS };
        refresh();
      };
      skillEls.set(k.num, c);
      skillGrid.append(c);
    }
  }

  const pickBox = el('div');
  const chips = el('div', 'chips');
  const chipEls = new Map<PickKind, HTMLButtonElement>();
  for (const p of PICKS) {
    const c = el('button', 'chip', p.label);
    c.title = p.hint;
    c.onclick = () => act({ pick: p.kind });
    chipEls.set(p.kind, c);
    chips.append(c);
  }
  pickBox.append(el('div', 'section', 'Levantar'), chips);

  const roamBox = el('div');
  const roamChips = el('div', 'chips');
  const roamEls = new Map<number, HTMLButtonElement>();
  for (const r of ROAMS) {
    const c = el('button', 'chip', r.label);
    c.title = r.hint;
    c.onclick = () => { prefs.roam = r.roam; savePrefs(prefs); act({ roam: r.roam }); };
    roamEls.set(r.roam, c);
    roamChips.append(c);
  }
  roamBox.append(el('div', 'section', 'Moverse'), roamChips);

  const statusLine = el('div', 'status');
  const lootLine = el('div', 'loot');
  const statsBtn = el('button', 'btn', 'Repartir puntos');
  // Versión en chico al pie; al tocarla se ven las novedades. Marca "nuevo" hasta que se miran las de una versión que no se había visto.
  const news = el('div', 'news');
  for (const v of CHANGELOG) {
    const h = el('h4', '', `v${v.version} `);
    h.append(el('span', '', v.date));
    const ul = el('ul');
    for (const it of v.items) ul.append(el('li', '', it));
    news.append(h, ul);
  }
  const foot = el('div', 'foot');
  const ver = el('button', 'ver', `v${EXT_VERSION}`);
  ver.title = `Versión ${EXT_VERSION}${EXT_BUILD ? ` (${EXT_BUILD})` : ''}. Tocá para ver las novedades.`;
  const newBadge = el('span', 'new', 'nuevo');
  ver.append(newBadge);
  foot.append(ver, el('span'));
  body.append(attackRow, skillBox, roamBox, pickBox, statusLine, lootLine, statsBtn, news, foot);
  box.append(head, body);
  root.append(style, box);

  let last: Status | null = null;
  let error: { text: string; until: number } | null = null;
  let points = 0;
  let pointsAt = 0;
  let plan: string | null = null;
  let lastAlertId = 0;
  let investing = false;

  function act(change: { attack?: boolean; pick?: PickKind; roam?: number }) {
    const reason = deps.setAssist(change);
    error = reason ? { text: reason, until: Date.now() + ERROR_MS } : null;
    refresh();
  }
  // Un doble click lo prendía y apagaba en el mismo instante (visto en vivo): el segundo click dentro de SWITCH_GUARD_MS no cuenta.
  let switchedAt = 0;
  attackSwitch.onclick = () => {
    if (Date.now() - switchedAt < SWITCH_GUARD_MS) return;
    switchedAt = Date.now();
    act({ attack: !last?.enabled });
  };
  statsBtn.onclick = () => {
    investing = true;
    refresh();
    void deps.investStats()
      .then((reason) => { if (reason) error = { text: reason, until: Date.now() + ERROR_MS }; })
      .finally(() => { investing = false; pointsAt = 0; refresh(); });
  };

  bell.onclick = () => {
    prefs.sound = !prefs.sound;
    if (prefs.sound) { unlockSound(); chime(); }
    savePrefs(prefs);
    refresh();
  };
  fold.onclick = () => { prefs.collapsed = !prefs.collapsed; savePrefs(prefs); refresh(); place(box.offsetLeft, box.offsetTop); };
  ver.onclick = () => {
    news.classList.toggle('open');
    if (prefs.seenVersion !== EXT_VERSION) { prefs.seenVersion = EXT_VERSION; savePrefs(prefs); refresh(); }
    place(box.offsetLeft, box.offsetTop);
  };

  // Arrastre desde el título; la posición se guarda y se recorta a la ventana. Si el panel crece (novedades abiertas), sube para no salirse por
  // abajo: con el botón de la versión afuera no se podían cerrar.
  const place = (x: number, y: number) => {
    box.style.left = `${Math.max(0, Math.min(x, innerWidth - 80))}px`;
    box.style.top = `${Math.max(0, Math.min(y, innerHeight - Math.max(30, box.offsetHeight)))}px`;
  };
  place(prefs.x ?? 12, prefs.y ?? 12);
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const dx = e.clientX - box.offsetLeft, dy = e.clientY - box.offsetTop;
    const move = (m: PointerEvent) => place(m.clientX - dx, m.clientY - dy);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      prefs.x = box.offsetLeft; prefs.y = box.offsetTop; savePrefs(prefs);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    e.preventDefault();
  });
  addEventListener('resize', () => place(box.offsetLeft, box.offsetTop));
  // Que los clicks y las teclas en el panel no lleguen al juego (si no, un click en un botón también camina o ataca).
  for (const type of ['pointerdown', 'mousedown', 'click', 'contextmenu', 'wheel'] as const) box.addEventListener(type, (e) => e.stopPropagation());

  function statusText(s: Status): { text: string; cls: string } {
    if (error && error.until > Date.now()) return { text: error.text, cls: 'err' };
    if (!s.inGame) return { text: 'Entrá al mundo con el personaje.', cls: 'warn' };
    if (!s.ready) return { text: 'Sincronizando con el juego (unos segundos)…', cls: 'warn' };
    const anyPick = s.pick.zen || s.pick.jewels || s.pick.excellent;
    if (s.paused && (s.enabled || anyPick)) return { text: 'En pausa: estás jugando a mano.', cls: 'warn' };
    const chosen = s.skills.find((k) => k.num === s.selectedSkill);
    if (s.enabled && chosen?.buff) return { text: `${chosen.name} no ataca: elegí un skill de ataque.`, cls: 'warn' };
    const hp = s.maxHp > 0 ? Math.round((s.hp / s.maxHp) * 100) : 0;
    const near = s.monsters === 1 ? '1 monstruo' : `${s.monsters} monstruos`;
    if (s.enabled && s.doing === 'approach') return { text: `Yendo al monstruo · ${near} · vida ${hp}%`, cls: '' };
    if (s.enabled && s.doing === 'pickup') return { text: 'Yendo a levantar…', cls: '' };
    if (s.enabled && s.doing === 'return') return { text: 'Volviendo a donde lo prendiste', cls: '' };
    if (s.enabled) return { text: s.target ? `Atacando · ${near} · vida ${hp}%` : `Sin nada ${s.roam ? 'en la zona' : 'al alcance'} · ${near}`, cls: '' };
    return { text: `${near} cerca · vida ${hp}%`, cls: '' };
  }

  function refresh() {
    const s = deps.status();
    last = s;
    const now = Date.now();
    if (now - pointsAt > POINTS_REFRESH_MS) { points = readPoints(); pointsAt = now; }

    box.classList.toggle('collapsed', !!prefs.collapsed);
    setText(title, s.name ? `mutool · ${s.name}` : 'mutool');
    dot.className = `dot${s.enabled ? (s.paused ? ' paused' : ' on') : ''}`;
    setText(bell, prefs.sound ? '🔔' : '🔕');
    bell.classList.toggle('off', !prefs.sound);
    bell.title = prefs.sound ? 'Aviso sonoro de joyas y excelentes: prendido' : 'Aviso sonoro de joyas y excelentes: apagado';
    setText(fold, prefs.collapsed ? '▸' : '▾');
    newBadge.hidden = prefs.seenVersion === EXT_VERSION;
    fold.title = prefs.collapsed ? 'Mostrar' : 'Achicar';

    attackSwitch.classList.toggle('on', s.enabled);
    attackSwitch.disabled = !s.ready && !s.enabled;
    setText(attackSub, s.skill === 'golpe' ? 'Golpe común' : `Con ${s.skill}`);
    renderSkills(s);
    skillBox.hidden = skillEls.size === 0;
    for (const [num, c] of skillEls) c.classList.toggle('on', num === s.selectedSkill);
    for (const [roam, c] of roamEls) c.classList.toggle('on', roam === s.roam);
    for (const [kind, c] of chipEls) {
      c.classList.toggle('on', s.pick[kind]);
      c.disabled = !s.ready && !s.pick[kind];
    }

    const st = statusText(s);
    setText(statusLine, st.text);
    statusLine.className = `status${st.cls ? ` ${st.cls}` : ''}`;

    lootLine.hidden = !s.loot;
    if (s.loot) {
      setText(lootLine, `${s.loot.kind === 'zen' ? '🪙' : '💎'} ${s.loot.name} · ${s.loot.dist === 0 ? 'acá' : `${s.loot.dist} al ${s.loot.dir}`}`);
      if (s.loot.kind !== 'zen' && s.loot.id !== lastAlertId) { lastAlertId = s.loot.id; if (prefs.sound) chime(); }
    }

    if (points > 0 && now === pointsAt) plan = previewStats();
    setText(statsBtn, investing ? 'Repartiendo…' : points > 0 ? `Repartir ${points}${plan ? `: ${plan}` : ' puntos'}` : 'Repartir puntos');
    statsBtn.disabled = investing || points <= 0;
    statsBtn.title = points > 0
      ? `${plan ?? ''}\nCada punto al stat que más sube el daño por segundo del giro: agilidad (velocidad, hasta 508), fuerza o energía. Sin vitalidad.`
      : 'Abrí la ventana de personaje (C) para ver los puntos';
  }

  if (prefs.roam !== undefined) deps.setAssist({ roam: prefs.roam });
  const attach = () => { document.documentElement.appendChild(host); refresh(); setInterval(refresh, REFRESH_MS); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
}
