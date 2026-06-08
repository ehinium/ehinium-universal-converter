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

function serializeBadgeKey(key: BadgeKey): string {
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

export function insertBadgeAfter(
  anchor: HTMLElement,
  badge: HTMLElement
): void {
  anchor.insertAdjacentElement("afterend", badge);

  const serializedKey = badge.getAttribute(BADGE_KEY_ATTRIBUTE);

  if (serializedKey !== null) {
    getPriceContainer(anchor).setAttribute(PRICE_KEY_ATTRIBUTE, serializedKey);
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

export function removeBadges(root: ParentNode = document): void {
  if (root instanceof HTMLElement && root.matches(BADGE_SELECTOR)) {
    const anchor = root.previousElementSibling;

    if (anchor instanceof HTMLElement) {
      getPriceContainer(anchor).removeAttribute(PRICE_KEY_ATTRIBUTE);
    }

    root.remove();
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
}
