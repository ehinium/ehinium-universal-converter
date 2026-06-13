import { Window } from "happy-dom";
import type { BadgeStyle, ConverterMode } from "../types/settings";
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
  converterMode: ConverterMode = "currencies",
  enabled = true,
  badgeStyle: BadgeStyle = "default"
): number {
  return renderConversions(getTextNodes(root), {
    enabled,
    targetCurrency,
    converterMode,
    badgeStyle,
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
    enabled: true,
    targetCurrency: "USD",
    converterMode: "currencies",
    badgeStyle: "default",
    convertAmount: (match) => match.amount / 30,
  });

  textNode.textContent = "304,95 TL";

  renderConversions([textNode], {
    enabled: true,
    targetCurrency: "USD",
    converterMode: "currencies",
    badgeStyle: "default",
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
  const root = createRoot("<span>10 kg</span>");
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

  expectEqual(rendered, 1, "units mode rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "units mode badges");
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, "22 lb", "units mode badge text");
  expectEqual(conversionCalls, 0, "units mode converter calls");
}

{
  const root = createRoot("<span>€100 and 10 kg</span>");
  const rendered = render(
    root,
    "USD",
    (match) => match.amount * 1.1,
    "everything"
  );

  expectEqual(rendered, 2, "everything mode rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "everything mode badges");
}

{
  const root = createRoot("<span>10 kg</span>");
  const rendered = render(root, "USD", () => null, "currencies");

  expectEqual(rendered, 0, "currencies mode unit rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "currencies mode unit badges");
}

{
  const root = createRoot("<span>€100 and 10 kg</span>");
  const rendered = render(root, "USD", () => 110, "units");

  expectEqual(rendered, 1, "units mode mixed rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "units mode mixed badges");
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, "22 lb", "units mode excludes currency badge");
}

{
  const root = createRoot("<span>10 kg</span>");
  const textNode = root.querySelector("span")?.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error("unit duplicate test requires a text node");
  }

  const options = {
    enabled: true,
    targetCurrency: "USD",
    converterMode: "units" as const,
    badgeStyle: "default" as const,
    convertAmount: () => null,
  };

  renderConversions([textNode], options);
  renderConversions([textNode], options);

  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "unit duplicate badges");
}

{
  const root = createRoot('<span class="a-price">10 kg</span>');
  const rendered = render(root, "USD", () => null, "units");

  expectEqual(rendered, 0, "currency price container unit rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "currency price container unit badges");
}

{
  const root = createRoot("<span>-40 °F</span>");
  const rendered = render(root, "USD", () => null, "units");

  expectEqual(rendered, 1, "equal numeric temperature rendered count");
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, "-40 °C", "equal numeric temperature badge");
}

for (const converterMode of ["currencies", "units", "everything"] as const) {
  const root = createRoot("<span>€100 and 10 kg</span>");
  let conversionCalls = 0;
  const rendered = render(
    root,
    "USD",
    () => {
      conversionCalls++;
      return 110;
    },
    converterMode,
    false
  );

  expectEqual(rendered, 0, `disabled ${converterMode} rendered count`);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, `disabled ${converterMode} badges`);
  expectEqual(conversionCalls, 0, `disabled ${converterMode} converter calls`);
}

{
  const root = createRoot("<span>€100</span>");
  const rendered = render(root, "USD", () => 110, "currencies", true);

  expectEqual(rendered, 1, "enabled current behavior rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "enabled current behavior badges");
}

{
  const root = createRoot("<span>€100</span>");
  render(root, "USD", () => 110, "currencies", true, "compact");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(badge?.dataset.ehiniumBadgeStyle, "compact", "compact badge marker");
  expectEqual(badge?.style.padding, "1px 4px", "compact badge padding");
  expectEqual(badge?.style.fontSize, "10px", "compact badge font size");
}

{
  const root = createRoot("<span>10 kg</span>");
  render(root, "USD", () => null, "units", true, "minimal");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(badge?.dataset.ehiniumBadgeStyle, "minimal", "minimal badge marker");
  expectEqual(badge?.style.background, "transparent", "minimal badge background");
  expectEqual(badge?.style.textDecoration, "underline dotted", "minimal badge decoration");
}
