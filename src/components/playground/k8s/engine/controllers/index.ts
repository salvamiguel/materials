import type { Cluster } from '../cluster';
import { deploymentController } from './deployment';
import { replicaSetController } from './replicaset';
import { statefulSetController } from './statefulset';
import { daemonSetController } from './daemonset';
import { cronJobController, jobController } from './job';
import { hpaController } from './hpa';
import { kubelet } from './kubelet';
import { garbageCollector, namespaceController, networkController, nodeController, storageController } from './infra';

/** One reconcile pass of every controller, in dependency order. */
export function runControllers(cl: Cluster) {
  namespaceController(cl);
  garbageCollector(cl);
  nodeController(cl);
  cronJobController(cl);
  hpaController(cl);
  deploymentController(cl);
  replicaSetController(cl);
  statefulSetController(cl);
  daemonSetController(cl);
  jobController(cl);
  storageController(cl);
  kubelet(cl);
  networkController(cl);
}
