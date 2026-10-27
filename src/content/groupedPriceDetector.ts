import { resolveCurrencySymbol } from "../utils/currencyParser";
import { isInsideExcludedContent } from "./domExclusions";

export type GroupedPriceMatch = {
  amount: number;
  currency: string;
  anchor: HTMLElement;
};

// Amazon renders every price twice inside `.a-price`: a screen-reader copy in
// `.a-offscreen` and a visual copy (often aria-hidden) split into symbol,
// whole and fraction. Only a price nested in a screen-reader copy is hidden.
const HIDDEN_PRICE_SELECTOR = ".a-offscreen";
const GROUPED_PRICE_SELECTOR = ".a-price";

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function parseDigits(value: string): string | null {
  const normalized = normalizeDigits(value).replace(/[\s,.٬٫]/gu, "");
  return /^\d+$/u.test(normalized) ? normalized : null;
}

function parseGroupedAmount(anchor: HTMLElement): number | null {
  const wholeElement = anchor.querySelector<HTMLElement>(".a-price-whole");
  const fractionElement =
    anchor.querySelector<HTMLElement>(".a-price-fraction");

  if (!wholeElement) {
    return null;
  }

  const whole = parseDigits(wholeElement.textContent ?? "");
  const fractionText = fractionElement?.textContent ?? "";
  const fraction = fractionElement ? parseDigits(fractionText) : "";

  if (whole === null || fraction === null) {
    return null;
  }

  const amount = Number(fraction ? `${whole}.${fraction}` : whole);
  return Number.isFinite(amount) ? amount : null;
}

function groupedMatchFor(anchor: HTMLElement): GroupedPriceMatch | null {
  if (isInsideExcludedContent(anchor) || anchor.closest(HIDDEN_PRICE_SELECTOR)) {
    return null;
  }
  const symbolText = anchor.querySelector<HTMLElement>(".a-price-symbol")?.textContent ?? "";
  const currency = symbolText.trim() ? resolveCurrencySymbol(symbolText) : undefined;
  const amount = parseGroupedAmount(anchor);
  return currency && amount !== null ? { amount, currency, anchor } : null;
}

/** True when `element` sits in an `.a-price` that the grouped detector converts. */
export function isInsideGroupedPrice(element: Element): boolean {
  const anchor = element.closest<HTMLElement>(GROUPED_PRICE_SELECTOR);
  return !!anchor && groupedMatchFor(anchor) !== null;
}

export function detectGroupedPrices(root: ParentNode): GroupedPriceMatch[] {
  const matches: GroupedPriceMatch[] = [];
  for (const anchor of root.querySelectorAll<HTMLElement>(GROUPED_PRICE_SELECTOR)) {
    const match = groupedMatchFor(anchor);
    if (match) matches.push(match);
  }
  return matches;
}

export function detectGroupedPricesForTextNodes(
  textNodes: readonly Text[]
): GroupedPriceMatch[] {
  const anchors = new Set<HTMLElement>();

  for (const node of textNodes) {
    const anchor = node.parentElement?.closest<HTMLElement>(GROUPED_PRICE_SELECTOR);
    if (anchor) {
      anchors.add(anchor);
    }
  }

  return [...anchors].map(groupedMatchFor).filter((match): match is GroupedPriceMatch => match !== null);
}

export function detectGroupedPricesInRoots(
  roots: readonly Node[]
): GroupedPriceMatch[] {
  const anchors = new Set<HTMLElement>();

  for (const root of roots) {
    const element = root instanceof Element ? root : root.parentElement;
    const containingAnchor = element?.closest<HTMLElement>(GROUPED_PRICE_SELECTOR);
    if (containingAnchor) {
      anchors.add(containingAnchor);
    }
    if (element?.matches(GROUPED_PRICE_SELECTOR)) {
      anchors.add(element as HTMLElement);
    }
    for (const anchor of element?.querySelectorAll<HTMLElement>(GROUPED_PRICE_SELECTOR) ?? []) {
      anchors.add(anchor);
    }
  }

  return [...anchors].map(groupedMatchFor).filter((match): match is GroupedPriceMatch => match !== null);
}
