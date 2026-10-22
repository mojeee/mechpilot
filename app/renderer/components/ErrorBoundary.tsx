// A boundary around views that can fail at start-up for reasons outside the document, such as
// the 3D viewer when WebGL is not available (product rule 5: say what happened in plain words,
// keep the rest of the app usable).

import { Component, type ReactNode } from 'react';
import { t } from '@shared/i18n';

interface Props {
  /** What the view is called in the message, e.g. "The 3D view". */
  what: string;
  children: ReactNode;
}

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="view-error" role="alert">
        <p>{t('{what} could not start: {reason}', { what: this.props.what, reason: this.state.error })}</p>
        <p className="dim">{t('The rest of MechPilot keeps working: the part still builds, the Features tab and the exports still work.')}</p>
        <button className="btn small" onClick={() => this.setState({ error: null })}>
          {t('Try again')}
        </button>
      </div>
    );
  }
}
