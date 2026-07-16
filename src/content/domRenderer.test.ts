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
import { clearBadgeLifecycles } from "./badgeLifecycle";
import { getBadgeVisibleText } from "./badgeManager";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  localStorage: window.localStorage,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  KeyboardEvent: window.KeyboardEvent,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
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
  clearBadgeLifecycles(document);
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

  expectEqual(getBadgeVisibleText(badge), "$4.63", "currency tooltip visible badge text");
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "16.99 AED → $4.63",
    "currency tooltip content"
  );
}

{
  const root = createRoot('<a href="#linked-currency">Linked price $49.99</a>');
  const link = root.querySelector<HTMLAnchorElement>("a");
  link?.style.setProperty("text-decoration", "underline");
  let linkClicks = 0;
  let linkKeydowns = 0;

  link?.addEventListener("click", () => {
    linkClicks++;
  });
  link?.addEventListener("keydown", () => {
    linkKeydowns++;
  });

  const rendered = render(root, "EUR", () => 45.99);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(rendered, 1, "linked currency rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "linked currency badge count");
  expectEqual(badge?.parentElement, link, "linked currency badge parent");
  expectEqual(link?.childNodes[1], badge ?? null, "linked currency badge after text");
  expectEqual(badge?.style.textDecoration, "none", "linked currency badge no underline");

  badge?.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );
  await Promise.resolve();

  expectEqual(linkClicks, 0, "linked currency badge click does not trigger link");
  badge?.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );

  expectEqual(linkKeydowns, 0, "linked currency badge key does not trigger link");

  link?.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );

  expectEqual(linkClicks, 1, "normal linked currency text click triggers link");
  link?.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );

  expectEqual(linkKeydowns, 1, "normal linked currency key triggers link");

  render(root, "EUR", () => 45.99);
  expectEqual(
    root.querySelectorAll(BADGE_SELECTOR).length,
    1,
    "linked currency duplicate badge count"
  );
}

{
  const root = createRoot('<button type="button">Button text with 120 EUR</button>');
  const button = root.querySelector<HTMLButtonElement>("button");
  let buttonClicks = 0;
  let buttonKeydowns = 0;

  button?.addEventListener("click", () => {
    buttonClicks++;
  });
  button?.addEventListener("keydown", () => {
    buttonKeydowns++;
  });

  const rendered = render(root, "USD", () => 130.43);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(rendered, 1, "button currency rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "button currency badge count");
  expectEqual(badge?.parentElement, button, "button currency badge parent");
  expectEqual(button?.childNodes[1], badge ?? null, "button currency badge after text");

  badge?.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );
  await Promise.resolve();

  expectEqual(buttonClicks, 0, "button badge click does not trigger button");
  badge?.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );

  expectEqual(buttonKeydowns, 0, "button badge key does not trigger button");

  button?.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );

  expectEqual(buttonClicks, 1, "normal button source click triggers button");
  button?.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );

  expectEqual(buttonKeydowns, 1, "normal button source key triggers button");

  render(root, "USD", () => 130.43);
  expectEqual(
    root.querySelectorAll(BADGE_SELECTOR).length,
    1,
    "button currency duplicate badge count"
  );
}

{
  const root = createRoot(
    '<button type="button" style="color: rgb(255, 255, 255); background-color: rgb(20, 20, 20)">Dark button 120 EUR</button>'
  );
  render(root, "USD", () => 130.43);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(
    badge?.style.color,
    "rgb(255, 255, 255)",
    "dark button badge text color"
  );
  expectEqual(
    badge?.style.getPropertyValue("--euc-badge-background"),
    "rgba(255, 255, 255, 0.07)",
    "dark button badge background"
  );
  expectEqual(badge?.dataset.ehiniumBadgeStyle, "default", "button badge shadow style variant");
  expectEqual(badge?.childNodes.length, 0, "button badge light DOM remains empty");
}

{
  const root = createRoot('<a href="#linked-unit">Linked unit 10 kg</a>');
  const link = root.querySelector<HTMLAnchorElement>("a");
  const rendered = render(root, "USD", () => null, "units");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(rendered, 1, "linked unit rendered count");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "linked unit badge count");
  expectEqual(badge?.parentElement, link, "linked unit badge parent");
  expectEqual(link?.childNodes[1], badge ?? null, "linked unit badge after text");
}

for (const [convertedAmount, expected] of [
  [2372.3, "$2,372.30"],
  [7.29, "$7.29"],
  [0.2456, "$0.2456"],
  [0.004812, "$0.004812"],
] as const) {
  const root = createRoot("<span>AED 1</span>");
  render(root, "USD", () => convertedAmount);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(
      getBadgeVisibleText(badge),
    expected,
    `currency converted badge ${convertedAmount}`
  );
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    `1 AED → ${expected}`,
    `currency converted tooltip ${convertedAmount}`
  );
}

{
  const root = createRoot("<span>10000000IRR</span>");
  render(root, "USD", () => 23.81);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "10,000,000 IRR → $23.81",
    "large currency tooltip content"
  );
  expectEqual(
    root.querySelector("span")?.firstChild?.textContent,
    "10000000IRR",
    "large currency raw page text"
  );
}

{
  const root = createRoot("<span>224 900 AMD</span>");
  const conversionAmounts: number[] = [];
  render(root, "USD", (match) => {
    conversionAmounts.push(match.amount);
    return 535.48;
  });
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "grouped space currency badge count");
  expectEqual(JSON.stringify(conversionAmounts), JSON.stringify([224900]), "grouped space conversion amount");
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "224,900 AMD → $535.48",
    "grouped space currency tooltip"
  );
}

{
  const root = createRoot("<span>10 kg</span>");
  render(root, "USD", () => null, "units");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(getBadgeVisibleText(badge), "22.05 lb", "unit tooltip visible badge text");
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "10 kg → 22.05 lb",
    "unit tooltip content"
  );
}

{
  const root = createRoot("<span>1 m</span>");
  render(root, "USD", () => null, "units", true, "default", "km");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(getBadgeVisibleText(badge), "0.001 km", "small unit badge text");
  expectEqual(
    badge ? getHoverTarget(badge)?.content : null,
    "1 m → 0.001 km",
    "small unit tooltip content"
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
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 0, "unowned legacy badge removed");
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
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), "22.05 lb", "units mode badge text");
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
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), "22.05 lb", "units mode excludes currency badge");
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
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), "-40 °C", "equal numeric temperature badge");
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
  expectEqual(badge?.childNodes.length, 0, "compact badge light DOM empty");
}

{
  const root = createRoot("<span>10 kg</span>");
  render(root, "USD", () => null, "units", true, "minimal");
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR);

  expectEqual(badge?.dataset.ehiniumBadgeStyle, "minimal", "minimal badge marker");
  expectEqual(badge?.childNodes.length, 0, "minimal badge light DOM empty");
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
    (badge) => getBadgeVisibleText(badge)
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
    getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)),
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
    getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)),
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
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), expected, `metric ${source} badge`);
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
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), expected, `imperial ${source} badge`);
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
    getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)),
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
    getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)),
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
    "16.99 AED → $4.63",
    "currency hover target"
  );
  expectEqual(
    source?.hasAttribute("title"),
    false,
    "currency hover native title"
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
    "10 kg → 22.05 lb",
    "unit hover target"
  );
  expectEqual(source?.hasAttribute("title"), false, "unit hover native title");
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
    "100 EUR → $110.00",
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
    "10 kg → 22.05 lb",
    "unit-only hover target"
  );
}
