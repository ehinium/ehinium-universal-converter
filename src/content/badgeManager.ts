import {
  EHINIUM_IGNORE_ATTRIBUTE,
  EUC_BADGE_ATTRIBUTE,
  EUC_OWNED_ATTRIBUTE,
} from "./domExclusions";
import {
  removeExtensionOwnedTitles,
} from "./hoverRegistry";
import type { BadgeStyle } from "../types/settings";
import { markBadgeRemovalIntentional, markMovedByExtension } from "./badgeLifecycle";
import {
  clearBadgeColorVariables,
  createProtectedBadgeHost,
  forgetBadgeHost,
  setBadgeColorVariables,
} from "./badgeHost";
import { unregisterBadgeHost } from "./badgeHostRegistry";

export { getBadgeVisibleText } from "./badgeHost";

export type BadgeKey = {
  sourceCurrency: string;
  targetCurrency: string;
  amount: number;
};

export type UnitBadgeKey = {
  sourceUnit: string;
  targetUnit: string;
  amount: number;
  convertedAmount: number;
  dimensions?: readonly number[];
  range?: readonly number[];
};

type BadgeIdentity = BadgeKey | UnitBadgeKey;

export type BadgeColorContext = {
  textColor: string;
  backgroundColor: string;
  isSharedBackground: boolean;
};

type ParsedColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type EffectiveBackground = {
  element: HTMLElement;
  color: ParsedColor;
};

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';
const BADGE_KEY_ATTRIBUTE = "data-ehinium-key";
const PRICE_GROUP_ATTRIBUTE = "data-ehinium-price-group";
const PRICE_GROUP_SELECTOR = `[${PRICE_GROUP_ATTRIBUTE}="true"]`;
const INLINE_PRICE_SELECTOR = [
  ".a-price",
  ".x-price-primary",
  '[itemprop="price"]',
].join(", ");
const PRICE_CONTAINER_SELECTOR = [
  '[class*="price"]',
  '[class*="Price"]',
  '[data-testid*="price"]',
  '[aria-label*="price"]',
  ".a-price",
  ".s-item__price",
  ".product-price",
  ".price",
].join(", ");
const BADGE_CLASS = "ehinium-converter-badge";

function parseCssColor(value: string): ParsedColor | null {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "transparent") {
    return {
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0,
    };
  }

  const match = normalizedValue.match(
    /^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)(?:\s*,\s*([.\d]+)\s*)?\)$/u
  );

  if (!match) {
    return null;
  }

  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);

  if (
    !Number.isFinite(red) ||
    !Number.isFinite(green) ||
    !Number.isFinite(blue) ||
    !Number.isFinite(alpha)
  ) {
    return null;
  }

  return {
    red: Math.round(Math.min(255, Math.max(0, red))),
    green: Math.round(Math.min(255, Math.max(0, green))),
    blue: Math.round(Math.min(255, Math.max(0, blue))),
    alpha: Math.min(1, Math.max(0, alpha)),
  };
}

function formatRgb(color: ParsedColor): string {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`;
}

function formatRgba(color: ParsedColor, alpha: number): string {
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})`;
}

function readComputedStyle(element: HTMLElement): CSSStyleDeclaration | null {
  return typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
}

function isVisuallyHidden(element: HTMLElement): boolean {
  const style = readComputedStyle(element);

  if (!style) {
    return false;
  }

  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    (style.opacity.trim() !== "" && Number(style.opacity) === 0)
  );
}

function getEffectiveBackground(
  element: HTMLElement
): EffectiveBackground | null {
  let current: HTMLElement | null = element;

  while (current) {
    const style = readComputedStyle(current);
    const color = style ? parseCssColor(style.backgroundColor) : null;

    if (color && color.alpha > 0) {
      return {
        element: current,
        color,
      };
    }

    current = current.parentElement;
  }

  return null;
}

function colorsMatch(first: ParsedColor, second: ParsedColor): boolean {
  return (
    first.red === second.red &&
    first.green === second.green &&
    first.blue === second.blue &&
    Math.abs(first.alpha - second.alpha) < 0.001
  );
}

