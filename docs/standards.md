# Standards used by MechPilot

MechPilot draws to ISO standards. This page lists each one, what the app takes from it, where that
data lives and how well it has been checked. Every value in `library/` names its standard and
clause; values that could not be checked are left out and listed in [to-verify.md](to-verify.md)
(product rule 2).

**How values were checked.** "Standard text" means the value was read in the standard itself: the
free previews published by iTeh (standards.iteh.ai), or the Indian Standards that adopt an ISO
standard word for word and are published by Public.Resource.Org (law.resource.org). Some of those
adoptions are of an older edition; where that is the case it is said below. "Secondary" would mean
two independent handbooks or catalogues agree; only some material densities rely on that (see "Holes and materials" below).

| Standard | What MechPilot takes from it | Data file | Checked against |
| --- | --- | --- | --- |
| ISO 128-2:2020 (lines) | Line types and the line-width series | `library/line-types/iso-128-2.json` | Standard text (2020 preview) |
| ISO 5457:1999 (drawing sheets) | Sheet sizes A0 to A4, 20/10 mm borders, 0.7 mm frame, grid zones of 50 mm and their count, centring and trimming marks, where the title block goes | `library/sheets/iso-5457.json` | Standard text (1999 edition). Amendment 1:2010 not seen: A4 landscape is not offered yet |
| ISO 7200:2004 (title blocks) | The 19 data fields, which are mandatory, recommended lengths, the 180 mm width. The cell layout is MechPilot's own, drawn after the standard's Figure 1 | `library/title-blocks/iso-7200.json` | Standard text. Italian field names are our translation |
| ISO 5455:1979 (scales) | Recommended scales 50:1 to 1:10 000, how a scale is written and where | `library/scales/iso-5455.json` | Standard text (full) |
| ISO 3098 (lettering) | Text heights 1.8 to 20 mm, type A and B proportions, spacing. Defaults (type B vertical, 3.5 mm for dimensions) are MechPilot's choice | `library/lettering/iso-3098.json` | Standard text of ISO 3098-0:1997; the 2015 edition (ISO 3098-1) has the same clauses but its values were not seen |
| ISO 129-1:2018 (dimensions) | Text above the line and readable from the bottom or the right, decimal comma, symbols ⌀ R □ S⌀ SR and others, how tolerances are written | `library/dimensioning/iso-129-1.json` | Standard text (2018 preview) |
| ISO 129-1:2004 (dimensions, previous edition) | Arrowhead forms and sizes, extension lines 8 line widths past the dimension line | same file | Standard text of the 2004 edition; to confirm in the 2018 edition. Dimension-line spacing and text gap: no value found, not stored |
| ISO 286-1 and 286-2:2010 (limits and fits) | Tolerance grades IT01 to IT18 up to 3 150 mm; fundamental deviations of the shaft and hole letters up to 500 mm, with the rules to compute fits such as H7/g6 | `library/fits/iso-286.json` | IT grades: 2010 standard text. Deviations: 1988 edition text, letters A to E cross-checked with 2010 |
| ISO 1101:2017 (geometrical tolerances) | The 15 characteristics, their 14 symbols, whether a datum is needed | `library/gdt/iso-1101.json` | Standard text (2017 preview) |
| ISO 7083:1983 (GD&T symbol proportions) | Tolerance frame height 2h, line width h/10, compartment widths | same file | Standard text (1983 edition); ISO 1101:2017 Annex F not seen |
| ISO 21920-1:2021 (surface texture) | The three surface symbols with the new bar, how "Ra 1,6" is written | `library/surface/iso-21920-1.json` | Standard text (2021 preview). Symbol proportions (Annex A) not seen: the app uses those of ISO 1302:1978 meanwhile |
| ISO 1302:1978 (surface texture, withdrawn) | The Ra list 0.025 to 50 µm offered first in the app; symbol proportions until ISO 21920-1 Annex A is checked | same file | Standard text (1978 edition) |

Not yet covered here: ISO 5456-2 (projections), ASME Y14.5 and Y14.3, ISO 14405-1 (meaning of
size tolerances). The open questions for each standard above are in [to-verify.md](to-verify.md).

## Holes and materials

| Standard | What MechPilot takes from it | Data file | Checked against |
| --- | --- | --- | --- |
| ISO 273:1979 (clearance holes) | Clearance hole diameters for the fine, medium and coarse series, M1.6 to M64; H12 / H13 / H14 for information. Medium is MechPilot's default series (the standard names none) | `library/holes/iso-273.json` | Standard text (IS 1821:1987, identical adoption) |
| ISO 2306:1972 (drills before tapping) | Tap drill diameters for metric coarse threads M1.6 to M56, and the rule drill ≈ nominal diameter − pitch | `library/holes/tap-drills.json` | Standard text (IS 10952:1984, identical adoption). M60 and M64 are not in its Table 1: not stored |
| ISO 261:1998 (metric threads, general plan) | Coarse pitches of the tap-drill table (cross-check) | same file | Standard text (IS 4218 (Part 2):2001, identical adoption). ISO 262 (selected sizes) not read |
| EN 10025-2, EN 1993-1-1 and EN 1993-1-2:2005 (structural steel) | S235JR and S355J2; density 7850 kg/m³ from EN 1993-1-2, 3.2.2 (EN 1993-1-1:2005, 3.2.6 gives no density) | `library/materials/common.json` | Standard text (first-generation Eurocodes) |
| EN 10088-1:2005 (stainless steels) | X5CrNi18-10 (1.4301), density 7.9 kg/dm³ (Annex A, Table A.3) | same file | Standard text of the 2005 edition (unofficial copy); the 2023 edition not seen |
| EN 1999-1-1:2007 (aluminium) | EN AW-6082 and EN AW-5754, density 2700 kg/m³ (3.2.5, one value for all alloys) | same file | Standard text |
| EN 10083-2 (C45), EN 1652 / EN 12163 (CuZn37), EN 13599 (Cu-ETP), EN 1561 (EN-GJL-250), POM-C, PA 6, PE-HD | Material designations; densities from manufacturer and supplier datasheets | same file | Secondary: two or more datasheets agree for each (EN-GJL-250 is the weakest). PTFE left out: sources disagree |

Mass in MechPilot is shown as approximate: densities vary with alloy, temper and grade. The open
questions are in [to-verify.md](to-verify.md).
