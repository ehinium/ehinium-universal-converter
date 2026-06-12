import { detectGroupedPrices } from "./groupedPriceDetector";

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

console.log(matches.map((match) => ({
  amount: match.amount,
  currency: match.currency,
  anchorClass: match.anchor.className,
})));