function areCloselyRelated(
  first: HTMLElement,
  second: HTMLElement
): boolean {
  return (
    first === second ||
    first.contains(second) ||
    second.contains(first) ||
    first.parentElement === second.parentElement
  );
}

function getContextTextColor(color: ParsedColor): string {
  return color.alpha >= 1 ? formatRgb(color) : formatRgba(color, color.alpha);
}

function getContextBackgroundColor(color: ParsedColor): string {
  return formatRgba(color, 0.07);
}

/**
 * The colours an inserted badge takes from `sourceElement`. Reads computed
 * styles only, so a render pass can read every badge's before writing any.
 */
export function readBadgeColorContext(
  badge: HTMLElement,
  sourceElement: HTMLElement
): BadgeColorContext | null {
  const badgeParent = badge.parentElement;
  return badgeParent ? getBadgeColorContext(sourceElement, badgeParent) : null;
}

export function applyBadgeColorContext(
  badge: HTMLElement,
  context: BadgeColorContext | null
): void {
  if (!context?.isSharedBackground) {
    return;
  }

  const badgeStyle = (badge.getAttribute("data-ehinium-badge-style") as BadgeStyle | null) ?? "default";
  setBadgeColorVariables(
    badge,
    context.textColor,
    badgeStyle !== "minimal" ? context.backgroundColor : null
  );
}

// The default badge tint over white, made opaque: the same look on a white
// page, readable on a coloured one and on one the page changes later.
const OPAQUE_BADGE_COLOR = "rgb(17, 24, 39)";
const OPAQUE_BADGE_BACKGROUND = "rgb(237, 238, 240)";

