# Library

Data files the app ships with: line types, title blocks, materials, standard parts. Every file is
JSON with an `id` equal to its file name, a `source` (standard and clause, or catalogue) and, when
it carries lengths, `"unit": "mm"`. `npm run check:library` validates all of them; CI runs it.

Never add a table value you cannot verify against the standard: list it in `docs/to-verify.md`.

| Folder | What | Since |
| --- | --- | --- |
| `line-types/` | ISO 128-2 line types and the line-width series | M0 |
| `title-blocks/` | ISO 7200 title block layouts | M2 |
| `fits/` | ISO 286 deviations for the common fits | M2 |
| `materials/` | density and properties with their source | M4 |
| `parts/` | ISO 4762 screws, ISO 4032 nuts, ISO 7089 washers, ISO 15 bearings, aluminium profiles | M6 |

## line-types/*.json

```json
{
  "id": "iso-128-2",
  "source": "ISO 128-2:2020",
  "unit": "mm",
  "widths": [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2],
  "types": [
    { "id": "01.2", "name": "Continuous wide", "width": "wide", "use": "Visible edges and outlines", "source": "ISO 128-2:2020, Table 1" }
  ]
}
```

`pattern`, when present, is the dash/gap sequence in multiples of the line width `d`. It is left
out until the element lengths are verified (see `docs/to-verify.md`); a type without a pattern
renders as continuous.
