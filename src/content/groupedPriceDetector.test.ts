import { Window } from "happy-dom";
import { detectGroupedPrices } from "./groupedPriceDetector";
import { setActiveCurrencyContext } from "../utils/currencyParser";
import { resolveCurrencyContext } from "../utils/currencyContext";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
});

function expectGrouped(html: string, expected: Array<{ amount: number; currency: string }>, description: string): void {
  const root = document.createElement("div");
  root.innerHTML = html;
  const actual = detectGroupedPrices(root).map(({ amount, currency }) => ({ amount, currency }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const prices = `
  <span class="a-price">
    <span class="a-price-symbol">US$</span>
    <span class="a-price-whole">164</span>
    <span class="a-price-fraction">17</span>
  </span>

  <span class="a-price">
    <span class="a-price-symbol">£</span>
    <span class="a-price-whole">99</span>
    <span class="a-price-fraction">50</span>
  </span>

  <span class="a-price">
    <span class="a-price-symbol">$</span>
    <span class="a-price-whole">10</span>
  </span>

  <span class="a-price">
    <span class="a-price-symbol">¥</span>
    <span class="a-price-whole">20</span>
  </span>
`;

// Bare "$" and "¥" resolve like text prices: the page's currency, else USD/JPY.
expectGrouped(prices, [
  { amount: 164.17, currency: "USD" },
  { amount: 99.5, currency: "GBP" },
  { amount: 10, currency: "USD" },
  { amount: 20, currency: "JPY" },
], "default symbol resolution");

setActiveCurrencyContext(resolveCurrencyContext({ hostname: "www.amazon.ca", pathname: "/dp/B0CNJXHJHK" }));
expectGrouped(prices, [
  { amount: 164.17, currency: "USD" },
  { amount: 99.5, currency: "GBP" },
  { amount: 10, currency: "CAD" },
  { amount: 20, currency: "JPY" },
], "Canadian page context");
setActiveCurrencyContext(null);

// Amazon US: the decimal point lives inside the whole part, the visual copy is aria-hidden.
expectGrouped(`
  <span class="a-price" data-a-size="xl"><span class="a-offscreen"> </span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">17<span class="a-price-decimal">.</span></span><span class="a-price-fraction">90</span></span></span>
`, [{ amount: 17.9, currency: "USD" }], "split cents keep their value");

// A price inside a screen-reader copy is not visible.
expectGrouped(`
  <span class="a-offscreen"><span class="a-price"><span class="a-price-symbol">€</span><span class="a-price-whole">5</span></span></span>
`, [], "screen-reader copy");
