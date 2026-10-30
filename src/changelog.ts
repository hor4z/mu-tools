/**
 * Novedades de cada versión, la más nueva primero: el panel las muestra al tocar la versión y marca "nuevo" hasta que se miran. Al cambiar algo
 * que se nota jugando, subir `version` en manifest.json y sumar una entrada acá.
 */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: '0.3.1',
    date: '2026-10-30',
    items: ['Ahora se llama mutool y vive en su propio repo (hor4z/mu-tools). Nada cambia al jugar.'],
  },
  {
    version: '0.3.0',
    date: '2026-10-30',
    items: [
      'Elegí el skill de ataque desde el panel (Cyclone, Twisting Slash, Death Stab…): es el mismo de la barra del juego, y el alcance sigue al elegido.',
      'Arreglado: le pegaba a monstruos que se estaban muriendo y el golpe salía hacia otro lado sin animación.',
      'Avisa si el skill elegido es un buff y no ataca.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-30',
    items: [
      'El ataque lo lanza el juego, como con el click apretado: gira hacia el monstruo, hace el movimiento y lleva su ritmo.',
      'Levantar: Zen, Joyas y Excelentes por separado (antes Joyero y Oro se pisaban).',
      'Aviso sonoro solo para joyas y excelentes, suave y con la campanita para apagarlo. Se acabó el pitido con cada Zen.',
      'Panel nuevo: dice si está atacando, en pausa porque jugás a mano o sincronizando.',
      'Arreglado: el audio de los avisos se acumulaba y podía trabar la página.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-29',
    items: ['Auto attack, Joyero, Oro y reparto de puntos dentro de la página del juego.'],
  },
];
