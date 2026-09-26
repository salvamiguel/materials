import { describe, expect, test } from 'bun:test';
import { completeYaml } from './yamlComplete';

const at = (src: string) => {
  const i = src.indexOf('|');
  return completeYaml(src.replace('|', ''), i);
};
const labels = (src: string) => at(src)?.items.map((i) => i.label) || [];

describe('yaml completion', () => {
  test('skeletons in an empty document', () => {
    expect(labels('Dep|')).toContain('Deployment');
  });

  test('fields of the container under the cursor', () => {
    const src = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: web
          image: nginx
          re|`;
    const l = labels(src);
    expect(l).toContain('resources');
    expect(l).toContain('readinessProbe');
    expect(l).not.toContain('image');
    expect(l).not.toContain('replicas');
  });

  test('a new list item', () => {
    const src = `kind: Deployment
spec:
  template:
    spec:
      containers:
      - na|`;
    expect(labels(src)).toContain('name');
  });

  test('spec fields and values', () => {
    expect(labels('kind: Deployment\nspec:\n  |')).toContain('replicas');
    expect(labels('kind: Service\nspec:\n  type: |')).toEqual(['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName']);
    expect(labels('kind: |')).toContain('StatefulSet');
    expect(labels('apiVersion: |\nkind: Deployment')).toEqual(['apps/v1']);
  });

  test('nested under a list item key', () => {
    const src = `kind: StatefulSet
spec:
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        acc|`;
    expect(labels(src)).toContain('accessModes');
  });
});
