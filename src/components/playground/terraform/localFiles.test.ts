import { describe, expect, test } from 'bun:test';
import { localFiles, workspaceFile } from './localFiles';

describe('workspaceFile', () => {
  test('resolves paths like the engine', () => {
    expect(workspaceFile('./saludo.txt')).toBe('saludo.txt');
    expect(workspaceFile('modules/red/./../red/x.txt')).toBe('modules/red/x.txt');
    expect(workspaceFile('/playground/out/a.txt')).toBe('out/a.txt');
  });

  test('rejects paths outside the workspace', () => {
    for (const p of ['../fuera.txt', '/etc/motd', '.', '', 'a/../..']) expect(workspaceFile(p)).toBeUndefined();
  });
});

describe('localFiles', () => {
  const state = JSON.stringify({
    resources: [
      { mode: 'managed', type: 'local_file', name: 'saludo', instances: [{ attributes: { filename: './saludo.txt' } }] },
      {
        module: 'module.web',
        mode: 'managed',
        type: 'local_sensitive_file',
        name: 'k',
        instances: [{ index_key: 'a', attributes: { filename: 'modules/web/a.key' } }],
      },
      { mode: 'managed', type: 'local_file', name: 'cfg', instances: [{ attributes: { filename: './main.tf' } }] },
      { mode: 'data', type: 'local_file', name: 'leido', instances: [{ attributes: { filename: './leido.txt' } }] },
      { mode: 'managed', type: 'aws_s3_bucket', name: 'b', instances: [{ attributes: { bucket: 'x' } }] },
    ],
  });

  test('maps each managed file to its resource', () => {
    expect([...localFiles(state)]).toEqual([
      ['saludo.txt', 'local_file.saludo'],
      ['modules/web/a.key', 'module.web.local_sensitive_file.k["a"]'],
    ]);
  });

  test('tolerates empty or broken state', () => {
    expect(localFiles('').size).toBe(0);
    expect(localFiles('{').size).toBe(0);
  });
});
