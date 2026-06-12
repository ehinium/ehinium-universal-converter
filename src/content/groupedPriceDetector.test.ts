import { Window } from "happy-dom";
import { detectGroupedPrices } from "./groupedPriceDetector";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
});

const root = document.createElement("div");

root.innerHTML = `
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

const matches = detectGroupedPrices(root);
const actual = matches.map(({ amount, currency }) => ({ amount, currency }));
const expected = [
  { amount: 164.17, currency: "USD" },
  { amount: 99.5, currency: "GBP" },
];

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
  );
}
