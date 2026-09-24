# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Creative technologists exploring ideas for things they could build. Primary use is a longer desktop session; mobile remains fully usable for shorter visits.

## Product Purpose

Turn a short seed into a branching set of loose associations. The user follows promising branches, pins ideas worth making, and exports buildable concept cards. Success means they understand where an association came from, can choose where to go next, and leave with a prototype-sized idea.

## Positioning

The user steers an association tree one node at a time: a dose changes how loose the connections may be, an optional kit grounds them in owned equipment, Jev filters each generated batch, and pinning creates a buildable card from the actual association chain.

## Operating Context

Self-hosted, one user per local instance at 127.0.0.1; the owner supplies an OpenRouter key. Trips, nodes, kit snapshots, and pinned cards persist locally. Model calls incur the owner's spend, so state and cost feedback matter. The browser never calls the provider directly.

## Capabilities and Constraints

- Seed, dose, optional kit, expandable nodes, pinned concept cards, saved trips, Markdown and generic coding-agent exports.
- The graph is a radial branch explorer: the current idea sits in the center, immediate branches orbit it, and choosing a branch moves it to the center. The path remains visible for backtracking.
- Keep existing data, model pipeline, key handling, limits, and routes intact during the design work.
- Jev filtering is required; model text is treated as untrusted and rendered as text.
- The desktop composition is primary; selection, branching, pinning and retrieval must also be usable on touch and keyboard.

## Evidence on Hand

The runnable Svelte UI is in `web/App.svelte`. Saved local trips already show multi-level branches and pinned cards. The user found the existing force graph unintuitive, unresponsive and text-heavy. No approved visual assets or photographic material are supplied.

## Product Principles

- Exploration should make the current path and next choice obvious.
- Reveal a node's detail when it becomes relevant, without losing the surrounding branch.
- Every paid action needs clear state and recovery, without accidental duplicate calls.
- Preserve the feeling of creative possibility while keeping controls dependable.

## Accessibility & Inclusion

The core exploration flow must work with a keyboard, touch, reduced motion, and readable text at narrow viewport widths. Information and actions cannot rely solely on hover or color.
