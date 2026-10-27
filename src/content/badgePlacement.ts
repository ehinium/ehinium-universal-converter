import { getBadgeTextBox, type BadgeTextBox } from "./badgeHost";

/**
 * A badge inserted inline can end up clipped: after the hidden lines of a
 * two-line clamped product title, below the fixed height of a size button, or
 * outside a rounded price box. It can also push the box's own text out of view
 * (`2' x 6' (Runner)` wrapping inside a fixed-height button). After insertion
 * the badge is measured against its clipping ancestors and, when one cuts its
 * text off or overflows because of it, moved after the nearest such box it can
 * leave and fit after. When no nearby box can take it (a colour swatch tile of
 * fixed size, a truncated offer in a card of fixed height), the badge is
 * reported as clipped so the caller can offer the conversion on hover.
 */

// A badge only moves out of nearby boxes; clipping is detected further up.
const MAX_ESCAPE_DEPTH = 6;
const MAX_CLIP_DEPTH = 12;
// Moving a badge out of these would leave it between table cells or list items.
const STOP_TAGS = new Set([
  "BODY", "HTML", "MAIN", "ARTICLE", "SECTION", "UL", "OL", "LI", "TABLE", "TBODY", "TR", "TD", "TH",
  "FORM", "NAV", "HEADER", "FOOTER",
]);
// Rounding in layout can put a fully visible badge a fraction outside.
const TOLERANCE_PX = 1;

/**
 * The price or measurement a badge converts: an element, or the matched
 * characters of a text node. Measured only when a box clips the badge.
 */
export type BadgeSource = Element | { node: Text; start: number; end: number };

export type ClippedBadgePlacement = {
  /** The box the badge was moved after, if any. */
  escapedAfter: Element | null;
  /** The badge stays cut off although its source is visible. */
  clipped: boolean;
  /**
   * The small box that cuts it off (a swatch tile): where a hover conversion
   * belongs, as an overlay in the tile may cover the price. Absent when the box
   * is far larger than the price (a carousel); the price takes the hover then.
   */
  clippedBy?: Element;
};

const UNCHANGED: ClippedBadgePlacement = { escapedAfter: null, clipped: false };

type Box = BadgeTextBox;
type ClippingBox = { element: Element; depth: number; afterStop: boolean; rect: DOMRect; cutsBadge: boolean };

function clipsContent(style: CSSStyleDeclaration): boolean {
  const clamp = style.getPropertyValue("-webkit-line-clamp");
  return (clamp !== "" && clamp !== "none") ||
    style.overflowX === "hidden" || style.overflowY === "hidden" ||
    style.overflowX === "clip" || style.overflowY === "clip" ||
    style.overflow === "hidden" || style.overflow === "clip";
}

/** How far `rect` reaches past each side of `box`: top, right, bottom, left. */
function reach(rect: Box, box: Box): number[] {
  return [box.top - rect.top, rect.right - box.right, rect.bottom - box.bottom, box.left - rect.left];
}

/**
 * True when `box` cuts the badge's text off, and further than it cuts the
 * source beside it: a page that clips its own price by a few pixels clips the
 * badge in the same way.
 */
function cutsText(text: Box, box: Box, source: Box | null): boolean {
  const sourceReach = source ? reach(source, box) : [0, 0, 0, 0];
  return reach(text, box).some((distance, side) => distance > Math.max(0, sourceReach[side]) + TOLERANCE_PX);
}

/** Less than half of the source shows inside `box`: the price itself is clipped out. */
function hidesSource(source: Box, box: Box): boolean {
  const shownWidth = Math.min(source.right, box.right) - Math.max(source.left, box.left);
  const shownHeight = Math.min(source.bottom, box.bottom) - Math.max(source.top, box.top);
  return shownWidth < (source.right - source.left) / 2 || shownHeight < (source.bottom - source.top) / 2;
}

