import { Window } from "happy-dom";
import type { ConverterMode } from "../types/settings";
import type { CurrencyMatch } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  localStorage: window.localStorage,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
});

const visibleRect = {
  x: 0,
  y: 0,
  top: 0,
  right: 100,
  bottom: 20,
  left: 0,
  width: 100,
  height: 20,
  toJSON: () => ({}),
};

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => visibleRect,
});

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

function createRoot(html: string): HTMLElement {
  document.body.innerHTML = "";

  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function render(
  root: HTMLElement,
  targetCurrency: string,
  convertAmount: (match: CurrencyMatch) => number | null,
  converterMode: ConverterMode = "currencies"
): number {
  return renderConversions(getTextNodes(root), {
    targetCurrency,
    converterMode,
    convertAmount,
  });
}

{
  const root = createRoot("<span>$29,800</span>");
  let conversionCalls = 0;
  const rendered = render(root, "USD", () => {
    conversionCalls++;
    return 29800;
  });

  expectEqual(rendered, 0, "same-currency rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "same-currency badges");
  expectEqual(conversionCalls, 0, "same-currency converter calls");
}

{
  const root = createRoot("<span>€100</span>");
  const rendered = render(root, "USD", (match) => match.amount * 1.1);

  expectEqual(rendered, 1, "normal conversion rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "normal conversion badges");
}

{
  const root = createRoot("<span>304.95 TL</span>");
  const textNode = root.querySelector("span")?.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error("translation duplicate test requires a text node");
  }

  renderConversions([textNode], {
    targetCurrency: "USD",
    converterMode: "currencies",
    convertAmount: (match) => match.amount / 30,
  });

  textNode.textContent = "304,95 TL";

  renderConversions([textNode], {
    targetCurrency: "USD",
    converterMode: "currencies",
    convertAmount: (match) => match.amount / 30,
  });

  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "translation duplicate badges");
}

{
  const root = createRoot(
    '<span data-ehinium-badge="true" data-ehinium-converted="true" data-ehinium-ignore="true">$100</span>'
  );
  const rendered = render(root, "EUR", (match) => match.amount * 0.9);

  expectEqual(rendered, 0, "existing badge rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "existing badge total");
}

{
  const root = createRoot(`
    <span class="a-price">
      <span class="a-price-symbol">AED</span>
      <span class="a-price-whole">17</span>
      <span class="a-price-fraction">26</span>
    </span>
  `);
  const rendered = render(root, "USD", (match) => match.amount / 3.67);

  expectEqual(rendered, 1, "Amazon grouped rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "Amazon grouped badges");
}

{
  const root = createRoot("<span>€100</span>");
  let conversionCalls = 0;
  const rendered = render(
    root,
    "USD",
    () => {
      conversionCalls++;
      return 110;
    },
    "units"
  );

  expectEqual(rendered, 0, "units mode rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "units mode badges");
  expectEqual(conversionCalls, 0, "units mode converter calls");
}

{
  const root = createRoot("<span>€100</span>");
  const rendered = render(
    root,
    "USD",
    (match) => match.amount * 1.1,
    "everything"
  );

  expectEqual(rendered, 1, "everything mode rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "everything mode badges");
}
