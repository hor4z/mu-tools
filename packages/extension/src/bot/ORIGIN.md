# src/bot: de dónde viene

Es la parte del bot de **mutbot** que la extensión compila, nada más. Referencia: **`hor4z/mutbot@02cf92e`**, carpeta `packages/bot/src/`
(misma ruta debajo: `src/bot/core/world.ts` ↔ `packages/bot/src/core/world.ts`). Para revisar algo o traer un arreglo, comparar contra esa ref.

Cambios hechos acá respecto de la ref:

| Archivo | Cambio |
| --- | --- |
| `core/state.ts` | `assist`: `pick` (Zen/joyas/excelentes) en vez de `sniper`/`gold`; `cast`, `alive`, `clientSkill`, `nativeCastAt`, `face`, `roam`/`anchor`/`doing`, `pickup`, `picking`, `walk`, `stop`, `here`, `posOf` (posiciones del cliente: las del bot quedan atrasadas). Sin los tipos `Warp` y `StatusServer` (no viajan). |
| `brain/assist.ts` | ataque por el cliente (`assist.cast`, que se acerca solo), objetivo en una zona alrededor de un ancla, levantar caminando y volver al ancla, solo monstruos vivos, skill elegido en la barra, levantar por clase; sin pausa automática por juego a mano (`pausedByUser` siempre false, issue #3). |
| `core/gamedata.ts` | importa `../../stubs/db` en vez de `@mubot/db`. |
| `core/telemetry.ts` | manda por el bridge de la página (`../../page/db-bridge`) en vez de `@mubot/db`; `VERSION` = `mutool-<versión>` y `SESSION` por carga de página. |
| `core/world.ts` | `onZenPicked`: avisa cuánto Zen entró al levantar (lo usa `src/yield.ts`). |
| `core/chat.ts`, `core/journal.ts` | importan `../../stubs/protocol` en vez de `@mubot/protocol`. |
| `core/connection.ts` | solo comentarios (rutas). |
| `core/health.ts`, `core/world.ts` | `maxFor` usa la mayor vida vista solo cerca del tope de 16 bits; `world.maxHp` sale del máximo informado (`setReportedMaxHp`): un buff de vida dejaba el máximo inflado para siempre. |

No se tocan a mano:

- `net/utils.ts` y `net/encryption/`: copias literales del cliente. Una versión "más limpia" ya rompió el cifrado y el parseo de skills.
- `packets/`: generado en mutbot (`MU_SRC=~/self/mu/src bun run extract`); se regenera allá y se copia.

`data/seeds/*.json` viene de `hor4z/mutbot@02cf92e:packages/db/seeds/`.
