# The assistant

## Using the assistant

The assistant is optional (product rule 7). MechPilot works the same without it; nothing is sent
anywhere until you write a message.

### Set it up

1. Open the **Assistant** tab in the right panel (or press **Ctrl+Shift+A**, or type `AI` in the
   command line).
2. Pick the provider (Claude, OpenAI or Gemini) and the model. The list shows the usual models; you
   can also type another model id.
3. Paste your API key and press **Store key**. The key is stored encrypted on this computer (Electron
   `safeStorage`) and only the main process ever sees it. **Test** makes one cheap call to check it;
   **Remove** deletes the stored key. The header line then shows *Key stored*, *Key from environment*
   (a developer key in the environment) or *No key*, and the settings fold away.

### Write what you want

Type a request and press **Enter** (**Shift+Enter** starts a new line, **Ctrl+Enter** also sends,
**Esc** clears the input). From the command line, `AI <text>` sends the text straight to the chat.
Examples:

- *a 120 × 80 plate, 10 thick, four M6 clearance holes on a 100 × 60 pattern, R10 corners*
- *make this 5 mm thicker* (with a part or a face as a reference)
- *put the drawing on an A3 sheet with the overall dimensions and export the PDF*

While the assistant works you see what it looks at (*Looking at: model, measure ×2*) and the
answer as it streams; **Cancel** stops it and nothing changes.

### Point at things: references

References are chips above the input; they go with the next message and tell the model exactly what
you mean. Hover a chip to see what it points at (the entities light up on the drawing, a face lights
up in 3D); × removes it.

- **Use selection** adds the selected 2D entities (*3 lines, 1 arc*).
- In the **Features** tab, **→ chat** next to a part adds the part, and **→** on a feature row adds
  that feature.
- In the 3D viewer, turn on **Reference** (top right), or keep the Assistant tab open and hold
  **Alt**: a click on the body adds the face under the pointer (*Face 12 of Stepped shaft, normal
  +Z, 24 cm²*: centre, average normal and area are measured on the built mesh), **Shift+click** adds
  the point under the pointer (*Point (12.00, 0.00, 15.00)*).

### Proposals: preview, accept, reject

The assistant never edits your drawing. Every change comes as a **proposal card**: a title, a short
summary, the diff (entities added, changed or deleted; features added or changed with their values;
sheets), the claims with their sources, and **Accept** / **Reject**.

- The first pending card is shown as a **preview**; hover or focus another card to preview that one.
  In 2D, what the proposal adds or changes is drawn dashed in the accent colour on top of the
  drawing, and what it deletes dashed in red. In 3D, a proposal that changes the part shown is
  rebuilt in the kernel and drawn as a translucent body over the current one.
- **Accept** applies the proposal's commands as **one undo step**: **U** (or Ctrl+Z) takes all of it
  back. Some proposals then do one more thing, written on the card (*Then it exports the PDF*, open
  a part or a sheet).
- **Reject** keeps the card in the conversation, marked rejected; the model sees that on the next
  message.
- If the drawing changed so that a proposal no longer applies, the card says why and Accept is off.

### Where a statement comes from

Every claim carries a badge (product rule 7):

- **measured**: measured on this model (hover for what was measured);
- a standard and clause, for example **ISO 286-1 §5.2**;
- **library: holes/iso-273 M6**: a library entry with its source;
- **suggestion**: the model's own suggestion, to check before you rely on it.

### When something goes wrong

Errors are shown in the chat in plain words with a way out (no key, a key the provider refused, no
credit, offline, a timeout, a model that is not available). Nothing in the drawing changes when a
request fails. **Clear** starts a new conversation.

## How it works (the model side)

Everything below runs in the main process (`app/main/ai/`, with the pure parts in `shared/ai/`).
The renderer sends a snapshot of the drawing with every request and gets back words, claims and
proposals; it never sees a key and the model never touches the document.

### Keys and settings

- A key entered in the app is encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on
  Windows, libsecret/KWallet on Linux) and kept as base64 in `<app data>/ai-keys.json`, one entry
  per provider. When the OS offers no encryption, the key is **not stored** and the user is told
  why; a plain-text fallback would not be safe.
- Development only (`app.isPackaged === false`): with no stored key, the key comes from
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` in the environment, then from those
  lines in `.env.local` in the repository root (git-ignored). `hasKey` reports both.
- The provider and model live in the ordinary settings file (`settings.json`, field `ai`); the
  defaults are in `shared/ai/types.ts` (`PROVIDER_INFO`).
- The key is never logged, never sent to the renderer, and scrubbed from every error message. The
  Anthropic client always talks to `https://api.anthropic.com`, whatever `ANTHROPIC_BASE_URL` or
  other SDK settings say in the environment.
- **Test** asks the provider's Models API whether the chosen model exists for the key (no tokens
  spent).

### Providers

`app/main/ai/providers/` has one neutral chat-with-tools interface and three implementations:
Claude through `@anthropic-ai/sdk` (system prompt and tools marked for prompt caching, effort
`medium` on the Claude 5 models, the server-side refusal fallback on the models that support it),
OpenAI through the Responses API and Gemini through `generateContent`, both with `fetch`. Every
failure becomes a typed error (auth, quota, rate, offline, timeout, model, server, refused,
cancelled, no key) shown in plain words with a hint.

