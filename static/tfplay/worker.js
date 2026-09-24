/* Terraform playground: Web Worker hosting the engine (Go compiled to WASM).
 *
 * Messages: {id, method, args} -> {id, result} | {id, error}
 *   boot(baseUrl)            download + start the engine
 *   loadProvider(name)       download + register static/tfplay/providers/<name>.json.gz
 *   registerProvider(json)   register a provider definition given as text
 *   requiredProviders(files) list the providers a configuration needs
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

async function boot(baseUrl) {
  base = baseUrl;
  importScripts(base + 'wasm_exec.js');
  const go = new self.Go();
  const ready = new Promise((resolve) => {
    self.__tfplayReady = resolve;
  });
  const res = await fetch(base + 'tfplay.wasm.gz');
  if (!res.ok) {
    throw new Error('No se pudo descargar el motor (HTTP ' + res.status + '). ¿Has ejecutado "bun run build:wasm"?');
  }
  const bytes = await readBytes(res);
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
      const res = await fetch(base + 'providers/' + name + '.json.gz');
      if (!res.ok) {
        throw new Error('No se pudo descargar el proveedor ' + name + ' (HTTP ' + res.status + ')');
      }
      const text = new TextDecoder().decode(await readBytes(res));
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
