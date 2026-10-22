# Library

Data files the app ships with: line types, title blocks, materials, standard parts. Every file is
JSON with an `id` equal to its file name, a `source` (standard and clause, or catalogue) and, when
it carries lengths, `"unit": "mm"`. `npm run check:library` validates all of them; CI runs it.

Never add a table value you cannot verify against the standard: list it in `docs/to-verify.md`.

| Folder | What | Since |
| --- | --- | --- |
| `line-types/` | ISO 128-2 line types and the line-width series | M0 |
| `sheets/` | ISO 5457 sheet sizes, borders, grid reference zones, centring and trimming marks | M2 |
| `title-blocks/` | ISO 7200 title block data fields (and MechPilot's own cell layout) | M2 |
| `scales/` | ISO 5455 recommended scales and their designation | M2 |
| `lettering/` | ISO 3098 lettering heights and proportions | M2 |
| `dimensioning/` | ISO 129-1 arrowheads, extension lines, text placement, symbols | M2 |
| `fits/` | ISO 286 standard tolerance grades, fundamental deviations and Δ values | M2 |
| `gdt/` | ISO 1101 geometrical characteristics, symbols, frame proportions | M2 |
| `surface/` | ISO 21920-1 surface texture symbols and the Ra series | M2 |
| `holes/` | ISO 273 clearance holes (fine, medium, coarse) and ISO 2306 tap drills with ISO 261 pitches | M4 |
| `materials/` | density with its source (EN 1993-1-2, EN 10088-1, EN 1999-1-1; supplier datasheets marked secondary) | M4 |
| `parts/` | ISO 4762 screws, ISO 4032 nuts, ISO 7089 washers, ISO 15 bearings, aluminium profiles | M6 |

Standards data files (M2 on) carry `verification` ("primary" = the standard's own text was seen,
"secondary" = two independent sources agree, listed in `docs/to-verify.md`) and `verifiedFrom`
(the documents used). `docs/standards.md` summarizes what comes from each standard.

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
