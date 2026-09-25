// Files written by local_file / local_sensitive_file, read from the state.
// Mirrors workspaceFile and isConfigFile in tools/tfplay/engine/localfile.go.

const CONFIG_SUFFIXES = ['.tf', '.tf.json', '.tfvars', '.tfvars.json', '.provider.json', '.tftest.hcl', '.terraform.lock.hcl'];

/** Workspace file name for a filename argument, or undefined outside the workspace. */
export function workspaceFile(name: string): string | undefined {
  const p = name.replace(/^\/playground\//, '');
  if (!p || p.startsWith('/')) return undefined;
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : undefined;
}

/** Workspace files managed by local_file, mapped to the resource address. */
export function localFiles(state: string): Map<string, string> {
  const out = new Map<string, string>();
  let s: any;
  try {
    s = JSON.parse(state);
  } catch {
    return out;
  }
  for (const r of s?.resources || []) {
    if (r.mode !== 'managed' || (r.type !== 'local_file' && r.type !== 'local_sensitive_file')) continue;
    for (const i of r.instances || []) {
      const file = typeof i.attributes?.filename === 'string' ? workspaceFile(i.attributes.filename) : undefined;
      if (!file || CONFIG_SUFFIXES.some((x) => file.endsWith(x))) continue;
      const key = i.index_key === undefined ? '' : typeof i.index_key === 'number' ? `[${i.index_key}]` : `["${i.index_key}"]`;
      out.set(file, `${r.module ? r.module + '.' : ''}${r.type}.${r.name}${key}`);
    }
  }
  return out;
}
