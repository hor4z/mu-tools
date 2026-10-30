/** Teclas y clicks sintéticos en la página del juego: lo que haría el usuario, sin mandar paquetes. */

/** Teclas del hotbar que el asistente puede apretar: las pociones (Q vida, W maná). El ataque no va por tecla. */
const HOTBAR_KEYS = new Set(['q', 'w', 'e', 'r']);

export function pressKey(key: string) {
  if (!HOTBAR_KEYS.has(key)) return;
  const code = key.toUpperCase().charCodeAt(0);
  const domCode = `Key${key.toUpperCase()}`;
  for (const type of ['keydown', 'keyup']) {
    const ev = new KeyboardEvent(type, { key, code: domCode, keyCode: code, which: code, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  }
}

export function clickElement(el: HTMLElement, mods: { shift?: boolean; cmd?: boolean } = {}) {
  const r = el.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0,
    shiftKey: !!mods.shift, metaKey: !!mods.cmd, ctrlKey: !!mods.cmd,
  };
  for (const [type, Ctor] of [['pointerdown', PointerEvent], ['mousedown', MouseEvent], ['pointerup', PointerEvent], ['mouseup', MouseEvent], ['click', MouseEvent]] as const) {
    el.dispatchEvent(new Ctor(type, opts));
  }
}
