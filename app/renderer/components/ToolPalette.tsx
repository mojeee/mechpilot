// Tool palette on the left: one button per tool with its command-line shortcut.

import { t } from '@shared/i18n';
import { READY_TOOLS, toolName, useStore, type ToolId } from '../state/store';

const TOOLS: { id: ToolId; key: string; icon: string }[] = [
  { id: 'select', key: 'Esc', icon: '↖' },
  { id: 'line', key: 'L', icon: '╱' },
  { id: 'polyline', key: 'PL', icon: '⌇' },
  { id: 'rect', key: 'REC', icon: '▭' },
  { id: 'circle', key: 'C', icon: '○' },
  { id: 'arc', key: 'A', icon: '◠' },
  { id: 'dimension', key: 'D', icon: '↔' },
  { id: 'text', key: 'T', icon: 'A' },
];

export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const cancel = useStore((s) => s.cancelTool);
  return (
    <aside className="tool-palette" aria-label={t('Tools')}>
      {TOOLS.map((tl) => {
        const ready = READY_TOOLS.has(tl.id);
        return (
          <button
            key={tl.id}
            className={`tool ${tool === tl.id ? 'on' : ''} ${ready ? '' : 'soon'}`}
            title={`${toolName(tl.id)} (${tl.key})${ready ? '' : ` · ${t('later milestone')}`}`}
            onClick={() => (tl.id === 'select' ? cancel() : setTool(tl.id))}
          >
            <span className="icon" aria-hidden="true">
              {tl.icon}
            </span>
            <span className="key">{tl.key}</span>
          </button>
        );
      })}
    </aside>
  );
}
