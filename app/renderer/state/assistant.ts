// The assistant's slice of the store (product rule 7, honest AI). The conversation, the references
// the user dropped into the chat, the running request and the preview of a proposal. A proposal is
// never applied until the user accepts it; Accept runs its commands as ONE batch command through
// run(), so a single undo removes all of it (product rule 4). The preview is a dry run of the same
// commands with `apply` on the current document: nothing in the real document changes.

import type { StoreApi } from 'zustand';
import { apply } from '@shared/commands';
import type { Document, Id } from '@shared/doc/types';
import type { PartMesh } from '@shared/cad/protocol';
import type { AiProviderId, AiSettings, AssistantContext, ChatTurn, Proposal, Reference } from '@shared/ai/types';
import type { AppError, Result } from '@shared/api';
import { explain } from '@shared/sketch/model';
import { randomId } from '@shared/ids';
import { t } from '@shared/i18n';
import { kernelWorker } from '../workers';
import { entitiesLabel, proposalDiff, type ProposalDiff } from '../assistant/diff';
import type { Store } from './store';

export interface AssistantPreview {
  turnId: string;
  proposalId: string;
  /** The document the preview was computed on; the overlays show it only while it is still current. */
  base: Document;
  /** The active part when the preview was computed (the 3D overlay belongs to it). */
  activePart: Id | null;
  /** The document after the proposal's commands, or null when they do not apply any more. */
  doc: Document | null;
  error: string | null;
  diff: ProposalDiff | null;
  /** 3D: the active part rebuilt from the preview document, when the proposal changes it. */
  part: { partId: Id; building: boolean; mesh: PartMesh | null; error: string | null } | null;
}

export interface AssistantProgressState {
  text: string;
  tools: { name: string; summary: string }[];
}

export interface AssistantSlice {
  /** False when the preload exposes no `ai` API (an older build): the panel says so. */
  available: boolean;
  settings: AiSettings | null;
  turns: ChatTurn[];
  /** References waiting to go with the next message (chips above the input). */
  references: Reference[];
  busy: boolean;
  progress: AssistantProgressState;
  /** Provider and model of the last answer. */
  lastModel: { provider: AiProviderId; model: string } | null;
  preview: AssistantPreview | null;
  /** The card under the pointer or focus; otherwise the first pending card is previewed. */
  hoverProposal: { turnId: string; proposalId: string } | null;
  hoverReference: Reference | null;
  /** Why Accept failed, per proposal id. */
  failures: Record<string, string>;
  /** The Assistant tab is shown (previews and Alt+click picking are live only then). */
  panelOpen: boolean;
  /** Reference mode in the 3D viewer: a click adds the face, Shift+click the point. */
  pick3d: boolean;
  /** Bumped to show the Assistant tab and focus its input. */
  focusTick: number;

  loadAiSettings(): Promise<void>;
  setProvider(provider: AiProviderId): Promise<void>;
  setModel(model: string): Promise<void>;
  setKey(provider: AiProviderId, key: string): Promise<Result<AiSettings>>;
  clearKey(provider: AiProviderId): Promise<void>;
  testKey(provider: AiProviderId): Promise<Result<{ model: string }>>;
  addReference(ref: Reference): void;
  removeReference(index: number): void;
  /** Add the current 2D selection as an `entities` reference. */
  useSelection(): void;
  send(text: string): Promise<void>;
  acceptProposal(turnId: string, proposalId: string): void;
  rejectProposal(turnId: string, proposalId: string): void;
  previewProposal(turnId: string, proposalId: string | null): void;
  /** Pointer or focus on a card (null = left it). */
  hoverCard(turnId: string, proposalId: string | null): void;
  /** Recompute the preview for the current document and cards. */
  syncPreview(): void;
  setHoverReference(ref: Reference | null): void;
  clearChat(): void;
  cancel(): Promise<void>;
  setPanelOpen(open: boolean): void;
  togglePick3d(): void;
  /** Show the Assistant tab and focus the input. */
  focus(): void;
}

type Set = StoreApi<Store>['setState'];
type Get = StoreApi<Store>['getState'];

const ai = () => (typeof window !== 'undefined' ? window.mechpilot?.ai : undefined);
const now = () => new Date().toISOString();
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Ids of the running request and the running 3D preview build; older results are dropped. */
let requestSeq = 0;
let buildSeq = 0;

