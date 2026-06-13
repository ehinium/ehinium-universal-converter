import { Window } from "happy-dom";
import type {
  BadgeStyle,
  BadgeVisibility,
  ConverterMode,
  TargetLengthUnit,
  TargetTemperatureUnit,
  TargetWeightUnit,
  UnitSystem,
} from "../types/settings";
import type { CurrencyMatch } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";
import { getHoverTarget } from "./hoverRegistry";

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
  badgeStyle: BadgeStyle = "default",
  targetLengthUnit: TargetLengthUnit = "auto",
  targetWeightUnit: TargetWeightUnit = "auto",
  targetTemperatureUnit: TargetTemperatureUnit = "auto",
  unitSystem: UnitSystem = "auto",
  badgeVisibility: BadgeVisibility = "always"
): number {
  return renderConversions(getTextNodes(root), {
    enabled,
    targetCurrency,
    converterMode,
    badgeStyle,
    badgeVisibility,
    unitSystem,
    targetLengthUnit,
    targetWeightUnit,
    targetTemperatureUnit,
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
  const root = createRoot("<span>AED 16.99</span>");
  render(root, "USD", () => 4.63);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(badge?.textContent, "$4.63", "currency tooltip visible badge text");
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "AED 16.99 → $4.63",
    "currency tooltip content"
  );
}

{
  const root = createRoot("<span>10 kg</span>");
  render(root, "USD", () => null, "units");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(badge?.textContent, "22 lb", "unit tooltip visible badge text");
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "10 kg → 22 lb",
    "unit tooltip content"
  );
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
    badgeVisibility: "always",
    unitSystem: "auto",
    targetLengthUnit: "auto",
    targetWeightUnit: "auto",
    targetTemperatureUnit: "auto",
    convertAmount: (match) => match.amount / 30,
  });

  textNode.textContent = "304,95 TL";

  renderConversions([textNode], {
    enabled: true,
    targetCurrency: "USD",
    converterMode: "currencies",
    badgeStyle: "default",
    badgeVisibility: "always",
    unitSystem: "auto",
    targetLengthUnit: "auto",
    targetWeightUnit: "auto",
    targetTemperatureUnit: "auto",
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
    badgeVisibility: "always" as const,
    unitSystem: "auto" as const,
    targetLengthUnit: "auto" as const,
    targetWeightUnit: "auto" as const,
    targetTemperatureUnit: "auto" as const,
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

{
  const root = createRoot("<span>10 in and 5 ft</span>");
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "cm"
  );
  const badges = [...root.querySelectorAll<HTMLElement>(BADGE_SELECTOR)].map(
    (badge) => badge.textContent
  ).sort();

  expectEqual(rendered, 2, "selected length target rendered count");
  expectEqual(
    JSON.stringify(badges),
    JSON.stringify(["152.4 cm", "25.4 cm"]),
    "selected length target badges"
  );
}

{
  const root = createRoot("<span>180 lb</span>");
  render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "kg"
  );

  expectEqual(
    root.querySelector(BADGE_SELECTOR)?.textContent,
    "81.65 kg",
    "selected weight target badge"
  );
}

{
  const root = createRoot("<span>68 °F</span>");
  render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "c"
  );

  expectEqual(
    root.querySelector(BADGE_SELECTOR)?.textContent,
    "20 °C",
    "selected temperature target badge"
  );
}

{
  const root = createRoot("<span>180 cm</span>");
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "cm"
  );

  expectEqual(rendered, 0, "same selected target rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "same selected target badges");
}

for (const [source, expected] of [
  ["10 in", "25.4 cm"],
  ["5 ft", "1.52 m"],
  ["2 mi", "3.22 km"],
  ["180 lb", "81.65 kg"],
] as const) {
  const root = createRoot(`<span>${source}</span>`);
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "metric"
  );

  expectEqual(rendered, 1, `metric ${source} rendered count`);
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, expected, `metric ${source} badge`);
}

for (const source of ["50 kg", "180 cm", "2 km"] as const) {
  const root = createRoot(`<span>${source}</span>`);
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "metric"
  );

  expectEqual(rendered, 0, `metric same-system ${source} rendered count`);
}

for (const [source, expected] of [
  ["180 cm", "70.87 in"],
  ["2 m", "6.56 ft"],
  ["5 km", "3.11 mi"],
  ["50 kg", "110.23 lb"],
] as const) {
  const root = createRoot(`<span>${source}</span>`);
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "imperial"
  );

  expectEqual(rendered, 1, `imperial ${source} rendered count`);
  expectEqual(root.querySelector(BADGE_SELECTOR)?.textContent, expected, `imperial ${source} badge`);
}

for (const source of ["10 in", "5 ft"] as const) {
  const root = createRoot(`<span>${source}</span>`);
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "imperial"
  );

  expectEqual(rendered, 0, `imperial same-system ${source} rendered count`);
}

{
  const root = createRoot("<span>5 ft</span>");
  render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "cm",
    "auto",
    "auto",
    "metric"
  );

  expectEqual(
    root.querySelector(BADGE_SELECTOR)?.textContent,
    "152.4 cm",
    "metric exact length override badge"
  );
}

{
  const root = createRoot("<span>180 lb</span>");
  render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "kg",
    "auto",
    "imperial"
  );

  expectEqual(
    root.querySelector(BADGE_SELECTOR)?.textContent,
    "81.65 kg",
    "imperial exact weight override badge"
  );
}

{
  const root = createRoot("<span>AED 16.99</span>");
  const source = root.querySelector<HTMLElement>("span");
  const rendered = render(
    root,
    "USD",
    () => 4.63,
    "currencies",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "auto",
    "hover"
  );

  expectEqual(rendered, 1, "currency hover rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "currency hover badges");
  expectEqual(
    source ? getHoverTarget(source)?.content : null,
    "AED 16.99 → $4.63",
    "currency hover target"
  );

  const duplicateRendered = render(
    root,
    "USD",
    () => 4.63,
    "currencies",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "auto",
    "hover"
  );

  expectEqual(duplicateRendered, 0, "currency hover duplicate rendered count");
}

{
  const root = createRoot("<span>10 kg</span>");
  const source = root.querySelector<HTMLElement>("span");
  const rendered = render(
    root,
    "USD",
    () => null,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "auto",
    "hover"
  );

  expectEqual(rendered, 1, "unit hover rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "unit hover badges");
  expectEqual(
    source ? getHoverTarget(source)?.content : null,
    "10 kg → 22 lb",
    "unit hover target"
  );
}

{
  const root = createRoot("<span>€100 and 10 kg</span>");
  const source = root.querySelector<HTMLElement>("span");
  const rendered = render(
    root,
    "USD",
    () => 110,
    "currencies",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "auto",
    "hover"
  );

  expectEqual(rendered, 1, "currency-only hover rendered count");
  expectEqual(
    source ? getHoverTarget(source)?.content : null,
    "EUR 100 → $110.00",
    "currency-only hover target"
  );
}

{
  const root = createRoot("<span>€100 and 10 kg</span>");
  const source = root.querySelector<HTMLElement>("span");
  const rendered = render(
    root,
    "USD",
    () => 110,
    "units",
    true,
    "default",
    "auto",
    "auto",
    "auto",
    "auto",
    "hover"
  );

  expectEqual(rendered, 1, "unit-only hover rendered count");
  expectEqual(
    source ? getHoverTarget(source)?.content : null,
    "10 kg → 22 lb",
    "unit-only hover target"
  );
}