`MP_AI_FAKE=1` replaces them with a scripted fake (`fake.ts`) that drives the same tool loop. Its
scripts, chosen by the user's text: *plate* / *piastra* (a 120 × 80 plate with four M6 clearance
holes), *thicker* / *più spesso* (the first extrude of the referenced or active part + 5 mm),
*pdf* (an A3 sheet with the overall dimensions, then the PDF export), *add holes* with no number
(a clarifying question with numbered options and a default, no proposal), *fail* (a server error).

### What the model sees

- **System prompt** (`shared/ai/prompt.ts`, frozen per language so it caches): a drafting
  colleague inside MechPilot; millimetres and ISO drawing rules; the honesty rules (look before
  answering, never state a value it did not take from a tool, every claim with a source, propose and
  never edit); when to **ask** instead of guessing (a missing size or position, which face, edge,
  part or hole size, "bigger" without a number: one short question, numbered options, a stated
  default) and when to propose with the assumptions written in the summary; the command schema in
  words with examples (entities, dimensions with tolerances, constraints, parts and their features,
  sheets, the `then` actions); how references work, including how a clicked face maps to an
  `inPlane` edge selector or a `normal` face selector. It answers in the language of the app.
- **First user message**: the drawing as it is now (`shared/ai/summary.ts`): layers, entities with
  geometry rounded to 3 decimals (the first 150; the rest by paging `read_model`), dimensions with
  their measured values and tolerances, constraints, parts with feature trees, build status, errors
  and mass properties of the active part, sheets, the selection. Then the conversation: earlier
  turns, with what became of each proposal (accepted, rejected, not answered), and the new message
  with its references.

### Tools

All answered from the snapshot with pure code from `shared/` (no renderer round trip):

| Tool | What it does |
| --- | --- |
| `read_model` | The summary above, paged (`offset`) or filtered by layer. |
| `get_entities` | Full, unrounded records by id. |
| `measure` | Distance between two points (coordinates or points of entities), one entity (length, radius, sweep, dimension value), the area of the closed loops of several entities (through the same profile builder as the kernel), or the active part's build properties. Results are marked *measured*. |
| `library` | ISO 273 clearance holes, ISO 2306 tap drills, ISO 286 deviations and fits, materials, ISO 5457 sheet sizes, ISO 5455 scales, ISO 7200 title-block fields; each answer carries its file, entry and source text. |
| `check` | Closed-profile check of entities or of a part's sketches, ISO 286 classes on dimensions that the data does not have, the solver status and build errors. |
| `propose` | The only way to change anything (below). |

Measurements and library values the model looked up are also returned with the reply as claims,
with their sources. The loop runs at most 12 tool rounds and 180 s per request, and **Cancel**
stops it at once.

### Proposals

A proposal is a title, a summary, a list of ordinary commands (`shared/commands`), claims, the ids
it touches and an optional `then` action. Before the user sees it, `shared/ai/proposal.ts`:

1. **fills ids**: a new entity, constraint, part, feature, sheet, view or layer without an id gets
   one; an id that already exists is replaced, and later references to it in the same proposal
   follow the new id (the model is told the final ids);
2. **fills layers**: annotations go on `dimensions` (when it exists), other entities on the active
   layer;
3. **treats updates as patches**: `updateEntities`, `updateConstraints`, `updateLayer`,
   `updateSheet`, `updatePart` and `setDimStyle` merge the given fields onto the current object
   (`null` removes an optional field). `updatePart`'s feature list is the complete new list; an entry
   naming an existing feature is merged onto it, and leaving a feature out is refused unless the
   model sets `dropFeatures` (parametric history is never destroyed silently);
4. **dry-runs** the commands in order with `apply` on a copy of the drawing (unknown ids, locked
   layers and duplicates fail here, with the id named), then runs the file format's own `validate`
   on the result;
5. **checks** that every sketch an extrude or revolve uses is a closed profile, that hole threads
   are in the library, that ISO 286 classes on new or changed dimensions exist, and that the `then`
   action has its sheet or part; `replaceDocument` is not allowed;
6. **normalizes** the commands to the validated objects (no stray keys) and fills `touches` from the
   diff: every entity and part added, changed or deleted, plus parts whose sketches use a touched
   entity;
7. **downgrades** a claim with an incomplete source to *suggestion*.

On any failure the model gets the reason as the tool result and fixes the proposal; a broken
proposal never reaches the user. Several proposals in one reply are validated in order, each on
top of the previous ones, so the user accepts them in order.

### IPC

`ai:settings`, `ai:setSettings`, `ai:setKey`, `ai:clearKey`, `ai:testKey`, `ai:chat` (returns
`Result<AssistantReply>`), `ai:cancel`. While `ai:chat` runs, the main process sends
`AssistantProgress` events (`{kind:'text', text}`, `{kind:'tool', name, summary}`, then
`{kind:'done'}`) to the asking window on `ai:progress`. One request per window at a time.
