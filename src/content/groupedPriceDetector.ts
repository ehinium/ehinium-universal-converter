import { fiatCurrencies } from "../data/currencies";
import { isInsideExcludedContent } from "./domExclusions";

export type GroupedPriceMatch = {
  amount: number;
  currency: string;
  anchor: HTMLElement;
};

const unsafeSymbols = new Set(["R", "K", "F", "L", "P", "Q", "kr", "$", "¥"]);
const safeFallbackSymbols = new Map<string, string>([
  ["€", "EUR"],
  ["£", "GBP"],
]);
const contextualSymbols = new Set([
  "US$",
  "CA$",
  "AU$",
  "NZ$",
  "HK$",
  "SG$",
  "CN¥",
  "JP¥",
]);
const contextualFallbackSymbols = new Map<string, string>([
  ["US$", "USD"],
  ["CA$", "CAD"],
  ["AU$", "AUD"],
  ["NZ$", "NZD"],
  ["HK$", "HKD"],
  ["SG$", "SGD"],
  ["CN¥", "CNY"],
  ["JP¥", "JPY"],
]);
const HIDDEN_PRICE_SELECTOR = '.a-offscreen, [aria-hidden="true"]';
const GROUPED_PRICE_SELECTOR = ".a-price";

function normalizeSymbol(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function buildCurrencyLookup(): Map<string, string> {
  const symbolCurrencies = new Map<string, Set<string>>();

  for (const currency of fiatCurrencies) {
    const identifiers = [currency.code, ...currency.symbols];

    for (const identifier of identifiers) {
      const normalized = normalizeSymbol(identifier);

      if (!normalized) {
        continue;
      }

      const currencies = symbolCurrencies.get(normalized) ?? new Set<string>();
      currencies.add(currency.code);
      symbolCurrencies.set(normalized, currencies);
    }
  }

  const lookup = new Map<string, string>();

  for (const [symbol, currencies] of symbolCurrencies) {
    if (unsafeSymbols.has(symbol)) {
      continue;
    }

    if (contextualSymbols.has(symbol) || currencies.size === 1) {
      const currency = currencies.values().next().value;

      if (currency) {
        lookup.set(symbol, currency);
      }
    }
  }

  for (const [symbol, currency] of safeFallbackSymbols) {
    lookup.set(symbol, currency);
  }

  for (const [symbol, currency] of contextualFallbackSymbols) {
    if (fiatCurrencies.some((definition) => definition.code === currency)) {
      lookup.set(symbol, currency);
    }
  }

  return lookup;
}

const currencyBySymbol = buildCurrencyLookup();

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

export function detectGroupedPrices(root: ParentNode): GroupedPriceMatch[] {
  const matches: GroupedPriceMatch[] = [];
  const seenAnchors = new Set<HTMLElement>();

  for (const anchor of root.querySelectorAll<HTMLElement>(GROUPED_PRICE_SELECTOR)) {
    if (
      seenAnchors.has(anchor) ||
      isInsideExcludedContent(anchor) ||
      anchor.closest(HIDDEN_PRICE_SELECTOR)
    ) {
      continue;
    }

    const symbolText = anchor.querySelector<HTMLElement>(".a-price-symbol")
      ?.textContent;
    const symbol = symbolText ? normalizeSymbol(symbolText) : "";
    const currency = symbol ? currencyBySymbol.get(symbol) : undefined;
    const amount = parseGroupedAmount(anchor);

    if (!currency || amount === null) {
      continue;
    }

    seenAnchors.add(anchor);
    matches.push({
      amount,
      currency,
      anchor,
    });
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

  const matches: GroupedPriceMatch[] = [];
  for (const anchor of anchors) {
    if (
      isInsideExcludedContent(anchor) ||
      anchor.closest(HIDDEN_PRICE_SELECTOR)
    ) {
      continue;
    }
    const symbolText = anchor.querySelector<HTMLElement>(".a-price-symbol")
      ?.textContent;
    const symbol = symbolText ? normalizeSymbol(symbolText) : "";
    const currency = symbol ? currencyBySymbol.get(symbol) : undefined;
    const amount = parseGroupedAmount(anchor);
    if (currency && amount !== null) {
      matches.push({ amount, currency, anchor });
    }
  }
  return matches;
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

  const matches: GroupedPriceMatch[] = [];
  for (const anchor of anchors) {
    if (
      isInsideExcludedContent(anchor) ||
      anchor.closest(HIDDEN_PRICE_SELECTOR)
    ) {
      continue;
    }
    const symbolText = anchor.querySelector<HTMLElement>(".a-price-symbol")
      ?.textContent;
    const symbol = symbolText ? normalizeSymbol(symbolText) : "";
    const currency = symbol ? currencyBySymbol.get(symbol) : undefined;
    const amount = parseGroupedAmount(anchor);
    if (currency && amount !== null) {
      matches.push({ amount, currency, anchor });
    }
  }
  return matches;
}
