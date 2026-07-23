import { getBadgeVisibleText } from "../content/badgeManager";
import {
  getBadgeVisibilityDiagnostics,
  reconcileBadgeVisibility,
} from "../content/badgeVisibility";
import { discoverCurrencyMatchesInRoots } from "../content/currencyDomMatches";
import { renderCurrencyConversionsOnly } from "../content/conversionScan";
import { getTextNodeScanExclusion, getTextNodes } from "../content/domScanner";
import {
  getCurrencyPlacementSkipReason,
  isSafeBadgePlacement,
  resetRenderedConversions,
} from "../content/domRenderer";
import { detectGroupedPricesInRoots } from "../content/groupedPriceDetector";
import { observeDomChanges } from "../content/observer";
import {
  canonicalizePriceCandidates,
  discoverPriceCandidates,
  getCandidateDiscoveryDiagnostics,
  getCanonicalizationDiagnostics,
} from "../content/priceCandidatePipeline";
import type { CurrencyMatch } from "../utils/currencyParser";
import { parseCurrencies } from "../utils/currencyParser";
import { defaultSettings } from "../utils/defaultSettings";
import { RETAIL_FIXTURE_RATES, RETAIL_FIXTURE_TARGET_CURRENCY } from "./retailFixtures";

export type RealRetailFailureStage =
  | "NO_ELIGIBLE_TEXT_NODES"
  | "PRICE_TEXT_NOT_PARSED"
  | "GROUPED_PRICE_NOT_DISCOVERED"
  | "CANDIDATE_NOT_CREATED"
  | "CANDIDATE_REJECTED"
  | "UNSAFE_ANCHOR"
  | "CONVERSION_RATE_MISSING"
  | "BADGE_INSERTION_FAILED"
  | "BADGE_HIDDEN_BY_LIFECYCLE"
  | "BADGE_TOO_FAR_FROM_ANCHOR"
  | "BADGE_REMOVED_AFTER_RESCAN"
  | "DUPLICATE_BADGE"
  | "SOURCE_MUTATION_NOT_RECONCILED";

export type RealRetailCapture = {
  id: string;
  retailer: string;
  hostname: string;
  capturedAt: string;
  fixtureVersion: 1;
  sourceSelector: string;
  sourceUrl: string;
  html: string;
  expected: Array<{ amount: number; currency: string }>;
  expectedBadgeCount: number;
};

export type RealRetailCaptureReport = {
  fixtureId: string;
  retailer: string;
  hostname: string;
  capturedAt: string;
  fixtureVersion: number;
  sourceSelector: string;
  rawCapturedSubtree: string;
  eligibleTextNodes: string[];
  excludedTextNodes: Array<{ text: string; reason: string }>;
  parsedMatches: CurrencyMatch[];
  groupedCandidates: Array<{ amount: number; currency: string }>;
  discoveredCandidates: Array<{ amount: number; currency: string; raw: string; scanKind: string }>;
  canonicalCandidates: Array<{ amount: number; currency: string; raw: string; mode: string }>;
  selectedAnchors: string[];
  rejectedAnchors: string[];
  renderedBadgeCount: number;
  visibleBadgeCount: number;
  badgeVisibilityReasons: string[];
  badgeVisibleText: string[];
  repeatedScanBadgeCount: number;
  repeatedVisibilityBadgeCount: number;
  mutationBadgeCount: number;
  mutationVisibleBadgeCount: number;
  resetPreservedSource: boolean;
  firstFailingStage: RealRetailFailureStage | null;
  reasons: string[];
  sourceDomSnapshot: string;
  postRenderDomSnapshot: string;
  debugTimeline: string[];
  passed: boolean;
};

