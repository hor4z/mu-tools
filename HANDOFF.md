# Handoff: mutool (2026-10-30)

Estado para retomar. Lo estable (comandos, estructura, reglas) está en [AGENTS.md](AGENTS.md); acá va lo que está en curso.

## Dónde quedó

- Repo: `hor4z/mu-tools` (público), clon en `~/self/mu-tools`. Versión **0.3.1**, commit `91883f3` en `main`.
- El usuario carga la extensión desde `~/self/mu-tools/dist`. Se juega con **Capitan** en `https://mu.mormon.garden` (Slow).
- Viene de `hor4z/mutbot` (`packages/extension`). En mutbot la copia vieja sigue en la rama `asistente-gira-al-objetivo`, **sin commitear**:
  falta decidir si se borra de mutbot (sacar `packages/extension` y `brain/assist.ts`, dejar una línea que apunte a mu-tools).

## Qué se hizo hoy

1. **El ataque lo lanza el cliente** (`src/page/game-world.ts`). El cliente no anima al personaje con el eco de un skill propio; un paquete del
   asistente salía sin giro ni animación. Se toma el mundo del cliente con un setter de `scene` en `Object.prototype` y se pide
   `world.castRequest = { target, point }`, como su MU Helper. El pedido se repone cada 50 ms (como el click apretado). Medido: un cast cada ~550 ms.
2. **Solo monstruos vivos** (`isAlive`, `assist.alive`). La lista del bot guarda los muertos hasta que salen de la vista: le apuntaba a cadáveres, el
   cliente no lanzaba y caía al paquete de respaldo (golpe hacia otro lado, sin animación). Medido antes: 3 nativos / 14 respaldo; después:
   139 / 0. Con el cliente disponible ya no cae al respaldo.
3. **Skill elegido** (`src/page/skills.ts`): se lee y se cambia la barra del juego con clicks reales (`.v097d-skill-box`, `.v097d-skill-slot`).
   El alcance y el panel siguen al skill elegido. Capitan conoce 22 Cyclone, 41 Twisting Slash, 42 Rageful Blow, 43 Death Stab, 47 Impale, 48 Swell Life (buff).
4. **Levantar por clase**: `assist.pick = { zen, jewels, excellent }` reemplaza a Joyero/Oro, que se pisaban.
5. **Panel nuevo** (`src/ui/panel.ts`, Shadow DOM): auto attack, skill, levantar, estado legible (atacando / en pausa porque jugás a mano /
   sincronizando), drop más cercano, repartir puntos, campanita, versión al pie con novedades.
6. **Sonido** (`src/ui/sound.ts`): antes se creaba un `AudioContext` por cada drop (zen incluido) y nunca se cerraba: pitido constante y probable
   causa de cuelgues. Ahora uno solo, suave, solo joyas y excelentes, apagado por defecto.
7. Código reorganizado (`inject.ts` quedó en 20 líneas) y núcleo del bot reducido a lo que la extensión compila (`src/bot/ORIGIN.md`).

## Probado y sin probar

- **Probado en vivo:** cast nativo y su cadencia, monstruos vivos sin respaldo, posiciones bot ↔ cliente iguales, abrir/leer/cerrar la barra de
  skills con clicks sintéticos, panel nuevo (versión 0.2.0).
- **Sin probar en el juego:** el build 0.3.x completo (selector de skill desde el panel, versión al pie y novedades, nombre mutool),
  levantar Zen/joyas/excelentes por separado, el aviso sonoro, pociones, repartir puntos con el panel nuevo, caminar con el auto attack prendido.

## Pendiente

1. Que el usuario cargue `dist/` de mu-tools y probar todo lo de "sin probar".
2. **Mantener Swell Life**: relanzarlo cuando se termina sin que el usuario cambie de skill. Antes, ver en vivo qué paquete manda el server al
   activarse y terminarse el buff (el núcleo no sigue buffs).
3. Golpe común sin skill: sale como paquete del asistente (sin animación). `world.attackTarget` lo haría nativo, pero queda pegado con el
   asistente apagado: hay que limpiarlo al apagar.
4. Consola: `[asistente]no packet: 0xFB` cada 2 s (paquete del server que el lector no conoce). Sale de `src/bot/net/socket.ts`, copia literal del
   cliente: no tocar ahí; silenciarlo desde afuera si molesta.
5. Riesgo conocido: si en el juego no hay skill elegido, el cliente convierte el `castRequest` en `attackTarget`, que queda pegado.

## Cómo probar en vivo

- La pestaña del juego tiene que estar en el grupo de pestañas de Claude in Chrome (si se recarga o se mueve, sale del grupo: pedirle al usuario
  que la vuelva a arrastrar). No abrir el juego en otra pestaña: no se loguea por el usuario y serían dos sesiones.
- Consola: `__mu.status()`, `__mu.state.{world,bot,assist}`, `__muDebug.world()` (mundo del cliente), `__muDebug.opts.native = false` (volver a paquetes).
- Cambios del cerebro sin recargar: `bun run brain` y `__mu.swapBrain(<dist/brain.js como string>)`. Cambios en `src/` fuera del cerebro piden
  ↻ en la extensión y recargar la pestaña (login del usuario).
- Medir en vez de mirar capturas: bajadas de maná para la cadencia, y envolver `assist.cast` / `assist.face` para contar nativo vs respaldo.

## Preferencias del usuario

- Quiere una experiencia de uso excelente: iterar probando en vivo, no entregar sin medir.
- Cada build entregado sube la versión y suma novedades, aunque sean fixes.
- Docs mínimas y solo de la extensión. CLAUDE.md solo apunta a AGENTS.md.
- Lo que viene de mutbot lleva referencia exacta (repo@commit y ruta).
