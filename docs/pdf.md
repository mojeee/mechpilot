# PDF export

MechPilot writes sheets as **vector PDF**: every line, arc, circle, ellipse, filled shape and text
of the sheet becomes a PDF path or text object. Nothing is rasterised, so the file stays sharp at
any zoom and prints at the size it was drawn.

The code is `shared/pdf/index.ts` (`pdfFromPages`), built on [pdf-lib](https://github.com/Hopding/pdf-lib)
(MIT, pure JavaScript). It draws the same display primitives as the screen (`shared/draw/primitives.ts`),
so the PDF shows exactly the geometry of the sheet on screen.

## True scale

- One PDF page per sheet. The page size (MediaBox) is the paper size in mm converted with the
  exact factor 1 mm = 72/25.4 pt (an A4 landscape page is 841.88976… × 595.27559… pt).
- Coordinates are written with full double precision, never rounded: 1 mm on the sheet is 1 mm on
  paper. Print with "Actual size" (not "Fit to page") to keep the scale.
- Arcs and circles are cubic Bézier curves (at most 90° each) within 0.005 mm of the true circle;
  ellipses are fine polylines within 0.005 mm.

## Black and line widths

- Everything is drawn in **black**: layer and screen colours are not printed.
- Line widths come from the line type (ISO 128-2). A width of 0 is printed as **0.13 mm**, the
  thinnest line of the ISO 128-2 line-width series. Dashes are written in mm, at true scale.

## Text and characters

- Text uses **Helvetica**, one of the 14 standard PDF fonts that every PDF reader has, so **no
  font is embedded** and files stay small. The font size is set so that the cap height equals the
  text height of the drawing (Helvetica cap height = 0.718 em), and alignment uses Helvetica's real
  character widths.
- Helvetica in a PDF covers the **WinAnsi (Windows-1252) character set**: Latin letters with
  accents and the drawing symbols Ø ° ± × µ are fine. A minus sign (−) is written as a hyphen, ⌀ as
  Ø, Greek μ as µ; any other character outside the set (Greek, Cyrillic, CJK, emoji, ≤ …) is
  printed as `?`.

## Metadata

Title, author and the creating application are written to the document information. Sheet titles
appear as page labels in the reader. For tests and CI a deterministic mode gives byte-identical
files (fixed dates, uncompressed content).
