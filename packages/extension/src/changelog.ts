/**
 * Novedades de cada versión, la más nueva primero: el panel las muestra al tocar la versión y marca "nuevo" hasta que se miran. Al cambiar algo
 * que se nota jugando, subir `version` en manifest.json y sumar una entrada acá.
 */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: '0.5.1',
    date: '2026-10-31',
    items: [
      'El panel ya no se agranda y se achica solo: el estado, el drop a la vista y el rendimiento ocupan siempre un renglón (el texto completo, con el mouse encima).',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-31',
    items: [
      'Nueva sección Rendimiento en el panel: experiencia y Zen por hora de los últimos 10 minutos, y la sesión (exp, Zen levantado, kills).',
      'Con el servidor local prendido (bun run server) guarda todo en la base y el panel compara esta zona con la mejor conocida.',
      'Página de rendimiento en http://127.0.0.1:8787: ranking de zonas por Zen/h y exp/h, mapa de calor por mapa, qué monstruos rinden más y las sesiones.',
      'Se carga desde packages/extension/dist (el repo pasó a monorepo): hay que volver a cargar la extensión una vez.',
    ],
  },
  {
    version: '0.4.3',
    date: '2026-10-30',
    items: [
      'Arreglado: después de Swell Life creía tener poca vida para siempre, tomaba una poción cada 2,5 s y casi no atacaba ("En pausa: estás jugando a mano").',
      'El automático ya no se pausa solo: lo prendés y lo apagás vos con el interruptor.',
      'Si tres pociones seguidas dejan la vida exactamente igual (estás lleno y lo leyó mal), deja de tomar 30 s.',
    ],
  },
  {
    version: '0.4.2',
    date: '2026-10-30',
    items: [
      'Al apagar el auto attack frena en el acto: antes terminaba el camino que había empezado y parecía que seguía prendido.',
      'Un doble click en el interruptor ya no lo prende y apaga a la vez.',
      'Repartir puntos anda de nuevo con el juego en castellano ("Fue" en vez de "Str"); si no puede, dice por qué.',
      'Atacando en un spot lleno vuelve a levantar lo que cae a 2 casillas (antes solo levantaba cuando no quedaba ningún monstruo).',
      'Si el objetivo se va de la zona, deja de seguirlo; si no llega a un drop a tiempo, deja de ir.',
      'Reparto más inteligente: cada punto va a lo que más sube el daño por segundo del giro (agilidad hasta 508 de velocidad, fuerza o energía), sin vitalidad. El botón muestra el plan antes de repartir.',
    ],
  },
  {
    version: '0.4.1',
    date: '2026-10-30',
    items: [
      'Ya no va y viene: usa dónde están de verdad el personaje y los monstruos en el juego (antes los veía hasta 5 casillas corridos y caminaba hacia uno que creía tener encima).',
      'Si el server no te da un drop (de otro jugador), lo deja enseguida en vez de quedarse 4 s esperando, y no lo vuelve a intentar por 30 s.',
      'Si mientras va a levantar algo se le acerca un monstruo, primero el monstruo.',
      'El panel cuenta solo los monstruos vivos cerca, no los muertos ni los lejanos.',
      'Ataca desde el alcance real del skill: con Twisting Slash ya no camina hacia monstruos que tiene a tiro.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-30',
    items: [
      'Va a buscar: con monstruos cerca pero fuera de alcance ya no se queda parado, camina hasta tenerlos a tiro (lo hace el juego, como su MU Helper).',
      'Moverse: Quieto, Cerca (5 casillas) o Lejos (9), contadas desde donde lo prendiste. Sin nada que hacer, vuelve ahí. Si jugás a mano, el punto te sigue.',
      'Elige mejor: termina al que empezó, primero lo que lo puede golpear y después donde hay más monstruos juntos. Si no llega a uno en 4 s, lo saltea.',
      'Levanta caminando lo que tengas prendido dentro de la zona, entre un monstruo y el siguiente.',
      'Con menos de la mitad de vida no va a buscar: pelea lo que tiene al lado mientras toma pociones.',
    ],
  },
  {
    version: '0.3.2',
    date: '2026-10-30',
    items: ['Arreglado: con las novedades abiertas el panel se salía de la pantalla por abajo y no se podían cerrar. Ahora sube o se desplaza.'],
  },
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
