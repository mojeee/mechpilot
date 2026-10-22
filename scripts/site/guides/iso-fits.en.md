<!--
description: What H7, g6 and H7/g6 mean: ISO 286 tolerance classes, standard tolerance grades, fundamental deviations, clearance, transition and interference fits, with a worked example.
-->
# ISO fits explained

A shaft that must turn freely in a bore, a pin that must stay put once pressed in, a bearing seat
that must locate without play: each is a *fit* between a hole and a shaft. ISO 286 gives these a
shared code, so that "⌀25 H7/g6" means the same thing in every drawing office and workshop.

## The two parts of ISO 286

- **ISO 286-1** sets out the system: standard tolerance grades, fundamental deviations, and how
  they combine into tolerance classes and fits.
- **ISO 286-2** tabulates the limit deviations of the tolerance classes for holes and shafts.

## A tolerance class is a letter and a number

A tolerance class such as **H7** or **g6** has two parts:

- The **letter** is the *fundamental deviation*: where the tolerance zone sits relative to the
  nominal size. Capital letters are for holes (internal features), lower-case letters for shafts
  (external features).
- The **number** is the *standard tolerance grade*: how wide the zone is. ISO 286 defines
  {{GRADES}} grades, from IT01 and IT0 to IT18; a higher number means a wider zone.

The width also depends on the size: the same grade allows more on a larger part. IT7 is
{{IT7_25}} µm for nominal sizes over {{S25_OVER}} up to {{S25_UPTO}} mm, and {{IT7_100}} µm over
{{S100_OVER}} up to {{S100_UPTO}} mm. All the values: [ISO 286 standard tolerance grades]({{P_GRADES}}).

## Where the zone sits

- Hole **H**: the lower deviation EI is zero, so the zone starts at the nominal size and goes up.
- Shaft **h**: the upper deviation es is zero, so the zone ends at the nominal size and goes down.
- Shafts **a to g** lie below the nominal size, shafts **k to zc** above it; holes **A to G** lie
  above it. The further the letter from h (or H), the further the zone from the nominal size.
- **js** and **JS** are symmetric about the nominal size: plus and minus half the tolerance.

Capital ES and EI are the upper and lower deviations of a hole; lower-case es and ei those of a
shaft.

## Hole and shaft together: the fit

Put a hole class and a shaft class of the same nominal size together and you have a fit, written
hole first: **H7/g6**. Depending on where the two zones lie, the fit is:

- a **clearance fit**: there is always clearance; the smallest hole is at least as large as the
  largest shaft;
- an **interference fit**: there is always interference; the largest hole is at most as large as
  the smallest shaft;
- a **transition fit**: clearance or interference, depending on the actual sizes of the parts.

Most fits are chosen in the **hole-basis system**: every hole is H and the shaft letter selects the
fit. The **shaft-basis system** does the opposite, with every shaft h. Hole-basis is often
preferred because a hole is harder to make to many different sizes than a shaft; keeping it at H
keeps the number of reamers and plug gauges down.

## Worked example: ⌀25 H7/g6

At 25 mm (the size step over {{S25_OVER}} up to {{S25_UPTO}} mm):

- Hole **25 H7**: EI = {{H7_EI}} µm, ES = {{H7_ES}} µm, so the hole is {{H7_MIN}} to {{H7_MAX}} mm.
- Shaft **25 g6**: es = {{G6_ES}} µm, ei = {{G6_EI}} µm, so the shaft is {{G6_MIN}} to {{G6_MAX}} mm.
- The clearance is between {{CL_MIN}} µm (smallest hole, largest shaft) and {{CL_MAX}} µm (largest
  hole, smallest shaft): a clearance fit.

The same table for every size step: [H7/g6]({{P_FIT_H7G6}}). Other common fits:
[ISO 286 fits]({{P_FITS}}).

## On the drawing

- On a part drawing the class follows the size: **25 H7** on the hole, **25 g6** on the shaft. The
  deviations need not be written next to a class unless they are needed (see
  [ISO 129-1 dimensioning]({{P_DIMS}})).
- On an assembly drawing the fit is written with the hole class first: **25 H7/g6**.
- Limits and fits refer to the standard reference temperature of 20 °C.

## In MechPilot

Give a dimension a tolerance class such as H7 in the Properties panel and MechPilot writes the
class and takes its deviations from its ISO 286 data (`library/fits/iso-286.json`, which cites
ISO 286-1 and ISO 286-2 and says how each value was checked). A class that is not in that data is
reported as such; it is never guessed.