function isLightColor(color: ParsedColor): boolean {
  return (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255 > 0.5;
}

/**
 * A badge moved out of its source's box can land on another background (the
 * blue rim of a selected swatch tile), which computed colours cannot always
 * tell: a gradient leaves the background colour transparent. It takes an
 * opaque light pill, unless its source is light text on a dark page.
 */
export function refreshBadgeColorContext(badge: HTMLElement, sourceElement: HTMLElement): void {
  const badgeParent = badge.parentElement;
  if (!badgeParent) return;
  const context = getBadgeColorContext(sourceElement, badgeParent);
  const sourceStyle = readComputedStyle(sourceElement);
  const sourceColor = sourceStyle ? parseCssColor(sourceStyle.color) : null;
  const minimal = badge.getAttribute("data-ehinium-badge-style") === "minimal";
  if (context?.isSharedBackground && sourceColor && isLightColor(sourceColor)) {
    setBadgeColorVariables(badge, context.textColor, minimal ? null : context.backgroundColor);
    return;
  }
  setBadgeColorVariables(badge, OPAQUE_BADGE_COLOR, minimal ? null : OPAQUE_BADGE_BACKGROUND);
}

function normalizeAmount(amount: number): string {
  return amount
    .toFixed(6)
    .replace(/0+$/u, "")
    .replace(/\.$/u, "");
}

export function serializeBadgeKey(key: BadgeIdentity): string {
  const normalizedAmount = normalizeAmount(key.amount);

  if ("sourceUnit" in key) {
    const dimensions = key.dimensions
      ? `|${key.dimensions.map(normalizeAmount).join("x")}`
      : key.range ? `|${key.range.map(normalizeAmount).join("-")}` : "";
    return `unit|${normalizedAmount}|${key.sourceUnit}|${key.targetUnit}|${normalizeAmount(key.convertedAmount)}${dimensions}`;
  }

  return `${normalizedAmount}|${key.sourceCurrency}|${key.targetCurrency}`;
}

function isMatchingBadge(element: Element, serializedKey: string): boolean {
  return (
    element.matches(BADGE_SELECTOR) &&
    element.getAttribute(BADGE_KEY_ATTRIBUTE) === serializedKey
  );
}

export function getBadgeColorContext(
  sourceElement: HTMLElement,
  badgeParent: HTMLElement
): BadgeColorContext | null {
  if (isVisuallyHidden(sourceElement) || !sourceElement.isConnected) {
    return null;
  }

  const sourceStyle = readComputedStyle(sourceElement);
  const sourceColor = sourceStyle ? parseCssColor(sourceStyle.color) : null;

  if (!sourceColor || sourceColor.alpha <= 0) {
    return null;
  }

  const sourceBackground = getEffectiveBackground(sourceElement);
  const badgeBackground = getEffectiveBackground(badgeParent);

  if (!sourceBackground || !badgeBackground) {
    return {
      textColor: getContextTextColor(sourceColor),
      backgroundColor: getContextBackgroundColor(sourceColor),
      isSharedBackground: false,
    };
  }

  const isSharedBackground =
    sourceBackground.element === badgeBackground.element ||
    (colorsMatch(sourceBackground.color, badgeBackground.color) &&
      areCloselyRelated(sourceBackground.element, badgeBackground.element));

  return {
    textColor: getContextTextColor(sourceColor),
    backgroundColor: getContextBackgroundColor(sourceColor),
    isSharedBackground,
  };
}

export function createBadge(
  content: string,
  hoverContent: string,
  badgeStyle: BadgeStyle = "default"
): HTMLElement {
  const ariaLabel = formatBadgeAriaLabel(hoverContent, content);
  const badge = createProtectedBadgeHost(content, ariaLabel, hoverContent, badgeStyle);

  badge.classList.add(BADGE_CLASS);
  badge.setAttribute("data-ehinium-badge", "true");
  badge.setAttribute(EUC_OWNED_ATTRIBUTE, "true");
  badge.setAttribute(EUC_BADGE_ATTRIBUTE, "true");
  badge.setAttribute(EHINIUM_IGNORE_ATTRIBUTE, "true");
  badge.setAttribute("role", "button");
  badge.setAttribute("tabindex", "0");
  badge.setAttribute("aria-label", ariaLabel);
  badge.removeAttribute("title");

  return badge;
}

function formatBadgeAriaLabel(hoverContent: string, fallback: string): string {
  const [source, converted] = hoverContent.split("→").map((part) => part.trim());

  if (source && converted) {
    return `Convert ${source} to ${converted}. Click to copy.`;
  }

  return `${fallback}. Click to copy.`;
}

function createPriceGroup(): HTMLElement {
  const group = document.createElement("span");

  group.setAttribute(PRICE_GROUP_ATTRIBUTE, "true");
  group.setAttribute(EUC_OWNED_ATTRIBUTE, "true");
  group.style.display = "inline-flex";
  group.style.alignItems = "baseline";
  group.style.gap = "6px";
  group.style.flexWrap = "nowrap";
  group.style.whiteSpace = "nowrap";

  return group;
}

function insertIntoPriceGroup(
  anchor: HTMLElement,
  badge: HTMLElement
): boolean {
  const sourcePrice = anchor.closest<HTMLElement>(INLINE_PRICE_SELECTOR);

  if (!sourcePrice) {
    return false;
  }

  const existingGroup = sourcePrice.parentElement?.closest<HTMLElement>(
    PRICE_GROUP_SELECTOR
  );

  if (existingGroup) {
    existingGroup.append(badge);
    return true;
  }

  const group = createPriceGroup();

  markMovedByExtension(sourcePrice);
  sourcePrice.replaceWith(group);
  group.append(sourcePrice, badge);
  return true;
}

/**
 * `colorContext: false` leaves the colours to the caller, which reads them with
 * `readBadgeColorContext(badge, anchor)` once its other badges are in.
 */
export function insertBadgeAfter(
  anchor: HTMLElement,
  badge: HTMLElement,
  colorContext = true
): void {
  if (!insertIntoPriceGroup(anchor, badge)) {
    anchor.insertAdjacentElement("afterend", badge);
  }

  if (colorContext) applyBadgeColorContext(badge, readBadgeColorContext(badge, anchor));
}

/**
 * Moves a badge inserted with `colorContext: false` to where
 * `insertBadgeAfterTextNode` puts it now, and gives it the colours of that place.
 */
export function moveBadgeAfterTextNode(
  node: Text,
  badge: HTMLElement,
  previous?: HTMLElement | null
): void {
  clearBadgeColorVariables(badge);
  insertBadgeAfterTextNode(node, badge, previous);
}

/** Where `insertBadgeAfterTextNode` puts a badge: right after `after`. */
function textBadgePosition(
  node: Text,
  previous: HTMLElement | null | undefined
): { textParent: HTMLElement; after: Node } | null {
  const textParent = node.parentElement;
  if (!textParent) return null;
  // After an earlier badge of the same text (which may sit after a clipping box).
  if (previous?.isConnected && previous.parentElement !== textParent) {
    return { textParent, after: previous };
  }
  return { textParent, after: previous?.isConnected ? previous : node };
}

/** True when `badge` already sits where `insertBadgeAfterTextNode` would put it. */
export function isBadgeAfterTextNode(
  node: Text,
  badge: HTMLElement,
  previous?: HTMLElement | null
): boolean {
  const position = textBadgePosition(node, previous);
  return !!position && badge.previousSibling === position.after;
}

/**
 * Inserts after `node`, or after `previous` (an earlier badge for the same
 * text) so several badges of one text node keep the source order. With
 * `colorContext: false` the caller reads the colours against the text's parent.
 */
export function insertBadgeAfterTextNode(
  node: Text,
  badge: HTMLElement,
  previous?: HTMLElement | null,
  colorContext = true
): void {
  const position = textBadgePosition(node, previous);

  if (!position) {
    return;
  }

  position.after.parentNode?.insertBefore(badge, position.after.nextSibling);

  if (colorContext) applyBadgeColorContext(badge, readBadgeColorContext(badge, position.textParent));
}

export function getPriceContainer(anchor: HTMLElement): HTMLElement {
  return (
    anchor.closest<HTMLElement>(PRICE_CONTAINER_SELECTOR) ??
    anchor.parentElement ??
    anchor
  );
}

export function badgeExists(anchor: HTMLElement, key: BadgeIdentity): boolean {
  const serializedKey = serializeBadgeKey(key);
  const priceContainer = getPriceContainer(anchor);

  for (const badge of priceContainer.querySelectorAll(BADGE_SELECTOR)) {
    if (isMatchingBadge(badge, serializedKey)) {
      return true;
    }
  }

  return false;
}

export function markBadge(badge: HTMLElement, key: BadgeIdentity): void {
  badge.setAttribute("data-ehinium-badge", "true");
  badge.setAttribute(EUC_OWNED_ATTRIBUTE, "true");
  badge.setAttribute(EUC_BADGE_ATTRIBUTE, "true");
  badge.setAttribute("data-ehinium-converted", "true");
  badge.setAttribute("data-euc-badge-host", "true");
  badge.setAttribute("translate", "no");
  badge.classList.add("notranslate");
  badge.setAttribute(EHINIUM_IGNORE_ATTRIBUTE, "true");
  badge.setAttribute(BADGE_KEY_ATTRIBUTE, serializeBadgeKey(key));
  badge.removeAttribute("title");
}

function unwrapEmptyPriceGroups(root: ParentNode): void {
  const groups: HTMLElement[] = [];

  if (root instanceof HTMLElement && root.matches(PRICE_GROUP_SELECTOR)) {
    groups.push(root);
  }

  groups.push(...root.querySelectorAll<HTMLElement>(PRICE_GROUP_SELECTOR));

  for (const group of groups) {
    if (!group.querySelector(BADGE_SELECTOR)) {
      const children = Array.from(group.childNodes);
      for (const child of children) markMovedByExtension(child);
      group.replaceWith(...children);
    }
  }
}

export function removeBadges(root: ParentNode = document): void {
  markBadgeRemovalIntentional(root as Node);
  removeExtensionOwnedTitles(root);

  if (root instanceof HTMLElement && root.matches(BADGE_SELECTOR)) {
    const group = root.closest<HTMLElement>(PRICE_GROUP_SELECTOR);

    unregisterBadgeHost(root);
    forgetBadgeHost(root);
    root.remove();

    if (group) {
      unwrapEmptyPriceGroups(group);
    }

    return;
  }

  for (const badge of root.querySelectorAll<HTMLElement>(BADGE_SELECTOR)) {
    unregisterBadgeHost(badge);
    forgetBadgeHost(badge);
    badge.remove();
  }

  unwrapEmptyPriceGroups(root);
}
