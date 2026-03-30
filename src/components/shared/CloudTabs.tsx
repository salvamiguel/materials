import React, { useState, useEffect, Children, isValidElement } from 'react';
import { FaAws } from 'react-icons/fa';
import { VscAzure } from 'react-icons/vsc';
import { SiGooglecloud } from 'react-icons/si';

const STORAGE_KEY = 'cloud-provider-tab';

const CLOUDS: Record<string, { label: string; icon: React.ReactNode }> = {
  aws:   { label: 'AWS',   icon: <FaAws /> },
  gcp:   { label: 'GCP',   icon: <SiGooglecloud /> },
  azure: { label: 'Azure', icon: <VscAzure /> },
};

export function CloudTab({ children }: { provider: string; children: React.ReactNode }) {
  return <>{children}</>;
}

export default function CloudTabs({ children }: { children: React.ReactNode }) {
  const tabs = Children.toArray(children).filter(
    (child) => isValidElement(child) && (child as React.ReactElement<{ provider: string }>).props.provider
  ) as React.ReactElement<{ provider: string; children: React.ReactNode }>[];

  const providers = tabs.map((t) => t.props.provider);

  const [selected, setSelected] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && providers.includes(stored)) return stored;
    }
    return providers[0] || 'aws';
  });

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && providers.includes(e.newValue)) {
        setSelected(e.newValue);
      }
    };
    const customHandler = (e: Event) => {
      const value = (e as CustomEvent).detail;
      if (providers.includes(value)) setSelected(value);
    };
    window.addEventListener('storage', handler);
    window.addEventListener('cloud-tab-change', customHandler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('cloud-tab-change', customHandler);
    };
  }, [providers]);

  const select = (provider: string) => {
    setSelected(provider);
    localStorage.setItem(STORAGE_KEY, provider);
    window.dispatchEvent(new CustomEvent('cloud-tab-change', { detail: provider }));
  };

  const activeTab = tabs.find((t) => t.props.provider === selected) || tabs[0];

  return (
    <div className="cloud-tabs">
      <ul className="cloud-tabs__nav" role="tablist">
        {providers.map((p) => {
          const cloud = CLOUDS[p];
          const isActive = p === selected;
          return (
            <li
              key={p}
              role="tab"
              aria-selected={isActive}
              className={`cloud-tabs__tab ${isActive ? 'cloud-tabs__tab--active' : ''}`}
              onClick={() => select(p)}
            >
              <span className="cloud-tabs__icon">{cloud?.icon}</span>
              {cloud?.label || p}
            </li>
          );
        })}
      </ul>
      <div className="cloud-tabs__content">
        {activeTab?.props.children}
      </div>
    </div>
  );
}
