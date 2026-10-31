/** Compila la extensión a un solo archivo para la página. `node:fs` se reemplaza por un stub: en el navegador no hay disco. */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dir;
// La versión del panel: la del manifest, más el commit y la fecha del build (con `+` si había cambios sin commitear) para saber qué está cargado.
const version = (JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { version: string }).version;
const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: root }).stdout.toString().trim();
const commit = git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--', 'src', 'manifest.json', 'data') ? '+' : '');
const built = new Date().toLocaleString('sv-SE').slice(0, 16); // hora local, AAAA-MM-DD HH:MM
const result = await Bun.build({
  // inject.js corre en la página; bridge.js (content script aislado) y background.js (service worker) llevan los datos al servidor local.
  entrypoints: ['inject.ts', 'bridge.ts', 'background.ts'].map((f) => join(root, 'src', f)),
  target: 'browser',
  format: 'iife',
  // La extensión es un script clásico: `import.meta` es un error de sintaxis ahí (el código del bot lo usa solo para saber la carpeta del repo).
  define: {
    'import.meta.dir': '""',
    __EXT_VERSION__: JSON.stringify(version),
    __EXT_BUILD__: JSON.stringify(`${commit} · ${built}`),
  },
  outdir: join(root, 'dist'),
  plugins: [{
    name: 'sin-disco',
    setup(b) {
      b.onResolve({ filter: /^node:fs$/ }, () => ({ path: join(root, 'src/stubs/fs.ts') }));
    },
  }],
});
if (!result.success) {
  for (const m of result.logs) console.error(m);
  process.exit(1);
}
mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(join(root, 'manifest.json'), join(root, 'dist/manifest.json'));
console.log(`extensión compilada: ${result.outputs.map((o) => `${o.path} (${Math.round(o.size / 1024)} KB)`).join(', ')}`);
