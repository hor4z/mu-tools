# mutool

Asistente para MU Slow que corre dentro de la página del juego, como extensión de Chrome.

- **Auto attack** con el skill que elijas: el juego lo lanza como con el click apretado (gira, anima, lleva su ritmo). Busca monstruos y drops
  cerca de donde lo prendiste (Quieto, Cerca o Lejos) y vuelve. Lo prendés y lo apagás vos.
- **Levantar** Zen, joyas y excelentes, cada uno con su interruptor, con aviso sonoro opcional para joyas y excelentes.
- **Pociones** con Q y W, y **reparto de puntos** con un botón.
- **Rendimiento**: experiencia y Zen por hora en el panel.

Todo el juego pasa en tu pestaña. Opcional: el servidor local guarda el rendimiento en ClickHouse y muestra en `http://127.0.0.1:8787` dónde rinde
más el farmeo (zonas, monstruos, sesiones).

## Instalar

```sh
bun install
bun run build
```

En `chrome://extensions`, prendé el modo desarrollador, "Cargar descomprimida" y elegí la carpeta `packages/extension/dist/`. Después de cada `build`: ↻ en la
extensión y recargar la pestaña del juego.

La versión está al pie del panel; tocándola se ven las novedades.

## Servidor local (opcional)

```sh
bun run web:build
bun run server
```

Usa el ClickHouse de mutbot (`bun run db:up` en mutbot) y sus credenciales de `~/.mubot/.env.db`. Escucha solo en `127.0.0.1:8787`.
