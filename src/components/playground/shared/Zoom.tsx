import React, { useSyncExternalStore } from 'react';
import { TbZoomIn, TbZoomOut } from 'react-icons/tb';
import {
  DEFAULT_SCALE,
  getPlaygroundZoom,
  getScale,
  isOn,
  MAX_SCALE,
  MIN_SCALE,
  setPlaygroundZoom,
  setScale,
  subscribe,
} from '../../presentation/presentation';
import styles from './playground.module.css';

export interface Zoom {
  zoom: number;
  setZoom: (z: number) => void;
  presenting: boolean;
}

/** The playground's size: the presentation scale while presenting (so the
 * HUD and the +/− keys drive it too), and its own zoom otherwise. */
export function usePlaygroundZoom(): Zoom {
  const presenting = useSyncExternalStore(subscribe, isOn, () => false);
  const scale = useSyncExternalStore(subscribe, getScale, () => DEFAULT_SCALE);
  const own = useSyncExternalStore(subscribe, getPlaygroundZoom, () => 1);
  return presenting ? { zoom: scale, setZoom: setScale, presenting } : { zoom: own, setZoom: setPlaygroundZoom, presenting };
}

/** Sets --pz, which scales the playground's fonts (see playground.module.css). */
export const zoomStyle = (zoom: number) => ({ '--pz': zoom }) as React.CSSProperties;

export default function ZoomControl({ zoom, setZoom, presenting }: Zoom) {
  const reset = presenting ? DEFAULT_SCALE : 1;
  const where = presenting ? ' (modo presentación: también texto, código y demos)' : '';
  return (
    <div className={styles.zoom} role="group" aria-label="Tamaño del código">
      <button
        type="button"
        onClick={() => setZoom(zoom - 0.1)}
        disabled={zoom <= MIN_SCALE}
        title={`Reducir el tamaño${where}`}
        aria-label="Reducir el tamaño"
      >
        <TbZoomOut aria-hidden />
      </button>
      <button
        type="button"
        className={styles.zoomValue}
        onClick={() => setZoom(reset)}
        title={`Tamaño del editor y la terminal${where}. Clic para volver a ${Math.round(reset * 100)} %`}
      >
        {Math.round(zoom * 100)} %
      </button>
      <button
        type="button"
        onClick={() => setZoom(zoom + 0.1)}
        disabled={zoom >= MAX_SCALE}
        title={`Aumentar el tamaño${where}`}
        aria-label="Aumentar el tamaño"
      >
        <TbZoomIn aria-hidden />
      </button>
    </div>
  );
}
