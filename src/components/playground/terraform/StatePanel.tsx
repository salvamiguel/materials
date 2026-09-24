import React, { useEffect, useMemo, useState } from 'react';
import HclEditor from './HclEditor';
import styles from './playground.module.css';

interface Props {
  state: string;
  onChange: (state: string) => void;
  onReset: () => void;
  onShow: (address: string) => void;
}

interface Summary {
  serial: number;
  lineage: string;
  addresses: string[];
  outputs: string[];
}

function summarize(state: string): Summary | undefined {
  try {
    const s = JSON.parse(state);
    const addresses: string[] = [];
    for (const r of s.resources || []) {
      const base = `${r.module ? r.module + '.' : ''}${r.mode === 'data' ? 'data.' : ''}${r.type}.${r.name}`;
      for (const i of r.instances || []) {
        const key = i.index_key === undefined ? '' : typeof i.index_key === 'number' ? `[${i.index_key}]` : `["${i.index_key}"]`;
        addresses.push(base + key);
      }
    }
    return { serial: s.serial, lineage: s.lineage, addresses, outputs: Object.keys(s.outputs || {}) };
  } catch {
    return undefined;
  }
}

export default function StatePanel({ state, onChange, onReset, onShow }: Props) {
  const [draft, setDraft] = useState(state);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) setDraft(state);
  }, [state, editing]);
  const summary = useMemo(() => summarize(state), [state]);

  if (!state.trim()) {
    return (
      <div className={styles.panelEmpty}>
        Todavía no hay estado. Ejecuta <code>apply</code> y aquí verás el <code>terraform.tfstate</code> que Terraform
        guardaría: cada recurso con sus atributos, sus dependencias y el número de serie.
      </div>
    );
  }

  const save = () => {
    try {
      JSON.parse(draft);
    } catch (e) {
      setError('JSON no válido: ' + (e as Error).message);
      return;
    }
    setError('');
    setEditing(false);
    onChange(draft);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([state], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terraform.tfstate';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.statePanel}>
      <div className={styles.stateHeader}>
        {summary && (
          <div className={styles.stateMeta}>
            <span>
              serial <b>{summary.serial}</b>
            </span>
            <span>{summary.addresses.length} objetos</span>
            {summary.outputs.length > 0 && <span>{summary.outputs.length} outputs</span>}
          </div>
        )}
        <div className={styles.stateActions}>
          {editing ? (
            <>
              <button className={styles.btnSmall} onClick={save}>
                Guardar estado
              </button>
              <button
                className={styles.btnSmallGhost}
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              className={styles.btnSmallGhost}
              onClick={() => setEditing(true)}
              title="Edita un atributo para simular un cambio hecho fuera de Terraform (drift) y ejecuta plan"
            >
              Editar (simular drift)
            </button>
          )}
          <button className={styles.btnSmallGhost} onClick={download}>
            Descargar
          </button>
          <button className={styles.btnSmallGhost} onClick={onReset} title="Borra el estado, como si nunca se hubiera hecho apply">
            Borrar estado
          </button>
        </div>
      </div>
      {summary && summary.addresses.length > 0 && (
        <div className={styles.stateList}>
          {summary.addresses.map((a) => (
            <button key={a} className={styles.addrChip} onClick={() => onShow(a)} title={`terraform state show '${a}'`}>
              {a}
            </button>
          ))}
        </div>
      )}
      {error && <div className={styles.stateError}>{error}</div>}
      <div className={styles.stateEditor}>
        <HclEditor filename="terraform.tfstate.json" value={editing ? draft : state} onChange={setDraft} diagnostics={[]} readOnly={!editing} />
      </div>
    </div>
  );
}
