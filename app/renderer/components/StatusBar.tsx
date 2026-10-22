// Status bar: cursor in mm, zoom, grid and snap toggles, entity count, worker status.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import { useStore } from '../state/store';
import { smokeWorker } from '../workers';

export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const view = useStore((s) => s.view);
  const gridOn = useStore((s) => s.gridOn);
  const snapGrid = useStore((s) => s.snapGrid);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleSnap = useStore((s) => s.toggleSnapGrid);
  const osnap = useStore((s) => s.snaps.end);
  const polar = useStore((s) => s.snaps.polar);
  const setSnaps = useStore((s) => s.setSnaps);
  const toggleOsnap = () => {
    const on = !osnap;
    setSnaps({ end: on, mid: on, center: on, quadrant: on, intersection: on, perpendicular: on, tangent: on });
  };
  const togglePolar = () => setSnaps({ polar: !polar });
  const gridStep = useStore((s) => s.gridStep());
  const count = useStore((s) => s.editor.doc.entityOrder.length);
  const selected = useStore((s) => s.selection.length);
  const diagnosis = useStore((s) => s.diagnosis);
  const solving = useStore((s) => s.solving);
  const [worker, setWorker] = useState<'checking' | 'ok' | 'failed'>('checking');
  useEffect(() => {
    smokeWorker()
      .call('ping', { n: 1 }, 10_000)
      .then((r) => setWorker(r.pong ? 'ok' : 'failed'))
      .catch(() => setWorker('failed'));
  }, []);
  const fmt = (v: number) => v.toFixed(3);
  return (
    <footer className="statusbar">
      <span className="mono coords">{cursor ? `X ${fmt(cursor.x)}  Y ${fmt(cursor.y)} mm` : t('X —  Y — mm')}</span>
      <span className="mono">{t('Zoom {pct}%', { pct: Math.round(view.scale * 100) / 100 === 0 ? 0 : (view.scale * 100).toFixed(view.scale < 0.1 ? 2 : 0) })}</span>
      <button className={`toggle ${gridOn ? 'on' : ''}`} onClick={toggleGrid} title={t('Grid (F7 later): minor step {step} mm', { step: gridStep })}>
        {t('Grid')} <span className="mono">{gridStep}</span>
      </button>
      <button className={`toggle ${snapGrid ? 'on' : ''}`} onClick={toggleSnap} title={t('Snap the cursor to the grid')}>
        {t('Snap')}
      </button>
      <button className={`toggle ${osnap ? 'on' : ''}`} onClick={toggleOsnap} title={t('Object snaps: end, mid, centre, quadrant, intersection, perpendicular, tangent (OSNAP)')}>
        {t('Osnap')}
      </button>
      <button className={`toggle ${polar ? 'on' : ''}`} onClick={togglePolar} title={t('Polar tracking every 15°')}>
        {t('Polar')}
      </button>
      <span className="grow" />
      {diagnosis && (
        <span className={`dof ${diagnosis.status}`} title={t('Sketch constraints: degrees of freedom left, conflicts and redundancies (see the Checks tab)')}>
          {diagnosis.status === 'conflicting' ? t('Over-constrained') : diagnosis.status === 'redundant' ? t('Redundant constraints') : diagnosis.status === 'failed' ? t('Solver failed') : diagnosis.dof === 0 ? t('Fully constrained') : t('DOF {n}', { n: diagnosis.dof })}
          {solving ? ' …' : ''}
        </span>
      )}
      <span className="dim">{selected ? t('{n} of {total} selected', { n: selected, total: count }) : t('{n} entities', { n: count })}</span>
      <span className={`worker ${worker}`} title={t('Background worker (solver and kernel run here, never on the UI thread)')}>
        {worker === 'ok' ? t('Worker ready') : worker === 'failed' ? t('Worker failed') : t('Worker…')}
      </span>
    </footer>
  );
}
