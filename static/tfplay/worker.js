/* Terraform playground: Web Worker hosting the engine (Go compiled to WASM).
 *
 * Messages: {id, method, args} -> {id, result} | {id, error}
 *   boot(baseUrl)            download + start the engine
 *   loadProvider(name)       download + register static/tfplay/providers/<name>.json(.gz)
 *   registerProvider(json)   register a provider definition given as text
 *   requiredProviders(files) list the providers a configuration needs
 *   schema(request)          provider index or type schema, for autocompletion
 *   run(request)             run a command (see tools/tfplay/engine/engine.go)
 */
let base = '';
let booting = null;
const providers = {};

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

function isJson(b) {
  for (let i = 0; i < b.length && i < 64; i++) {
    if (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09) continue;
    return b[i] === 0x7b; // {
  }
  return false;
}

/* Downloads <path>.gz and falls back to the plain <path>: some corporate
 * proxies block gzip archives (403, reset connection or an HTML block page
 * served with 200) but let ordinary .wasm/.json assets through. */
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
    self.__tfplayReady = resolve;
  });
  const bytes = await fetchAsset('tfplay.wasm', isWasm, 'el motor');
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
  await ready;
}

function call(method, arg) {
  const out = JSON.parse(self.tfplay[method](arg));
  if (out && out.error && Object.keys(out).length === 1) {
    throw new Error(out.error);
  }
  return out;
}

function loadProvider(name) {
  if (!providers[name]) {
    providers[name] = (async () => {
      const bytes = await fetchAsset('providers/' + name + '.json', isJson, 'el proveedor ' + name);
      const text = new TextDecoder().decode(bytes);
      return call('registerProvider', text);
    })();
    providers[name].catch(() => {
      delete providers[name];
    });
  }
  return providers[name];
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
      switch (method) {
        case 'loadProvider':
          result = await loadProvider(args[0]);
          break;
        case 'registerProvider':
          result = call('registerProvider', args[0]);
          break;
        case 'requiredProviders':
          result = call('requiredProviders', JSON.stringify(args[0]));
          break;
        case 'schema':
          result = call('schema', JSON.stringify(args[0]));
          break;
        case 'run':
          result = call('run', JSON.stringify(args[0]));
          break;
        default:
          throw new Error('Método desconocido: ' + method);
      }
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
