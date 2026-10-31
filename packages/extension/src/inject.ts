/**
 * Entrada de la extensión: se inyecta en la página del juego, en el mundo de la página y antes de que cargue el cliente. Solo conecta las piezas:
 *  - page/socket.ts: el socket del juego pasa por el asistente (assistant.ts), que lee el mundo y escribe sus paquetes con el mismo contador.
 *  - page/game-world.ts: el mundo del cliente, para que el ataque lo lance el cliente como con un click.
 *  - page/input.ts, page/skills.ts y page/stats.ts: teclas de pociones, elegir skill y repartir puntos, con clicks reales.
 *  - ui/panel.ts: el panel.
 * Los datos de rendimiento (yield.ts) salen por page/db-bridge.ts → bridge.js → background.js al servidor local, si está prendido.
 */
import { onGameSocket, onGameSocketClosed, onPageSend, onServerFrame, setAssist, startAssistant, status } from './assistant';
import { castNative, castOpts, captureGameWorld, debugWorld, faceTowards, isAlive, pickupNative, pickupPending, playerTile, stopNative, tileOf, walkNative } from './page/game-world';
import { pressKey } from './page/input';
import { hookGameSocket, writeToGame } from './page/socket';
import { selectSkill, selectedSkillName } from './page/skills';
import { investStats } from './page/stats';
import { mountPanel } from './ui/panel';

captureGameWorld();
hookGameSocket({ opened: onGameSocket, closed: onGameSocketClosed, serverFrame: onServerFrame, pageSend: onPageSend });
startAssistant({ write: writeToGame, press: pressKey, face: faceTowards, cast: castNative, alive: isAlive, pickup: pickupNative, picking: pickupPending, walk: walkNative, stop: stopNative, here: playerTile, posOf: tileOf,
  selectedSkill: selectedSkillName });
mountPanel({ status, setAssist, investStats, selectSkill });
(window as unknown as { __muDebug?: unknown }).__muDebug = { opts: castOpts, world: debugWorld };
