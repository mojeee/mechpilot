// Checks tab: the sketch solver's findings (conflicting, redundant constraints, degrees of
// freedom) with one-click fixes, and the list of constraints. The drawing checker (M7) adds
// its findings here.

import { t } from '@shared/i18n';
import type { Constraint } from '@shared/doc/types';
import { constraintEntities } from '@shared/commands';
import { CONSTRAINT_GLYPH } from '@shared/draw/constraints';
import { useStore } from '../state/store';

function describe(c: Constraint): string {
  const ents = constraintEntities(c).join(', ');
  switch (c.kind) {
    case 'distance':
      return `${t('Distance')} ${c.value} mm (${ents})`;
    case 'pointLineDistance':
      return `${t('Point–line distance')} ${c.value} mm (${ents})`;
    case 'angle':
      return `${t('Angle')} ${Number(((c.value * 180) / Math.PI).toPrecision(6))}° (${ents})`;
    case 'radius':
      return `${t('Radius')} ${c.value} mm (${ents})`;
    default:
      return `${c.kind} (${ents})`;
  }
}

export function ChecksPanel() {
  const s = useStore();
  const doc = s.editor.doc;
  const d = s.diagnosis;
  const remove = (ids: string[]) => s.run({ kind: 'deleteConstraints', ids });
  const highlight = (c: Constraint) => s.select(constraintEntities(c).filter((id) => doc.entities[id]));
  const group = (title: string, ids: string[], kind: 'err' | 'warn') =>
    ids.length ? (
      <div className="finding-group">
        <h3 className={kind}>{title}</h3>
        {ids.map((id) => {
          const c = doc.constraints[id];
          if (!c) return null;
          return (
            <div key={id} className="finding">
              <span className="glyph">{CONSTRAINT_GLYPH[c.kind]}</span>
              <button className="link" onClick={() => highlight(c)} title={t('Select the entities of this constraint')}>
                {describe(c)}
              </button>
              <button className="btn small" onClick={() => remove([id])}>
                {t('Remove')}
              </button>
            </div>
          );
        })}
      </div>
    ) : null;
  return (
    <div className="props">
      <h3>{t('Sketch')}</h3>
      {!d && doc.constraintOrder.length === 0 && <p className="dim">{t('No constraints yet. Use the constraint tools (CC, CH, CV, CPA, CPE, CT, CE, CS, CF, CD, CA, CR) or make a dimension driving in its properties.')}</p>}
      {d && (
        <p className={d.status === 'conflicting' || d.status === 'failed' ? 'err' : d.status === 'redundant' ? 'warn' : 'dim'}>
          {d.message}
        </p>
      )}
      {d && group(t('Conflicting constraints'), d.conflicting, 'err')}
      {d && group(t('Redundant constraints'), [...d.redundant, ...d.partiallyRedundant.filter((id) => !d.redundant.includes(id))], 'warn')}
      {d && d.skippedDimensions.length > 0 && (
        <p className="warn">
          {t('{n} driving dimensions could not be attached to geometry (their points do not lie on entity points):', { n: d.skippedDimensions.length })}{' '}
          <button className="link" onClick={() => s.select(d.skippedDimensions)}>
            {t('select them')}
          </button>
        </p>
      )}
      {doc.constraintOrder.length > 0 && (
        <>
          <div className="layers-head">
            <h3 style={{ margin: 0 }}>{t('{n} constraints', { n: doc.constraintOrder.length })}</h3>
            <button className="btn small" onClick={() => remove(doc.constraintOrder)}>
              {t('Remove all')}
            </button>
          </div>
          {doc.constraintOrder.map((id) => {
            const c = doc.constraints[id];
            return (
              <div key={id} className="finding">
                <span className="glyph">{CONSTRAINT_GLYPH[c.kind]}</span>
                <button className="link" onClick={() => highlight(c)}>
                  {describe(c)}
                </button>
                <button className="icon-btn" title={t('Remove')} onClick={() => remove([id])}>
                  ×
                </button>
              </div>
            );
          })}
        </>
      )}
      <p className="dim">{t('The drawing checker (M7) will add missing dimensions, unknown fits and empty title-block fields here.')}</p>
    </div>
  );
}
