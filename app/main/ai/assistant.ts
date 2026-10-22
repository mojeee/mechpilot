// One assistant turn (product rule 7, honest AI): the model reads the snapshot through tools,
// answers in words and changes things only through validated proposals. Runs in the main
// process: at most MAX_TOOL_ROUNDS tool rounds, an overall time limit, cancellable.

import type { Result } from '@shared/api';
import type { AiProviderId, AssistantContext, AssistantProgress, AssistantReply, AssistantRequest, ChatTurn, Claim, Proposal, Reference } from '@shared/ai/types';
import { assistantTurnText, contextText, systemPrompt, userTurnText } from '@shared/ai/prompt';
import { validateProposal } from '@shared/ai/proposal';
import { runReadTool, TOOL_SPECS, type ToolOutcome } from '@shared/ai/tools';
import { validate } from '@shared/doc/file';
import { randomId, type IdGen } from '@shared/ids';
import { t } from '@shared/i18n';
import { ProviderError, toAiError, type AiProvider, type ChatMessage, type ToolCall, type ToolResult } from './providers';

export const MAX_TOOL_ROUNDS = 12;
export const TURN_TIMEOUT_MS = 180_000;
export const MAX_PROPOSALS = 8;
/** Earlier turns sent to the model (the newest ones). */
export const MAX_HISTORY_TURNS = 30;
const MAX_TOKENS = 16_000;

export interface RunOptions {
  provider: AiProvider;
  providerId: AiProviderId;
  model: string;
  signal?: AbortSignal;
  onProgress?: (e: AssistantProgress) => void;
  timeoutMs?: number;
  maxToolRounds?: number;
  newId?: IdGen;
}

/** The conversation for the model: the snapshot first, then the turns (the newest user turn last). */
export function buildMessages(req: AssistantRequest): ChatMessage[] {
  const turns = req.turns.slice(-MAX_HISTORY_TURNS);
  const messages: ChatMessage[] = [{ role: 'user', content: [contextText(req.context)] }];
  for (const turn of turns) {
    if (turn.role === 'user') messages.push({ role: 'user', content: [userTurnText(turn, req.context)] });
    else messages.push({ role: 'assistant', text: assistantTurnText(turn), toolCalls: [] });
  }
  return messages;
}

