# DXF import and export

DXF is the drawing exchange format of AutoCAD, and almost every CAD program reads and writes it.
MechPilot reads ASCII DXF files of any version and writes **DXF R12** (AC1009, the most widely
readable) and **DXF 2000** (AC1015, which keeps ellipses, splines, lineweights and true colours).

Reference implementation: `shared/dxf/` (`read.ts`, `write.ts`, `codes.ts`). Tests:
`tests/dxf.test.ts` with hand-written files in `tests/fixtures/dxf/`. Group codes follow the
*DXF Reference* published by Autodesk (sections HEADER, TABLES, BLOCKS, ENTITIES, OBJECTS).

## Precision

Lengths are millimetres and are never rounded (product rule 1). Numbers are written with the
shortest text that reads back to exactly the same double (`0.30000000000000004`, not `0.3`), so a
MechPilot → DXF → MechPilot round trip gives the same numbers, bit for bit. Two values go through a
conversion and can change in the last digit (about 1e-15 relative): the angles of arcs and the
rotation of texts, which DXF stores in **degrees** while MechPilot uses radians. Ellipse
parameters are radians in both, so they are exact.

## Units

On export MechPilot writes `$INSUNITS = 4` (millimetres) and `$EXTMIN` / `$EXTMAX` (the drawing
extents). R12 predates `$INSUNITS`; R12 readers ignore it and newer readers use it.

On import the unit comes from the HEADER variable `$INSUNITS` (DXF Reference, HEADER section,
`$INSUNITS`, group code 70) and every length is converted to millimetres:

| `$INSUNITS` | Unit | × to get mm | Warning |
| --- | --- | --- | --- |
| 0 or absent | unitless | 1 (mm assumed) | yes: "millimetres were assumed" |
| 1 | inch | 25.4 | yes: "converted from inches" |
| 2 | foot | 304.8 | yes |
| 3 | mile | 1 609 344 | yes |
| 4 | millimetre | 1 | no |
| 5 | centimetre | 10 | yes |
| 6 | metre | 1000 | yes |
| 7 | kilometre | 1 000 000 | yes |
| 8 | microinch | 0.0000254 | yes |
| 9 | mil (0.001 in) | 0.0254 | yes |
| 10 | yard | 914.4 | yes |
| 11 | ångström | 1e-7 | yes |
| 12 | nanometre | 1e-6 | yes |
| 13 | micrometre | 0.001 | yes |
| 14 | decimetre | 100 | yes |
| 15 | decametre | 10 000 | yes |
| 16 | hectometre | 100 000 | yes |
| 17 | gigametre | 1e12 | yes |
| 18 | astronomical unit | 1.495978707e14 | yes |
| 19 | light-year | 9.4607304725808e18 | yes |
| 20 | parsec | 648000/π au | yes |
| 21–24 | US survey foot, inch, yard, mile | 1200/3937 m per foot | yes |
| other | unknown | 1 (mm assumed) | yes |

Drawings from R12-era programs often have no `$INSUNITS`. If such a part looks 25.4 times too
small, it was drawn in inches: scale it by 25.4.

## Export

| MechPilot | DXF 2000 | DXF R12 |
| --- | --- | --- |
| line | LINE | LINE |
| circle | CIRCLE | CIRCLE |
| arc | ARC (angles in degrees) | ARC |
| polyline (with bulges, open or closed) | LWPOLYLINE (70 bit 1 closed, 42 bulge per vertex) | POLYLINE / VERTEX / SEQEND (70 bit 1 closed, 42 bulge per vertex) |
| ellipse | ELLIPSE (major axis relative to the centre, ratio, parameters in radians) | POLYLINE that follows the curve within 0.01 mm |
| spline | SPLINE (degree, knots, control points, fit points; flags planar and closed) | POLYLINE that follows the curve within 0.01 mm |
| text | TEXT (baseline left, height, rotation in degrees) | TEXT |

Before exporting, the app can ask `dxfExportNotes(doc, version)` what the file will change and
show it: ellipses and splines approximated in R12, layer names DXF cannot hold, texts with line
breaks. For a DXF 2000 export of ordinary geometry the list is empty.

Every entity carries the name of its layer (group code 8). The file also has the tables other
programs expect: line types (LTYPE), layers (LAYER) and the text style STANDARD; DXF 2000 files add
handles, the BLOCK_RECORD table, the model and paper space blocks and the root dictionary in
OBJECTS. The current layer is written as `$CLAYER`.

