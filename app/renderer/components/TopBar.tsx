// Top bar: in-app menus (same on every OS), the document name, and the drawing settings that must
// always be visible: unit, standard, projection (product rules 1 and 2).

import { useEffect, useRef, useState } from 'react';
import { t } from '@shared/i18n';
import { useStore } from '../state/store';

interface Item {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  run?: () => void;
  children?: Item[];
}

function Menu({ title, items }: { title: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className={`menu ${open ? 'open' : ''}`} ref={ref}>
      <button className="menu-title" onClick={() => setOpen((o) => !o)}>
        {title}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((it, i) => (
            <MenuRow key={i} item={it} close={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({ item, close }: { item: Item; close: () => void }) {
  const [sub, setSub] = useState(false);
  if (item.children) {
    return (
      <div className="menu-item has-sub" onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)} onClick={() => setSub(true)}>
        <span>{item.label}</span>
        <span className="chev">›</span>
        {sub && (
          <div className="menu-list sub">
            {item.children.length === 0 && <div className="menu-item disabled">{t('None')}</div>}
            {item.children.map((c, i) => (
              <MenuRow key={i} item={c} close={close} />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <button
      className={`menu-item ${item.disabled ? 'disabled' : ''}`}
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        close();
        item.run?.();
      }}
    >
      <span className="check">{item.checked ? '✓' : ''}</span>
      <span>{item.label}</span>
      {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
    </button>
  );
}

export function TopBar() {
  const s = useStore();
  const doc = s.editor.doc;
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
  const file: Item[] = [
    { label: t('New drawing'), shortcut: `${mod}N`, run: () => s.newDocument() },
    { label: t('Open…'), shortcut: `${mod}O`, run: () => void s.openFile() },
    { label: t('Open recent'), children: s.settings.recent.map((p) => ({ label: p, run: () => void s.openFile(p) })) },
    { label: t('Open sample'), children: s.samples.map((smp) => ({ label: smp.name, run: () => void s.openSample(smp.id) })) },
    { label: t('Save'), shortcut: `${mod}S`, run: () => void s.saveFile() },
    { label: t('Save as…'), shortcut: `${mod}⇧S`, run: () => void s.saveFile(true) },
  ];
  const edit: Item[] = [
    { label: s.canUndo() ? t('Undo {what}', { what: s.editor.history.undo[s.editor.history.undo.length - 1].label }) : t('Undo'), shortcut: `${mod}Z`, disabled: !s.canUndo(), run: () => s.undo() },
    { label: t('Redo'), shortcut: `${mod}Y`, disabled: !s.canRedo(), run: () => s.redo() },
    { label: t('Select all'), shortcut: `${mod}A`, run: () => s.select(doc.entityOrder) },
    { label: t('Delete'), shortcut: 'Del', disabled: s.selection.length === 0, run: () => s.deleteSelection() },
  ];
  const view: Item[] = [
    { label: t('Zoom extents'), shortcut: 'ZE', run: () => s.zoomExtents() },
    { label: t('Grid'), checked: s.gridOn, run: () => s.toggleGrid() },
    { label: t('Snap to grid'), checked: s.snapGrid, run: () => s.toggleSnapGrid() },
    { label: t('Dark interface'), checked: s.settings.theme === 'dark', run: () => void s.updateSettings({ theme: 'dark' }) },
    { label: t('Light interface'), checked: s.settings.theme === 'light', run: () => void s.updateSettings({ theme: 'light' }) },
    { label: t('Dark canvas'), checked: s.settings.canvas === 'dark', run: () => void s.updateSettings({ canvas: 'dark' }) },
    { label: t('White canvas'), checked: s.settings.canvas === 'white', run: () => void s.updateSettings({ canvas: 'white' }) },
    { label: 'English', checked: s.settings.lang === 'en', run: () => void s.updateSettings({ lang: 'en' }) },
    { label: 'Italiano', checked: s.settings.lang === 'it', run: () => void s.updateSettings({ lang: 'it' }) },
  ];
  const help: Item[] = [
    { label: t('Website'), run: () => void window.mechpilot.app.openExternal('https://mechpilot.agentflowbind.com') },
    { label: t('Source code and issues (GitHub)'), run: () => void window.mechpilot.app.openExternal('https://github.com/mojeee/mechpilot') },
    { label: t('About MechPilot {version}', { version: s.version }), run: () => s.say({ kind: 'info', text: t('MechPilot {version}. Open-source 2D/3D mechanical design, Apache-2.0. Copyright Mojtaba Amini.', { version: s.version }) }) },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        MechPilot
      </div>
      <nav className="top-menu">
        <Menu title={t('File')} items={file} />
        <Menu title={t('Edit')} items={edit} />
        <Menu title={t('View')} items={view} />
        <Menu title={t('Help')} items={help} />
      </nav>
      <div className="doc-title" title={s.filePath ?? ''}>
        {doc.name}
        {s.editor.dirty ? ' •' : ''}
      </div>
      <div className="doc-badges">
        <span className="badge" title={t('All geometry is stored in millimetres')}>
          mm
        </span>
        <span className="badge" title={t('Drawing standard')}>
          {doc.standard.toUpperCase()}
        </span>
        <span className="badge" title={t('Projection (ISO 5456-2)')}>
          {doc.projection === 'first' ? t('1st angle') : t('3rd angle')}
        </span>
      </div>
    </header>
  );
}
