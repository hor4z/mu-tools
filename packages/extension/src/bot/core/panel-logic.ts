/**
 * Datos puros del panel: nombres de mapa e ítems. Sin estado ni red (se importa también desde scripts/).
 */
import { items, onGameData } from './gamedata';

// Índices de mapa del 0.97d: viven en @mutool/protocol porque los usan también el servidor y la página.
export { MAP_NAMES, mapName } from '@mutool/protocol';

// Ítems: nombre y tamaño en la grilla del inventario (tabla `items` de la base, `gamedata.ts`).
const ITEM_INFO = new Map<number, { name: string; w: number; h: number }>();
onGameData('items', () => {
  ITEM_INFO.clear();
  for (const i of items) ITEM_INFO.set(i.grp * 512 + i.idx, { name: i.name, w: i.w || 1, h: i.h || 1 });
});
export function itemInfo(group: number, num: number): { name: string; w: number; h: number } {
  return ITEM_INFO.get(group * 512 + num) ?? { name: `ítem ${group}/${num}`, w: 1, h: 1 };
}
