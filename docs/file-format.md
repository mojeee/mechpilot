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

## Entities (format 1)

Angles are radians, counter-clockwise, y up.

| `type` | Fields |
| --- | --- |
| `line` | `a`, `b`: points |
| `circle` | `center`: point; `radius` > 0 |
| `arc` | `center`, `radius`, `start`, `end`: from `start` to `end` counter-clockwise |

More entity types arrive with M1 (polyline, rectangle as a closed polyline, ellipse, spline, text),
dimensions and annotations with M2, sketches and constraints with M3, parts with M4. Each addition
bumps `version` and ships a migration.

## Migrations

`shared/doc/file.ts` keeps one function per version step. Opening a file of version n runs the
steps n → n+1 → … → current, then validates. A file that fails validation is refused with the
field that is wrong, never silently repaired.
