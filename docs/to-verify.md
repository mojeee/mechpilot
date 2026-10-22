# To verify

Table values and rules from standards that could not be verified against the standard's text while
building. They are **not** in code (product rule 2). Each entry says where it would go once a copy
of the standard confirms it.

| Standard | Value or rule | Where it would go | Status |
| --- | --- | --- | --- |
| AutoCAD Color Index (DXF group 62) | The RGB values of the greys 8, 9 and 250–255 and the formula used for colours 10–249 in `shared/dxf/codes.ts` come from memory of AutoCAD's colour dialog, not from a published table. The nine basic colours 1–9 are the well-known ones. | `shared/dxf/codes.ts`, `aciToRgb` / `nearestAci` | compare with a published ACI table |
| DXF compatibility | The AC1015 (2000) and AC1009 (R12) output has only been checked by MechPilot's own reader and the unit tests. | `shared/dxf/write.ts` | open an exported file in AutoCAD, LibreCAD and DraftSight (owner, by hand) |
| ISO 128-2:2020 Annex D | The line type application numbers for mechanical engineering drawings (e.g. which "01.2.x" number covers visible edges, which "04.1.x" covers centre lines). The `use` texts in `library/line-types/iso-128-2.json` come from the former ISO 128-24 and are cited as "Annex D" without numbers. | `library/line-types/iso-128-2.json`, field `source` of each type | application numbers to confirm |

## Verified (kept here as a record of the source)

| Standard | Value | Verified against |
| --- | --- | --- |
| ISO 128-2:2020 | Line width series 0.13 to 2 mm and the extra wide : wide : narrow = 4 : 2 : 1 ratio (clause 5.1) | the standard's own preview text (clause 5.1), 2026-10-22 |
| ISO 128-2:2020 | Table 4 lengths of line elements: dot ≤ d, gap 3d, short dash 6d, dash 12d, long dash ≈24d, space 18d, with the line types each applies to (clause 5.3) | the standard's own preview text (Table 4), 2026-10-22 |
| ISO 128-2:2020 | Table 1 basic line types 01 to 15 and their names; Table 2 sub-types .1 narrow, .2 wide, .3 extra wide; Table 3 variations (wavy, spiral, zigzag, freehand) | the standard's own preview text, 2026-10-22 |