### Layers

| MechPilot | DXF (LAYER table entry) |
| --- | --- |
| name | 2. Characters DXF does not allow (`< > / \ " : ; ? * | = \``) become `_`; two names that differ only in capitals get `_2`. |
| colour | 62: the nearest AutoCAD Color Index (ACI) colour; "auto" is 7 (white on dark, black on white). DXF 2000 also writes the exact colour as true colour (420). True colour was added to DXF with AutoCAD 2004; older readers ignore it and use the ACI. |
| line type | 6: see the mapping below |
| line width | 370 (DXF 2000 only), in hundredths of a millimetre: 0.25 mm → 25 |
| hidden | 70 bit 1 (frozen) |
| locked | 70 bit 4 (locked) |

### Line types

| ISO 128-2 (MechPilot) | DXF |
| --- | --- |
| 01.1 continuous narrow, 01.1 freehand, 01.1 zigzag, 01.2 continuous wide | CONTINUOUS |
| 02.1 dashed narrow, 02.2 dashed wide | HIDDEN |
| 04.1 long-dashed dotted narrow, 04.2 wide | CENTER |
| 05.1 long-dashed double-dotted narrow | PHANTOM |

The dash lengths written in the LTYPE table (HIDDEN 6.35/−3.175, CENTER 31.75/−6.35/6.35/−6.35,
PHANTOM 31.75/−6.35/6.35/−6.35/6.35/−6.35, DASHED 12.7/−6.35 mm) are the usual display patterns of
DXF programs, not ISO 128-2 values; they only affect how other programs draw the dashes.

## Import

### Entities

| DXF | Becomes | Notes |
| --- | --- | --- |
| LINE, CIRCLE, ARC | line, circle, arc | |
| LWPOLYLINE | polyline | bulges kept, closed flag kept |
| POLYLINE / VERTEX / SEQEND | polyline | 2D only; 3D polylines and meshes are skipped with a warning. Curve-fit vertices are kept, spline frame points are dropped. |
| ELLIPSE | ellipse | a ratio above 1 is turned into the equivalent ellipse with ratio ≤ 1 |
| SPLINE | spline | control points and knots; a spline with only fit points is interpolated through them; a spline with weights (rational) becomes a polyline, with a warning |
| TEXT | text | 10/20 insertion, 40 height, 50 rotation in degrees, 1 value; `%%d` → °, `%%p` → ±, `%%c` → Ø, `\U+XXXX` → the character |
| MTEXT | text (one line) | all 3 codes then 1; paragraph breaks become spaces; inline formatting is removed (`\f…;`, `\H…;`, `\W…;`, `\A…;`, `\C…;`, `\Q…;`, `\T…;`, `\L`, `\O`, braces); `\\`, `\{`, `\}` are kept as characters; stacked fractions `\S1/2;` become `1/2`. The rotation comes from the direction vector 11/21 when present, else 50 (read in degrees, as AutoCAD writes it). The insertion point is moved to the baseline (one height down for top attachment, half for middle). |
| INSERT | the block's entities | see Blocks |

Entities marked invisible (60 = 1) are skipped silently. Entities in paper space (67 = 1: title
blocks, viewports) are skipped with one warning; only model space is imported. Everything else
(HATCH, DIMENSION, LEADER, SOLID, 3DFACE, IMAGE, POINT, ATTRIB, …) is skipped with one warning per
type that says how many there were.