const asArgs = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Run one assistant turn. Never throws: failures come back as a plain-language AppError. */
export async function runAssistant(req: AssistantRequest, opts: RunOptions): Promise<Result<AssistantReply>> {
  const timeoutMs = opts.timeoutMs ?? TURN_TIMEOUT_MS;
  const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const newId = opts.newId ?? randomId;
  const progress = (e: AssistantProgress) => {
    try {
      opts.onProgress?.(e);
    } catch {
      // A closed window must not stop the turn.
    }
  };
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = Date.now() + timeoutMs;

  const ctx = req.context;
  const system = systemPrompt(ctx.lang);
  const messages = buildMessages(req);
  const proposals: Proposal[] = [];
  const claims: Claim[] = [];
  const toolLog: { name: string; summary: string }[] = [];
  const texts: string[] = [];
  let workDoc = ctx.doc;

  const runTool = (call: ToolCall): ToolOutcome => {
    if (call.name !== 'propose') return runReadTool(call.name, call.input, ctx);
    if (proposals.length >= MAX_PROPOSALS) return { content: JSON.stringify({ error: `at most ${MAX_PROPOSALS} proposals per reply; finish with a text answer` }), isError: true, summary: t('Too many proposals in one reply') };
    const r = validateProposal(workDoc, call.input, newId);
    if (!r.ok) return { content: JSON.stringify({ ok: false, error: r.error, next: 'fix the commands and call propose again' }), isError: true, summary: t('A proposal did not pass validation: {reason}', { reason: r.error.slice(0, 160) }) };
    proposals.push(r.proposal);
    // Later proposals in this reply build on this one (they are accepted in order).
    workDoc = r.doc;
    const note = 'Shown to the user as a preview; nothing changes until they accept it. Later proposals in this reply see this one as applied.';
    return { content: JSON.stringify({ ok: true, proposalId: r.proposal.id, renamedIds: r.renamed, generatedIds: r.created, touches: r.proposal.touches, note }), isError: false, summary: t('Proposed: {title}', { title: r.proposal.title }) };
  };

  try {
    for (let round = 0; ; round++) {
      if (ctrl.signal.aborted) throw new ProviderError(timedOut ? 'timeout' : 'cancelled', opts.providerId, timedOut ? 'Turn time limit reached' : 'Cancelled');
      const res = await opts.provider.chat({
        model: opts.model,
        system,
        messages,
        tools: TOOL_SPECS,
        maxTokens: MAX_TOKENS,
        cacheSystem: true,
        timeoutMs: Math.max(1000, deadline - Date.now()),
        signal: ctrl.signal,
      });
      messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
      if (res.text.trim()) {
        texts.push(res.text.trim());
        progress({ kind: 'text', text: res.text.trim() });
      }
      if (res.stop === 'refusal' && res.toolCalls.length === 0 && texts.length === 0 && proposals.length === 0) throw new ProviderError('refused', opts.providerId, 'Refused');
      if (res.toolCalls.length === 0) {
        if (res.stop === 'max_tokens') texts.push(t('(The answer was cut short because it was too long.)'));
        break;
      }
      if (round >= maxRounds) {
        texts.push(t('I stopped after {n} steps without finishing. Ask again with a narrower request, or accept the proposals so far and continue.', { n: maxRounds }));
        break;
      }
      const results: ToolResult[] = [];
      for (const call of res.toolCalls) {
        const out = runTool(call);
        results.push({ callId: call.id, name: call.name, content: out.content, isError: out.isError });
        toolLog.push({ name: call.name, summary: out.summary });
        if (out.claim && !claims.some((c) => c.text === out.claim?.text)) claims.push(out.claim);
        progress({ kind: 'tool', name: call.name, summary: out.summary });
      }
      messages.push({ role: 'tool', results });
    }
    return { ok: true, value: { text: texts.join('\n\n'), proposals, claims, toolLog, model: { provider: opts.providerId, model: opts.model } } };
  } catch (e) {
    let err = e;
    if (ctrl.signal.aborted && !(e instanceof ProviderError && (e.kind === 'timeout' || e.kind === 'cancelled'))) err = new ProviderError(timedOut ? 'timeout' : 'cancelled', opts.providerId, 'Stopped');
    else if (e instanceof ProviderError && e.kind === 'cancelled' && timedOut) err = new ProviderError('timeout', opts.providerId, 'Turn time limit reached');
    return { ok: false, error: toAiError(err, opts.providerId, opts.model) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    progress({ kind: 'done' });
  }
}

/* ---------- request validation (IPC arguments arrive as unknown) ---------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isV3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

function readReference(v: unknown): Reference | null {
  if (!isObj(v) || !isStr(v.label)) return null;
  switch (v.kind) {
    case 'entities':
      return Array.isArray(v.ids) ? { kind: 'entities', ids: v.ids.filter(isStr), label: v.label } : null;
    case 'part':
      return isStr(v.partId) ? { kind: 'part', partId: v.partId, label: v.label } : null;
    case 'feature':
      return isStr(v.partId) && isStr(v.featureId) ? { kind: 'feature', partId: v.partId, featureId: v.featureId, label: v.label } : null;
    case 'face':
      return isStr(v.partId) && isNum(v.faceId) && isV3(v.center) && isV3(v.normal) && isNum(v.area) ? { kind: 'face', partId: v.partId, faceId: v.faceId, center: v.center, normal: v.normal, area: v.area, label: v.label } : null;
    case 'point':
      return (v.partId === null || isStr(v.partId)) && isV3(v.at) ? { kind: 'point', partId: v.partId, at: v.at, label: v.label } : null;
    default:
      return null;
  }
}

function readTurn(v: unknown): ChatTurn | null {
  if (!isObj(v) || (v.role !== 'user' && v.role !== 'assistant') || !isStr(v.text)) return null;
  const turn: ChatTurn = { id: isStr(v.id) ? v.id : '', role: v.role, text: v.text, at: isStr(v.at) ? v.at : '' };
  if (Array.isArray(v.references)) turn.references = v.references.map(readReference).filter((r): r is Reference => r !== null);
  if (Array.isArray(v.proposals))
    turn.proposals = v.proposals.filter(isObj).map((p) => ({
      id: isStr(p.id) ? p.id : '',
      title: isStr(p.title) ? p.title : '',
      summary: isStr(p.summary) ? p.summary : '',
      commands: [],
      claims: [],
      touches: { entities: [], parts: [] },
      state: p.state === 'accepted' || p.state === 'rejected' ? p.state : 'pending',
    }));
  if (isObj(v.error) && isStr(v.error.message)) turn.error = { code: isStr(v.error.code) ? v.error.code : 'error', message: v.error.message };
  return turn;
}

/** Check an assistant request from the renderer. Returns the request or a reason in plain words. */
export function readAssistantRequest(raw: unknown): AssistantRequest | string {
  if (!isObj(raw) || !Array.isArray(raw.turns) || !isObj(raw.context)) return t('The request to the assistant was incomplete.');
  const turns = raw.turns.map(readTurn).filter((x): x is ChatTurn => x !== null);
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'user' || !last.text.trim()) return t('Write a question or a request for the assistant.');
  const c = raw.context;
  if (!isObj(c.doc)) return t('The request to the assistant was incomplete.');
  const doc = validate(c.doc);
  if (typeof doc === 'string') return t('The drawing could not be read for the assistant: {reason}', { reason: doc });
  const build = isObj(c.build) && isObj(c.build.status) && Array.isArray(c.build.errors) ? (c.build as unknown as AssistantContext['build']) : null;
  const sketch = isObj(c.sketch) && isStr(c.sketch.status) ? { status: c.sketch.status, dof: isNum(c.sketch.dof) ? c.sketch.dof : 0, message: isStr(c.sketch.message) ? c.sketch.message : '' } : null;
  const context: AssistantContext = {
    doc,
    selection: Array.isArray(c.selection) ? c.selection.filter(isStr) : [],
    activePart: isStr(c.activePart) && doc.parts[c.activePart] ? c.activePart : null,
    activeSheet: isStr(c.activeSheet) && doc.sheets[c.activeSheet] ? c.activeSheet : null,
    build,
    sketch,
    lang: c.lang === 'it' ? 'it' : 'en',
  };
  return { turns, context };
}
