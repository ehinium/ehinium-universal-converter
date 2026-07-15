import { Window } from "happy-dom";
import { renderCurrencyConversionsOnly } from "../content/conversionScan";
import { getTextNodes } from "../content/domScanner";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  localStorage: window.localStorage,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
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

const sandbox = document.createElement("div");

for (const id of ["aed-prefix", "aed-suffix"]) {
  const row = document.createElement("p");
  row.className = "smoke-price-anchor";
  row.dataset.caseId = id;
  row.textContent = id === "aed-prefix" ? "AED 1,234.56" : "1,234.56 AED";
  sandbox.append(row);
}

document.body.append(sandbox);

const settings: UserSettings = {
  ...defaultSettings,
  targetCurrency: "USD",
  converterMode: "currencies",
  badgeVisibility: "always",
};

const rendered = renderCurrencyConversionsOnly(
  getTextNodes(sandbox),
  settings,
  { AED: 3.6725, USD: 1 }
);

if (rendered !== 2) {
  throw new Error(`Expected two independently rendered cases, received ${rendered}`);
}

for (const row of sandbox.querySelectorAll<HTMLElement>("[data-case-id]")) {
  const badgeCount = row.querySelectorAll('[data-ehinium-badge="true"]').length;
  if (badgeCount !== 1) {
    throw new Error(`${row.dataset.caseId} expected one badge, received ${badgeCount}`);
  }
}

console.log("Smoke renderer case scopes are isolated.");
