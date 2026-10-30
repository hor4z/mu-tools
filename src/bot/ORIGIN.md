# src/bot: de dónde viene

Es la parte del bot de **mutbot** que la extensión compila, nada más. Referencia: **`hor4z/mutbot@02cf92e`**, carpeta `packages/bot/src/`
(misma ruta debajo: `src/bot/core/world.ts` ↔ `packages/bot/src/core/world.ts`). Para revisar algo o traer un arreglo, comparar contra esa ref.

Cambios hechos acá respecto de la ref:

| Archivo | Cambio |
| --- | --- |
| `core/state.ts` | `assist`: `pick` (Zen/joyas/excelentes) en vez de `sniper`/`gold`; `cast`, `alive`, `clientSkill`, `nativeCastAt`, `face`. Sin los tipos `Warp` y `StatusServer` (no viajan). |
| `brain/assist.ts` | ataque por el cliente (`assist.cast`), solo monstruos vivos, skill elegido en la barra, levantar por clase, `pausedByUser`. |
| `core/gamedata.ts`, `core/telemetry.ts` | importan `../../stubs/db` en vez de `@mubot/db`. |
| `core/chat.ts`, `core/journal.ts` | importan `../../stubs/protocol` en vez de `@mubot/protocol`. |
| `core/connection.ts` | solo comentarios (rutas). |

No se tocan a mano:

- `net/utils.ts` y `net/encryption/`: copias literales del cliente. Una versión "más limpia" ya rompió el cifrado y el parseo de skills.
- `packets/`: generado en mutbot (`MU_SRC=~/self/mu/src bun run extract`); se regenera allá y se copia.

`data/seeds/*.json` viene de `hor4z/mutbot@02cf92e:packages/db/seeds/`.
