/**
 * El skill elegido en la barra del cliente, que es el que lanza el cliente con el click apretado (y con el pedido del asistente). Se lee y se
 * cambia con la misma barra: el cuadro `.v097d-skill-box` dice el actual en su título ("Cyclone - clic: lista de habilidades") y al tocarlo abre
 * la lista `.v097d-skill-slot`, uno por skill con su nombre en el título.
 */
import { clickElement } from './input';

const skillBox = () => document.querySelector<HTMLElement>('.v097d-skill-box');
const slots = () => Array.from(document.querySelectorAll<HTMLElement>('.v097d-skill-slot'));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** El nombre del skill elegido en el juego, o null si no hay barra (o ninguno elegido). */
export function selectedSkillName(): string | null {
  const title = skillBox()?.title ?? '';
  const name = title.split(' - ')[0]?.trim();
  return name || null;
}

/** Elige un skill en la barra del juego, como a mano: abre la lista y toca el que se llama así. true si quedó elegido. */
export async function selectSkill(name: string): Promise<boolean> {
  if (selectedSkillName() === name) return true;
  const box = skillBox();
  if (!box) return false;
  if (!slots().length) { clickElement(box); await nextFrame(); }
  const slot = slots().find((s) => s.title === name);
  if (slot) clickElement(slot);
  else if (slots().length) clickElement(box); // no estaba: se cierra la lista como se encontró
  await nextFrame();
  return selectedSkillName() === name;
}
