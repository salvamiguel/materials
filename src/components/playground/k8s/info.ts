// The facts shown in the tooltip/popup of a diagram node, and the actions of
// its context menu.

import type { Cluster } from './engine/cluster';
import { LAST_APPLIED } from './engine/cluster';
import { podReady } from './engine/controllers/common';
import { hpaTargets, podStatus } from './engine/kubectl/printers';
import { qualifiedName } from './engine/resources';
import type { FaultKind, Obj } from './engine/types';
import { fromLabelSelector, humanDuration, labelsString, selectorString } from './engine/util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Info {
  kind: string;
  name: string;
  namespace?: string;
  rows: [string, string][];
  source?: string;
  fault?: string;
}

export const FAULT_LABEL: Record<FaultKind, string> = {
  crash: 'el contenedor se cae (CrashLoopBackOff)',
  unready: 'la readiness probe falla (degradado)',
  oom: 'se queda sin memoria (OOMKilled)',
  imagepull: 'no puede descargar la imagen',
};

export function objectFor(cl: Cluster, uid: string): Obj | undefined {
  return cl.byUid(uid);
}

export function infoFor(cl: Cluster, o: Obj): Info {
  const rows: [string, string][] = [];
  const age = humanDuration(cl.now - Date.parse(o.metadata.creationTimestamp));
  const s = o.status || {};
  const images = (spec: Json) => (spec?.containers || []).map((c: Json) => c.image).join(', ');
  switch (o.kind) {
    case 'Pod': {
      const cs: Json[] = s.containerStatuses || [];
      rows.push(['Estado', podStatus(cl, o)]);
      rows.push(['Listo', `${cs.filter((c) => c.ready).length}/${o.spec.containers.length}${podReady(o) ? '' : ' (no recibe tráfico)'}`]);
      const restarts = cs.reduce((n, c) => n + (c.restartCount || 0), 0);
      if (restarts) rows.push(['Reinicios', String(restarts)]);
      rows.push(['Nodo', o.spec.nodeName || '(sin programar)']);
      if (s.podIP) rows.push(['IP', s.podIP]);
      rows.push(['Imagen', images(o.spec)]);
      const owner = cl.controllerOf(o);
      if (owner) rows.push(['Controlado por', `${owner.kind}/${owner.metadata.name}`]);
      const waiting = cs.find((c) => c.state?.waiting?.message)?.state?.waiting;
      if (waiting) rows.push(['Motivo', `${waiting.reason}: ${waiting.message}`.slice(0, 160)]);
      const unsched = (s.conditions || []).find((c: Json) => c.type === 'PodScheduled' && c.status === 'False');
      if (unsched) rows.push(['Scheduler', unsched.message.slice(0, 160)]);
      break;
    }
    case 'Deployment': {
      rows.push([
        'Réplicas',
        `${o.spec.replicas} deseadas · ${s.updatedReplicas || 0} actualizadas · ${s.readyReplicas || 0} listas · ${s.availableReplicas || 0} disponibles`,
      ]);
      const st = o.spec.strategy || {};
      rows.push([
        'Estrategia',
        st.type === 'RollingUpdate'
          ? `RollingUpdate (maxSurge ${st.rollingUpdate?.maxSurge ?? '25%'}, maxUnavailable ${st.rollingUpdate?.maxUnavailable ?? '25%'})`
          : st.type,
      ]);
      rows.push(['Imagen', images(o.spec.template.spec)]);
      rows.push(['Selector', selectorString(fromLabelSelector(o.spec.selector))]);
      rows.push(['Revisión', o.metadata.annotations?.['deployment.kubernetes.io/revision'] || '1']);
      const prog = (s.conditions || []).find((c: Json) => c.type === 'Progressing');
      if (prog) rows.push(['Progreso', prog.message]);
      if (o.spec.paused) rows.push(['Pausado', 'sí (kubectl rollout resume)']);
      break;
    }
    case 'ReplicaSet':
      rows.push(['Réplicas', `${o.spec.replicas} deseadas · ${s.readyReplicas || 0} listas`]);
      rows.push(['Revisión', o.metadata.annotations?.['deployment.kubernetes.io/revision'] || '-']);
      rows.push(['Imagen', images(o.spec.template.spec)]);
      rows.push(['pod-template-hash', o.metadata.labels?.['pod-template-hash'] || '-']);
      break;
    case 'StatefulSet':
      rows.push(['Réplicas', `${o.spec.replicas} deseadas · ${s.readyReplicas || 0} listas · ${s.updatedReplicas || 0} actualizadas`]);
      rows.push(['Servicio', o.spec.serviceName || '-']);
      rows.push([
        'Política',
        `${o.spec.podManagementPolicy} · ${o.spec.updateStrategy?.type}${o.spec.updateStrategy?.rollingUpdate?.partition ? ` (partition ${o.spec.updateStrategy.rollingUpdate.partition})` : ''}`,
      ]);
      rows.push(['Imagen', images(o.spec.template.spec)]);
      break;
    case 'DaemonSet':
      rows.push(['Nodos', `${s.desiredNumberScheduled || 0} deseados · ${s.numberReady || 0} listos · ${s.updatedNumberScheduled || 0} actualizados`]);
      rows.push(['Imagen', images(o.spec.template.spec)]);
      break;
    case 'Job':
      rows.push(['Completados', `${s.succeeded || 0}/${o.spec.completions ?? 1} (paralelismo ${o.spec.parallelism ?? 1})`]);
      if (s.failed) rows.push(['Fallos', `${s.failed} (backoffLimit ${o.spec.backoffLimit ?? 6})`]);
      rows.push(['Imagen', images(o.spec.template.spec)]);
      break;
    case 'CronJob':
      rows.push(['Horario', o.spec.schedule]);
      rows.push(['Última', s.lastScheduleTime ? `hace ${humanDuration(cl.now - Date.parse(s.lastScheduleTime))}` : 'nunca']);
      rows.push(['Activos', String((s.active || []).length)]);
      break;
    case 'Service': {
      rows.push(['Tipo', o.spec.type]);
      rows.push(['ClusterIP', o.spec.clusterIP]);
      rows.push(['Puertos', (o.spec.ports || []).map((p: Json) => `${p.port}→${p.targetPort}${p.nodePort ? ` (nodo :${p.nodePort})` : ''}`).join(', ')]);
      rows.push(['Selector', labelsString(o.spec.selector)]);
      const ep = cl.get('Endpoints', o.metadata.namespace, o.metadata.name);
      const addrs = (ep?.subsets || []).flatMap((x: Json) => (x.addresses || []).map((a: Json) => a.ip));
      rows.push(['Endpoints', addrs.length ? addrs.join(', ') : 'ninguno: ningún pod listo cumple el selector']);
      const lb = s.loadBalancer?.ingress?.[0]?.ip;
      if (lb) rows.push(['IP externa', lb]);
      rows.push(['DNS', `${o.metadata.name}.${o.metadata.namespace}.svc.cluster.local`]);
      break;
    }
    case 'Ingress':
      for (const r of o.spec?.rules || [])
        for (const p of r.http?.paths || [])
          rows.push([
            `${r.host || '*'}${p.path || '/'}`,
            `→ ${p.backend?.service?.name}:${p.backend?.service?.port?.number ?? p.backend?.service?.port?.name}`,
          ]);
      rows.push(['Dirección', s.loadBalancer?.ingress?.[0]?.ip || '(pendiente)']);
      rows.push(['Clase', o.spec?.ingressClassName || 'nginx (por defecto)']);
      break;
    case 'HorizontalPodAutoscaler':
      rows.push(['Objetivo', `${o.spec.scaleTargetRef?.kind}/${o.spec.scaleTargetRef?.name}`]);
      rows.push(['CPU', hpaTargets(o).replace('cpu: ', '')]);
      rows.push(['Réplicas', `${s.currentReplicas ?? 0} (min ${o.spec.minReplicas ?? 1}, max ${o.spec.maxReplicas})`]);
      break;
    case 'PersistentVolumeClaim':
      rows.push(['Estado', s.phase || 'Pending']);
      rows.push(['Tamaño', o.spec.resources?.requests?.storage]);
      rows.push(['StorageClass', o.spec.storageClassName || '-']);
      if (o.spec.volumeName) rows.push(['Volumen', o.spec.volumeName]);
      break;
    case 'PersistentVolume':
      rows.push(['Estado', s.phase]);
      rows.push(['Capacidad', o.spec.capacity?.storage]);
      rows.push(['Reclaim', o.spec.persistentVolumeReclaimPolicy]);
      if (o.spec.claimRef) rows.push(['Claim', `${o.spec.claimRef.namespace}/${o.spec.claimRef.name}`]);
      break;
    case 'ConfigMap':
    case 'Secret':
      rows.push(['Claves', Object.keys(o.data || {}).join(', ') || '(vacío)']);
      if (o.kind === 'Secret') rows.push(['Tipo', o.type]);
      break;
  }
  const labels = Object.entries(o.metadata.labels || {}).filter(
    ([k]) => k !== 'pod-template-hash' && !k.startsWith('batch.kubernetes.io') && k !== 'controller-uid' && k !== 'job-name',
  );
  if (labels.length && o.kind !== 'Pod') rows.push(['Etiquetas', labels.map(([k, v]) => `${k}=${v}`).join(', ')]);
  if (o.kind === 'Pod' && labels.length) rows.push(['Etiquetas', labels.map(([k, v]) => `${k}=${v}`).join(', ')]);
  rows.push(['Edad', age]);
  const src = cl.sourceOf(o);
  const f = cl.s.faults[o.metadata.uid];
  return {
    kind: o.kind,
    name: o.metadata.name,
    namespace: o.metadata.namespace,
    rows,
    source: src
      ? `${src.source.file}:${src.source.line}${src.obj !== o ? ` (vía ${qualifiedName(src.obj.kind)}/${src.obj.metadata.name})` : ''}${src.source.via ? ` · ${src.source.via}` : ''}`
      : o.metadata.annotations?.[LAST_APPLIED]
        ? undefined
        : undefined,
    fault: f ? FAULT_LABEL[f] : undefined,
  };
}

