import { Window } from "happy-dom";
import { renderCurrencyConversionsOnly } from "../content/conversionScan";
import { getTextNodes } from "../content/domScanner";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";
import {
  mountRetailFixtureStages,
  retailFixtures,
  runRetailFixtureSuite,
} from "./retailFixtures";
import {
  mountRealRetailCaptureStages,
  runRealRetailCaptureSuite,
} from "./realRetailCaptures";

const window = new Window();

Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  DOMRect: window.DOMRect,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDialogElement: window.HTMLDialogElement,
  MutationObserver: window.MutationObserver,
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
  value() {
    const element = this as HTMLElement;
    if (element.style.width === "1px" && element.style.height === "1px") {
      return { ...visibleRect, right: 1, bottom: 1, width: 1, height: 1 };
    }
    return visibleRect;
  },
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

const ignoredUi = document.createElement("main");
ignoredUi.setAttribute("data-ehinium-ignore", "true");
ignoredUi.textContent = "Ignored smoke controls USD 999.00";
const retailRoot = document.createElement("section");
retailRoot.id = "retail-fixture-root";
const realRetailRoot = document.createElement("section");
realRetailRoot.id = "real-retail-capture-root";
document.body.append(ignoredUi, realRetailRoot, retailRoot);

mountRealRetailCaptureStages(realRetailRoot);
const initialRealReports = await runRealRetailCaptureSuite(realRetailRoot);
const liveTemuReport = initialRealReports.find((report) => report.fixtureId === "temu-selected-goods-price-15-44-eur");
const initialTemuReport = initialRealReports.find((report) => report.fixtureId === "temu-selected-poco-353-62-eur");
const initialWalmartReport = initialRealReports.find((report) => report.retailer === "Walmart");
if (!initialTemuReport?.passed) {
  throw new Error(`Captured Temu fixture should pass after the shared fragment fix: ${initialTemuReport?.reasons.join(" ")}`);
}
if (!liveTemuReport?.passed || liveTemuReport.visibleBadgeCount !== 1) {
  throw new Error(`Post-fix live Temu capture must retain one visible badge through lifecycle reconciliation: ${liveTemuReport?.reasons.join(" ")}`);
}
if (!initialWalmartReport?.passed) {
  throw new Error(`Captured Walmart baseline should pass: ${initialWalmartReport?.reasons.join(" ")}`);
}
if (!initialTemuReport.canonicalCandidates.some((candidate) => candidate.amount === 353.62 && candidate.currency === "EUR") ||
    initialTemuReport.canonicalCandidates.some((candidate) => candidate.amount === 0.62)) {
  throw new Error("Captured Temu split price must canonicalize as 353.62 EUR without a fractional-tail candidate.");
}
const temuStage = realRetailRoot.querySelector<HTMLElement>('[data-real-retail-capture-id="temu-selected-poco-353-62-eur"]');
const temuSplitTexts = [...(temuStage?.querySelectorAll("._382YgpSF > span") ?? [])].map((element) => element.textContent);
if (JSON.stringify(temuSplitTexts) !== JSON.stringify(["353", ",62", "€"])) {
  throw new Error("Captured Temu text-node boundaries were not preserved.");
}
if (temuStage?.querySelector("._382YgpSF")?.getAttribute("aria-hidden") !== "true") {
  throw new Error("Capture sanitization must preserve scanner-critical aria-hidden state.");
}
const walmartAnchor = realRetailRoot.querySelector<HTMLAnchorElement>('[data-real-retail-capture-id="walmart-selected-sunbs-current-old"] a.w-100');
if (walmartAnchor?.getAttribute("href") !== "#" || initialWalmartReport.canonicalCandidates.length !== 2) {
  throw new Error("Captured Walmart clickable ancestry and distinct current/old prices must be preserved.");
}
console.log("Real retail captures passed: live Temu lifecycle, Temu split price, and Walmart current/old card.");

mountRetailFixtureStages(retailRoot);
for (const fixture of retailFixtures.filter((item) => !item.mutationSteps)) {
  const stage = retailRoot.querySelector<HTMLElement>(`[data-retail-fixture-id="${fixture.id}"]`);
  if (!stage || getTextNodes(stage).length === 0) {
    throw new Error(`${fixture.id} must expose at least one eligible text node.`);
  }
}
const reports = await runRetailFixtureSuite(retailRoot);
if (reports.length !== retailFixtures.length) {
  throw new Error(`Expected ${retailFixtures.length} retail reports, received ${reports.length}`);
}
if (retailRoot.closest('[data-ehinium-ignore="true"], [data-euc-owned], [data-euc-badge], [data-ehinium-converted], [aria-hidden="true"], .a-offscreen')) {
  throw new Error("Retail fixture root must remain scanner-eligible outside ignored smoke UI.");
}
const failures = reports.filter((report) => !report.passed);
if (failures.length > 0) {
  throw new Error(`Retail fixture failures: ${failures.map((report) => `${report.fixtureId}: ${report.reasons.join(" ")}`).join(" | ")}`);
}
if (reports.some((report) => report.duplicateBadgeDetected)) {
  throw new Error("Repeated retail fixture renders must not create duplicate badges.");
}
if (reports.some((report) => !report.resetPreservedSourceDom)) {
  throw new Error("Retail fixture reset must remove owned output and preserve source DOM.");
}
const dynamicReports = reports.filter((report) => report.mutationSteps.length > 0);
if (dynamicReports.some((report) => report.mutationSteps.some((step) => step.rescanExpected && !step.observerDelivered))) {
  throw new Error("Dynamic retail fixture mutations must be delivered to the production observer.");
}

const repeatedReports = await runRetailFixtureSuite(retailRoot);
if (repeatedReports.some((report) => !report.passed || report.duplicateBadgeDetected)) {
  throw new Error("Repeated retail fixture suite runs must remain idempotent.");
}

console.log(`Retail DOM fixtures passed: ${reports.length} scanner-eligible production scenarios.`);
