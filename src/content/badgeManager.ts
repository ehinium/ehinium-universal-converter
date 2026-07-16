import {
  EHINIUM_IGNORE_ATTRIBUTE,
  EUC_BADGE_ATTRIBUTE,
  EUC_OWNED_ATTRIBUTE,
} from "./domExclusions";
import {
  removeExtensionOwnedTitles,
} from "./hoverRegistry";
import type { BadgeStyle } from "../types/settings";
import { markBadgeRemovalIntentional } from "./badgeLifecycle";
import {
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

function applyBadgeColorContext(
  badge: HTMLElement,
  sourceElement: HTMLElement,
  badgeStyle: BadgeStyle
): void {
  const badgeParent = badge.parentElement;

  if (!badgeParent) {
    return;
  }

  const context = getBadgeColorContext(sourceElement, badgeParent);

  if (!context?.isSharedBackground) {
    return;
  }

  setBadgeColorVariables(
    badge,
    context.textColor,
    badgeStyle !== "minimal" ? context.backgroundColor : null
  );
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
    return `unit|${normalizedAmount}|${key.sourceUnit}|${key.targetUnit}|${normalizeAmount(key.convertedAmount)}`;
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

  sourcePrice.replaceWith(group);
  group.append(sourcePrice, badge);
  return true;
}

export function insertBadgeAfter(
  anchor: HTMLElement,
  badge: HTMLElement
): void {
  if (!insertIntoPriceGroup(anchor, badge)) {
    anchor.insertAdjacentElement("afterend", badge);
  }

  applyBadgeColorContext(
    badge,
    anchor,
    (badge.getAttribute("data-ehinium-badge-style") as BadgeStyle | null) ??
      "default"
  );
}

export function insertBadgeAfterTextNode(
  node: Text,
  badge: HTMLElement
): void {
  const parent = node.parentElement;

  if (!parent) {
    return;
  }

  parent.insertBefore(badge, node.nextSibling);

  applyBadgeColorContext(
    badge,
    parent,
    (badge.getAttribute("data-ehinium-badge-style") as BadgeStyle | null) ??
      "default"
  );
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
      group.replaceWith(...Array.from(group.childNodes));
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