function lineHeight(style: CSSStyleDeclaration): number {
  const height = parseFloat(style.lineHeight);
  return Number.isFinite(height) ? height : (parseFloat(style.fontSize) || 16) * 1.2;
}

/**
 * True when the badge makes a block box overflow by half a line or more: it
 * pushes the box's own text out of view. A line made a few pixels taller by the
 * badge does not count. Wider content counts only in a box about the size of
 * the source (a label that runs past a button's edge); a carousel row is
 * meant to scroll, and slides moving further along it hide nothing.
 */
function overflowsBecauseOf(
  badge: HTMLElement,
  box: Element,
  style: CSSStyleDeclaration,
  isSmall: () => boolean
): boolean {
  // Overflow clipping applies to block containers; inline boxes report no client size.
  if (style.display === "inline" || style.display === "contents") return false;
  const threshold = lineHeight(style) / 2;
  const tall = box.scrollHeight - box.clientHeight;
  const wide = box.scrollWidth - box.clientWidth;
  const measureWidth = wide >= threshold && isSmall();
  if (tall < threshold && !measureWidth) return false;
  const display = badge.style.display;
  badge.style.display = "none";
  const tallWithout = box.scrollHeight - box.clientHeight;
  const wideWithout = box.scrollWidth - box.clientWidth;
  badge.style.display = display;
  return tall - Math.max(0, tallWithout) >= threshold ||
    (measureWidth && wide - Math.max(0, wideWithout) >= threshold);
}

/** The source's box on screen; null when it has none to compare with (no layout). */
function measureSource(source: BadgeSource | undefined): DOMRect | null {
  if (!source) return null;
  let rect: DOMRect | undefined;
  if (source instanceof Element) {
    rect = source.getBoundingClientRect();
  } else {
    const range = source.node.ownerDocument.createRange();
    range.setStart(source.node, Math.min(source.start, source.node.length));
    range.setEnd(source.node, Math.min(source.end, source.node.length));
    rect = range.getBoundingClientRect?.();
  }
  return rect && (rect.width > 0 || rect.height > 0) ? rect : null;
}

function containsSource(box: Element, source: BadgeSource | undefined): boolean {
  return !!source && box.contains(source instanceof Element ? source : source.node);
}

/**
 * Boxes on screen, each measured once and only when a clipping box needs it:
 * `source` is the matched price or measurement itself; `anchor` the element
 * that holds it (a title, a label), which sizes are compared with.
 */
type Measured = { source: () => DOMRect | null; anchor: () => DOMRect | null };

/**
 * Ancestors that cut the badge's text off (or that it makes overflow),
 * innermost first. Null when the source itself is clipped out of one of them,
 * as with the hidden end of a horizontally scrolling row or a list price
 * pushed below a swatch tile: its badge stays hidden with it.
 */
function clippingBoxes(badge: HTMLElement, source: BadgeSource | undefined, measured: Measured): ClippingBox[] | null {
  const badgeRect = badge.getBoundingClientRect();
  let text: Box | null = null;
  const boxes: ClippingBox[] = [];
  let afterStop = false;
  let current = badge.parentElement;
  for (let depth = 0; current && depth < MAX_CLIP_DEPTH; depth++, current = current.parentElement) {
    if (current.tagName === "BODY" || current.tagName === "HTML") break;
    // Only clipping ancestors are measured; the layout is already fresh from the insertion check.
    const style = getComputedStyle(current);
    if (clipsContent(style)) {
      const rect = current.getBoundingClientRect();
      let cutsBadge = false;
      // Most clipping boxes (cards, carousels) hold the whole badge; the source
      // and the badge's text are measured only for one that does not.
      if (cutsText(badgeRect, rect, null)) {
        const sourceRect = measured.source();
        if (sourceRect && containsSource(current, source) && hidesSource(sourceRect, rect)) return null;
        // The badge's padding may be trimmed; its text may not.
        cutsBadge = cutsText(text ??= getBadgeTextBox(badge) ?? badgeRect, rect, sourceRect);
      }
      if (cutsBadge || (depth < MAX_ESCAPE_DEPTH &&
        overflowsBecauseOf(badge, current, style, () => isNearSourceSize(rect, measured.anchor())))) {
        boxes.push({ element: current, depth, afterStop, rect, cutsBadge });
      }
    }
    if (STOP_TAGS.has(current.tagName)) afterStop = true;
  }
  return boxes;
}

