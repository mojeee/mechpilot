# Launch: getting people to the repository

The repository is the product's front door on GitHub; the website is the front door for
engineers who search. Both are ready for visitors when every item in "Before posting" is done.
The posts below are drafts to publish from the owner's accounts, in this order, one day apart.

## Before posting (checklist)

- [x] Repository description, homepage and topics set (done 2026-10-22).
- [x] GitHub Discussions enabled; issue and PR templates; `good first issue` and `help wanted`
      labels exist.
- [x] README with the hero screenshot, badges and the 30-minute contribution path.
- [x] Website live at https://mechpilot.agentflowbind.com with real screenshots.
- [ ] CI green on `main` (the badge on the README must be green on launch day).
- [ ] The assistant shipped and the demo page live (`/demo/`) with real screenshots.
- [ ] A first release with installers (macOS, Windows, Linux) from a tag, so "Download" works.
      Tagging is the owner's action (M8).
- [ ] Five to eight issues labelled `good first issue`, each with a clear done condition.
- [ ] A 60-second screen recording of the demo script (`docs/demo.md`), MP4 and GIF.
- [ ] Social preview image on GitHub (Settings > General > Social preview, 1280 × 640).

## Posts (drafts; the owner publishes)

### Show HN

**Title:** Show HN: MechPilot – open-source 2D/3D mechanical CAD with an AI that proposes, never edits

**Text:**

I'm building MechPilot, an open-source (Apache-2.0) desktop CAD for production drawings: ISO
dimensioning with tolerances and fits, parametric sketches (FreeCAD's planegcs solver), 3D parts
on OpenCascade, DXF/STEP/PDF, an open JSON file format that diffs in git. Local-first, no account.

The part I'd like feedback on is the assistant. You describe a part ("a 160 × 100 plate, R12
corners, four M8 clearance holes on a 130 × 70 pattern, a Ø40 H7 bore") and it answers with a
proposal: a preview on the drawing you accept or reject, one undo step. Every claim shows its
source: measured on the model, an ISO clause, a library entry with the standard it was read from,
or "suggestion". You can click a face in 3D or select lines and ask for a change on that. It works
with your own Claude / OpenAI / Gemini key; the app is fully usable without it.

Every table value in the library cites the standard and clause, and what I could not verify
against the standard's text is listed in docs/to-verify.md instead of being in code.

Repo: https://github.com/mojeee/mechpilot · Site and demo: https://mechpilot.agentflowbind.com/demo/

Happy to answer anything about the kernel (replicad/opencascade.js in a worker), the solver
wrapper, or the file format.

### Reddit (r/cad, r/MechanicalEngineering, r/opensource; one post each, adapted)

**Title:** I made an open-source 2D/3D mechanical CAD where the AI proposes changes you accept or reject (ISO drawings, parametric sketches, 3D parts, DXF/STEP/PDF)

**Text:** short version of the Show HN text, plus the demo GIF, plus: "What would you need before
using something like this for real drawings? Honest answers welcome, the comparison table on the
site says what is missing."

### LinkedIn (owner's profile, Italian and English)

MechPilot è un CAD meccanico 2D/3D open source per disegni di produzione: quote ISO 129-1 con
tolleranze e accoppiamenti ISO 286, schizzi parametrici, parti 3D, DXF/STEP/PDF, file aperti.
Dentro c'è un assistente che propone e non modifica mai da solo: descrivi la parte, vedi
l'anteprima, accetti o rifiuti, ogni affermazione cita la fonte (misura, norma e punto, voce di
libreria). Gratuito, locale, senza account. Demo: https://mechpilot.agentflowbind.com/demo/ ·
Codice: https://github.com/mojeee/mechpilot

(English version: the Show HN text, shortened to five lines.)

### X / Twitter (thread, 4 posts)

1. Open-source mechanical CAD with an AI that proposes and never edits silently. ISO drawings,
   parametric sketches, 3D parts, DXF/STEP/PDF. Free, local-first. 🧵
2. Describe a part in a sentence → a preview on the drawing → Accept or Reject → one undo step.
   Every claim shows its source. [demo GIF]
3. Click a face in 3D or select lines and ask for a change on that. Dimension to ISO 129-1, put
   it on an A3 sheet, export the PDF. [screenshot]
4. Apache-2.0, every library value cites its standard. Repo: github.com/mojeee/mechpilot · Site:
   mechpilot.agentflowbind.com

## Where else

- Awesome lists: awesome-cad, awesome-electron (pull requests adding MechPilot).
- FreeCAD and KiCad forums only where a thread asks for alternatives; never cold posts.
- A short article on the honest-AI design (proposals, sources, undo) for dev.to or the owner's
  blog, linking the demo.

## After posting

- Answer every comment and issue within a day for the first week.
- Turn questions into docs pages or issues; thank contributors in the changelog.
- Keep the comparison table honest when competitors are mentioned.
