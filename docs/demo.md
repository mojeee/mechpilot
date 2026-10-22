# Demo script: design by writing, point, change, print

A twelve-minute walkthrough of MechPilot with the assistant, for a live demo. Every step uses what
ships with the app; the assistant needs an API key (Assistant tab). The default model is Claude
Opus 5.5. Nothing the assistant proposes is applied until you click Accept, and every accepted
proposal is one undo step (`U`). The part is a bearing housing for a 6207 ball bearing
(35 × 72 × 17 mm): a square flange, a boss with the bearing seat, a seal counterbore, a cover
bolt pattern.

## 0. Before the demo

- Start the app (`npm run dev` or the installed app), dark theme, white canvas if the projector
  is bright (View menu).
- Assistant tab: provider Claude, model Claude Opus 5.5, key stored (green "Key stored").
- Close any open file: File > New.

## 1. A bearing housing from one sentence (2D)

Type in the Assistant tab:

> A bearing housing flange for a 6207 bearing: a 140 × 140 mm square plate with R15 corners,
> four Ø11 clearance holes for M10 on a 110 × 110 pattern, two Ø6 H7 dowel holes on one diagonal
> at 60 mm from the centre, and a central Ø72 H7 bore for the bearing's outer ring.

What to show: the proposal card lists what it will add, the claims say where each number comes
from (Ø11 for M10 from `library/holes/iso-273` medium series; H7 deviations from ISO 286), and
the drawing shows the ghost preview. Click **Accept**. Press `U` once to show it is one undo
step, then `REDO`.

## 2. Step by step to a 3D part

> Make it a 3D part: extrude the plate 15 mm with every hole through.

Accept. The 3D tab opens with the body; the Features tab shows the tree. Then:

> Add a Ø100 boss, 30 mm tall, on top around the bore; keep the Ø72 H7 bore through it and
> chamfer both ends of the bore 1 × 45°.

Accept, rotate the view. Then the back and the cover:

> On the back face add a Ø80 counterbore 4 mm deep for the shaft seal, and on the top of the boss
> a circular pattern of six M5 tapped holes on a Ø88 circle, 10 mm deep.

Accept. Then an impossible request, to show honesty:

> Make the boss wall 1 mm thick and fillet its edges with R15.

The assistant answers with the real numbers from the model (the wall is 14 mm, a 1 mm wall cannot
take an R15, the bearing seat needs its length) and offers options; nothing is applied.

## 3. Point at something and ask for a change

- In the 3D viewer, Alt+click the top face of the boss. A chip "Face … normal +Z" appears in the
  chat input.
- Type:

> Chamfer the outer edge of this face 2 × 45° and make the boss 35 mm tall instead.

Accept. Then in the Model tab select the four M10 holes (window selection), click
**Use selection**, and type:

> Change these to M12 clearance holes and widen the pattern to 114 × 114.

Accept; the holes, their dimensions and the hole feature follow.

## 4. The drawing and the PDF

> Dimension it to ISO 129-1 with the H7 fits, add a front view in full section through the bore
> axis, put everything on an A2 sheet at 1:1 with the title block filled in (title "Bearing
> housing", material EN-GJL-250), and export the PDF.

Accept. The sheet tab opens, the PDF save dialog appears; save and open the PDF.

## 5. If something goes wrong

- The impossible request in step 2 is the honesty moment: the assistant does not pretend; it
  measures, says why, and asks which way to go.
- No answer, or a key error: the Assistant tab says why in plain words; check the key and the
  model name.
- A proposal you do not like: **Reject**, or accept and press `U`.
- The assistant never edits silently: look for the card, nothing changes without Accept.

## Website

The same walkthrough is the demo page of the website (`/demo/`, `/it/demo/`): the screen
recording of this script played against the real model (`e2e/demo.e2e.ts`, then
`scripts/demo-video.mjs`), with the steps underneath as chapters.
