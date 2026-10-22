// The main layout (CLAUDE.md, Design tokens): top bar, tool palette on the left, the canvas in the
// centre, properties/layers on the right, command line and status bar at the bottom.

import { useEffect, useState } from 'react';
import { onLanguage, t } from '@shared/i18n';
import { useStore } from './state/store';
import { TopBar } from './components/TopBar';
import { SheetTabs } from './components/SheetTabs';
import { ToolPalette } from './components/ToolPalette';
import { Canvas2D } from './components/Canvas2D';
import { Viewer3D } from './components/Viewer3D';
import { RightPanel } from './components/RightPanel';
import { CommandLine } from './components/CommandLine';
import { StatusBar } from './components/StatusBar';
import { useShortcuts } from './shortcuts';

export function App() {
  const init = useStore((s) => s.init);
  const [, bump] = useState(0);
  useEffect(() => {
    void init();
    // Re-render everything when the language changes: t() is called at render time.
    return onLanguage(() => bump((n) => n + 1));
  }, [init]);
  useShortcuts();
  const recovery = useStore((s) => s.recovery);
  const recover = useStore((s) => s.recover);
  const dismiss = useStore((s) => s.dismissRecovery);
  const activePart = useStore((s) => s.activePart);
  return (
    <div className="app">
      <TopBar />
      {recovery && (
        <div className="banner" role="alert">
          <span>{t('MechPilot did not close properly last time. An autosave of "{name}" is available.', { name: recovery.name })}</span>
          <button className="btn small primary" onClick={() => void recover()}>
            {t('Recover it')}
          </button>
          <button className="btn small" onClick={() => void dismiss()}>
            {t('Discard')}
          </button>
        </div>
      )}
      <SheetTabs />
      <div className="middle">
        <ToolPalette />
        {activePart ? <Viewer3D /> : <Canvas2D />}
        <RightPanel />
      </div>
      <CommandLine />
      <StatusBar />
    </div>
  );
}
