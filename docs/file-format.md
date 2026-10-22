# The MechPilot file format

A drawing is one JSON text file, `name.mechpilot.json`. It is yours: open, documented, versioned,
and written in a stable order so it diffs well in Git (product rule 3). Nothing is rounded on save
or load: numbers are IEEE doubles written by `JSON.stringify`, which round-trips every value
exactly (product rule 1).

Reference implementation: `shared/doc/types.ts` (shapes), `shared/doc/file.ts` (serialize, parse,
validate, migrations). Tests: `tests/file-format.test.ts`.

## Top level (format 1)

```json
{
  "format": "mechpilot",
  "version": 1,
  "unit": "mm",
  "name": "Mounting bracket",
  "description": "optional",
  "standard": "iso",
  "projection": "first",
  "layerOrder": ["0", "hidden", "centre"],
  "activeLayer": "0",
  "layers": { "0": { "id": "0", "name": "0", "color": "auto", "lineType": "01.2", "lineWidth": 0.5, "visible": true, "locked": false } },
  "entityOrder": ["e1", "e2"],
  "entities": { "e1": { "id": "e1", "type": "line", "layer": "0", "a": { "x": 0, "y": 0 }, "b": { "x": 120, "y": 0 } } }
}
```

| Field | Meaning |
| --- | --- |
| `format` | always `"mechpilot"` |
| `version` | the format version; older files are migrated on open, newer ones are refused with a plain message |
| `unit` | always `"mm"`: every length in the file is millimetres |
| `standard` | `"iso"` (default) or `"asme"`: which drawing conventions the checker and the dimension styles follow |
| `projection` | `"first"` (ISO 5456-2 default) or `"third"` |
| `layerOrder` / `layers` | layers bottom to top; the map is keyed by id and written in that order |
| `activeLayer` | where new entities go |
| `entityOrder` / `entities` | drawing order; the map is keyed by id and written in that order |

Ids are short strings, unique within the file. Keys inside a layer or an entity are written with
`id`, `type` and `layer` first and the rest alphabetically.

## Layers

| Field | Meaning |
| --- | --- |
| `color` | a hex colour, or `"auto"`: the canvas foreground (white on a dark canvas, black on a white one) |
| `lineType` | a line type id from `library/line-types/iso-128-2.json`, e.g. `"01.2"` continuous wide |
| `lineWidth` | mm, from the ISO 128-2 series (0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2) |
| `visible`, `locked` | booleans; a locked layer cannot be edited |

## Entities (format 2)

Angles are radians, counter-clockwise, y up.

| `type` | Fields |
| --- | --- |
| `line` | `a`, `b`: points |
| `circle` | `center`: point; `radius` > 0 |
| `arc` | `center`, `radius`, `start`, `end`: from `start` to `end` counter-clockwise |
| `polyline` | `points` (2 or more), `closed`; optional `bulges[i]` for segment i as in DXF: tan(θ/4), positive counter-clockwise, 0 straight. A rectangle is a closed polyline of four points. |
| `ellipse` | `center`; `major`: vector from the centre to the major-axis end; `ratio` minor/major in (0, 1]; `start`, `end` parameters (0 and 2π = full) |
| `spline` | non-rational B-spline as in DXF: `degree`, `controlPoints`, clamped `knots` (controlPoints + degree + 1 values, non-decreasing), `closed`; optional `fitPoints` the user picked |
| `text` | `position` (baseline left), `text`, `height` in mm, `rotation` |

Format 1 (M0) had line, circle and arc only; a format-1 file is upgraded to format 2 unchanged.

## Annotations (format 3)

| `type` | Fields |
| --- | --- |
| `dimension` | `kind` (`linear`, `aligned`, `angular`, `radius`, `diameter`, `ordinate`), `a`, `b` (measured points; for radius/diameter `a` is the centre and `b` a point on the curve; for ordinate `a` is the origin), `position` (the dimension line passes through it, or the leader ends there), `rotation` (direction of a linear or ordinate dimension), `center` (angular: the vertex); optional `text` (override, `<>` = measured value), `prefix`, `suffix`, `decimals`, `tolerance` |
| `tolerance` | `{ kind: "deviation", upper, lower }` in mm, `{ kind: "symmetric", value }`, `{ kind: "limits", upper, lower }`, or `{ kind: "fit", cls: "H7" }` (ISO 286 class; the deviations come from the library) |
| `note` | `position`, `text` (lines separated by `\n`), `height`, `rotation`; optional `leader`: points from the arrow tip to the text |
| `balloon` | `position` (circle centre), `text`, `leader` (arrow tip) |
| `surface` | `position` (tip on the surface), `rotation`, `removal` (`any`, `required`, `prohibited`); optional `ra` (µm), `text`, `leader` |
| `gdt` | `position`, `rotation`, `characteristic` (id from `library/gdt/iso-1101.json`), `tolerance` (text), `datums` (up to three letters); optional `leader` |
| `datum` | `position` (triangle on the feature), `rotation`, `label` |