// Reconstructed only from the selected-element diagnostics captured on
// 2026-07-21. Unreported tracking IDs, image URLs, and product media are absent.
export const realRetailCaptures: readonly RealRetailCapture[] = [
  {
    id: "temu-selected-goods-price-15-44-eur",
    retailer: "Temu",
    hostname: "www.temu.com",
    capturedAt: "2026-07-21T13:47:50.665Z",
    fixtureVersion: 1,
    sourceSelector: "#goods_price",
    sourceUrl: "https://www.temu.com/de-en/130000-rpm-powerful-screen-4-level-adjustment.html",
    html: `<div class="_1x59iCix">
      <div class="_15o2bYpT" id="goods_price" style="display:flex;position:relative;visibility:visible;opacity:1;direction:ltr;white-space:normal;width:231.5625px;min-height:28px">
        <div class="_1vkz0rqG PjdWJn3s" style="display:block;position:relative;visibility:visible;opacity:1;white-space:nowrap;width:100px;min-height:28px">
          <span class="_14At0Pe5" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap">€15.44</span>
          <span aria-hidden="true">15</span><span aria-hidden="true">,44</span><span aria-hidden="true">€</span>
        </div>
        <div class="_188rnzBo"><span>VAT included</span></div>
      </div>
    </div>`,
    expected: [{ amount: 15.44, currency: "EUR" }],
    expectedBadgeCount: 1,
  },
  {
    id: "temu-selected-poco-353-62-eur",
    retailer: "Temu",
    hostname: "www.temu.com",
    capturedAt: "2026-07-21T09:41:36.045Z",
    fixtureVersion: 1,
    sourceSelector: "div._20V883Hw",
    sourceUrl: "https://www.temu.com/de-en/channel/amazing-finds.html",
    html: `<div class="_20V883Hw" style="display:block;position:relative;width:274px;min-height:374.8984375px;visibility:visible;opacity:1">
      <div class="_6q6qVUF5">
        <div class="_29eI_zBp"><div class="_2RC6dVF0"><span class="_2NKR8esG">Top pick</span></div><div class="_1O9WmJi_"><span class="C9HMW0KN">Local</span></div></div>
        <h3 class="_2BvQbnbN"><span class="_2D9RBAXL">XIAOMI Poco X8 Pro Smartphone 8GB + 512GB</span><span class="_3qVSYeqz">Open in new tab.</span></h3>
      </div>
      <div class="_25i85qo3"><div class="_1XWuIfqs"><div class="_3WBDHjhZ"><div class="_2myxWHLi" style="display:block;position:relative;white-space:nowrap">
        <span class="_2XgTiMJi" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap">353,62€</span>
        <div class="_382YgpSF" aria-hidden="true" style="display:block;position:static;visibility:visible;opacity:1;white-space:nowrap"><span class="_2de9ERAH">353</span><span class="_3SrxhhHh">,62</span><span class="_21mW6kwi" aria-hidden="true">€</span></div>
      </div></div></div></div>
      <div class="_18s4AHT2"><div class="SDAU0uwg"><div class="xSPyKd2G"><div class="CzHIOOmF"><span class="_3YWULQb1">1 sold</span></div></div></div></div>
    </div>`,
    expected: [{ amount: 353.62, currency: "EUR" }],
    expectedBadgeCount: 1,
  },
  {
    id: "walmart-selected-sunbs-current-old",
    retailer: "Walmart",
    hostname: "www.walmart.com",
    capturedAt: "2026-07-21T09:42:19.458Z",
    fixtureVersion: 1,
    sourceSelector: "a.w-100",
    sourceUrl: "https://www.walmart.com/",
    html: `<ul class="list"><li class="flex"><div class="sans-serif"><a class="w-100" href="#" style="display:block;position:static;width:244.6640625px;min-height:373.9609375px;visibility:visible;opacity:1"><span class="ld_Ec"><h3>SUNBS Womens Tops Long Sleeve V Neck Shirts Fall Sweater Casual Blouses Fashion Outfits $11.49 Was $25.99</h3></span></a></div></li></ul>`,
    expected: [
      { amount: 11.49, currency: "USD" },
      { amount: 25.99, currency: "USD" },
    ],
    expectedBadgeCount: 2,
  },
];

