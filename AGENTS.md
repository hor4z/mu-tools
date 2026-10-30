# mutool

Extensión de Chrome (MV3) para MU Slow (`https://mu.mormon.garden`). Corre 100% dentro de la página del juego: sin servidor, sin proceso aparte,
sin base de datos. Auto attack con el skill elegido, levantar Zen/joyas/excelentes, pociones por atajo y reparto de puntos.

## Comandos

- `bun install`
- `bun run build`: compila a `dist/` (la carpeta que se carga en `chrome://extensions` → "Cargar descomprimida").
- `bun run tsc`: tiene que quedar limpio antes de dar algo por terminado.
- `bun run brain`: compila solo el cerebro a `dist/brain.js`, para `window.__mu.swapBrain(código)` con la página abierta.

## Dónde está cada cosa

- `src/inject.ts`: entrada, conecta las piezas y carga antes que el cliente.
- `src/assistant.ts`: lee el mundo con el núcleo del bot y corre el cerebro; cifrado compartido con la página.
- `src/page/`: socket del juego, mundo del cliente (`castRequest`, `dying`), barra de skills, stats, teclas.
- `src/ui/`: panel (Shadow DOM) y sonido.
- `src/bot/`: núcleo del bot traído de mutbot. Ver `src/bot/ORIGIN.md` antes de tocarlo.

## Reglas

- Cada build que se entrega para recargar sube `version` en `manifest.json` y suma su entrada en `src/changelog.ts`, aunque sean solo arreglos
  (patch para fixes, minor si se nota algo nuevo). Se sube antes de compilar.
- El ataque lo lanza el cliente (`castRequest`). No mandar paquetes de ataque mientras el mundo del cliente esté disponible: salen sin animación.
- Ritmos humanos: no bajarlos. Nunca dos sesiones de la misma cuenta.
- Nada de credenciales en el repo: es público.
- `src/bot/net/utils.ts`, `src/bot/net/encryption/` y `src/bot/packets/` no se editan a mano.
- Si este archivo quedó desactualizado respecto del código, gana el código: corregilo en el mismo cambio.