Annotations are drawn from the document's `dimStyle` (paper mm: `textHeight`, `arrowSize`,
`extensionOvershoot`, `extensionGap`, `textGap`, `decimals`, `annotationScale`, `arrowhead`).
The measured value is computed from the geometry when the drawing is shown, never stored, so a
dimension can never disagree with what it measures.

## Sheets (format 3)

`sheetOrder` / `sheets`: each sheet has `name`, `size` (A0 to A4), `orientation`, `titleBlock`
(ISO 7200 field id → text) and `views`: windows onto the model placed on the paper, each with
`scale` (ratio: 0.5 for 1:2), `center` (model point at the centre of the viewport), `position`,
`width`, `height` (paper mm) and `label` (draw "SCALE 1:2" under it). A format-2 file gets the
default dimension style and no sheets.

## Sketch constraints (format 4)

`constraintOrder` / `constraints`: each constraint has an `id` and a `kind`, and refers to entities
by id and to their points by a `PointRef` `{ "entity": "e1", "point": "a" }` (`a`/`b` of a line,
`center` of a circle or arc, `start`/`end` of an arc, or a vertex index of a polyline). Values are
mm, angles radians.

| `kind` | Fields |
| --- | --- |
| `coincident` | `p1`, `p2` |
| `pointOnLine` | `p`, `line` |
| `horizontal`, `vertical` | `entity` (a line) |
| `parallel`, `perpendicular` | `a`, `b` (lines) |
| `angle` | `a`, `b`, `value` (radians, counter-clockwise from a to b) |
| `tangent`, `equal` | `a`, `b` (lines, circles, arcs) |
| `symmetric` | `p1`, `p2`, `line` |
| `fixed` | `entity` |
| `distance` | `p1`, `p2`, `value` |
| `pointLineDistance` | `p`, `line`, `value` |
| `radius` | `entity`, `value` |

A dimension with `driving` set (a number: mm, or degrees for angular) also constrains the
geometry it measures. The solver (planegcs in a worker) moves the entities; the solved geometry is
what the file stores, so a file opens exactly as it was saved even without solving. Deleting an
entity deletes the constraints that refer to it (undo brings both back).

## Parts (format 5)

`partOrder` / `parts`: a part has `name`, an optional `material` (id from `library/materials`) and
`features`, an ordered list built one after the other by OpenCascade (through replicad) in a worker.
Each feature has `id`, `name`, `kind` and optionally `suppressed`.

| `kind` | Fields |
| --- | --- |
| `sketch` | `plane` (`XY`, `XZ`, `YZ`), `offset` along the plane normal, `entities`: ids of 2D entities in model space that form closed loops (outer loop and holes) |
| `extrude` | `sketch` (id of an earlier sketch feature), `distance` > 0, `direction` (`normal`, `reverse`, `both`), `op` (`add`, `cut`) |
| `revolve` | `sketch`, `axis` `{ a, b }` in sketch coordinates, `angle` in degrees (0, 360], `op` |
| `hole` | `sketch` (its circle centres, line ends and polyline vertices are hole positions), `spec` (`{ kind: "simple", diameter }`, `{ kind: "clearance", thread, series }` ISO 273, `{ kind: "tapped", thread }` tap drill), `depth` in mm or `"through"` |
| `fillet` | `edges` selector, `radius` |
| `chamfer` | `edges` selector, `distance` |
| `shell` | `thickness`, `faces` to remove (selectors) |
| `mirror` | `plane`, `offset` |
| `pattern` | `mode: "linear"` with `counts`, `spacing`, `axes`, or `mode: "circular"` with `axis`, `count`, `angle` |
| `import` | `format: "step"`, `data` (base64 of the STEP text), `sourceName` |

Edge selectors: `{ kind: "all" }`, `{ kind: "parallelTo", axis }`, `{ kind: "inPlane", plane, offset }`,
`{ kind: "ofLength", length }`, `{ kind: "inBox", min, max }`. Face selectors: `{ kind: "normal",
direction: "Z+" }` or `{ kind: "inPlane", plane, offset }`. The built solid is never stored: a file
rebuilds from its features, so it stays small and diffable; meshes and mass properties are computed
when the part is shown.

Each addition bumps `version` and ships a migration.

## Migrations

`shared/doc/file.ts` keeps one function per version step. Opening a file of version n runs the
steps n → n+1 → … → current, then validates. A file that fails validation is refused with the
field that is wrong, never silently repaired.
