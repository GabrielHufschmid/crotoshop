// Espeja los assets del quitado de fondo (@imgly/background-removal) desde su
// CDN a public/imgly-data/, para servirlos desde nuestro propio origen:
// - supply chain: la librería NO verifica hashes de los chunks que descarga,
//   así que confiar en el CDN de imgly en runtime es confiar a ciegas;
//   espejado una vez, lo que se sirve es lo que auditamos.
// - privacidad/disponibilidad: ninguna visita depende de staticimgly.com.
//
// Se espejan solo los recursos que la app usa: los runtimes de onnxruntime y
// el modelo "medium" (isnet_fp16) que pineamos en backgroundRemoval.ts
// (~123 MB). Idempotente: lo ya descargado no se vuelve a bajar.
//
// Uso: node scripts/fetch-imgly-data.mjs [--quiet]

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.7.0'; // debe coincidir con @imgly/background-removal
const CDN = `https://staticimgly.com/@imgly/background-removal-data/${VERSION}/dist/`;
const KEYS = [
  '/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs',
  '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  '/models/isnet_fp16',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'imgly-data');
const quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!quiet) console.log(...args); };

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} al bajar ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const resourcesPath = join(outDir, 'resources.json');
  if (!(await exists(resourcesPath))) {
    log('Bajando resources.json…');
    await download(`${CDN}resources.json`, resourcesPath);
  }
  const resources = JSON.parse(await readFile(resourcesPath, 'utf8'));

  const chunks = [];
  for (const key of KEYS) {
    const entry = resources[key];
    if (!entry) throw new Error(`resources.json no tiene ${key}`);
    for (const chunk of entry.chunks) chunks.push(chunk.name);
  }

  let pending = 0;
  for (const name of chunks) {
    if (!(await exists(join(outDir, name)))) pending++;
  }
  if (pending === 0) {
    log(`imgly-data OK (${chunks.length} chunks ya presentes)`);
    return;
  }

  log(`Bajando ${pending} chunks del modelo de IA (~123 MB la primera vez)…`);
  let done = 0;
  const queue = [...chunks];
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const name = queue.shift();
      if (!name) return;
      const dest = join(outDir, name);
      if (!(await exists(dest))) {
        await download(`${CDN}${name}`, dest);
        done++;
        log(`  ${done}/${pending} ${name.slice(0, 12)}…`);
      }
    }
  });
  await Promise.all(workers);
  log('imgly-data listo.');
}

main().catch((err) => {
  // No rompe build/dev: sin estos archivos la app funciona igual, solo falla
  // el quitado de fondo en runtime (con toast de error).
  console.error(`[fetch-imgly-data] ${err.message}`);
  console.error('[fetch-imgly-data] El quitado de fondo no va a funcionar hasta espejar los assets.');
});
