// The main layout (CLAUDE.md, Design tokens): top bar, tool palette on the left, the canvas in the
// centre, properties/layers on the right, command line and status bar at the bottom.

import { useEffect, useState } from 'react';
import { onLanguage } from '@shared/i18n';
import { useStore } from './state/store';
import { TopBar } from './components/TopBar';
import { ToolPalette } from './components/ToolPalette';
import { Canvas2D } from './components/Canvas2D';
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
  return (
    <div className="app">
      <TopBar />
      <div className="middle">
        <ToolPalette />
        <Canvas2D />
        <RightPanel />
      </div>
      <CommandLine />
      <StatusBar />
    </div>
  );
}
