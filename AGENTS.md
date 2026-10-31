# mutool

Extensión de Chrome (MV3) para MU Slow (`https://mu.mormon.garden`): auto attack con el skill elegido, levantar Zen/joyas/excelentes, pociones por
atajo, reparto de puntos y rendimiento (exp y Zen por hora). Juega 100% dentro de la página; el servidor local es opcional: guarda el rendimiento en
ClickHouse y muestra la página de zonas y monstruos. Sin servidor la extensión funciona igual.

## Comandos (desde la raíz; es un monorepo de workspaces de Bun)

- `bun install`
- `bun run build`: compila la extensión a `packages/extension/dist/` (la carpeta que se carga en `chrome://extensions` → "Cargar descomprimida").
- `bun run tsc`: todos los paquetes; tiene que quedar limpio antes de dar algo por terminado.
- `bun run brain`: compila solo el cerebro a `packages/extension/dist/brain.js`, para `window.__mu.swapBrain(código)` con la página abierta.
- `bun run web:build` y `bun run server`: compila la página y levanta el servidor en `http://127.0.0.1:8787` (solo localhost). Credenciales de la base
  del entorno o de `~/.mubot/.env.db` (las de mutbot: ClickHouse en Docker, base `mubot_slow`).

## Dónde está cada cosa

- `packages/protocol/`: tipos y constantes que comparten los tres (puerto, tablas, respuestas de la API).
- `packages/server/`: `main.ts` (ingesta, API, archivos de la página), `queries.ts` (SQL de zonas, monstruos, sesiones), `db.ts` (ClickHouse por HTTP).
- `packages/web/`: la página de rendimiento (TypeScript sin framework, compilada con Bun).
- `packages/extension/`: la extensión. Las rutas de abajo son relativas a esa carpeta.
- `src/inject.ts`: entrada, conecta las piezas y carga antes que el cliente.
- `src/assistant.ts`: lee el mundo con el núcleo del bot y corre el cerebro; cifrado compartido con la página.
- `src/page/`: socket del juego, mundo del cliente (`castRequest`, `dying`), barra de skills, stats, teclas.
- `src/ui/`: panel (Shadow DOM) y sonido.
- `src/yield.ts`: rendimiento (kills con su exp y el Zen que soltaron, Zen levantado, pociones, fotos cada 5 s). Los datos salen por
  `src/page/db-bridge.ts` → `src/bridge.ts` (content script aislado) → `src/background.ts` (service worker) → servidor local.
- `src/bot/`: núcleo del bot traído de mutbot. Ver `src/bot/ORIGIN.md` antes de tocarlo.

## Reglas

- Cada build que se entrega para recargar sube `version` en `manifest.json` y suma su entrada en `src/changelog.ts`, aunque sean solo arreglos
  (patch para fixes, minor si se nota algo nuevo). Se sube antes de compilar.
- El ataque lo lanza el cliente (`castRequest`). No mandar paquetes de ataque mientras el mundo del cliente esté disponible: salen sin animación.
- Ritmos humanos: no bajarlos. Nunca dos sesiones de la misma cuenta.
- Nada de credenciales en el repo ni en la extensión: es público. La página nunca habla con la base; solo el servidor.
- Las filas de la extensión llevan `version` = `mutool-<versión>`: comparten tablas con mutbot y el servidor rechaza cualquier otra.
- `src/bot/net/utils.ts`, `src/bot/net/encryption/` y `src/bot/packets/` no se editan a mano.
- Si este archivo quedó desactualizado respecto del código, gana el código: corregilo en el mismo cambio.
