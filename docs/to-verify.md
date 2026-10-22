# To verify

Table values and rules from standards that could not be verified against the standard's text while
building. They are **not** in code (product rule 2). Each entry says where it would go once a copy
of the standard confirms it.

| Standard | Value or rule | Where it would go | Status |
| --- | --- | --- | --- |
| ISO 128-2:2020 | Element lengths of dashed and dotted line types as multiples of the line width d (recalled as: dot ≤ 0.5d, gap 3d, dash 12d, long dash 24d) | `library/line-types/iso-128-2.json`, field `pattern` | not verified; line types render as continuous until confirmed |
| ISO 128-2:2020 | Exact clause numbers for the line type table and the width series (cited as "ISO 128-2:2020, Table 1" and "ISO 128-2:2020, 5" from memory) | comments in `library/line-types/iso-128-2.json` | clause numbers to confirm |
