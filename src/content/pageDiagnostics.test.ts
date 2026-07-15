import { Window } from "happy-dom";
import { fiatCurrencies } from "../data/currencies";
import { defaultSettings } from "../utils/defaultSettings";
import { formatPageDiagnosticMarkdown } from "../popup/diagnosticMarkdown";
import {
  capturePageDiagnostics,
  clearPageDiagnosticSession,
  getLatestPageDiagnosticReport,
  startElementDiagnosticPicker,
} from "./pageDiagnostics";

const window = new Window({ url: "https://example.com/pricing" });

Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  CSS: window.CSS,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: window.navigator,
});
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: window.location,
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return fiatCurrencies
        .filter((currency) => currency.code !== "USD")
        .map((currency) => ({
          date: "2026-07-15",
          base: "USD",
          quote: currency.code,
          rate: 1,
        }));
    },
  }),
});

const visibleRect = {
  x: 10,
  y: 20,
  top: 20,
  right: 210,
  bottom: 60,
  left: 10,
  width: 200,
  height: 40,
  toJSON: () => ({}),
};

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => visibleRect,
});

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

document.title = "Pricing diagnostics fixture";
document.body.innerHTML = `
  <section id="split-symbol-price"><span>4.99</span><span>€</span><span> / month</span></section>
  <a id="split-code-link" href="https://example.com/checkout">
    <span id="split-code-price"><span>TRY </span><span>99</span><span>/month</span></span>
  </a>
  <p id="unsplit-price">TRY 135/month</p>
  <p id="owned-source">AED 12.00 <span class="ehinium-converter-badge" data-ehinium-badge="true" data-ehinium-converted="true">$3.27</span></p>
  <code id="excluded-price">USD 40</code>
`;

const settings = {
  ...defaultSettings,
  converterMode: "units" as const,
};
const pageReport = await capturePageDiagnostics(settings);
const markdown = formatPageDiagnosticMarkdown(pageReport);

expect(pageReport.scope === "page", "Page capture should use page scope");
expect(markdown.includes("## Text-node pipeline"), "Markdown export should include pipeline diagnostics");
expect(
  pageReport.priceLikeElements.some((element) => element.text.includes("4.99")),
  "Split suffix price should be inspected as price-like"
);

const currencyReport = await capturePageDiagnostics({
  ...defaultSettings,
  targetCurrency: "USD",
  converterMode: "currencies",
});
const convertibleNode = currencyReport.textNodes.find((node) =>
  node.text.includes("TRY 135")
);
expect(convertibleNode?.conversionRequested, "Unsplit price should request conversion");
expect(convertibleNode?.rateAvailable, "Unsplit price should report an available rate");
expect(convertibleNode?.renderingAttempted, "Unsplit price should reach renderer placement");
expect(
  pageReport.textNodes.some((node) => node.text.includes("4.99") && node.splitAcrossNodes),
  "Split amount and symbol should be reported"
);
expect(
  pageReport.textNodes.some((node) => node.text.includes("TRY") && node.splitAcrossNodes),
  "Split code and amount should be reported"
);
expect(
  currencyReport.priceLikeElements.every((element) => !element.text.includes("$3.27")),
  "Extension badge text must not enter price-like discovery"
);
expect(
  currencyReport.textNodes
    .flatMap((node) => node.matchDiagnostics)
    .every((match) => !match.parserInput.includes("$3.27") && !match.combinedTextContainsExtensionUi),
  "Extension badge text must not enter direct or combined parser input"
);
expect(
  pageReport.textNodes.some((node) => node.text.includes("USD 40") && !node.scanned && node.scanSkipReason?.includes("code")),
  "Excluded code content should include its scanner reason"
);

let linkActivated = false;
document.querySelector("#split-code-link")?.addEventListener("click", () => {
  linkActivated = true;
});
const splitCodePrice = document.querySelector<HTMLElement>("#split-code-price");
expect(splitCodePrice, "Split-code fixture is missing");

startElementDiagnosticPicker(settings);
splitCodePrice.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true }) as unknown as Event);
splitCodePrice.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
await new Promise((resolve) => setTimeout(resolve, 0));

const selectedReport = getLatestPageDiagnosticReport();
expect(selectedReport?.scope === "selected-element", "Picker should store a selected-element report");
expect(selectedReport.selectedElement?.selector === "#split-code-price", "Selected element selector should be stable");
expect(!linkActivated, "Picker click must not activate the underlying link");
expect(!document.querySelector("[data-ehinium-diagnostics-picker]"), "Picker overlay must be removed after selection");

startElementDiagnosticPicker(settings);
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
expect(!document.querySelector("[data-ehinium-diagnostics-picker]"), "Escape must clean up the picker overlay");

clearPageDiagnosticSession();
expect(getLatestPageDiagnosticReport() === null, "Clearing diagnostics must remove the stored report");

console.log("Page diagnostics capture and picker cleanup passed.");
