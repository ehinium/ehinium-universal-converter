import { Window } from "happy-dom";
import type { CurrencyMatch } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";
import {
  collectCurrencyDomMatches,
  collectSourceTextFragments,
} from "./currencyDomMatches";
import {
  classifyMutationBatch,
  observeDomChanges,
} from "./observer";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  localStorage: window.localStorage,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});

const visibleRect = {
  x: 0, y: 0, top: 0, right: 100, bottom: 20, left: 0,
  width: 100, height: 20, toJSON: () => ({}),
};

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => visibleRect,
});

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function createRoot(value: string | number): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  if (typeof value === "string") {
    root.innerHTML = value;
  } else {
    for (let index = 0; index < value; index++) {
      const node = document.createElement("span");
      node.textContent = `ordinary text ${index}`;
      root.append(node);
    }
  }
  document.body.append(root);
  return root;
}

function render(root: HTMLElement): number {
  return renderConversions(getTextNodes(root), {
    enabled: true,
    targetCurrency: "USD",
    converterMode: "currencies",
    badgeStyle: "default",
    badgeVisibility: "always",
    unitSystem: "metric",
    targetLengthUnit: "auto",
    targetWeightUnit: "auto",
    targetTemperatureUnit: "auto",
    scanRoots: [root],
    convertAmount: (match: CurrencyMatch) => match.amount / 10,
  });
}

function expectIdempotent(root: HTMLElement, expectedBadges: number): void {
  render(root);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, expectedBadges, "idempotent badge count");
  expectEqual(root.querySelectorAll("[data-ehinium-price-key]").length, 0, "no broad price marker");
}

{
  const root = createRoot('<p><strong>Standard with ads</strong><span>: 4.99€ / month</span></p>');
  expectIdempotent(root, 1);
  expectEqual(root.querySelector("span")?.querySelector(BADGE_SELECTOR) !== null, true, "badge near direct price span");
}

{
  const root = createRoot('<p><span>3.99€ / month with ads or 4.99€ / month without ads</span></p>');
  expectIdempotent(root, 2);
}

{
  const root = createRoot('<div class="plan-card"><h3>Individual</h3><p>Free for first 1 month</p><p>TRY 99/month after</p></div>');
  expectIdempotent(root, 1);
  const later = document.createElement("p");
  later.textContent = "TRY 109/month";
  root.querySelector(".plan-card")?.append(later);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "later sibling remains processable");
}

{
  const root = createRoot('<div class="plan-card"><p>TRY 135 / month</p><p>TRY 165 / month</p></div>');
  expectIdempotent(root, 2);
}

{
  const root = createRoot('<p>Free for first 1 month, then TRY 55 per month after.</p>');
  expectIdempotent(root, 1);
}

{
  const root = createRoot('<p><span>4.99</span><span>€</span><span> / month</span></p>');
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "split EUR candidate count");
  expectEqual(candidates[0]?.scanKind, "combined-inline", "split EUR scan kind");
  expectEqual(candidates[0]?.sourceNodes.length, 2, "split EUR mapped source nodes");
  expectEqual(candidates[0]?.renderingAnchor.tagName, "P", "split EUR narrow anchor");
  expectIdempotent(root, 1);
}

{
  const root = createRoot('<p><span>TRY</span><span>99</span><span>/month</span></p>');
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "split TRY candidate count");
  expectEqual(candidates[0]?.sourceNodes.length, 2, "split TRY mapped source nodes");
  expectIdempotent(root, 1);
}

{
  const root = createRoot('<div><p>TRY 99/month</p><p>TRY 55/month</p><span class="ehinium-converter-badge" data-ehinium-badge="true" data-ehinium-converted="true">$2.11</span></div>');
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 3, "two source badges plus existing generated badge");
}

{
  const root = createRoot('<p>TRY 99/month</p>');
  render(root);
  const source = root.querySelector("p")?.firstChild as Text;
  source.textContent = "TRY 109/month";
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "changed text replaces stale badge");
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, "$10.90", "changed text conversion");

  root.querySelector(BADGE_SELECTOR)?.remove();
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "manually removed badge recreated");
}

{
  const root = createRoot('<div id="price-region"><p>AED 12.00</p></div>');
  const region = root.querySelector("#price-region") as HTMLElement;
  render(root);
  for (let replacement = 0; replacement < 10; replacement++) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "AED 12.00";
    region.replaceChildren(paragraph);
    render(root);
    expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "equivalent replacement badge count");
  }
  expectEqual(root.querySelectorAll("[data-ehinium-source-fingerprint]").length, 1, "equivalent replacement owner count");
}

{
  const root = createRoot('<div><p>AED 12.00</p><p>AED 12.00</p></div>');
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "two equal source occurrences");
  const container = root.firstElementChild as HTMLElement;
  const replacement = document.createElement("p");
  replacement.textContent = "AED 12.00";
  container.firstElementChild?.replaceWith(replacement);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "equal sibling replacement remains distinct");
}

