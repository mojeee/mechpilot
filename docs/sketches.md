# Sketch constraints

MechPilot keeps the shape of a sketch with **constraints** (horizontal, tangent, a distance of
100 mm...) and **driving dimensions** (a dimension whose value sets the geometry). A solver moves the
geometry until every constraint holds. This page says what the solver does, what takes part, and
where its limits are.

## The solver

The solver is [planegcs](https://github.com/Salusoft89/planegcs), the 2D constraint solver of
FreeCAD compiled to WebAssembly (LGPL-2.0-or-later). It runs in its own worker
(`app/workers/solver`), so the drawing never freezes while it works, and it is a separate,
replaceable module: the app talks to it only through the worker protocol
(`shared/sketch/protocol.ts`). Its licence notice is in `app/workers/solver/NOTICE.md`.

The code has three layers:

- `shared/sketch/model.ts` turns the drawing into the solver's input (points, lines, circles, arcs
  and constraints as plain JSON) and the solver's output back into entities. It has no WebAssembly
  and is tested on its own.
- `shared/sketch/solver.ts` loads planegcs, solves, reads the diagnosis and computes the degree-of-
  freedom colouring.
- `app/workers/solver/index.ts` serves `solve` and `freedom` to the renderer.

Every solve works on the whole document and returns only the entities that changed, with their ids
unchanged; the UI applies them with one `updateEntities` command, so a solve is undone like any other
edit (product rule 4). Values are copied from the solver as they are: nothing is rounded (product
rule 1). A solved value within 1e-12 mm (or rad) of the stored one keeps the stored value: that is
floating-point noise (an arc end point at sin(π) = 1.2e-16 can pull a joined line end by 2e-15 mm),
far below the solver's own convergence threshold, and not an edit.

## What takes part

| Entity | In the solver | Degrees of freedom when unconstrained |
| --- | --- | --- |
| Line | two points and the line between them | 4 |
| Circle | centre point and radius | 3 |
| Arc | centre, start and end points, radius and both angles, kept consistent by planegcs' arc rules | 5 |
| Polyline (straight segments only) | one point per vertex and one line per segment | 2 per vertex |
| Polyline with any arc segment | its vertices, as **fixed** points only (other geometry can attach to them) | 0 |
| Ellipse, spline, text, annotations | not at all | — |

Every point of a solver entity is free unless a constraint holds it: a line with only a horizontal
constraint can still move up and down, left and right, and change length.

Points are named in constraints by entity and role: `a`/`b` for a line, `center` for a circle,
`center`/`start`/`end` for an arc, the vertex index for a polyline. In the solver they become
`<entity id>.a`, `<entity id>.center`, `<entity id>.3`...; constraints keep their MechPilot ids, so a
conflict reported by planegcs reads back directly as the constraint the user made.

## Constraints

| Constraint | planegcs | Notes |
| --- | --- | --- |
| coincident | `p2p_coincident` | two points in the same place |
| pointOnLine | `point_on_line_pl` | the point lies on the line's infinite extension |
| horizontal, vertical | `horizontal_l`, `vertical_l` | lines only |
| parallel, perpendicular | `parallel`, `perpendicular_ll` | two lines |
| tangent | `tangent_lc`, `tangent_la`, `tangent_cc`, `tangent_ca`, `tangent_aa`; `angle_via_point` at a shared end point | chosen by the two entity types (line–line is not a tangency); see below for fillet corners |
| equal | `equal_length` (two lines), `equal_radius_cc` / `_ca` / `_aa` | |
| symmetric | `p2p_symmetric_ppl` | two points mirrored about a line |
| fixed | `coordinate_x`/`coordinate_y` on every point, plus the radius (and for an arc both angles) | see below |
| distance | `p2p_distance` | mm |
| pointLineDistance | `p2l_distance` | mm, unsigned |
| angle | `l2l_angle_ll` | radians, counter-clockwise from line a to line b, measured between the line directions (point a → point b) |
| radius | `circle_radius`, `arc_radius` | mm |

**Fixed** is written as one equation per degree of freedom (4 for a line, 3 for a circle, 5 for an
arc), not as planegcs "fixed points": planegcs silently ignores a constraint whose unknowns are all
fixed, so a horizontal constraint on a fixed sloping line would "solve" with no error. With equations,
such a contradiction is reported like any other. A fixed entity is never moved by a solve, even when
the sketch is over-constrained.

**Tangent at a shared end point** (a fillet corner: a line or arc ending where an arc starts) is
written the way FreeCAD's Sketcher does it: `angle_via_point` through the shared point, with the
angle between the two curves' normals there set to 0 or π (whichever the current shape is closer
to). The distance-based `tangent_la` / `tangent_aa` is degenerate when the tangency point is also
the joined end point: planegcs reports it as redundant and it holds nothing. The end points count as
shared when a coincident constraint joins an end of one to an end of the other, or when they lie
within 1e-9 mm of each other; in the second case a coincident is added with the tangent.