Colours, line types or lineweights set on single entities are not kept (MechPilot draws each
entity with its layer's settings); one warning says how many entities had them.

Z coordinates are dropped. If any entity had a z value (or a tilted extrusion direction) one
warning says so. Arcs, circles, polylines and texts drawn with the extrusion direction (0, 0, −1),
which some programs use for mirrored geometry, are converted to the equivalent plan geometry.

### Blocks

Every INSERT is expanded into plain entities: the block's entities are moved by the insertion
point minus the block base point, scaled by the x scale (41), rotated (50, degrees) and repeated
for arrays (70/71 columns and rows, 44/45 spacing). Nested blocks are expanded up to 8 levels (a
deeper or self-inserting block is cut there, with a warning). Entities on layer 0 inside a block
take the layer of the INSERT, as in AutoCAD. A mirrored insert (scale −1) is kept as a mirror. When
the x and y scales differ, the x scale is used for both and a warning says so (non-uniform
scaling would turn circles into ellipses). Blocks that are missing or are external references are
skipped with a warning listing their names.

### Layers

| DXF | MechPilot |
| --- | --- |
| 2 name | name; the layer id is the name in lower case with other characters as `-` |
| 420 true colour | colour |
| 62 ACI | colour, from the ACI table below; 7 → "auto"; a negative value (layer off) → hidden |
| 70 bit 1 frozen | hidden |
| 70 bit 4 locked | locked |
| 6 line type | CONTINUOUS → 01.2 when the lineweight is 0.5 mm or more, else 01.1 (no lineweight: 01.2 for layer 0, 01.1 for the others); HIDDEN, HIDDEN2, DASHED, DASHED2 → 02.1 (02.2 when the lineweight is 0.5 mm or more); CENTER, CENTER2 → 04.1 (04.2 from 0.5 mm); PHANTOM, PHANTOM2, DASHDOT → 05.1; ACAD_ISO02W100, ACAD_ISO04W100, ACAD_ISO05W100 → 02, 04, 05; anything else → 01.1 with one warning listing the names |
| 370 lineweight | width in mm (25 → 0.25), snapped to the nearest ISO 128-2 width (0.13 … 2 mm); without a lineweight (or "default", "by layer", "by block"), 0.5 mm for wide line types and 0.25 mm for the others |

Entities on a layer that is not in the layer table get that layer, created with default settings
(one warning lists them). A file without a layer table starts from MechPilot's default layers.
`$CLAYER` becomes the active layer.

### AutoCAD Color Index

| ACI | Colour |
| --- | --- |
| 1 | red #ff0000 |
| 2 | yellow #ffff00 |
| 3 | green #00ff00 |
| 4 | cyan #00ffff |
| 5 | blue #0000ff |
| 6 | magenta #ff00ff |
| 7 | white / black → "auto" |
| 8 | #808080 |
| 9 | #c0c0c0 |
| 10–249 | 24 hues 15° apart (hue = (index / 10 − 1) × 15°), five brightness levels (255, 204, 153, 127, 76); even indices fully saturated, odd indices half saturated |
| 250–255 | greys #333333, #505050, #696969, #828282, #bebebe, #ffffff |

### Robustness

Files with CRLF or LF line endings, spaces around group codes, `999` comments, a missing HEADER or
TABLES section or a missing `EOF` are read. The CLASSES and OBJECTS sections are ignored. A file
that has no `SECTION` or no `ENTITIES` section is refused with "This file is not a DXF drawing"
and a hint; a binary DXF is refused with a hint to save it again as ASCII DXF.

## Warnings

Import returns the document and a list of warnings `{ code, message, count }`, one per kind (and
one per entity type for skipped entities), in plain words:

| Code | When |
| --- | --- |
| `units-assumed`, `units-converted`, `units-unknown` | see Units |
| `unsupported-entity` | an entity type MechPilot does not import yet (one warning per type) |
| `invalid-geometry` | zero radius, too few points, a broken spline (one warning per type) |
| `paper-space` | entities on paper-space layouts |
| `entity-overrides` | entities with their own colour, line type or lineweight |
| `polyline-3d` | 3D polylines and meshes |
| `rational-spline` | splines with weights, imported as polylines |
| `missing-block`, `block-depth`, `nonuniform-scale` | see Blocks |
| `missing-layer`, `unknown-linetype` | see Layers |
| `z-dropped` | the drawing had 3D coordinates |

## Limitations

- Dimensions, hatches, leaders, points, attributes and images are not imported yet.
- MTEXT becomes single-line text; its width, line spacing and horizontal alignment are not kept.
- TEXT alignment other than baseline left is read from the first alignment point, which DXF
  writers set to the baseline-left point of the text.
- Text encoding: MechPilot writes only ASCII (other characters as `\U+XXXX` and `%%` codes). When
  reading, the caller decodes the file bytes (UTF-8 for AutoCAD 2007 and later, the code page in
  `$DWGCODEPAGE` before); `\M+` multibyte escapes are dropped.
- R12 export approximates ellipses and splines with polylines within 0.01 mm, has no lineweights
  and stores colours as the nearest ACI colour.
- Line types 02.2 and 04.2 come back from DXF only when the file has lineweights (DXF 2000).
