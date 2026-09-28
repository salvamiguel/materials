import React, { useEffect, useRef, useState } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';

const FONT = "'JetBrains Mono', 'Fira Code', monospace";
const C = {
  bg: '#1e2029',
  panel: '#2a2d37',
  border: '#3a3d47',
  text: '#abb2bf',
  dim: '#7f848e',
  green: '#98c379',
  red: '#e06c75',
  yellow: '#e5c07b',
  blue: '#61afef',
  purple: '#c678dd',
};

interface Spec {
  replicas: number;
  tag: string;
}
interface Commit extends Spec {
  sha: string;
  msg: string;
}

const TAGS = ['v1', 'v2', 'v3'];
// The real controller polls Git every ~3 minutes; here a few seconds.
const POLL_SECONDS = 5;
const sha = () => Math.random().toString(16).slice(2, 9);

const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, color: C.text, fontFamily: FONT, fontSize: 13 };

export default function ArgoCDSyncSim() {
  const [first] = useState<Commit>(() => ({ replicas: 3, tag: 'v1', sha: sha(), msg: 'Initial commit' }));
  const [commits, setCommits] = useState<Commit[]>([first]);
  const [draft, setDraft] = useState<Spec>({ replicas: 3, tag: 'v1' });
  const [live, setLive] = useState<Spec>({ replicas: 3, tag: 'v1' });
  const [seen, setSeen] = useState<string>(first.sha); // last Git revision ArgoCD has fetched
  const [synced, setSynced] = useState<string>(first.sha); // revision applied to the cluster
  const [automated, setAutomated] = useState(true);
  const [selfHeal, setSelfHeal] = useState(true);
  const [countdown, setCountdown] = useState(POLL_SECONDS);
  const [progressing, setProgressing] = useState(0);
  const [log, setLog] = useState<string[]>(['Application status-dev creada: Synced, Healthy']);
  const history = useRef<{ id: number; sha: string; tag: string; replicas: number }[]>([{ id: 1, sha: first.sha, tag: 'v1', replicas: 3 }]);

  const head = commits[commits.length - 1];
  const target = commits.find((c) => c.sha === seen) || head;
  const outOfSync = live.replicas !== target.replicas || live.tag !== target.tag;
  const say = (m: string) => setLog((l) => [m, ...l].slice(0, 8));

  const sync = (to: Commit, reason: string) => {
    setLive({ replicas: to.replicas, tag: to.tag });
    setSynced(to.sha);
    setProgressing(3);
    history.current = [...history.current, { id: history.current.length + 1, sha: to.sha, tag: to.tag, replicas: to.replicas }];
    say(`${reason}: aplicada la revisión ${to.sha} (${to.tag}, ${to.replicas} réplicas)`);
  };

  // Reconciliation loop: a clock, and a Git poll every POLL_SECONDS.
  useEffect(() => {
    const t = setInterval(() => {
      setProgressing((p) => Math.max(0, p - 1));
      setCountdown((c) => (c <= 1 ? POLL_SECONDS : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (countdown !== POLL_SECONDS || seen === head.sha) return;
    say(`ArgoCD detecta el commit ${head.sha} en Git`);
    setSeen(head.sha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  useEffect(() => {
    if (!outOfSync || !automated) return;
    const gitChanged = synced !== target.sha;
    if (gitChanged) sync(target, 'Sync automático');
    else if (selfHeal) sync(target, 'selfHeal revierte el cambio manual');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfSync, automated, selfHeal, seen]);

  const commit = () => {
    if (draft.replicas === head.replicas && draft.tag === head.tag) return;
    const c: Commit = { ...draft, sha: sha(), msg: `replicas=${draft.replicas}, image=${draft.tag}` };
    setCommits((cs) => [...cs, c]);
    say(`git push: commit ${c.sha} (${c.msg})`);
  };
  const scaleByHand = () => {
    const n = live.replicas === 5 ? 2 : 5;
    setLive((l) => ({ ...l, replicas: n }));
    say(`kubectl scale --replicas=${n} (cambio manual en el clúster)`);
  };
  const rollback = () => {
    const prev = history.current[history.current.length - 2];
    if (!prev) return;
    setLive({ replicas: prev.replicas, tag: prev.tag });
    say(`argocd app rollback: vuelta a ${prev.sha} (${prev.tag}); Git no cambia`);
  };

  const pill = (text: string, color: string) => (
    <span style={{ border: `1px solid ${color}`, color, borderRadius: 999, padding: '2px 10px', fontSize: 12, marginRight: 6 }}>{text}</span>
  );
  const pods = Array.from({ length: live.replicas }, (_, i) => i);

  return (
    <DemoWrapper title="ArgoCD: sync, drift y selfHeal" description="Cambia Git o el clúster y observa cómo reconcilia ArgoCD">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 10 }}>
        <label style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={automated} onChange={(e) => setAutomated(e.target.checked)} /> <code>automated</code> (sync automático)
        </label>
        <label style={{ cursor: automated ? 'pointer' : 'not-allowed', opacity: automated ? 1 : 0.5 }}>
          <input type="checkbox" checked={selfHeal} disabled={!automated} onChange={(e) => setSelfHeal(e.target.checked)} /> <code>selfHeal</code>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...box, flex: '1 1 250px' }}>
          <div style={{ color: C.dim, marginBottom: 8 }}>Git · k8s/overlays/dev</div>
          <div style={{ marginBottom: 6 }}>
            replicas:{' '}
            <input
              type="number"
              min={1}
              max={6}
              value={draft.replicas}
              onChange={(e) => setDraft((d) => ({ ...d, replicas: Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1)) }))}
              style={{ width: 50, background: C.panel, color: C.yellow, border: `1px solid ${C.border}`, fontFamily: FONT }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            newTag:{' '}
            <select value={draft.tag} onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))} style={{ background: C.panel, color: C.yellow, border: `1px solid ${C.border}`, fontFamily: FONT }}>
              {TAGS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <button type="button" className="button button--sm button--primary" onClick={commit}>
            git commit + push
          </button>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>HEAD: {head.sha}</div>
        </div>

        <div style={{ ...box, flex: '1 1 250px' }}>
          <div style={{ color: C.dim, marginBottom: 8 }}>ArgoCD · status-dev</div>
          <div style={{ marginBottom: 8 }}>
            {outOfSync ? pill('OutOfSync', C.yellow) : pill('Synced', C.green)}
            {progressing > 0 ? pill('Progressing', C.blue) : pill('Healthy', C.green)}
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Próxima consulta a Git en {countdown} s</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="button button--sm button--secondary" onClick={() => { setSeen(head.sha); sync(head, 'Sync manual'); }}>
              SYNC
            </button>
            <button
              type="button"
              className="button button--sm button--secondary"
              disabled={automated}
              title={automated ? 'ArgoCD rechaza el rollback con sync automático' : 'Volver a la revisión anterior'}
              onClick={rollback}
            >
              ROLLBACK
            </button>
          </div>
          {automated && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Rollback desactivado: con sync automático, ArgoCD lo rechaza. Usa git revert.</div>}
        </div>

        <div style={{ ...box, flex: '1 1 250px' }}>
          <div style={{ color: C.dim, marginBottom: 8 }}>Clúster · namespace status-dev</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {pods.map((i) => (
              <span key={i} title={`gitops-status-demo-${i}`} style={{ border: `1px solid ${C.green}`, borderRadius: 6, padding: '4px 6px', fontSize: 11, color: C.green }}>
                pod {live.tag}
              </span>
            ))}
          </div>
          <button type="button" className="button button--sm button--secondary" onClick={scaleByHand}>
            kubectl scale (a mano)
          </button>
        </div>
      </div>

      <div style={{ ...box, marginTop: 12, fontSize: 12 }}>
        {log.map((l, i) => (
          <div key={i} style={{ opacity: i === 0 ? 1 : 0.6 }}>
            {l}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8, marginBottom: 0 }}>
        El controlador real consulta Git cada 3 minutos (o al instante con un webhook); aquí, cada {POLL_SECONDS} segundos. Sin{' '}
        <code>selfHeal</code>, un cambio manual deja la app en OutOfSync hasta el siguiente sync.
      </p>
    </DemoWrapper>
  );
}