Two pairs are checked before solving, because planegcs accepts them by shrinking a line to a point:
horizontal and vertical on the same line, and parallel and perpendicular on the same two lines. They
are reported as a conflict; the later constraint of the pair is left out of the solve so the drawing
stays as it was.

Constraints that refer to geometry the solver does not handle (an ellipse, a polyline vertex that
does not exist) are left out and listed in the message.

## Driving dimensions

A dimension with a `driving` value adds a constraint on the geometry it measures. A dimension stores
positions, not references, so its points are matched to entity points by coordinates: the first
entity point (in drawing order) within 1e-9 mm of the dimension's point. When a point matches
nothing, the dimension is not applied and the message says so.

| Dimension | Constraint |
| --- | --- |
| linear, horizontal or vertical | `difference` of the two points' x (or y), keeping the current sign |
| linear at another angle | not applied yet (planegcs has no projected distance) |
| aligned | `p2p_distance` |
| angular | `l2l_angle_ll` between the lines through the vertex and each leg point; the value is in degrees, counter-clockwise from leg a to leg b, with π added when exactly one leg runs against its line's direction |
| radius / diameter | `circle_radius` or `arc_radius` on the circle or arc with that centre and radius (value, or value / 2) |
| ordinate | `difference` of x (or y) from the origin point to the measured point, signed as the ordinate is |

Measure-only (non-driving) dimensions do not go to the solver at all: planegcs' non-driving
constraints add an unknown of their own, which spoils the degree-of-freedom count, and its own
documentation lists several that do not work.

## Groups and size

The solver works on one **group of connected geometry** at a time: entities linked by constraints or
driving dimensions. Entities with no constraint are not sent at all (they are free, with the degrees
of freedom in the table above). This keeps each solve small: planegcs analyses a system with a dense
matrix in a fixed memory of about 21 MB, so one system with thousands of unrelated entities would be
slow and soon run out of memory, while many small ones are fast (a chain of 100 joined lines solves
in well under 100 ms on a laptop).

One group may not exceed about 200,000 (unknowns × constraints): roughly a chain of 150 joined lines
with a horizontal or vertical constraint each. A larger group is not solved; the message says so and
suggests splitting it. Should planegcs still run out of memory, the worker starts a new copy of the
engine for the next request.

## What the message says

Every solve returns a diagnosis: `solved`, `conflicting`, `redundant`, `failed` or `empty`, the
degrees of freedom left, the constraint ids involved, and a sentence for the command line, in English
or Italian, for example:

- "Solved; fully constrained."
- "Solved. The sketch has 3 degrees of freedom left (for example line e7 can still move)."
- "Over-constrained: the horizontal constraint on line l12 conflicts with the angle 30° between line
  l12 and line l7. Remove one of them."
- "Solved, but the horizontal constraint on line a is redundant: the other constraints already fix
  the same thing. You can delete it."

Entities are named by type and a short id (sequential ids as they are, random ids by their first
four characters); the UI uses the ids in the diagnosis to highlight them on the drawing.

`failed` means planegcs found no solution without being able to point at the constraints: typically
constraints that contradict each other only for the actual shape (an angle of 30° between two lines
that are both horizontal), or geometry too far from the intended shape. On `failed` the group's
entities are left unchanged. On `conflicting` the solver's best attempt is returned with the
diagnosis.

## Dragging

While the user drags a point, the solver adds a **temporary** constraint pulling that point towards
the cursor. Temporary constraints give way to the real ones (planegcs switches to its SQP method), so
the point follows the cursor as far as the sketch allows: dragging a corner of a 100 × 60 rectangle
moves the whole rectangle, still 100 × 60.

## Degree-of-freedom colouring

`freedom` tells, per entity, whether the solver can still move it (`free`), cannot (`constrained`),
or does not know (`unknown`). Method:

1. Entities with no constraint are free; polylines with arcs are fixed.
2. Each group is solved. If it is over-constrained or the solve fails, its entities are `unknown`.
3. Every point of the group is pulled 1 mm in a different direction (golden-angle steps, so no two
   pulls line up) and every radius 1 mm larger, all with temporary constraints, and the group is
   solved again. The real constraints keep what they determine exactly in place; whatever can still
   move does. An entity is `free` when any of its points (or its radius) moved more than 1e-7 mm.

That is two solves per group instead of one per entity.

Limits:

- Above `maxEntities` solver entities (300 by default) everything is `unknown`, to keep the
  colouring cheap while editing.
- The test looks at small movements: freedom that only exists far from the current shape (a
  mechanism that jams) is not seen.
- In theory the pulls could cancel out for a particular degree of freedom; with irrational pull
  directions this does not happen in practice.
