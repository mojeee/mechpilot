# Parts: the 3D feature tree

A **part** turns closed outlines from the 2D drawing into a solid, one **feature** at a time:
sketch, extrude, revolve, hole, fillet, chamfer, shell, mirror, pattern and import. The features are
stored in the drawing file (`docs/file-format.md`, `parts`), so the solid is always rebuilt from
them: change a dimension in the sketch or a value in a feature and the part follows. This page says
what each feature does, how sketches sit in space, how edges and faces are chosen, where hole sizes
come from, what can be exported, and where the limits are.

## The kernel

Solids are built by [OpenCascade](https://dev.opencascade.org) compiled to WebAssembly
(opencascade.js, LGPL-2.1), through the [replicad](https://replicad.xyz) library (MIT). It runs in
its own worker (`app/workers/kernel`), so the drawing never freezes while a part builds, and it is a
separate, replaceable module: the app talks to it only through the worker protocol
(`shared/cad/protocol.ts`). Its licence notice is in `app/workers/kernel/NOTICE.md`.

The code has three layers:

- `shared/cad/profile.ts` turns the entities of a sketch into closed loops (an outer loop and its
  holes) and says in plain words what is wrong when they do not close. No WebAssembly; tested on
  its own.
- `shared/cad/build.ts` runs the feature tree with replicad and OpenCascade, measures the result
  and writes the exports.
- `shared/cad/kernel.ts` loads the engine once; `app/workers/kernel/index.ts` serves it to the app.

## How a build runs

The features run from the top of the list down. Each one changes the body built so far.

- A **suppressed** feature is skipped (status `skipped`): the part is built as if it were not there.
- A feature that **cannot be built** is marked `failed` with a message that says what happened and
  what to try ("The fillet of 5 mm does not fit on these edges; try a smaller radius or fewer
  edges."). The build carries on with the body as it was before that feature, so one bad feature
  never loses the whole part.
- A feature that uses a **failed or suppressed sketch** is skipped.
- Every new body is checked by OpenCascade (`BRepCheck_Analyzer`) and must have a volume; a result
  that fails the check counts as a failed feature.

The result has the mesh for the 3D view, the mass properties (volume in mm³, surface area in mm²,
centre of mass and bounding box in mm), the status of every feature and the errors.

Rebuilds are fast because the kernel keeps the bodies of the last build: when only the last
features change, the leading ones are not built again. The bracket of `tests/cad-build.test.ts` (a
plate with four clearance holes) builds in about 0.3 s the first time, in a few milliseconds when
nothing changed, and in about 0.15 s when only the holes changed.

## Sketches and planes

A **sketch** is a set of entities of the drawing (lines, arcs, circles, polylines with or without
bulges, ellipses and splines) placed on one of the three principal planes, moved along the plane's
normal by an **offset**. The drawing's x and y become:

| Plane | sketch x → | sketch y → | normal (offset direction) | Seen from |
| --- | --- | --- | --- | --- |
| XY | X | Y | +Z | above: reads as a top view |
| XZ | X | Z | −Y | the front (ISO 5456-2 view A): reads as a front view |
| YZ | Y | Z | +X | the right |

So a sketch on XZ at offset 5 lies in the plane Y = −5.

The entities must make **closed loops**: every end must meet exactly one other end (within
0.000001 mm), and loops must not cross. A loop inside another is a hole; a loop inside a hole is an
island (a second piece of material); separate loops make separate pieces. Text and annotations in a
sketch are ignored. When the loops do not close the sketch says where:

- "The sketch 'Base' is not closed: the end of line e7 at (120, 70) meets nothing."
- "The sketch 'Base' branches at (0, 0): line a, line c, line d meet there; a closed profile has
  exactly two curves at every corner."
- "The sketch 'Base' has curves that cross or overlap near (5, 5): line d1 and line d2."

Curves keep their exact shape: lines, arcs and bulges become lines and circular arcs, ellipses
become elliptical arcs, and splines are split into exact Bézier pieces. Only a spline whose knot
vector is not clamped is flattened (within 0.01 mm).

A sketch alone builds nothing; extrude, revolve and hole read it. A sketch whose outline is open is
marked failed only when an extrude or revolve needs its outline (a hole sketch only needs points).

## Features

| Feature | What it does |
| --- | --- |
| **Extrude** | Pushes the sketch's regions along the plane normal by the distance: **normal**, **reverse** (−normal) or **both** (half on each side of the plane). **Add** joins the result to the body (or starts the body); **cut** removes it. A cut that removes nothing, or everything, is reported. |
| **Revolve** | Turns the regions around an axis given by two points of the sketch, by an angle up to 360°. The profile must stay on one side of the axis. Add or cut as above. |
| **Hole** | Drills a cylinder at every circle centre, line end point and polyline vertex of its sketch, starting on the sketch plane and going **into the plane** (−normal): to a depth in mm, or **through** the whole body. Holes that do not touch the body are reported with the direction they were drilled in. Blind holes have a flat bottom. |
| **Fillet** | Rounds the chosen edges with a radius. |
| **Chamfer** | Bevels the chosen edges by an equal distance on both faces. |
| **Shell** | Hollows the body to a wall thickness, opening the chosen faces; with no face chosen, the body becomes a closed hollow. |
| **Mirror** | Mirrors the body across a principal plane at an offset and joins both halves. |
| **Pattern** | Repeats the body: **linear** in a grid (count and spacing along two axes) or **circular** around the X, Y or Z axis through the origin. A circular pattern over 360° spreads the copies evenly; over a smaller angle the last copy sits at that angle. At most 1000 copies. |
| **Import** | A STEP file kept inside the drawing as the body (or joined to it). |

### Choosing edges and faces

Fillets and chamfers choose edges without clicking in 3D, so the choice survives every rebuild:

| Selector | Edges |
| --- | --- |
| all | every edge of the body |
| parallel to X, Y or Z | straight edges along that axis |
| in a plane | edges lying in a principal plane at an offset (offset along the plane normal, as for sketches) |
| of a length | edges of that length, within 0.000001 mm |
| in a box | edges that lie completely inside an axis-aligned box |

A shell opens faces by the direction they face (+X, −X, +Y, −Y, +Z, −Z: plane faces whose outward
normal points that way) or by a principal plane at an offset. When no edge or face matches, the
feature says so instead of doing nothing.

## Holes from the library

Hole sizes come from `library/holes`, never from numbers typed into the code:

- **Simple**: the diameter as given.
- **Clearance**: ISO 273 clearance holes, fine, medium or coarse series
  (`library/holes/iso-273.json`). M8 medium is Ø9.
- **Tapped**: the tap drill for the thread (`library/holes/tap-drills.json`, ISO 2306). The hole is
  drilled at the tap drill diameter; the thread itself is not modelled.

An unknown thread fails the feature with the list of threads the library has.

## Exports

| Format | What is written |
| --- | --- |
| STEP | AP214, millimetres, the exact B-rep (`STEPControl_Writer`). Reading the file back gives the same volume to 0.000001 mm³ (tested). |
| STL | Binary (80-byte header, triangle count, 50 bytes per triangle) or ASCII, millimetres, triangulated within 0.01 mm. |
| 3MF | A 3MF Core 1.x package (a ZIP of `[Content_Types].xml`, `_rels/.rels` and `3D/3dmodel.model`), one mesh object in millimetres, vertices shared between triangles, triangulated within 0.01 mm. |

The 3D view uses a coarser mesh (0.05 mm, 0.3 rad), with a face number for every triangle (for
picking) and the sharp edges as line segments.

## Sections and drawing views

- **Section**: cuts the body with a principal plane at an offset and returns the outline as closed
  loops, in the plane's 2D coordinates (the same as a sketch on that plane) and in 3D.
- **Projection** for drawing views: the visible and hidden edges of the body seen from the front,
  top, right, left, back, bottom or an isometric direction, as 2D polylines in mm. The cameras
  follow ISO 5456-2 (first angle by default): the front view looks along +Y with X to the right
  and Z up; the top view looks down −Z with X to the right and Y up; the right view looks along −X
  with Y to the right; the left view looks along +X with −Y to the right; the back view looks along
  −Y with −X to the right; the bottom view looks along +Z with X to the right and −Y up. Where the
  views go on the sheet (first or third angle) is decided by the drawing, not by the kernel. Hidden
  edges that lie on visible ones (the back edges of a box seen from the front) are left out.

## Known limits

- Sketches lie on the three principal planes only, not on faces of the body or on tilted planes.
- Holes are plain cylinders: no countersinks, counterbores, drill-point cones or modelled threads.
- Chamfers have equal distances; fillets have one radius per feature.
- Patterns repeat the whole body built so far, not single features; circular patterns turn around
  an axis through the origin.
- Sections and projections work on the finished body, sampled every 0.5 mm along curves (at most
  720 points per edge); a section returns open chains too if OpenCascade leaves a gap.
- Edge and face choices are geometric rules: there are no named (persistent) edges yet, so a
  selector such as "of a length" may pick other edges after a big change.
- Error messages are translated in the worker's language, which is English until the kernel
  protocol carries the language.
- The first STEP export or import after start loads OpenCascade's STEP modules, which takes about a
  second.
