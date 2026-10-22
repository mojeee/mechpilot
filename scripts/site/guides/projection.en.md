<!--
description: First angle and third angle projection compared: where each view goes around the front view, the projection symbol, which regions use which method, and how MechPilot handles it.
-->
# First angle and third angle projection

A production drawing shows a part in several orthographic views. Each view looks at the part along
one direction, square to a projection plane. Both methods below produce exactly the same views; they
differ only in **where each view is placed on the sheet**. A reader who assumes the wrong method
reads the part mirrored, so every drawing says which method it uses.

The methods are defined in **ISO 5456-2** (projection methods, orthographic representations). The
basic conventions for views, such as choosing the principal view, are in **ISO 128-30**.

## The front view comes first

The most informative view of the part is drawn as the front view, also called the principal view.
The other views are placed around it, and only as many as are needed to define the part completely
and without ambiguity.

## First angle method

Imagine the part between you and the projection plane: each view is projected *through* the part
onto the plane behind it. Relative to the front view:

- the view from above goes **below**;
- the view from below goes **above**;
- the view from the left goes **on the right**;
- the view from the right goes **on the left**.

## Third angle method

Imagine the projection plane between you and the part, as if you looked through a window: each view
is drawn on the window on your side. Relative to the front view:

- the view from above goes **above**;
- the view from below goes **below**;
- the view from the left goes **on the left**;
- the view from the right goes **on the right**.

[[FIG:projection-layout]]

## The projection symbol

Because the views themselves do not show the method, the drawing carries a graphical symbol defined
in ISO 5456-2: a truncated cone shown in two views. In the first angle symbol the end view (two
circles) is to the right of the side view; in the third angle symbol it is to the left. The symbol
belongs near the title block; ISO 7200 does not list it among the title-block data fields, it is
shown outside the block when used ([ISO 7200 title block]({{P_TITLE_BLOCK}})).

[[FIG:projection-symbols]]

## Which one to use

Both methods are standard. First angle is the usual choice in most of Europe and in many other
countries; third angle is the usual choice in North America, where ASME Y14.3 uses it by default.
Use the method your customer or your company expects, show its symbol, and never mix the two
methods on one drawing.

When the usual places do not suit a drawing, ISO 5456-2 also allows the reference arrow method:
each view is identified by a letter and an arrow on another view shows the viewing direction, so
the views may go anywhere on the sheet.

## In MechPilot

Every drawing has a projection setting: first angle by default, third angle as an option (in the
Properties panel with nothing selected; it is stored in the file as `"projection": "first"` or
`"third"`). Front, top, side and isometric views generated from 3D parts, placed by that setting,
are part of milestone M5.

Related: [ISO fits explained]({{P_GUIDE_FITS}}).
