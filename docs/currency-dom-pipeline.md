# Range-aware currency DOM pipeline

Currency parsing returns exact `start`/`end` offsets, token type, and confidence.
The content renderer first parses each eligible text node. If a direct parse has
no match, it checks at most three ancestors and joins at most 24 eligible inline
text fragments totaling at most 512 characters. Traversal stops at the first
block or interactive boundary.

Combined matches are mapped back to their contributing `Text` nodes. The
renderer uses the source element for a direct match and the lowest common
element for a split match. It never marks a card or other ancestor as processed.
Exact duplicate state is held in a `WeakMap<Text, Map<matchKey, badge>>`, where
the key contains the parser-input version, range, source amount/currency, and
target currency. Each badge also carries a stable local source fingerprint and
owner-position key. Equivalent replacement nodes adopt an existing connected
badge in their local scope; changed prices remove the stale badge at that
position. Detached source nodes are released by the mutation observer.

Extension badges are excluded by exact extension-owned attributes. The legacy
`data-ehinium-price-key` container marker is no longer written or consulted.
The same source-only fragment collector is used by production combined scans,
source fingerprints, price-like diagnostics, and selected-element parsing.

Mutation records are categorized as site content, extension UI, or mixed.
Extension-only batches schedule no source scan. The existing 125 ms scan
scheduler coalesces site mutation bursts, while grouped-price detection is
restricted to grouped anchors reachable from the already-collected changed
text nodes rather than querying the document.

## Performance guard

The regression benchmark contains 1,000 ordinary text nodes, 100 two-price
cards, and 200 existing extension badges. Five complete collection passes in
happy-dom measured approximately 1.2–2.2 seconds on the development machine
(about 0.24–0.44 seconds per 1,200 source nodes). The test fails above five
seconds for five passes. Production scans remain capped at 2,500 text nodes,
and mutation scans operate on deduplicated changed roots rather than page
`innerText`.

A replacement stress fixture performs 20 equivalent rerenders across 100 price
regions. It measured approximately 5.8 seconds in happy-dom (about 291 ms per
100-region mutation batch), down from approximately 15.3 seconds before the
grouped detector was limited to changed text-node anchors. Every pass retained
exactly 100 active badges.

## Overlay-aware badge visibility

Persistent badges are inserted beside their narrow source anchor and use
`position: relative` with `z-index: auto`; they do not use a document-level
portal or a global stacking value. Each connected badge has a visibility record
containing its source element and rendering anchor. Opening an overlay changes
only that record's visibility and never repeats rate lookup or conversion.

The visibility manager observes semantic dialogs, popovers, fullscreen changes,
and newly inserted or attribute-updated fixed elements. Reconciliation is
batched with `requestAnimationFrame`. It first collects active overlay geometry,
then runs hit testing only for badges whose source or badge rectangle intersects
an active overlay. Fullscreen containment is handled before occlusion testing.
Hidden badges retain their local layout space through `visibility: hidden` and
are restored in place when the covering UI closes.

The overlay regression benchmark performs 40 visibility reconciliations across
100 badges. It measured approximately 1.2–1.5 seconds in happy-dom (about
30–38 ms per synthetic reconciliation); browser work is normally lower because
scroll and mutation bursts are animation-frame coalesced and hit testing is
limited to rectangles intersecting active overlays. There is no polling loop.
