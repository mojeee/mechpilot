// Tool palette on the left: draw tools, then edit tools, each with its command-line alias.

import { t } from '@shared/i18n';
import { toolName, useStore, type ToolId } from '../state/store';

const DRAW: { id: ToolId; key: string; icon: string }[] = [
  { id: 'select', key: 'Esc', icon: '↖' },
  { id: 'line', key: 'L', icon: '╱' },
  { id: 'polyline', key: 'PL', icon: '⌇' },
  { id: 'rect', key: 'REC', icon: '▭' },
  { id: 'circle', key: 'C', icon: '○' },
  { id: 'arc', key: 'A', icon: '◠' },
  { id: 'ellipse', key: 'EL', icon: '⬭' },
  { id: 'spline', key: 'SPL', icon: '∿' },
  { id: 'text', key: 'T', icon: 'A' },
];
const EDIT: { id: ToolId; key: string; icon: string }[] = [
  { id: 'move', key: 'M', icon: '✥' },
  { id: 'copy', key: 'CO', icon: '⧉' },
  { id: 'rotate', key: 'RO', icon: '↻' },
  { id: 'scale', key: 'SC', icon: '⤢' },
  { id: 'mirror', key: 'MI', icon: '⇔' },
  { id: 'offset', key: 'O', icon: '≡' },
  { id: 'trim', key: 'TR', icon: '✂' },
  { id: 'extend', key: 'EX', icon: '⟶' },
  { id: 'fillet', key: 'F', icon: '◞' },
  { id: 'chamfer', key: 'CHA', icon: '◣' },
  { id: 'array', key: 'AR', icon: '⁞⁞' },
];
const ANNOTATE: { id: ToolId; key: string; icon: string }[] = [
  { id: 'dim-linear', key: 'DLI', icon: '⟷' },
  { id: 'dim-aligned', key: 'DAL', icon: '⤡' },
  { id: 'dim-angular', key: 'DAN', icon: '∡' },
  { id: 'dim-radius', key: 'DRA', icon: 'R' },
  { id: 'dim-diameter', key: 'DDI', icon: 'Ø' },
  { id: 'dim-ordinate', key: 'DOR', icon: '⊢' },
  { id: 'note', key: 'LE', icon: '⤷' },
  { id: 'balloon', key: 'BAL', icon: '①' },
  { id: 'surface', key: 'SURF', icon: '√' },
  { id: 'gdt', key: 'TOL', icon: '⊞' },
  { id: 'datum', key: 'DAT', icon: '▲' },
];

export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const cancel = useStore((s) => s.cancelTool);
  const button = (tl: { id: ToolId; key: string; icon: string }) => (
    <button key={tl.id} className={`tool ${tool === tl.id ? 'on' : ''}`} title={`${toolName(tl.id)} (${tl.key})`} onClick={() => (tl.id === 'select' ? cancel() : setTool(tl.id))}>
      <span className="icon" aria-hidden="true">
        {tl.icon}
      </span>
      <span className="key">{tl.key}</span>
    </button>
  );
  return (
    <aside className="tool-palette" aria-label={t('Tools')}>
      {DRAW.map(button)}
      <div className="palette-sep" />
      {EDIT.map(button)}
      <div className="palette-sep" />
      {ANNOTATE.map(button)}
    </aside>
  );
}
