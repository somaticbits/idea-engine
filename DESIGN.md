---
name: Idea Engine
description: A kinetic-mobile visual system for a focused association explorer
colors:
  ink: "#173436"
  ink-muted: "#46615d"
  ground: "#dfe9e5"
  surface: "#e7efeb"
  light: "#f4f7f1"
  line: "#b5c9c3"
  copper: "#a14d2e"
  copper-deep: "#773822"
  pinned: "#397362"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, sans-serif"
    fontSize: "clamp(2.5rem, 4vw, 5rem)"
    fontWeight: 650
    lineHeight: 1.03
    letterSpacing: "-0.028em"
  body:
    fontFamily: "Atkinson Hyperlegible, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.48
  label:
    fontFamily: "Atkinson Hyperlegible, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
rounded:
  control: "7px"
  surface: "12px"
spacing:
  tight: "8px"
  regular: "16px"
  roomy: "26px"
components:
  button-primary:
    backgroundColor: "{colors.copper}"
    textColor: "{colors.light}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-primary-hover:
    backgroundColor: "{colors.copper-deep}"
    textColor: "{colors.light}"
    rounded: "{rounded.control}"
  branch-list:
    backgroundColor: "{colors.light}"
    textColor: "{colors.ink}"
    padding: "7px 8px"
---

# Design System: Idea Engine

## Overview

**Creative North Star: "The Kinetic Mobile"**

The interface behaves like a small suspended work of art: the current idea holds the center, a handful of branches orbit it, and choosing a branch brings it into focus. A pale, cool studio wall lets the actual association pattern have the stage. The structural strokes, selected enamel weight, and legible side catalog are part of the same apparatus.

The system belongs to a creative workbench, with expressive shape in the map and straightforward task controls beside it. The first viewport makes the chosen path, the nearby possibilities and the next action understandable without reading every node at once.

**Key Characteristics:**
- Numbered weights orbit a clear center and move there when chosen; names remain available in a legible choice list.
- Deep carbon structure, cool pale field, and a rare copper signal for focus.
- Self-hosted, expressive display lettering and highly legible control copy.

## Colors

The restrained palette separates the studio field, the dark structure and the active enamel weight.

### Primary
- **Burnished Copper:** The chosen branch and primary action use the `copper` token; hover deepens to `copper-deep`.

### Secondary
- **Oxidized Green:** The `pinned` token identifies an idea already held as a concept, including in the mobile.

### Neutral
- **Carbon Ink:** `ink` carries titles, text, and the central pivot; `ink-muted` handles explanatory copy.
- **Cool Studio Field:** `ground` underlies the app, with `surface` and `light` separating the map and inspector.
- **Instrument Rule:** `line` defines quiet dividers; the connecting wires are thin, not embellished with text.

**The Single Signal Rule.** Reserve copper for the user's chosen idea and the one next action; do not scatter it across unrelated chrome.

## Typography

**Display Font:** Bricolage Grotesque Variable, self-hosted via Fontsource.

**Body Font:** Atkinson Hyperlegible, self-hosted via Fontsource.

**Character:** The display face gives titles a crafted irregularity. Body text and branch names favor recognition and clear numerals, especially at phone width.

### Hierarchy
- **Display:** Large, compact, closely set titles on the home and trip heading.
- **Title:** Smaller Bricolage section names identify the apparatus, choice catalog and selected idea.
- **Body:** Atkinson copy explains what a selection or state means in a short measure.
- **Label:** Atkinson bold keeps button text, branch numbers and form labels scannable.

**The Separate Names Rule.** Put candidate names in the catalog and inspector, not on the wires or the weights.

## Layout

The trip screen uses a broad stage with a narrower choice-and-action panel. On desktop the selected idea and its actions lead that panel, followed by the branch catalog; the path sits above both. At widths under 750px, the map, catalog and inspector stack, and a selected-node action dock stays near the thumb. The SVG switches from a wide horizontal armature to a compact vertical arrangement; position depends on branch order and viewport class, never on a new physics run. Buttons in the catalog are at least 44px high.

## Elevation & Depth

Surfaces use slight tonal differences and a one-pixel rule. The enamel weights get a small offset soft shadow, and modal sheets get a deep ambient shadow against a dark backdrop. The map's dot registration is a quiet measurement texture, not a decorative glow.

## Shapes

Weights are circles supported by thin wires. Surface corners are lightly softened; controls are modestly rounded. Circular shapes belong to the movable weights and occasional utility controls, rather than to every content block.

## Components

### Buttons
- **Primary:** Solid copper, pale lettering, generous horizontal spacing; hover deepens and keyboard focus gets an obvious outline.
- **Secondary:** Pale green surface with carbon text and a quiet outline, used for Pin and non-destructive choices.

### Cards / Containers
- **Map stage:** A broad cool plane with suspended SVG branches; numbers alone link weights to names.
- **Choice panel:** A light surface separating named options and the selected idea, without nested cards.

### Inputs / Fields
- **Style:** Pale fill, low-contrast boundary, dark caret, and a visible copper focus ring.

### Navigation
- The header exposes New trip, Trips and Settings. The active lineage is a horizontally scrollable, keyboard-focusable breadcrumb; ancestors are actionable.

### Branch Weights
- Each numbered weight has a generous hit target and accessible name. Tapping a weight moves that branch to the center and reveals its immediate children as the next orbit; a short landing animation connects the two states. Oxidized green marks pinned branches. The layout is deterministic rather than physics-driven.

## Do's and Don'ts

### Do:
- **Do** keep the selected path in view and attach the next action to its selected node.
- **Do** render model-written names as plain text in the catalog and the concept card.
- **Do** keep low-motion and keyboard paths equivalent to pointer input.

### Don't:
- **Don't** run a new force layout when selection changes.
- **Don't** repeat full node labels across the graph and a second dense list.
- **Don't** treat a full-trip dashboard as the first step of exploration.
