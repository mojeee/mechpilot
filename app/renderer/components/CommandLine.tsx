// The command line (product rule 9): the prompt of the current tool, the last message, a history
// with the arrow keys.

import { useRef, useState } from 'react';
import { t } from '@shared/i18n';
import { useStore } from '../state/store';

export function CommandLine() {
  const prompt = useStore((s) => s.prompt());
  const message = useStore((s) => s.message);
  const run = useStore((s) => s.runCommandLine);
  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const pos = useRef(-1);

  const submit = () => {
    const v = text;
    if (v.trim()) {
      history.current.unshift(v);
      history.current.splice(50);
    }
    pos.current = -1;
    setText('');
    run(v);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      pos.current = Math.min(pos.current + 1, history.current.length - 1);
      setText(history.current[pos.current] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      pos.current = Math.max(pos.current - 1, -1);
      setText(pos.current === -1 ? '' : (history.current[pos.current] ?? ''));
    }
  };
  return (
    <div className="command-line">
      <div className={`cl-message ${message?.kind ?? ''}`} role="status">
        {message ? (
          <>
            <span>{message.text}</span>
            {message.hint && <span className="hint"> {message.hint}</span>}
          </>
        ) : (
          <span className="dim">{t('Ready.')}</span>
        )}
      </div>
      <div className="cl-row">
        <span className="cl-prompt">{prompt}</span>
        <input className="mono" value={text} placeholder=">" aria-label={t('Command')} spellCheck={false} autoComplete="off" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      </div>
    </div>
  );
}