export function findProposal(turns: ChatTurn[], turnId: string, proposalId: string): Proposal | null {
  return turns.find((x) => x.id === turnId)?.proposals?.find((p) => p.id === proposalId) ?? null;
}

/** The first pending card in the conversation (the one previewed when nothing is hovered). */
export function firstPending(turns: ChatTurn[]): { turnId: string; proposalId: string } | null {
  for (const turn of turns) for (const p of turn.proposals ?? []) if (p.state === 'pending') return { turnId: turn.id, proposalId: p.id };
  return null;
}

/** Entity ids a reference points at in 2D (for the highlight when its chip is hovered). */
export function referenceEntities(doc: Document, ref: Reference | null): Id[] {
  if (!ref) return [];
  if (ref.kind === 'entities') return ref.ids.filter((id) => doc.entities[id]);
  const part = ref.kind === 'part' || ref.kind === 'feature' ? doc.parts[ref.partId] : null;
  if (!part) return [];
  // A part highlights all its sketches; a feature its own sketch, or the sketch it uses (extrude, hole…).
  const sketchIds = new Set<Id>();
  if (ref.kind === 'part') for (const f of part.features) if (f.kind === 'sketch') sketchIds.add(f.id);
  if (ref.kind === 'feature') {
    const f = part.features.find((x) => x.id === ref.featureId);
    if (f?.kind === 'sketch') sketchIds.add(f.id);
    else if (f && 'sketch' in f) sketchIds.add(f.sketch);
  }
  return part.features.flatMap((f) => (f.kind === 'sketch' && sketchIds.has(f.id) ? f.entities : [])).filter((id) => doc.entities[id]);
}

