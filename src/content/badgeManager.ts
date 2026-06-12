import { EHINIUM_IGNORE_ATTRIBUTE } from "./domExclusions";
import { registerHoverTarget } from "./hoverRegistry";

export type BadgeKey = {
  sourceCurrency: string;
  targetCurrency: string;
  amount: number;
};

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';
const BADGE_KEY_ATTRIBUTE = "data-ehinium-key";
const PRICE_KEY_ATTRIBUTE = "data-ehinium-price-key";
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

export function serializeBadgeKey(key: BadgeKey): string {
  const normalizedAmount = key.amount
    .toFixed(6)
    .replace(/0+$/u, "")
    .replace(/\.$/u, "");

  return `${normalizedAmount}|${key.sourceCurrency}|${key.targetCurrency}`;
}

function isMatchingBadge(element: Element, serializedKey: string): boolean {
  return (
    element.matches(BADGE_SELECTOR) &&
    element.getAttribute(BADGE_KEY_ATTRIBUTE) === serializedKey
  );
}

export function createBadge(
  content: string,
  hoverContent: string
): HTMLElement {
  const badge = document.createElement("span");

  badge.setAttribute("data-ehinium-badge", "true");
  badge.setAttribute("data-ehinium-converted", "true");
  badge.setAttribute(EHINIUM_IGNORE_ATTRIBUTE, "true");
  badge.title = hoverContent;
  badge.textContent = content;
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.verticalAlign = "middle";
  badge.style.marginLeft = "6px";
  badge.style.marginInlineStart = "6px";
  badge.style.padding = "2px 6px";
  badge.style.borderRadius = "999px";
  badge.style.background = "rgba(17, 24, 39, 0.08)";
  badge.style.color = "rgb(17, 24, 39)";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "600";
  badge.style.lineHeight = "1.4";
  badge.style.whiteSpace = "nowrap";
  badge.style.textDecoration = "none";
  badge.style.pointerEvents = "auto";
  badge.style.position = "relative";
  badge.style.zIndex = "2147483647";

  registerHoverTarget(badge, hoverContent);
  return badge;
}

function createPriceGroup(): HTMLElement {
  const group = document.createElement("span");

  group.setAttribute(PRICE_GROUP_ATTRIBUTE, "true");
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

  const serializedKey = badge.getAttribute(BADGE_KEY_ATTRIBUTE);

  if (serializedKey !== null) {
    getPriceContainer(anchor).setAttribute(PRICE_KEY_ATTRIBUTE, serializedKey);
  }
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

  const serializedKey = badge.getAttribute(BADGE_KEY_ATTRIBUTE);

  if (serializedKey !== null) {
    getPriceContainer(parent).setAttribute(PRICE_KEY_ATTRIBUTE, serializedKey);
  }
}

export function getPriceContainer(anchor: HTMLElement): HTMLElement {
  return (
    anchor.closest<HTMLElement>(PRICE_CONTAINER_SELECTOR) ??
    anchor.parentElement ??
    anchor
  );
}

export function badgeExists(anchor: HTMLElement, key: BadgeKey): boolean {
  const serializedKey = serializeBadgeKey(key);
  const priceContainer = getPriceContainer(anchor);

  if (priceContainer.getAttribute(PRICE_KEY_ATTRIBUTE) === serializedKey) {
    return true;
  }

  for (const badge of priceContainer.querySelectorAll(BADGE_SELECTOR)) {
    if (isMatchingBadge(badge, serializedKey)) {
      return true;
    }
  }

  return false;
}

export function markBadge(badge: HTMLElement, key: BadgeKey): void {
  badge.setAttribute("data-ehinium-badge", "true");
  badge.setAttribute("data-ehinium-converted", "true");
  badge.setAttribute(EHINIUM_IGNORE_ATTRIBUTE, "true");
  badge.setAttribute(BADGE_KEY_ATTRIBUTE, serializeBadgeKey(key));
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
  if (root instanceof HTMLElement && root.matches(BADGE_SELECTOR)) {
    const anchor = root.previousElementSibling;
    const parent = root.parentElement;
    const group = root.closest<HTMLElement>(PRICE_GROUP_SELECTOR);

    if (anchor instanceof HTMLElement) {
      getPriceContainer(anchor).removeAttribute(PRICE_KEY_ATTRIBUTE);
    }

    if (parent) {
      getPriceContainer(parent).removeAttribute(PRICE_KEY_ATTRIBUTE);
    }

    root.remove();

    if (group) {
      unwrapEmptyPriceGroups(group);
    }

    return;
  }

  for (const badge of root.querySelectorAll(BADGE_SELECTOR)) {
    badge.remove();
  }

  if (
    root instanceof HTMLElement &&
    root.hasAttribute(PRICE_KEY_ATTRIBUTE)
  ) {
    root.removeAttribute(PRICE_KEY_ATTRIBUTE);
  }

  for (const priceContainer of root.querySelectorAll(
    `[${PRICE_KEY_ATTRIBUTE}]`
  )) {
    priceContainer.removeAttribute(PRICE_KEY_ATTRIBUTE);
  }

  unwrapEmptyPriceGroups(root);
}