export interface MenuItem {
  label: string;
  /** kubectl command to run in the terminal. */
  cmd?: string;
  /** Other action handled by the playground. */
  action?: 'fault' | 'heal' | 'open' | 'load' | 'node-down' | 'node-up' | 'select';
  fault?: FaultKind;
  load?: number;
  danger?: boolean;
  separator?: boolean;
  hint?: string;
}

const ref = (o: Obj) => `${o.kind === 'HorizontalPodAutoscaler' ? 'hpa' : qualifiedName(o.kind).split('.')[0]}/${o.metadata.name}`;

export function menuFor(cl: Cluster, o: Obj): MenuItem[] {
  const ns = o.metadata.namespace && o.metadata.namespace !== cl.s.namespace ? ` -n ${o.metadata.namespace}` : '';
  const r = ref(o);
  const items: MenuItem[] = [];
  const src = cl.sourceOf(o);
  if (src) items.push({ label: `Abrir ${src.source.file}`, action: 'open' });
  items.push({ label: 'Describe', cmd: `kubectl describe ${r}${ns}` });
  items.push({ label: 'Ver YAML', cmd: `kubectl get ${r}${ns} -o yaml` });
  const fault = cl.s.faults[o.metadata.uid];
  switch (o.kind) {
    case 'Pod': {
      items.push({ label: 'Logs', cmd: `kubectl logs ${o.metadata.name}${ns}` });
      if ((o.status?.containerStatuses || []).some((c: Json) => c.restartCount > 0))
        items.push({ label: 'Logs del contenedor anterior', cmd: `kubectl logs ${o.metadata.name}${ns} --previous` });
      if (o.status?.phase === 'Running') items.push({ label: 'Abrir una shell (exec -it)', cmd: `kubectl exec -it ${o.metadata.name}${ns} -- sh` });
      items.push({ separator: true, label: 'Simular un fallo' });
      if (fault) items.push({ label: 'Restaurar la salud', action: 'heal' });
      items.push({ label: 'Marcar como caído (CrashLoopBackOff)', action: 'fault', fault: 'crash', danger: true });
      items.push({ label: 'Marcar como degradado (readiness falla)', action: 'fault', fault: 'unready' });
      items.push({ label: 'Sin memoria (OOMKilled)', action: 'fault', fault: 'oom', danger: true });
      items.push({ separator: true, label: '' });
      items.push({
        label: 'Eliminar el pod',
        cmd: `kubectl delete pod ${o.metadata.name}${ns}`,
        danger: true,
        hint: cl.controllerOf(o) ? 'su controlador creará otro' : 'nadie lo volverá a crear',
      });
      items.push({ label: 'Forzar la eliminación', cmd: `kubectl delete pod ${o.metadata.name}${ns} --grace-period=0 --force`, danger: true });
      break;
    }
    case 'Deployment':
    case 'StatefulSet':
    case 'ReplicaSet': {
      const n = o.spec.replicas ?? 1;
      items.push({ label: `Escalar a ${n + 1}`, cmd: `kubectl scale ${r}${ns} --replicas=${n + 1}` });
      if (n > 0) items.push({ label: `Escalar a ${n - 1}`, cmd: `kubectl scale ${r}${ns} --replicas=${n - 1}` });
      if (o.kind !== 'ReplicaSet') {
        items.push({ separator: true, label: 'Rollout' });
        items.push({ label: 'Estado del rollout', cmd: `kubectl rollout status ${r}${ns}` });
        items.push({ label: 'Historial', cmd: `kubectl rollout history ${r}${ns}` });
        items.push({ label: 'Reiniciar (rollout restart)', cmd: `kubectl rollout restart ${r}${ns}` });
        items.push({ label: 'Deshacer (rollout undo)', cmd: `kubectl rollout undo ${r}${ns}` });
        if (o.kind === 'Deployment')
          items.push(
            o.spec.paused ? { label: 'Reanudar', cmd: `kubectl rollout resume ${r}${ns}` } : { label: 'Pausar', cmd: `kubectl rollout pause ${r}${ns}` },
          );
      }
      items.push({ separator: true, label: 'Simular' });
      if (fault) items.push({ label: 'Restaurar la salud de sus pods', action: 'heal' });
      items.push({ label: 'Todos sus pods se caen', action: 'fault', fault: 'crash', danger: true });
      items.push({ label: 'Todos sus pods degradados', action: 'fault', fault: 'unready' });
      if (o.kind !== 'ReplicaSet') {
        const load = cl.s.load[o.metadata.uid];
        items.push({ label: `Carga de CPU: ${load ? 'quitar' : 'alta (para el HPA)'}`, action: 'load', load: load ? 0 : 1 });
        if (!load) items.push({ label: 'Carga de CPU: pico', action: 'load', load: 3 });
      }
      break;
    }
    case 'DaemonSet':
      items.push({ label: 'Estado del rollout', cmd: `kubectl rollout status ${r}${ns}` });
      items.push({ label: 'Reiniciar (rollout restart)', cmd: `kubectl rollout restart ${r}${ns}` });
      items.push({ separator: true, label: 'Simular' });
      if (fault) items.push({ label: 'Restaurar la salud', action: 'heal' });
      items.push({ label: 'Todos sus pods se caen', action: 'fault', fault: 'crash', danger: true });
      break;
    case 'CronJob':
      items.push({
        label: 'Ejecutar ahora',
        cmd: `kubectl create job ${o.metadata.name}-manual-${Math.floor(cl.now / 1000) % 100000} --from=cronjob/${o.metadata.name}${ns}`,
      });
      items.push({
        label: o.spec.suspend ? 'Reanudar' : 'Suspender',
        cmd: `kubectl patch cronjob ${o.metadata.name}${ns} -p '{"spec":{"suspend":${!o.spec.suspend}}}'`,
      });
      break;
    case 'Job':
      items.push({ label: 'Logs', cmd: `kubectl logs job/${o.metadata.name}${ns}` });
      break;
    case 'Service':
      items.push({ label: 'Endpoints', cmd: `kubectl get endpoints ${o.metadata.name}${ns}` });
      if (o.spec.ports?.[0])
        items.push({ label: `port-forward a localhost:8080`, cmd: `kubectl port-forward svc/${o.metadata.name}${ns} 8080:${o.spec.ports[0].port} &` });
      items.push({
        label: 'Probar desde un pod (curl)',
        cmd: `kubectl run curl-${Math.floor(cl.now / 1000) % 10000} --rm -it --restart=Never --image=curlimages/curl${ns} -- curl -s http://${o.metadata.name}${o.metadata.namespace !== 'default' ? `.${o.metadata.namespace}` : ''}:${o.spec.ports?.[0]?.port ?? 80}`,
      });
      break;
    case 'Ingress': {
      const host = o.spec?.rules?.[0]?.host;
      items.push({
        label: 'Probar con curl',
        cmd: host ? `curl http://${host}${o.spec.rules[0].http?.paths?.[0]?.path || '/'}` : 'curl http://172.18.255.200/',
      });
      break;
    }
    case 'Secret':
      items.push({ label: 'Decodificar', cmd: `kubectl get secret ${o.metadata.name}${ns} -o jsonpath='{.data}'` });
      break;
  }
  items.push({ separator: true, label: '' });
  items.push({ label: `Eliminar ${o.kind === 'Pod' ? '' : o.kind}`.trim(), cmd: `kubectl delete ${r}${ns}`, danger: true, hint: deleteHint(cl, o) });
  if (o.kind === 'Pod') items.pop();
  return items;
}

