# mutool

Asistente para MU Slow que corre dentro de la página del juego, como extensión de Chrome.

- **Auto attack** con el skill que elijas: el juego lo lanza como con el click apretado (gira, anima, lleva su ritmo). No camina: lo movés vos, y si
  jugás a mano se pausa solo.
- **Levantar** Zen, joyas y excelentes, cada uno con su interruptor, con aviso sonoro opcional para joyas y excelentes.
- **Pociones** con Q y W, y **reparto de puntos** con un botón.

Todo pasa en tu pestaña: no hay servidor, proceso aparte ni base de datos.

## Instalar

```sh
bun install
bun run build
```

En `chrome://extensions`, prendé el modo desarrollador, "Cargar descomprimida" y elegí la carpeta `dist/`. Después de cada `build`: ↻ en la
extensión y recargar la pestaña del juego.

La versión está al pie del panel; tocándola se ven las novedades.
