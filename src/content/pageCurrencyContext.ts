import { setActiveCurrencyContext } from "../utils/currencyParser";
import { resolveCurrencyContext, type CurrencyContext } from "../utils/currencyContext";

const STRUCTURED_CURRENCY_SELECTOR = [
  'meta[property="og:price:currency"]',
  'meta[property="product:price:currency"]',
  '[itemprop="priceCurrency"]',
].join(", ");
const MAX_STRUCTURED_SCRIPTS = 20;
const MAX_STRUCTURED_SCRIPT_LENGTH = 200_000;

let cachedKey = "";
let cachedContext: CurrencyContext | null = null;

function structuredCurrencies(root: Document): string[] {
  const currencies: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(STRUCTURED_CURRENCY_SELECTOR)) {
    const value = element.getAttribute("content") ?? element.textContent ?? "";
    if (/^[A-Za-z]{3}$/u.test(value.trim())) currencies.push(value.trim().toUpperCase());
  }
  const scripts = [...root.querySelectorAll('script[type="application/ld+json"]')].slice(0, MAX_STRUCTURED_SCRIPTS);
  for (const script of scripts) {
    const text = (script.textContent ?? "").slice(0, MAX_STRUCTURED_SCRIPT_LENGTH);
    for (const match of text.matchAll(/"priceCurrency"\s*:\s*"([A-Za-z]{3})"/gu)) {
      currencies.push(match[1].toUpperCase());
    }
  }
  return currencies;
}

/**
 * Reads the page's currency signals (structured data, domain, storefront path,
 * language) once per URL and makes them the parser's context.
 */
export function refreshPageCurrencyContext(root: Document = document): CurrencyContext | null {
  const ldCount = root.querySelectorAll('script[type="application/ld+json"]').length;
  const key = `${root.location?.href ?? ""}|${ldCount}|${root.documentElement.lang}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cachedContext = resolveCurrencyContext({
      hostname: root.location?.hostname ?? "",
      pathname: root.location?.pathname ?? "",
      language: root.documentElement.lang || root.documentElement.getAttribute("xml:lang"),
      structuredCurrencies: structuredCurrencies(root),
    });
  }
  setActiveCurrencyContext(cachedContext);
  return cachedContext;
}