{
  const root = createRoot('<div><p>AED 12.00</p></div>');
  render(root);
  const container = root.firstElementChild as HTMLElement;
  const replacement = document.createElement("p");
  replacement.textContent = "AED 15.00";
  container.replaceChildren(replacement);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "changed replacement badge count");
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, "$1.50", "changed replacement conversion");
}

{
  const root = createRoot('<div><p>AED 12.00 <span class="ehinium-converter-badge" data-ehinium-badge="true" data-ehinium-converted="true">$3.27</span></p></div>');
  const collection = collectSourceTextFragments(root.firstElementChild as HTMLElement);
  expectEqual(collection.input.trim(), "AED 12.00", "extension badge excluded from combined input");
  expectEqual(collection.excludedExtensionFragmentCount, 1, "excluded extension fragment count");
  expectEqual(collection.combinedTextContainsExtensionUi, false, "combined input extension invariant");
}

{
  const root = createRoot(`
    <span class="a-price">
      <span class="a-price-symbol">AED</span>
      <span class="a-price-whole">12</span>
      <span class="a-price-fraction">00</span>
    </span>
  `);
  render(root);
  const oldAnchor = root.querySelector(".a-price") as HTMLElement;
  const replacement = document.createElement("span");
  replacement.className = "a-price";
  replacement.innerHTML = '<span class="a-price-symbol">AED</span><span class="a-price-whole">12</span><span class="a-price-fraction">00</span>';
  oldAnchor.replaceWith(replacement);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "grouped equivalent replacement adoption");
}

{
  const root = createRoot(`
    <span class="a-price">
      <span class="a-offscreen">AED 118.94</span>
      <span aria-hidden="true">
        <span class="a-price-symbol">AED</span>
        <span class="a-price-whole">118</span>
        <span class="a-price-fraction">94</span>
      </span>
    </span>
  `);
  expectEqual(getTextNodes(root).length, 0, "grouped fixture has no eligible text nodes");
  expectEqual(render(root), 1, "grouped root discovery does not require eligible descendants");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "hidden-fragment grouped badge count");
}

{
  const record = {
    type: "childList",
    target: document.body,
    addedNodes: [document.createElement("span")],
    removedNodes: [],
  } as unknown as MutationRecord;
  (record.addedNodes[0] as Element).setAttribute("data-ehinium-badge", "true");
  expectEqual(classifyMutationBatch([record]), "extension-ui", "extension-only mutation category");
}

{
  const root = createRoot('<div><p>TRY 99/month</p></div>');
  render(root);
  const paragraph = root.querySelector("p") as HTMLElement;
  const stop = observeDomChanges((roots) => {
    for (const mutationRoot of roots) {
      if (mutationRoot instanceof HTMLElement) {
        render(mutationRoot);
      }
    }
  });
  paragraph.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  root.append(paragraph);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "removed and reinserted source rendered once");
  stop();
}

const performanceRoot = createRoot(1000);
for (let index = 0; index < 100; index++) {
  const card = document.createElement("div");
  card.innerHTML = `<p>TRY ${99 + index}/month</p><p>EUR ${10 + index}.99/month</p>`;
  performanceRoot.append(card);
}
for (let index = 0; index < 200; index++) {
  const badge = document.createElement("span");
  badge.setAttribute("data-ehinium-badge", "true");
  badge.setAttribute("data-ehinium-converted", "true");
  badge.textContent = "$1.00";
  performanceRoot.append(badge);
}
const started = performance.now();
for (let pass = 0; pass < 5; pass++) {
  collectCurrencyDomMatches(getTextNodes(performanceRoot));
}
const duration = performance.now() - started;
if (duration > 5000) {
  throw new Error(`bounded DOM scan performance regression: ${duration.toFixed(1)}ms`);
}
console.log(`Generic real-DOM regressions passed; performance fixture ${duration.toFixed(1)}ms for five scans.`);

const replacementStressRoot = createRoot(
  Array.from({ length: 100 }, (_, index) =>
    `<section data-region="${index}"><p>AED ${12 + index}.00</p></section>`
  ).join("")
);
render(replacementStressRoot);
const replacementStarted = performance.now();
for (let pass = 0; pass < 20; pass++) {
  for (const [index, region] of [...replacementStressRoot.querySelectorAll<HTMLElement>("[data-region]")].entries()) {
    const paragraph = document.createElement("p");
    paragraph.textContent = `AED ${12 + index}.00`;
    region.replaceChildren(paragraph);
  }
  render(replacementStressRoot);
}
const replacementDuration = performance.now() - replacementStarted;
expectEqual(replacementStressRoot.querySelectorAll(BADGE_SELECTOR).length, 100, "replacement stress active badges");
if (replacementDuration > 20000) {
  throw new Error(`replacement reconciliation performance regression: ${replacementDuration.toFixed(1)}ms`);
}
console.log(`Replacement stress passed; 100 regions × 20 rerenders in ${replacementDuration.toFixed(1)}ms.`);
