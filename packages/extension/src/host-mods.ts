/**
 * Los módulos del núcleo que usa el cerebro (src/bot/brain). La página los publica en `window.__mu.mods` para que un cerebro nuevo, compilado aparte
 * (`bun run brain`, ver brain-build.ts), comparta el MISMO estado (`world`, `assist`, el mundo, el socket…) en vez de traer el suyo. Es el mismo
 * reparto que hacía la recarga en caliente del bot: el núcleo se queda, el cerebro se cambia. Si el cerebro importa un módulo nuevo de afuera de
 * `brain/`, hay que sumarlo acá.
 */
import * as actions from './bot/core/actions';
import * as config from './bot/core/config';
import * as connection from './bot/core/connection';
import * as gamedata from './bot/core/gamedata';
import * as journal from './bot/core/journal';
import * as lootState from './bot/core/loot-state';
import * as panelLogic from './bot/core/panel-logic';
import * as protocol097 from './bot/core/protocol097';
import * as state from './bot/core/state';
import * as telemetry from './bot/core/telemetry';
import * as util from './bot/core/util';
import * as eventBus from './bot/net/eventBus';
import * as packets from './bot/packets';

export const HOST_MODS: Record<string, object> = {
  'core/actions': actions,
  'core/config': config,
  'core/connection': connection,
  'core/gamedata': gamedata,
  'core/journal': journal,
  'core/loot-state': lootState,
  'core/panel-logic': panelLogic,
  'core/protocol097': protocol097,
  'core/state': state,
  'core/telemetry': telemetry,
  'core/util': util,
  'net/eventBus': eventBus,
  'packets/index': packets,
};
