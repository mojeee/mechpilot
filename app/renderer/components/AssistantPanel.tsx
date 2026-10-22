// Assistant tab (M7, product rule 7: honest AI). The user designs by writing, drops references into
// the chat (the 2D selection, a part, a feature, a face or a point picked in 3D) and gets proposals:
// ordinary commands shown as a preview (a ghost on the drawing, a translucent body in 3D) that the
// user accepts (one undo step) or rejects. Every claim shows where it comes from. The provider,
// model and key live in the main process; the renderer only learns whether a key exists.

import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@shared/i18n';
import { apply } from '@shared/commands';
import { PROVIDER_INFO, type AiProviderId, type AiSettings, type Claim, type ChatTurn, type Proposal, type Reference } from '@shared/ai/types';
import { useStore } from '../state/store';
import { entityDiffLine, proposalDiff } from '../assistant/diff';
import { Markdown } from '../assistant/Markdown';

const PROVIDERS = Object.keys(PROVIDER_INFO) as AiProviderId[];

/** Where a stored key came from, when the main process says so (an optional field beyond the contract). */
type KeySource = 'stored' | 'env' | null;
function keySource(settings: AiSettings, provider: AiProviderId): KeySource {
  const extra = (settings as AiSettings & { keySource?: Partial<Record<AiProviderId, KeySource>> }).keySource;
  if (!settings.hasKey[provider]) return null;
  return extra?.[provider] === 'env' ? 'env' : 'stored';
}

const REF_GLYPH: Record<Reference['kind'], string> = { entities: '⌗', part: '◆', feature: 'ƒ', face: '▣', point: '•' };

