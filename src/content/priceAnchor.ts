const PRICE_CONTAINER_SELECTOR = [
  ".a-price",
  ".price",
  ".product-price",
  '[class*="price"]',
  '[class*="Price"]',
  '[data-testid*="price"]',
].join(", ");

const EXCLUDED_ANCHOR_SELECTOR = [
  "[data-ehinium-ignore]",
  "[data-ehinium-badge]",
  "[data-ehinium-converted]",
].join(", ");

export function findPriceAnchor(node: Text): HTMLElement | null {
  const parent = node.parentElement;

  if (!parent || parent.closest(EXCLUDED_ANCHOR_SELECTOR)) {
    return null;
  }

  const priceContainer = parent.closest<HTMLElement>(PRICE_CONTAINER_SELECTOR);

  if (priceContainer?.closest(EXCLUDED_ANCHOR_SELECTOR)) {
    return null;
  }

  return priceContainer ?? parent;
}