export function createAssistant(set: Set, get: Get): AssistantSlice {
  const a = () => get().assistant;
  const patch = (p: Partial<AssistantSlice>) => set((s) => ({ assistant: { ...s.assistant, ...p } }));
  const pushTurn = (turn: ChatTurn) => patch({ turns: [...a().turns, turn] });
  const errorTurn = (error: AppError): ChatTurn => ({ id: randomId(), role: 'assistant', text: '', error, at: now() });
  const setProposalState = (turnId: string, proposalId: string, state: Proposal['state']) =>
    patch({ turns: a().turns.map((x) => (x.id !== turnId ? x : { ...x, proposals: x.proposals?.map((p) => (p.id === proposalId ? { ...p, state } : p)) })) });

  const context = (): AssistantContext => {
    const s = get();
    const doc = s.editor.doc;
    let build: AssistantContext['build'] = null;
    if (s.activePart && s.build) {
      const { mesh: _mesh, ...rest } = s.build;
      void _mesh;
      build = rest;
    }
    return {
      doc,
      selection: s.selection,
      activePart: s.activePart,
      activeSheet: s.activeSheet,
      build,
      sketch: s.diagnosis ? { status: s.diagnosis.status, dof: s.diagnosis.dof, message: explain(doc, s.diagnosis, t) } : null,
      lang: s.settings.lang,
    };
  };

  return {
    available: true,
    settings: null,
    turns: [],
    references: [],
    busy: false,
    progress: { text: '', tools: [] },
    lastModel: null,
    preview: null,
    hoverProposal: null,
    hoverReference: null,
    failures: {},
    panelOpen: false,
    pick3d: false,
    focusTick: 0,

    async loadAiSettings() {
      const api = ai();
      if (!api) {
        patch({ available: false, settings: null });
        return;
      }
      try {
        patch({ available: true, settings: await api.settings() });
      } catch {
        patch({ available: false, settings: null });
      }
    },
    async setProvider(provider) {
      const api = ai();
      if (!api) return;
      patch({ settings: await api.setSettings({ provider }) });
    },
    async setModel(model) {
      const api = ai();
      if (!api || !model.trim()) return;
      patch({ settings: await api.setSettings({ model: model.trim() }) });
    },
    async setKey(provider, key) {
      const api = ai();
      if (!api) return { ok: false, error: { code: 'unavailable', message: t('The assistant is not available in this build.') } };
      const r = await api.setKey(provider, key.trim());
      if (r.ok) patch({ settings: r.value });
      return r;
    },
    async clearKey(provider) {
      const api = ai();
      if (!api) return;
      patch({ settings: await api.clearKey(provider) });
    },
    async testKey(provider) {
      const api = ai();
      if (!api) return { ok: false, error: { code: 'unavailable', message: t('The assistant is not available in this build.') } };
      try {
        return await api.testKey(provider);
      } catch (e) {
        return { ok: false, error: { code: 'exception', message: errorText(e) } };
      }
    },

    addReference(ref) {
      const refs = a().references;
      // The same face, part, feature or set of entities only once.
      const key = (r: Reference) => JSON.stringify({ ...r, label: '' });
      if (refs.some((r) => key(r) === key(ref))) return;
      patch({ references: [...refs, ref] });
      get().say({ kind: 'info', text: t('Added to the chat: {label}', { label: ref.label }) });
    },
    removeReference(index) {
      const refs = a().references;
      const gone = refs[index];
      patch({ references: refs.filter((_, i) => i !== index), hoverReference: gone && a().hoverReference === gone ? null : a().hoverReference });
    },
    useSelection() {
      const s = get();
      const ids = s.selection.filter((id) => s.editor.doc.entities[id]);
      if (ids.length === 0) {
        s.say({ kind: 'info', text: t('Select something in the drawing first.') });
        return;
      }
      a().addReference({ kind: 'entities', ids, label: entitiesLabel(ids.map((id) => s.editor.doc.entities[id])) });
    },

    async send(raw) {
      const text = raw.trim();
      const st = a();
      if (st.busy || (!text && st.references.length === 0)) return;
      const user: ChatTurn = { id: randomId(), role: 'user', text, at: now(), ...(st.references.length ? { references: st.references } : {}) };
      patch({ turns: [...st.turns, user], references: [], hoverReference: null, busy: true, progress: { text: '', tools: [] } });
      const api = ai();
      if (!api) {
        pushTurn(errorTurn({ code: 'unavailable', message: t('The assistant is not available in this build.'), hint: t('The rest of MechPilot works without it.') }));
        patch({ busy: false, available: false });
        return;
      }
      const seq = ++requestSeq;
      let off: () => void = () => {};
      try {
        off = api.onProgress((e) => {
          if (seq !== requestSeq) return;
          const p = a().progress;
          if (e.kind === 'text') patch({ progress: { ...p, text: p.text + e.text } });
          else if (e.kind === 'tool') patch({ progress: { ...p, tools: [...p.tools, { name: e.name, summary: e.summary }] } });
        });
      } catch {
        // Progress is a nicety; the answer still comes back from chat().
      }
      try {
        const r = await api.chat({ turns: a().turns, context: context() });
        if (seq !== requestSeq) return;
        if (r.ok) {
          const reply = r.value;
          const proposals = (reply.proposals ?? []).map((p) => ({ ...p, id: p.id || randomId(), state: 'pending' as const, claims: p.claims ?? [], touches: p.touches ?? { entities: [], parts: [] } }));
          pushTurn({ id: randomId(), role: 'assistant', text: reply.text ?? '', proposals, claims: reply.claims ?? [], toolLog: reply.toolLog ?? [], at: now() });
          patch({ lastModel: reply.model ?? null });
        } else pushTurn(errorTurn(r.error));
      } catch (e) {
        if (seq !== requestSeq) return;
        pushTurn(errorTurn({ code: 'exception', message: t('The assistant did not answer: {reason}', { reason: errorText(e) }) }));
      } finally {
        off();
        if (seq === requestSeq) patch({ busy: false, progress: { text: '', tools: [] } });
      }
      a().syncPreview();
    },

    acceptProposal(turnId, proposalId) {
      const p = findProposal(a().turns, turnId, proposalId);
      if (!p || p.state !== 'pending') return;
      const s = get();
      const ok = s.run({ kind: 'batch', label: p.title, commands: p.commands });
      if (!ok) {
        const m = get().message;
        patch({ failures: { ...a().failures, [proposalId]: m?.text ?? t('The change could not be applied.') } });
        return;
      }
      const { [proposalId]: _gone, ...failures } = a().failures;
      void _gone;
      setProposalState(turnId, proposalId, 'accepted');
      patch({ failures, hoverProposal: null });
      get().say({ kind: 'info', text: t('Accepted “{title}”. U undoes it in one step.', { title: p.title }) });
      const then = p.then;
      if (then?.kind === 'exportPdf') void get().exportPdf();
      else if (then?.kind === 'openPart' && get().editor.doc.parts[then.partId]) get().setActivePart(then.partId);
      else if (then?.kind === 'openSheet' && get().editor.doc.sheets[then.sheetId]) get().setActiveSheet(then.sheetId);
      a().syncPreview();
    },
    rejectProposal(turnId, proposalId) {
      const p = findProposal(a().turns, turnId, proposalId);
      if (!p || p.state !== 'pending') return;
      setProposalState(turnId, proposalId, 'rejected');
      patch({ hoverProposal: null });
      a().syncPreview();
    },

    previewProposal(turnId, proposalId) {
      const seq = ++buildSeq;
      const p = proposalId ? findProposal(a().turns, turnId, proposalId) : null;
      if (!p || p.state !== 'pending') {
        if (a().preview) patch({ preview: null });
        return;
      }
      const s = get();
      const base = s.editor.doc;
      const r = apply(base, { kind: 'batch', label: p.title, commands: p.commands });
      if (!r.ok) {
        patch({ preview: { turnId, proposalId: p.id, base, activePart: s.activePart, doc: null, error: r.error.message, diff: null, part: null } });
        return;
      }
      const next = r.doc;
      const diff = proposalDiff(base, next, p.touches.entities);
      const partId = s.activePart;
      let part: AssistantPreview['part'] = null;
      if (partId && next.parts[partId] && (diff.parts.includes(partId) || p.touches.parts.includes(partId))) {
        part = { partId, building: true, mesh: null, error: null };
        kernelWorker()
          .call('build', { doc: next, partId, lang: s.settings.lang }, 120_000)
          .then((b) => {
            const cur = a().preview;
            if (seq !== buildSeq || !cur) return;
            patch({ preview: { ...cur, part: { partId, building: false, mesh: b.mesh, error: b.errors[0]?.message ?? null } } });
          })
          .catch((e: unknown) => {
            const cur = a().preview;
            if (seq !== buildSeq || !cur) return;
            patch({ preview: { ...cur, part: { partId, building: false, mesh: null, error: errorText(e) } } });
          });
      }
      patch({ preview: { turnId, proposalId: p.id, base, activePart: partId, doc: next, error: null, diff, part } });
    },
    hoverCard(turnId, proposalId) {
      patch({ hoverProposal: proposalId ? { turnId, proposalId } : null });
      a().syncPreview();
    },
    syncPreview() {
      const st = a();
      if (!st.panelOpen) {
        if (st.preview) a().previewProposal('', null);
        return;
      }
      const hovered = st.hoverProposal && findProposal(st.turns, st.hoverProposal.turnId, st.hoverProposal.proposalId)?.state === 'pending' ? st.hoverProposal : null;
      const target = hovered ?? firstPending(st.turns);
      const cur = st.preview;
      if (!target) {
        if (cur) a().previewProposal('', null);
        return;
      }
      // Same card on the same document and the same active part: keep it.
      if (cur && cur.turnId === target.turnId && cur.proposalId === target.proposalId && cur.base === get().editor.doc && cur.activePart === get().activePart) return;
      a().previewProposal(target.turnId, target.proposalId);
    },
    setHoverReference(ref) {
      if (a().hoverReference !== ref) patch({ hoverReference: ref });
    },
    clearChat() {
      if (a().busy) void a().cancel();
      buildSeq++;
      patch({ turns: [], references: [], preview: null, hoverProposal: null, hoverReference: null, failures: {}, progress: { text: '', tools: [] } });
    },
    async cancel() {
      if (!a().busy) return;
      requestSeq++;
      patch({ busy: false, progress: { text: '', tools: [] } });
      pushTurn(errorTurn({ code: 'cancelled', message: t('Stopped. Nothing was changed.') }));
      try {
        await ai()?.cancel();
      } catch {
        // The request is already dropped on this side.
      }
    },
    setPanelOpen(open) {
      if (a().panelOpen === open) return;
      patch({ panelOpen: open });
      if (open && a().settings === null) void a().loadAiSettings();
      a().syncPreview();
    },
    togglePick3d() {
      patch({ pick3d: !a().pick3d });
    },
    focus() {
      patch({ focusTick: a().focusTick + 1 });
    },
  };
}