function allTextNodes(root: Node): Text[] {
  const result: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.textContent?.trim()) result.push(current as Text);
    current = walker.nextNode();
  }
  return result;
}

function selector(element: Element): string {
  const classes = [...element.classList].map((name) => `.${name}`).join("");
  return `${element.tagName.toLowerCase()}${classes}`;
}

function sameExpected(
  actual: readonly { amount: number; currency: string }[],
  expected: readonly { amount: number; currency: string }[]
): boolean {
  const normalize = (items: readonly { amount: number; currency: string }[]) =>
    items.map((item) => `${item.currency}|${item.amount}`).sort();
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

export function mountRealRetailCaptureStages(root: HTMLElement): Map<string, HTMLElement> {
  root.replaceChildren();
  const stages = new Map<string, HTMLElement>();
  for (const capture of realRetailCaptures) {
    const stage = document.createElement("section");
    stage.className = "real-retail-capture-stage";
    stage.dataset.realRetailCaptureId = capture.id;
    stage.dataset.captureHostname = capture.hostname;
    stage.innerHTML = capture.html;
    root.append(stage);
    stages.set(capture.id, stage);
  }
  return stages;
}

export async function runRealRetailCapture(
  capture: RealRetailCapture,
  stage: HTMLElement
): Promise<RealRetailCaptureReport> {
  resetRenderedConversions(stage);
  stage.innerHTML = capture.html;
  const sourceDomSnapshot = stage.innerHTML;
  const sourceTextBefore = stage.textContent;
  const debugTimeline: string[] = [];
  const reasons: string[] = [];
  let firstFailingStage: RealRetailFailureStage | null = null;
  const fail = (stageName: RealRetailFailureStage, reason: string): void => {
    if (!firstFailingStage) firstFailingStage = stageName;
    reasons.push(reason);
    debugTimeline.push(`${stageName}: ${reason}`);
  };

  const eligible = getTextNodes(stage);
  const eligibleSet = new Set(eligible);
  const excludedTextNodes = allTextNodes(stage).flatMap((node) => {
    if (eligibleSet.has(node)) return [];
    const exclusion = getTextNodeScanExclusion(node);
    return exclusion ? [{ text: node.textContent ?? "", reason: exclusion.reason }] : [];
  });
  debugTimeline.push(`scanner: ${eligible.length} eligible; ${excludedTextNodes.length} excluded`);
  if (eligible.length === 0) fail("NO_ELIGIBLE_TEXT_NODES", "Production scanner found no eligible text nodes.");

  const parsedMatches = eligible.flatMap((node) => parseCurrencies(node.textContent ?? ""));
  if (!capture.expected.every((expected) => parsedMatches.some((match) => match.amount === expected.amount && match.currency === expected.currency))) {
    fail("PRICE_TEXT_NOT_PARSED", "The expected captured price was not parsed from an eligible source text node.");
  }

  const grouped = detectGroupedPricesInRoots([stage]);
  debugTimeline.push(`grouped-price: ${grouped.length} candidate(s)`);
  const discovery = discoverCurrencyMatchesInRoots([stage], { candidateNodes: eligible });
  const discoveredCandidates = discovery.matches.map((item) => ({
    amount: item.match.amount,
    currency: item.match.currency,
    raw: item.match.raw,
    scanKind: item.scanKind,
  }));
  if (!capture.expected.every((expected) => discoveredCandidates.some((match) => match.amount === expected.amount && match.currency === expected.currency))) {
    fail("CANDIDATE_NOT_CREATED", "Parser evidence existed, but production DOM discovery did not create the expected candidate.");
  }

  const rawCandidates = discoverPriceCandidates(discovery.matches, RETAIL_FIXTURE_TARGET_CURRENCY);
  const canonical = canonicalizePriceCandidates(rawCandidates);
  if (!capture.expected.every((expected) => canonical.some((item) => item.amount === expected.amount && item.sourceCurrency === expected.currency))) {
    fail("CANDIDATE_REJECTED", "The expected DOM candidate did not survive production canonicalization.");
  }
  const rejectedAnchors = discovery.matches.flatMap((item) => {
    const reason = getCurrencyPlacementSkipReason(item.renderingAnchor, "always");
    return reason ? [`${selector(item.renderingAnchor)}: ${reason}`] : [];
  });
  if (discovery.matches.some((item) => !isSafeBadgePlacement(item.renderingAnchor))) {
    fail("UNSAFE_ANCHOR", rejectedAnchors.join(" | ") || "Production anchor safety rejected a candidate.");
  }
  if (capture.expected.some((expected) => !RETAIL_FIXTURE_RATES[expected.currency])) {
    fail("CONVERSION_RATE_MISSING", "The deterministic capture rate map is missing an expected source currency.");
  }

  const settings = { ...defaultSettings, targetCurrency: RETAIL_FIXTURE_TARGET_CURRENCY, converterMode: "currencies" as const, badgeVisibility: "always" as const };
  renderCurrencyConversionsOnly(eligible, settings, RETAIL_FIXTURE_RATES, [stage], discovery.matches);
  const renderedBadges = [...stage.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')];
  const badgeCount = renderedBadges.length;
  if (badgeCount !== capture.expectedBadgeCount) {
    fail("BADGE_INSERTION_FAILED", `Expected ${capture.expectedBadgeCount} badge(s); rendered ${badgeCount}.`);
  }
  if (renderedBadges.some((badge) => !discovery.matches.some((item) => {
    const anchor = item.renderingAnchor;
    return anchor.contains(badge) ||
      badge.parentElement === anchor.parentElement ||
      badge.previousElementSibling === anchor ||
      badge.nextElementSibling === anchor;
  }))) {
    fail("BADGE_TOO_FAR_FROM_ANCHOR", "A rendered badge is not owned by one of the selected captured price anchors.");
  }
  reconcileBadgeVisibility("manual");
  const visibilityDiagnostics = getBadgeVisibilityDiagnostics().slice(-renderedBadges.length);
  const visibleBadgeCount = renderedBadges.filter((badge) => badge.style.visibility !== "hidden").length;
  if (visibleBadgeCount !== capture.expectedBadgeCount) {
    fail(
      "BADGE_HIDDEN_BY_LIFECYCLE",
      `Visibility reconciliation left ${visibleBadgeCount}/${capture.expectedBadgeCount} expected badge(s) visible (${visibilityDiagnostics.map((item) => item.visibilityReason).join(", ") || "no diagnostic"}).`
    );
  }
  renderCurrencyConversionsOnly(getTextNodes(stage), settings, RETAIL_FIXTURE_RATES, [stage]);
  const repeatedScanBadgeCount = stage.querySelectorAll('[data-ehinium-badge="true"]').length;
  if (repeatedScanBadgeCount > capture.expectedBadgeCount) fail("DUPLICATE_BADGE", "Repeated production scan created duplicate badges.");
  if (repeatedScanBadgeCount < badgeCount) fail("BADGE_REMOVED_AFTER_RESCAN", "A production rescan removed a valid badge.");
  for (const trigger of ["scroll", "mutation", "scroll"] as const) reconcileBadgeVisibility(trigger);
  const repeatedVisibilityBadgeCount = [...stage.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')]
    .filter((badge) => badge.style.visibility !== "hidden").length;
  if (repeatedVisibilityBadgeCount !== capture.expectedBadgeCount) {
    fail("BADGE_HIDDEN_BY_LIFECYCLE", `Repeated scroll/mutation reconciliation left ${repeatedVisibilityBadgeCount} badge(s) visible.`);
  }

  resetRenderedConversions(stage);
  const captureRoot = stage.firstElementChild as HTMLElement | null;
  const replacement = captureRoot?.cloneNode(true) as HTMLElement | undefined;
  let mutationObserved = false;
  const stopObserver = observeDomChanges((roots) => {
    if (roots.some((root) => root === stage || stage.contains(root) || !root.isConnected)) {
      mutationObserved = true;
    }
  });
  captureRoot?.replaceWith(replacement!);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  stopObserver();
  if (replacement) renderCurrencyConversionsOnly(getTextNodes(replacement), settings, RETAIL_FIXTURE_RATES, [replacement]);
  const mutationBadgeCount = stage.querySelectorAll('[data-ehinium-badge="true"]').length;
  reconcileBadgeVisibility("mutation");
  const mutationVisibleBadgeCount = [...stage.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')]
    .filter((badge) => badge.style.visibility !== "hidden").length;
  debugTimeline.push(`mutation: observer=${mutationObserved}; badges=${mutationBadgeCount}; visible=${mutationVisibleBadgeCount}`);
  if (!mutationObserved || mutationBadgeCount !== capture.expectedBadgeCount) {
    fail("SOURCE_MUTATION_NOT_RECONCILED", `Subtree replacement left ${mutationBadgeCount} badge(s).`);
  }
  if (mutationVisibleBadgeCount !== capture.expectedBadgeCount) {
    fail("BADGE_HIDDEN_BY_LIFECYCLE", `Subtree replacement left ${mutationVisibleBadgeCount} badge(s) visible.`);
  }

  const postRenderDomSnapshot = stage.innerHTML;
  const badgeVisibleText = [...stage.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')].map(getBadgeVisibleText);
  resetRenderedConversions(stage);
  const resetPreservedSource = stage.textContent === sourceTextBefore && stage.querySelector('[data-ehinium-badge="true"], [data-ehinium-converted="true"]') === null;
  if (!resetPreservedSource) fail("SOURCE_MUTATION_NOT_RECONCILED", "Reset did not preserve the captured source DOM text.");

  return {
    fixtureId: capture.id,
    retailer: capture.retailer,
    hostname: capture.hostname,
    capturedAt: capture.capturedAt,
    fixtureVersion: capture.fixtureVersion,
    sourceSelector: capture.sourceSelector,
    rawCapturedSubtree: capture.html,
    eligibleTextNodes: eligible.map((node) => node.textContent ?? ""),
    excludedTextNodes,
    parsedMatches,
    groupedCandidates: grouped.map((item) => ({ amount: item.amount, currency: item.currency })),
    discoveredCandidates,
    canonicalCandidates: canonical.map((item) => ({ amount: item.amount, currency: item.sourceCurrency, raw: item.rawText, mode: item.discoveryMode })),
    selectedAnchors: discovery.matches.map((item) => selector(item.renderingAnchor)),
    rejectedAnchors,
    renderedBadgeCount: badgeCount,
    visibleBadgeCount,
    badgeVisibilityReasons: visibilityDiagnostics.map((item) => item.visibilityReason),
    badgeVisibleText,
    repeatedScanBadgeCount,
    repeatedVisibilityBadgeCount,
    mutationBadgeCount,
    mutationVisibleBadgeCount,
    resetPreservedSource,
    firstFailingStage,
    reasons: reasons.length ? reasons : ["Captured fixture passed the complete production pipeline."],
    sourceDomSnapshot,
    postRenderDomSnapshot,
    debugTimeline: [
      ...debugTimeline,
      `candidate diagnostics: ${JSON.stringify(getCandidateDiscoveryDiagnostics())}`,
      `canonical diagnostics: ${JSON.stringify(getCanonicalizationDiagnostics())}`,
    ],
    passed: firstFailingStage === null && sameExpected(canonical.map((item) => ({ amount: item.amount, currency: item.sourceCurrency })), capture.expected),
  };
}

export async function runRealRetailCaptureSuite(root: HTMLElement): Promise<RealRetailCaptureReport[]> {
  const stages = mountRealRetailCaptureStages(root);
  const reports: RealRetailCaptureReport[] = [];
  for (const capture of realRetailCaptures) {
    const stage = stages.get(capture.id);
    if (!stage) throw new Error(`Missing real retail capture stage ${capture.id}`);
    reports.push(await runRealRetailCapture(capture, stage));
  }
  return reports;
}
