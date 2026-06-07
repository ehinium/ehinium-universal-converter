# Rendering V2 Plan

## Problem

The current renderer replaces text nodes with fragments. This causes issues with:

- Chrome Translate
- React/Vue re-renders
- Amazon split-price layouts
- Duplicate badges
- Clickable cards and links

## New Strategy

Do not replace text nodes.

Instead:

1. Detect price text
2. Find a stable anchor element
3. Insert a badge after the anchor element
4. Never modify the original price text

## Badge Identity

Each badge should have a stable key:

- raw price
- source currency
- target currency
- anchor element

Before inserting a badge, check whether that badge already exists near the anchor.

## Split Price Support

Some sites split prices:

AED
17
28

or:

$
164
17

V2 should support detecting grouped price containers.

## Rules

- Never mutate original text
- Never wrap original price
- Never replace text nodes
- Never parse inside Ehinium badges/tooltips
- Prefer fewer correct conversions over many wrong conversions
- False positives are worse than missed prices

## Phases

### Phase 1
Create badge manager:
- createBadge
- badgeExists
- removeBadges
- insertBadgeAfter

### Phase 2
Refactor renderer:
- stop replacing text nodes
- insert badges after text node parent or closest price-looking parent

### Phase 3
Add grouped price detector:
- detect split prices inside parent elements
- support Amazon-style price structures

### Phase 4
Re-test:
- eBay
- Amazon
- Banggood
- Chrome Translate
