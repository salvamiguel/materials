import React, { useSyncExternalStore } from 'react';
import { TbPresentation, TbPresentationOff } from 'react-icons/tb';
import { isOn, subscribe, toggle } from './presentation';

interface Props {
  mobile?: boolean;
  className?: string;
}

/** Navbar item `custom-presentation`: toggles presentation mode (also the P key). */
export default function PresentationNavbarItem({ mobile, className }: Props) {
  const active = useSyncExternalStore(subscribe, isOn, () => false);
  const label = active ? 'Salir del modo presentación' : 'Modo presentación';
  if (mobile) {
    return (
      <li className="menu__list-item">
        <button type="button" className="menu__link clean-btn presentation-menu-link" onClick={toggle}>
          <TbPresentation aria-hidden /> {label}
        </button>
      </li>
    );
  }
  return (
    <button
      type="button"
      className={`clean-btn presentation-navbar-btn ${className ?? ''}`}
      onClick={toggle}
      title={`${label} (P)`}
      aria-label={label}
      aria-pressed={active}
    >
      {active ? <TbPresentationOff aria-hidden /> : <TbPresentation aria-hidden />}
    </button>
  );
}