/** The badge's text fits in the block that lays it out; it does not spill over what follows. */
function fitsContainer(badge: HTMLElement): boolean {
  let container = badge.parentElement;
  while (container && ["inline", "contents"].includes(getComputedStyle(container).display)) {
    container = container.parentElement;
  }
  if (!container) return true;
  const text = getBadgeTextBox(badge) ?? badge.getBoundingClientRect();
  return reach(text, container.getBoundingClientRect()).every((distance) => distance <= TOLERANCE_PX);
}

/** About the size of the price's own tile, title or button, not a row of many items. */
function isNearSourceSize(rect: DOMRect, anchor: DOMRect | null): boolean {
  if (!anchor) return true;
  return rect.width <= Math.max(anchor.width * 2.5, anchor.width + 160) &&
    rect.height <= Math.max(anchor.height * 4, anchor.height + 160);
}

/** A nearby box (a clamped title, a button) the badge may move out of, not a list item or a row. */
function canEscape(box: ClippingBox, anchor: DOMRect | null): boolean {
  const width = anchor?.width ?? 0;
  return !box.afterStop && box.depth < MAX_ESCAPE_DEPTH && !STOP_TAGS.has(box.element.tagName) &&
    (width <= 0 || box.rect.width <= Math.max(width * 2.5, width + 160));
}

/**
 * Moves `badge` after the nearest ancestor whose clipping it can leave: one that
 * cuts its text off or that it makes overflow, about the size of the source's
 * element (a title, a button) rather than a row of many items. Boxes are tried
 * from the innermost out, and a place counts only when the badge is whole there
 * and fits the block it lands in. Reports whether the badge is still cut off
 * while its source is visible. `anchor` is the element that holds the source.
 */
export function escapeClippedBadge(badge: HTMLElement, source?: BadgeSource, anchor?: Element): ClippedBadgePlacement {
  if (typeof getComputedStyle !== "function") return UNCHANGED;
  const badgeRect = badge.getBoundingClientRect();
  if (badgeRect.width <= 0 && badgeRect.height <= 0) return UNCHANGED;
  let sourceRect: DOMRect | null | undefined;
  let anchorRect: DOMRect | null | undefined;
  const holder = anchor ?? (source instanceof Element ? source : source?.node.parentElement ?? undefined);
  const measured: Measured = {
    source: () => sourceRect === undefined ? (sourceRect = measureSource(source)) : sourceRect,
    anchor: () => anchorRect === undefined ? (anchorRect = measureSource(holder)) : anchorRect,
  };
  const boxes = clippingBoxes(badge, source, measured);
  if (!boxes || boxes.length === 0) return UNCHANGED;

  const parent = badge.parentNode;
  const next = badge.nextSibling;
  for (const box of boxes) {
    if (!canEscape(box, measured.anchor())) continue;
    box.element.insertAdjacentElement("afterend", badge);
    const remaining = clippingBoxes(badge, source, measured);
    if (remaining && remaining.length === 0 && fitsContainer(badge)) {
      return { escapedAfter: box.element, clipped: false };
    }
    if (!remaining) {
      parent?.insertBefore(badge, next);
      return UNCHANGED;
    }
  }
  // No room after any nearby box either (a card of fixed height around it).
  if (badge.parentNode !== parent || badge.nextSibling !== next) parent?.insertBefore(badge, next);
  const cutting = boxes.find((box) => box.cutsBadge) ?? boxes[0];
  return {
    escapedAfter: null,
    clipped: true,
    ...(isNearSourceSize(cutting.rect, measured.anchor()) ? { clippedBy: cutting.element } : {}),
  };
}
