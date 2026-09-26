/* Kubernetes playground: Web Worker hosting kustomize and Helm's template
 * engine (Go compiled to WASM, tools/k8splay). Loaded the first time a
 * command needs them.
 *
 * Messages: {id, method, args} -> {id, result} | {id, error}
 *   boot(baseUrl)        download + start the engine
 *   kustomize(request)   build a kustomization (see tools/k8splay/engine)
 *   helm(request)        render a chart
 */
let base = '';
let booting = null;

async function readBytes(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  // .gz files are served as-is by GitHub Pages; decompress unless the
  // server already did it via Content-Encoding.
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return buf;
}

const isWasm = (b) => b.length > 4 && b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d;

/* Downloads <path>.gz and falls back to the plain <path>: some corporate
 * proxies block gzip archives but let ordinary .wasm assets through. */
async function fetchAsset(path, check, what) {
  const failures = [];
  for (const url of [path + '.gz', path]) {
    const name = url.split('/').pop();
    try {
      const res = await fetch(base + url);
      if (!res.ok) {
        failures.push(name + ' → HTTP ' + res.status);
        continue;
      }
      const bytes = await readBytes(res);
      if (check(bytes)) return bytes;
      failures.push(name + ' → respuesta inesperada (' + (res.headers.get('content-type') || 'sin tipo') + ')');
    } catch (err) {
      failures.push(name + ' → ' + String((err && err.message) || err));
    }
  }
  let msg = 'No se pudo descargar ' + what + ': ' + failures.join(' · ');
  if (failures.every((f) => f.endsWith('HTTP 404'))) msg += '. ¿Has ejecutado "bun run build:wasm"?';
  throw new Error(msg);
}

async function boot(baseUrl) {
  base = baseUrl;
  if (typeof WebAssembly === 'undefined') {
    throw new Error('Este navegador no permite ejecutar WebAssembly.');
  }
  try {
    importScripts(base + 'wasm_exec.js');
  } catch (err) {
    throw new Error('No se pudo descargar wasm_exec.js: ' + String((err && err.message) || err));
  }
  const go = new self.Go();
  const ready = new Promise((resolve) => {
    self.__k8splayReady = resolve;
  });
  const bytes = await fetchAsset('k8splay.wasm', isWasm, 'helm y kustomize');
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
  await ready;
}

function call(method, arg) {
  const out = JSON.parse(self.k8splay[method](arg));
  if (out && out.error && Object.keys(out).length === 1) {
    throw new Error(out.error);
  }
  return out;
}

self.onmessage = async (event) => {
  const { id, method, args = [] } = event.data;
  try {
    let result;
    if (method === 'boot') {
      booting = booting || boot(args[0]);
      await booting;
      result = true;
    } else {
      if (!booting) throw new Error('El motor no está iniciado');
      await booting;
      if (method !== 'kustomize' && method !== 'helm') throw new Error('Método desconocido: ' + method);
      result = call(method, JSON.stringify(args[0]));
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