function Chip({ r, onRemove }: { r: Reference; onRemove?: () => void }) {
  const setHover = useStore((s) => s.assistant.setHoverReference);
  return (
    <span className={`ai-chip ${r.kind}`} onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)} title={r.label}>
      <span className="glyph" aria-hidden>
        {REF_GLYPH[r.kind]}
      </span>
      <span className="label">{r.label}</span>
      {onRemove && (
        <button
          className="x"
          aria-label={t('Remove {label}', { label: r.label })}
          onClick={() => {
            setHover(null);
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

function sourceText(c: Claim): string {
  const s = c.source;
  switch (s.kind) {
    case 'measured':
      return t('measured');
    case 'standard':
      return s.clause ? `${s.standard} ${/^\d/.test(s.clause) ? '§' : ''}${s.clause}` : s.standard;
    case 'library':
      return t('library: {entry}', { entry: `${s.file.replace(/^library\//, '').replace(/\.json$/, '')} ${s.entry}`.trim() });
    case 'suggestion':
      return t('suggestion');
  }
}

function Claims({ claims }: { claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <ul className="ai-claims">
      {claims.map((c, i) => (
        <li key={i}>
          <span className={`ai-source ${c.source.kind}`} title={c.source.kind === 'measured' ? c.source.what : undefined}>
            {sourceText(c)}
          </span>{' '}
          {c.text}
        </li>
      ))}
    </ul>
  );
}

/** "Looked at: model, measure ×2". */
function ToolLog({ log, running }: { log: { name: string; summary: string }[]; running?: boolean }) {
  if (!log.length) return null;
  const counts = new Map<string, number>();
  for (const l of log) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  const text = [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ');
  return (
    <div className="ai-toollog dim" title={log.map((l) => `${l.name}: ${l.summary}`).join('\n')}>
      {running ? t('Looking at: {what}', { what: text }) : t('Looked at: {what}', { what: text })}
    </div>
  );
}

function stateLabel(state: Proposal['state']): string {
  return state === 'accepted' ? t('Accepted') : state === 'rejected' ? t('Rejected') : t('Pending');
}

function ProposalCard({ turnId, p }: { turnId: string; p: Proposal }) {
  const doc = useStore((s) => s.editor.doc);
  const as = useStore((s) => s.assistant);
  const previewed = as.preview?.turnId === turnId && as.preview.proposalId === p.id;
  const failure = as.failures[p.id];
  // The diff of a pending card on the current document (the previewed card reuses the preview's).
  const computed = useMemo(() => {
    if (p.state !== 'pending') return null;
    if (previewed && as.preview?.base === doc) return { next: as.preview.doc, diff: as.preview.diff, error: as.preview.error };
    const r = apply(doc, { kind: 'batch', label: p.title, commands: p.commands });
    if (!r.ok) return { next: null, diff: null, error: r.error.message };
    return { next: r.doc, diff: proposalDiff(doc, r.doc, p.touches.entities), error: null };
  }, [doc, p, previewed, as.preview]);
  const lines = computed?.diff && computed.next ? entityDiffLine(computed.diff, computed.next, doc) : [];
  const then = p.then;
  const thenText = !then ? null : then.kind === 'exportPdf' ? t('Then it exports the PDF.') : then.kind === 'openPart' ? t('Then it opens the part {name}.', { name: doc.parts[then.partId]?.name ?? '' }) : t('Then it shows the sheet {name}.', { name: doc.sheets[then.sheetId]?.name ?? '' });
  return (
    <div
      className={`ai-proposal ${p.state} ${previewed ? 'previewed' : ''}`}
      tabIndex={0}
      data-proposal={p.id}
      onMouseEnter={() => as.hoverCard(turnId, p.id)}
      onMouseLeave={() => as.hoverCard(turnId, null)}
      onFocus={() => as.hoverCard(turnId, p.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) as.hoverCard(turnId, null);
      }}
    >
      <div className="ai-proposal-head">
        <strong>{p.title}</strong>
        <span className={`ai-state ${p.state}`}>{stateLabel(p.state)}</span>
      </div>
      {p.summary && <p className="ai-summary">{p.summary}</p>}
      {computed && (lines.length > 0 || (computed.diff?.features.length ?? 0) > 0) && (
        <ul className="ai-diff mono">
          {lines.map((l, i) => (
            <li key={i} className={l.startsWith('+') ? 'add' : l.startsWith('−') ? 'del' : 'chg'}>
              {l}
            </li>
          ))}
          {computed.diff?.features.map((f, i) => (
            <li key={`f${i}`} className={f.kind === 'added' ? 'add' : f.kind === 'deleted' ? 'del' : 'chg'}>
              {f.kind === 'added' ? '+' : f.kind === 'deleted' ? '−' : '~'} {f.partName}: {f.text}
            </li>
          ))}
        </ul>
      )}
      {computed && !computed.error && lines.length === 0 && (computed.diff?.features.length ?? 0) === 0 && <p className="dim small">{t('No visible change to the drawing.')}</p>}
      <Claims claims={p.claims} />
      {thenText && <p className="dim small">{thenText}</p>}
      {computed?.error && <p className="ai-error-line">{t('This proposal no longer applies: {reason}', { reason: computed.error })}</p>}
      {failure && <p className="ai-error-line">{failure}</p>}
      {p.state === 'pending' && (
        <div className="ai-actions">
          <button className="btn small primary" onClick={() => as.acceptProposal(turnId, p.id)} disabled={!!computed?.error}>
            {t('Accept')}
          </button>
          <button className="btn small" onClick={() => as.rejectProposal(turnId, p.id)}>
            {t('Reject')}
          </button>
          {previewed && <span className="dim small">{t('Shown as a preview')}</span>}
        </div>
      )}
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="ai-turn user">
        {turn.references?.length ? (
          <div className="ai-chips">
            {turn.references.map((r, i) => (
              <Chip key={i} r={r} />
            ))}
          </div>
        ) : null}
        {turn.text && (
          <div className="ai-text">
            <Markdown text={turn.text} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`ai-turn assistant ${turn.error ? 'failed' : ''}`}>
      {turn.toolLog && <ToolLog log={turn.toolLog} />}
      {turn.text && (
          <div className="ai-text">
            <Markdown text={turn.text} />
          </div>
        )}
      {turn.error && (
        <div className="ai-error" role="alert">
          <div>{turn.error.message}</div>
          {turn.error.hint && <div className="dim small">{turn.error.hint}</div>}
        </div>
      )}
      <Claims claims={turn.claims ?? []} />
      {turn.proposals?.map((p) => (
        <ProposalCard key={p.id} turnId={turn.id} p={p} />
      ))}
    </div>
  );
}

function SettingsBox() {
  const as = useStore((s) => s.assistant);
  const settings = as.settings;
  const [open, setOpen] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => setModel(settings?.model ?? ''), [settings?.model]);
  if (!settings) return null;
  const provider = settings.provider;
  const info = PROVIDER_INFO[provider];
  const src = keySource(settings, provider);
  const expanded = open ?? !src;
  const status = src === 'env' ? t('Key from environment') : src === 'stored' ? t('Key stored') : t('No key');
  const saveKey = async () => {
    if (!key.trim()) return;
    const r = await as.setKey(provider, key);
    setKey('');
    setNote(r.ok ? { kind: 'ok', text: t('Key stored') } : { kind: 'err', text: r.error.message + (r.error.hint ? ` ${r.error.hint}` : '') });
  };
  const test = async () => {
    setTesting(true);
    setNote(null);
    const r = await as.testKey(provider);
    setTesting(false);
    setNote(r.ok ? { kind: 'ok', text: t('The key works ({model}).', { model: r.value.model }) } : { kind: 'err', text: r.error.message + (r.error.hint ? ` ${r.error.hint}` : '') });
  };
  return (
    <div className={`ai-settings ${expanded ? 'open' : ''}`}>
      <div className="ai-settings-line">
        <button className="link" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
          {expanded ? '▾' : '▸'} {info.name} · <span className="mono">{settings.model}</span>
        </button>
        <span className={`ai-key ${src ? 'ok' : 'none'}`}>{status}</span>
      </div>
      {expanded && (
        <div className="ai-settings-body">
          <label className="field">
            <span>{t('Provider')}</span>
            <select value={provider} onChange={(e) => void as.setProvider(e.target.value as AiProviderId)}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_INFO[p].name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('Model')}</span>
            <input
              className="mono"
              list="ai-models"
              value={model}
              spellCheck={false}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => model !== settings.model && void as.setModel(model)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <datalist id="ai-models">
              {info.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>{t('API key')}</span>
            <input
              type="password"
              value={key}
              placeholder={src ? t('Replace the key') : t('Paste your key')}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveKey();
              }}
            />
          </label>
          <div className="ai-settings-actions">
            <button className="btn small primary" disabled={!key.trim()} onClick={() => void saveKey()}>
              {t('Store key')}
            </button>
            <button className="btn small" disabled={!src || testing} onClick={() => void test()}>
              {testing ? t('Testing…') : t('Test')}
            </button>
            <button className="btn small" disabled={src !== 'stored'} onClick={() => void as.clearKey(provider).then(() => setNote(null))}>
              {t('Remove')}
            </button>
            <button className="link small" onClick={() => void window.mechpilot?.app.openExternal(info.keyHelp)}>
              {t('Get a key')}
            </button>
          </div>
          {note && <p className={note.kind === 'ok' ? 'ok small' : 'ai-error-line'}>{note.text}</p>}
          <p className="dim small">{t('The key is stored encrypted on this computer and is only sent to {provider}. The drawing goes with every message.', { provider: info.name })}</p>
        </div>
      )}
    </div>
  );
}

/** The last handled focus request: a fresh mount only focuses the input when it was asked to. */
let handledFocus = 0;

export function AssistantPanel() {
  const as = useStore((s) => s.assistant);
  const selection = useStore((s) => s.selection);
  const activeSheet = useStore((s) => s.activeSheet);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Previews and Alt+click picking are live while this tab is shown.
  useEffect(() => {
    useStore.getState().assistant.setPanelOpen(true);
    return () => useStore.getState().assistant.setPanelOpen(false);
  }, []);
  useEffect(() => {
    if (as.focusTick !== handledFocus) {
      handledFocus = as.focusTick;
      inputRef.current?.focus();
    }
  }, [as.focusTick]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [as.turns.length, as.busy, as.progress.text, as.progress.tools.length]);

  const send = () => {
    if (as.busy) return;
    const v = text;
    if (!v.trim() && as.references.length === 0) return;
    setText('');
    void as.send(v);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && text) {
      // Esc clears the input first; a second Esc leaves it (the global handler).
      e.preventDefault();
      e.stopPropagation();
      setText('');
    }
  };

  const noKey = as.settings !== null && !as.settings.hasKey[as.settings.provider];
  return (
    <div className="assistant">
      {!as.available ? (
        <div className="ai-unavailable">
          <p>{t('The assistant is not available in this build.')}</p>
          <p className="dim small">{t('The rest of MechPilot works without it.')}</p>
        </div>
      ) : (
        <SettingsBox />
      )}
      <div className="ai-log" aria-live="polite">
        {as.turns.length === 0 && !as.busy && (
          <div className="ai-empty">
            <p>{t('Describe a part, for example: a 120 × 80 plate, 10 thick, four M6 clearance holes on a 100 × 60 pattern, R10 corners.')}</p>
            <p className="dim small">{t('Point at things to talk about them: “Use selection” adds the selected entities, “→” in the Features tab adds a part or a feature, and Alt+click in 3D adds a face (Shift+Alt+click a point).')}</p>
            <p className="dim small">{t('Every change comes as a proposal with a preview. Nothing changes until you accept it, and U undoes it.')}</p>
            {noKey && <p className="warn small">{t('Add a key for {provider} above to start.', { provider: PROVIDER_INFO[as.settings!.provider].name })}</p>}
          </div>
        )}
        {as.turns.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
        {as.busy && (
          <div className="ai-turn assistant busy">
            <ToolLog log={as.progress.tools} running />
            <div className="ai-text">{as.progress.text ? <Markdown text={as.progress.text} /> : <span className="dim">{t('Thinking…')}</span>}</div>
            <button className="btn small" onClick={() => void as.cancel()}>
              {t('Cancel')}
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="ai-composer">
        {as.references.length > 0 && (
          <div className="ai-chips">
            {as.references.map((r, i) => (
              <Chip key={i} r={r} onRemove={() => as.removeReference(i)} />
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="ai-input"
          rows={3}
          value={text}
          placeholder={t('Ask for a change or a check… (Enter sends, Shift+Enter new line)')}
          aria-label={t('Message to the assistant')}
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="ai-composer-actions">
          <button className="btn small" disabled={selection.length === 0 || !!activeSheet} onClick={as.useSelection} title={t('Add the selected entities to the message')}>
            {t('Use selection')}
          </button>
          {as.turns.length > 0 && (
            <button className="btn small" onClick={as.clearChat} title={t('Start a new conversation')}>
              {t('Clear')}
            </button>
          )}
          <span className="grow" />
          <button className="btn small primary" disabled={as.busy || !as.available || (!text.trim() && as.references.length === 0)} onClick={send}>
            {t('Send')}
          </button>
        </div>
      </div>
    </div>
  );
}