function deleteHint(cl: Cluster, o: Obj): string | undefined {
  const owner = cl.controllerOf(o);
  if (o.kind === 'ReplicaSet' && owner) return `el ${owner.kind} lo volverá a crear`;
  if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(o.kind)) return 'también se borran sus pods';
  if (o.kind === 'PersistentVolumeClaim') return 'se queda en Terminating mientras un pod lo use';
  return undefined;
}

export function nodeMenu(cl: Cluster, node: Obj): MenuItem[] {
  const down = cl.s.downNodes[node.metadata.uid] !== undefined;
  const items: MenuItem[] = [
    { label: 'Describe', cmd: `kubectl describe node ${node.metadata.name}` },
    { label: 'Pods del nodo', cmd: `kubectl get pods -A -o wide --field-selector spec.nodeName=${node.metadata.name}` },
    { separator: true, label: 'Mantenimiento' },
    node.spec.unschedulable
      ? { label: 'Uncordon (volver a programar)', cmd: `kubectl uncordon ${node.metadata.name}` }
      : { label: 'Cordon (no programar más pods)', cmd: `kubectl cordon ${node.metadata.name}` },
    { label: 'Drain (vaciar el nodo)', cmd: `kubectl drain ${node.metadata.name} --ignore-daemonsets --delete-emptydir-data`, danger: true },
    { separator: true, label: 'Simular' },
    down
      ? { label: 'Encender el nodo', action: 'node-up' }
      : { label: 'Apagar el nodo (se cae)', action: 'node-down', danger: true, hint: 'sus pods se desalojan a los 20 s' },
  ];
  return items;
}
