// Job and CronJob controllers.

import type { Cluster } from '../cluster';
import type { Obj } from '../types';
import { clone, stableJson } from '../util';
import { applyDefaults } from '../defaults';
import { nextCron, parseCron } from '../validate';
import { condition, createPod, deletePod, isTerminating, ownerRef, podReady, setCondition } from './common';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function jobFinished(job: Obj): 'Complete' | 'Failed' | undefined {
  if (condition(job, 'Complete')?.status === 'True') return 'Complete';
  if (condition(job, 'Failed')?.status === 'True') return 'Failed';
  return undefined;
}

export function jobController(cl: Cluster) {
  for (const job of cl.list('Job')) {
    if (isTerminating(job)) continue;
    const before = JSON.stringify(job);
    const uid = job.metadata.uid;
    // Admission-time labels and selector.
    if (!job.spec.selector) {
      const labels = {
        'batch.kubernetes.io/controller-uid': uid,
        'batch.kubernetes.io/job-name': job.metadata.name,
        'controller-uid': uid,
        'job-name': job.metadata.name,
      };
      job.spec.selector = { matchLabels: { 'batch.kubernetes.io/controller-uid': uid } };
      job.spec.template.metadata ??= {};
      job.spec.template.metadata.labels = { ...labels, ...(job.spec.template.metadata.labels || {}) };
      job.metadata.labels = { ...labels, ...(job.metadata.labels || {}) };
    }
    const finished = jobFinished(job);
    if (finished) {
      const ttl = job.spec.ttlSecondsAfterFinished;
      const at = Date.parse(job.status.completionTime || condition(job, finished)?.lastTransitionTime || '');
      if (ttl !== undefined && !Number.isNaN(at) && cl.now - at >= ttl * 1000) cl.deleteObject(job);
      if (JSON.stringify(job) !== before) job.metadata.resourceVersion = String(++cl.s.rv);
      continue;
    }
    if (job.spec.suspend) {
      setCondition(cl, job, 'Suspended', 'True', 'JobSuspended', 'Job suspended');
      for (const p of cl.children(job, 'Pod')) if (!isTerminating(p)) deletePod(cl, job, p);
      if (JSON.stringify(job) !== before) job.metadata.resourceVersion = String(++cl.s.rv);
      continue;
    }
    job.status ??= {};
    job.status.startTime ??= cl.ts();
    const pods = cl.children(job, 'Pod');
    const succeeded = pods.filter((p) => p.status?.phase === 'Succeeded').length;
    const failedPods = pods.filter((p) => p.status?.phase === 'Failed').length;
    const restarts = pods.reduce((n, p) => n + (p.status?.containerStatuses || []).reduce((m: number, c: Json) => m + (c.restartCount || 0), 0), 0);
    const failed = failedPods + restarts;
    const active = pods.filter((p) => !isTerminating(p) && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed');
    const completions: number = job.spec.completions ?? 1;
    const parallelism: number = job.spec.parallelism ?? 1;
    const deadline = job.spec.activeDeadlineSeconds;
    const started = Date.parse(job.status.startTime);

    const fail = (reason: string, message: string) => {
      for (const p of active) deletePod(cl, job, p);
      setCondition(cl, job, 'FailureTarget', 'True', reason, message, { lastProbeTime: cl.ts() });
      setCondition(cl, job, 'Failed', 'True', reason, message, { lastProbeTime: cl.ts() });
      cl.emit(job, 'Warning', reason, message, 'job-controller');
    };
    if (succeeded >= completions) {
      for (const p of active) deletePod(cl, job, p);
      job.status.completionTime = cl.ts();
      setCondition(cl, job, 'SuccessCriteriaMet', 'True', 'CompletionsReached', 'Reached expected number of succeeded pods', { lastProbeTime: cl.ts() });
      setCondition(cl, job, 'Complete', 'True', 'CompletionsReached', 'Reached expected number of succeeded pods', { lastProbeTime: cl.ts() });
      cl.emit(job, 'Normal', 'Completed', 'Job completed', 'job-controller');
    } else if (failed > (job.spec.backoffLimit ?? 6)) {
      fail('BackoffLimitExceeded', 'Job has reached the specified backoff limit');
    } else if (deadline !== undefined && cl.now - started >= deadline * 1000) {
      fail('DeadlineExceeded', 'Job was active longer than specified deadline');
    } else {
      const want = Math.min(parallelism, completions - succeeded) - active.length;
      // Pods that failed are replaced after an exponential back-off.
      const lastFail = pods
        .filter((p) => p.status?.phase === 'Failed')
        .reduce((m, p) => Math.max(m, Date.parse(p.status?.containerStatuses?.[0]?.state?.terminated?.finishedAt || '') || 0), 0);
      const wait = failedPods ? Math.min(360_000, 10_000 * 2 ** (failedPods - 1)) : 0;
      if (want > 0 && cl.now - lastFail >= wait) {
        for (let i = 0; i < want; i++) createPod(cl, job, job.spec.template, { generateName: `${job.metadata.name}-` });
      }
    }
    const nowPods = cl.children(job, 'Pod');
    const status: Json = {
      ...job.status,
      active: nowPods.filter((p) => !isTerminating(p) && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed').length,
      succeeded: nowPods.filter((p) => p.status?.phase === 'Succeeded').length,
      failed: failedPods,
      ready: nowPods.filter(podReady).length,
      terminating: nowPods.filter(isTerminating).length,
      uncountedTerminatedPods: {},
    };
    for (const k of ['active', 'succeeded', 'failed']) if (!status[k]) delete status[k];
    job.status = status;
    if (JSON.stringify(job) !== before) job.metadata.resourceVersion = String(++cl.s.rv);
  }
}

export function cronJobController(cl: Cluster) {
  for (const cj of cl.list('CronJob')) {
    if (isTerminating(cj)) continue;
    const before = JSON.stringify(cj);
    let cron;
    try {
      cron = parseCron(cj.spec.schedule);
    } catch {
      continue;
    }
    const jobs = cl.children(cj, 'Job');
    const active = jobs.filter((j) => !jobFinished(j));
    // Report finished jobs once.
    const seenAll = (cl.s.cronSeen ??= {});
    const seen = (seenAll[cj.metadata.uid] ??= []);
    for (const j of jobs) {
      const f = jobFinished(j);
      if (f && !seen.includes(j.metadata.uid)) {
        seen.push(j.metadata.uid);
        cl.emit(cj, 'Normal', 'SawCompletedJob', `Saw completed job: ${j.metadata.name}, condition: ${f}`, 'cronjob-controller');
        if (f === 'Complete') (cj.status ??= {}).lastSuccessfulTime = j.status.completionTime;
      }
    }
    if (!cj.spec.suspend) {
      const last = Date.parse(cj.status?.lastScheduleTime || cj.metadata.creationTimestamp);
      const next = nextCron(cron, last);
      if (cl.now >= next) {
        cj.status ??= {};
        cj.status.lastScheduleTime = cl.ts(next);
        const policy = cj.spec.concurrencyPolicy || 'Allow';
        if (policy === 'Forbid' && active.length) {
          cl.emit(
            cj,
            'Normal',
            'JobAlreadyActive',
            'Not starting job because prior execution is running and concurrency policy is Forbid',
            'cronjob-controller',
          );
        } else {
          if (policy === 'Replace') {
            for (const j of active) {
              cl.deleteObject(j);
              cl.emit(cj, 'Normal', 'SuccessfulDelete', `Deleted job ${j.metadata.name}`, 'cronjob-controller');
            }
          }
          const name = `${cj.metadata.name}-${Math.floor(next / 60_000)}`;
          if (!cl.get('Job', cj.metadata.namespace, name)) {
            const jt = clone(cj.spec.jobTemplate);
            const job: Obj = {
              apiVersion: 'batch/v1',
              kind: 'Job',
              metadata: {
                name,
                namespace: cj.metadata.namespace,
                labels: { ...(jt.metadata?.labels || {}) },
                annotations: { ...(jt.metadata?.annotations || {}), 'batch.kubernetes.io/cronjob-scheduled-timestamp': cl.ts(next) },
                ownerReferences: [ownerRef(cj)],
              },
              spec: jt.spec,
            };
            applyDefaults(job);
            cl.admit(job);
            cl.put(job);
            cl.emit(cj, 'Normal', 'SuccessfulCreate', `Created job ${name}`, 'cronjob-controller');
          }
        }
      }
    }
    // History limits.
    const done = cl
      .children(cj, 'Job')
      .filter((j) => jobFinished(j))
      .sort((a, b) => Date.parse(a.metadata.creationTimestamp) - Date.parse(b.metadata.creationTimestamp));
    for (const [kind, limit] of [
      ['Complete', cj.spec.successfulJobsHistoryLimit ?? 3],
      ['Failed', cj.spec.failedJobsHistoryLimit ?? 1],
    ] as const) {
      const list = done.filter((j) => jobFinished(j) === kind);
      while (list.length > limit) {
        const j = list.shift()!;
        cl.deleteObject(j);
        cl.emit(cj, 'Normal', 'SuccessfulDelete', `Deleted job ${j.metadata.name}`, 'cronjob-controller');
      }
    }
    cj.status ??= {};
    const act = cl.children(cj, 'Job').filter((j) => !jobFinished(j));
    if (act.length)
      cj.status.active = act.map((j) => ({
        apiVersion: 'batch/v1',
        kind: 'Job',
        name: j.metadata.name,
        namespace: j.metadata.namespace,
        resourceVersion: j.metadata.resourceVersion,
        uid: j.metadata.uid,
      }));
    else delete cj.status.active;
    if (JSON.stringify(cj) !== before) cj.metadata.resourceVersion = String(++cl.s.rv);
  }
}
