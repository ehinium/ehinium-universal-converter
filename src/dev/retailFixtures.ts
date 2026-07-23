import { getBadgeVisibleText } from "../content/badgeManager";
import { discoverCurrencyMatchesInRoots } from "../content/currencyDomMatches";
import {
  renderCurrencyConversionsOnly,
} from "../content/conversionScan";
import {
  getTextNodeScanExclusion,
  getTextNodes,
} from "../content/domScanner";
import {
  getCurrencyPlacementSkipReason,
  resetRenderedConversions,
} from "../content/domRenderer";
import { detectGroupedPricesInRoots } from "../content/groupedPriceDetector";
import { observeDomChanges } from "../content/observer";
import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { parseCurrencies, type CurrencyMatch } from "../utils/currencyParser";
import { defaultSettings } from "../utils/defaultSettings";

export const RETAIL_FIXTURE_TARGET_CURRENCY = "CAD";

/** Rates use convertCurrency's base semantics: one CAD equals rates[code] units. */
export const RETAIL_FIXTURE_RATES: ExchangeRates = {
  CAD: 1,
  USD: 0.74,
  EUR: 0.68,
  AED: 2.72,
  TRY: 23.7,
  IRR: 310000,
  JPY: 111,
  KRW: 999,
  INR: 61.5,
  IDR: 11840,
  BRL: 3.7,
};

export type RetailMutationStep = {
  description: string;
  apply(stage: HTMLElement): void;
  rescanExpected?: boolean;
};

export type RetailFixture = {
  id: string;
  market: string;
  locale: string;
  domPattern: string;
  html: string;
  expectedAmounts: number[];
  expectedCurrencies: string[];
  expectedFinalBadgeCount: number;
  mutationSteps?: RetailMutationStep[];
};

export type RetailExcludedText = {
  text: string;
  reason: string;
  rule: string;
};

export type RetailMutationReport = {
  description: string;
  rescanExpected: boolean;
  observerDelivered: boolean;
  eligibleTextNodeCount: number;
  renderedBadgeCount: number;
};

export type RetailFixtureReport = {
  fixtureId: string;
  market: string;
  locale: string;
  domPattern: string;
  eligibleTextNodeCount: number;
  excludedTextNodes: RetailExcludedText[];
  parserMatches: CurrencyMatch[];
  groupedPriceCandidates: Array<{ amount: number; currency: string }>;
  renderedBadgeCount: number;
  badgeVisibleText: string[];
  duplicateBadgeDetected: boolean;
  placementSkipReasons: string[];
  mutationSteps: RetailMutationReport[];
  sourceDomSnapshot: string;
  postRenderDomSnapshot: string;
  resetPreservedSourceDom: boolean;
  passed: boolean;
  reasons: string[];
};

export const retailFixtures: readonly RetailFixture[] = [
  {
    id: "amazon-split-whole-fraction",
    market: "Amazon UAE",
    locale: "en-AE",
    domPattern: "Visible prefix currency, whole amount, and superscript fraction with an offscreen accessible duplicate",
    html: '<article data-source-key="amazon"><span class="a-price"><span class="a-offscreen">AED 14.00</span><span class="price-visible"><span>AED</span><span>14</span><sup>00</sup></span></span></article>',
    expectedAmounts: [14],
    expectedCurrencies: ["AED"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "ebay-linked-range",
    market: "eBay",
    locale: "en-IE",
    domPattern: "Two linked range values",
    html: '<a data-source-key="ebay" href="#range"><span>EUR 10.00</span> to <span>EUR 20.00</span></a>',
    expectedAmounts: [10, 20],
    expectedCurrencies: ["EUR", "EUR"],
    expectedFinalBadgeCount: 2,
  },
  {
    id: "walmart-current-previous-savings",
    market: "Walmart US",
    locale: "en-US",
    domPattern: "Current, struck previous, and explicit savings values",
    html: '<article data-source-key="walmart"><strong>USD 24.98</strong><del>USD 29.98</del><span>Save USD 5.00</span></article>',
    expectedAmounts: [5, 24.98, 29.98],
    expectedCurrencies: ["USD", "USD", "USD"],
    expectedFinalBadgeCount: 3,
  },
  {
    id: "trendyol-european-try",
    market: "Trendyol Türkiye",
    locale: "tr-TR",
    domPattern: "TRY with European grouping and decimal separators",
    html: '<div data-source-key="trendyol" lang="tr">1.299,99 TRY</div>',
    expectedAmounts: [1299.99],
    expectedCurrencies: ["TRY"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "digikala-rtl-irr",
    market: "Digikala Iran",
    locale: "fa-IR",
    domPattern: "RTL Persian digits with Rial identifier",
    html: '<div data-source-key="digikala" lang="fa" dir="rtl">۱٬۲۳۴٬۵۶۷ ریال</div>',
    expectedAmounts: [1234567],
    expectedCurrencies: ["IRR"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "noon-arabic-aed",
    market: "Noon UAE",
    locale: "ar-AE",
    domPattern: "Arabic RTL digits with AED prefix",
    html: '<div data-source-key="noon" lang="ar" dir="rtl"><span>AED</span> <span>١٢٩٫٩٥</span></div>',
    expectedAmounts: [129.95],
    expectedCurrencies: ["AED"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "rakuten-jpy",
    market: "Rakuten Japan",
    locale: "ja-JP",
    domPattern: "JPY integer price",
    html: '<div data-source-key="rakuten" lang="ja">1,980 JPY</div>',
    expectedAmounts: [1980],
    expectedCurrencies: ["JPY"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "coupang-krw",
    market: "Coupang Korea",
    locale: "ko-KR",
    domPattern: "KRW grouped integer",
    html: '<div data-source-key="coupang" lang="ko">29,900 KRW</div>',
    expectedAmounts: [29900],
    expectedCurrencies: ["KRW"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "flipkart-indian-grouping",
    market: "Flipkart India",
    locale: "en-IN",
    domPattern: "Indian lakh grouping with INR prefix",
    html: '<div data-source-key="flipkart">INR 1,23,499.00</div>',
    expectedAmounts: [123499],
    expectedCurrencies: ["INR"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "shopee-idr",
    market: "Shopee Indonesia",
    locale: "id-ID",
    domPattern: "IDR grouped integer",
    html: '<div data-source-key="shopee" lang="id">249,000 IDR</div>',
    expectedAmounts: [249000],
    expectedCurrencies: ["IDR"],
    expectedFinalBadgeCount: 1,
  },
  {
    id: "mercado-brl-installments",
    market: "Mercado Livre Brazil",
    locale: "pt-BR",
    domPattern: "BRL total and installment price",
    html: '<div data-source-key="mercado" lang="pt-BR"><strong>BRL 1.299,90</strong><span>10x BRL 129,99</span></div>',
    expectedAmounts: [129.99, 1299.9],
    expectedCurrencies: ["BRL", "BRL"],
    expectedFinalBadgeCount: 2,
  },
  {
    id: "dynamic-variant-replacement",
    market: "Generic variant selector",
    locale: "en-GB",
    domPattern: "Price subtree replacement after variant selection",
    html: '<div data-source-key="variant"><span data-variant-price>EUR 19.99</span></div>',
    expectedAmounts: [19.99, 24.99],
    expectedCurrencies: ["EUR", "EUR"],
    expectedFinalBadgeCount: 1,
    mutationSteps: [{
      description: "Replace the selected variant price subtree",
      apply(stage) {
        const replacement = document.createElement("span");
        replacement.dataset.variantPrice = "";
        replacement.textContent = "EUR 24.99";
        stage.querySelector("[data-variant-price]")?.replaceWith(replacement);
      },
    }],
  },
  {
    id: "lazy-product-insertion-removal",
    market: "Generic lazy product grid",
    locale: "en-US",
    domPattern: "Lazy product insertion followed by removal",
    html: '<div data-source-key="lazy"></div>',
    expectedAmounts: [18.5],
    expectedCurrencies: ["USD"],
    expectedFinalBadgeCount: 0,
    mutationSteps: [
      {
        description: "Insert a lazy-loaded product price",
        apply(stage) {
          const product = document.createElement("article");
          product.dataset.lazyProduct = "";
          product.textContent = "USD 18.50";
          stage.querySelector('[data-source-key="lazy"]')?.append(product);
        },
      },
      {
        description: "Remove the lazy-loaded product",
        rescanExpected: false,
        apply(stage) {
          stage.querySelector("[data-lazy-product]")?.remove();
        },
      },
    ],
  },
  {
    id: "dark-clickable-price",
    market: "Generic dark storefront",
    locale: "en-GB",
    domPattern: "Dark clickable price container",
    html: '<a data-source-key="dark" href="#dark-product" style="display:inline-block;background:#111827;color:#f9fafb;padding:12px">EUR 89.00</a>',
    expectedAmounts: [89],
    expectedCurrencies: ["EUR"],
    expectedFinalBadgeCount: 1,
  },
];

function allTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.textContent?.trim()) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function snapshot(root: HTMLElement): string {
  return root.innerHTML;
}

function sortedNumbers(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fixtureSettings(): UserSettings {
  return {
    ...defaultSettings,
    targetCurrency: RETAIL_FIXTURE_TARGET_CURRENCY,
    converterMode: "currencies",
    badgeVisibility: "always",
  };
}

function inspectStage(stage: HTMLElement) {
  const eligible = getTextNodes(stage);
  const eligibleSet = new Set(eligible);
  const excludedTextNodes = allTextNodes(stage).flatMap((node): RetailExcludedText[] => {
    if (eligibleSet.has(node)) return [];
    const exclusion = getTextNodeScanExclusion(node);
    return exclusion ? [{ text: node.textContent ?? "", reason: exclusion.reason, rule: exclusion.rule }] : [];
  });
  const directParserMatches = eligible.flatMap((node) => parseCurrencies(node.textContent ?? ""));
  const discovery = discoverCurrencyMatchesInRoots([stage], { candidateNodes: eligible });
  const parserMatches = discovery.matches.map((candidate) => candidate.match);
  const grouped = detectGroupedPricesInRoots([stage]);
  const placementSkipReasons = discovery.matches.flatMap((candidate) => {
    const reason = getCurrencyPlacementSkipReason(candidate.renderingAnchor, "always");
    return reason ? [reason] : [];
  });
  return { eligible, excludedTextNodes, directParserMatches, discovery, parserMatches, grouped, placementSkipReasons };
}

function renderStage(stage: HTMLElement): ReturnType<typeof inspectStage> {
  const inspection = inspectStage(stage);
  renderCurrencyConversionsOnly(
    inspection.eligible,
    fixtureSettings(),
    RETAIL_FIXTURE_RATES,
    [stage],
    inspection.discovery.matches
  );
  return inspection;
}

function badgeTexts(stage: HTMLElement): string[] {
  return [...stage.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')]
    .map(getBadgeVisibleText);
}

function sourceText(stage: HTMLElement): string {
  return allTextNodes(stage)
    .filter((node) => !node.parentElement?.closest('[data-ehinium-badge="true"], [data-ehinium-converted="true"]'))
    .map((node) => node.textContent ?? "")
    .join("|");
}

async function nextMutationTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function mountRetailFixtureStages(root: HTMLElement): Map<string, HTMLElement> {
  root.replaceChildren();
  const stages = new Map<string, HTMLElement>();
  for (const fixture of retailFixtures) {
    const stage = document.createElement("section");
    stage.className = "retail-fixture-stage";
    stage.dataset.retailFixtureId = fixture.id;
    stage.lang = fixture.locale;
    stage.innerHTML = fixture.html;
    root.append(stage);
    stages.set(fixture.id, stage);
  }
  return stages;
}

export async function runRetailFixture(
  fixture: RetailFixture,
  stage: HTMLElement
): Promise<RetailFixtureReport> {
  resetRenderedConversions(stage);
  stage.innerHTML = fixture.html;
  const sourceDomSnapshot = snapshot(stage);
  const originalSourceText = sourceText(stage);
  const sourceElements = [...stage.querySelectorAll<HTMLElement>("[data-source-key]")];
  const reasons: string[] = [];
  const observedMatches: CurrencyMatch[] = [];
  const observedGrouped = new Map<string, { amount: number; currency: string }>();
  const excluded = new Map<string, RetailExcludedText>();
  const placementReasons = new Set<string>();
  let maximumEligibleTextNodes = 0;
  let latestInspection = renderStage(stage);

  const absorbInspection = (inspection: ReturnType<typeof inspectStage>): void => {
    maximumEligibleTextNodes = Math.max(maximumEligibleTextNodes, inspection.eligible.length);
    for (const match of inspection.parserMatches) {
      const key = `${match.currency}|${match.amount}|${match.raw}`;
      if (!observedMatches.some((item) => `${item.currency}|${item.amount}|${item.raw}` === key)) observedMatches.push(match);
    }
    for (const item of inspection.grouped) observedGrouped.set(`${item.currency}|${item.amount}`, { amount: item.amount, currency: item.currency });
    for (const item of inspection.excludedTextNodes) excluded.set(`${item.rule}|${item.text}`, item);
    for (const reason of inspection.placementSkipReasons) placementReasons.add(reason);
  };
  absorbInspection(latestInspection);

  const mutationReports: RetailMutationReport[] = [];
  for (const mutation of fixture.mutationSteps ?? []) {
    let observerDelivered = false;
    const stop = observeDomChanges((roots) => {
      if (roots.some((root) => root === stage || stage.contains(root) || !root.isConnected)) {
        observerDelivered = true;
      }
    });
    mutation.apply(stage);
    await nextMutationTurn();
    stop();
    latestInspection = renderStage(stage);
    absorbInspection(latestInspection);
    mutationReports.push({
      description: mutation.description,
      rescanExpected: mutation.rescanExpected !== false,
      observerDelivered,
      eligibleTextNodeCount: latestInspection.eligible.length,
      renderedBadgeCount: stage.querySelectorAll('[data-ehinium-badge="true"]').length,
    });
  }

  const beforeRepeatedRender = stage.querySelectorAll('[data-ehinium-badge="true"]').length;
  latestInspection = renderStage(stage);
  absorbInspection(latestInspection);
  const renderedBadgeCount = stage.querySelectorAll('[data-ehinium-badge="true"]').length;
  const duplicateBadgeDetected = renderedBadgeCount !== beforeRepeatedRender;
  const visibleBadges = badgeTexts(stage);
  const postRenderDomSnapshot = snapshot(stage);

  if (!stage.isConnected || stage.closest('[data-ehinium-ignore="true"], [data-euc-owned], [data-euc-badge], [data-ehinium-converted], [aria-hidden="true"], .a-offscreen')) {
    reasons.push("Fixture stage is not scanner-eligible.");
  }
  if (!fixture.mutationSteps && maximumEligibleTextNodes === 0) reasons.push("Static fixture exposed no eligible text nodes.");
  if (!sameJson(sortedNumbers(observedMatches.map((match) => match.amount)), sortedNumbers(fixture.expectedAmounts))) {
    reasons.push(`Expected amounts ${fixture.expectedAmounts.join(", ")}; observed ${observedMatches.map((match) => match.amount).join(", ") || "none"}.`);
  }
  if (!sameJson(sortedStrings(observedMatches.map((match) => match.currency)), sortedStrings(fixture.expectedCurrencies))) {
    reasons.push(`Expected currencies ${fixture.expectedCurrencies.join(", ")}; observed ${observedMatches.map((match) => match.currency).join(", ") || "none"}.`);
  }
  if (renderedBadgeCount !== fixture.expectedFinalBadgeCount) {
    reasons.push(`Expected ${fixture.expectedFinalBadgeCount} final badge(s); observed ${renderedBadgeCount}.`);
  }
  if (duplicateBadgeDetected) reasons.push("Repeated render changed the active badge count.");
  for (const mutation of mutationReports) {
    if (mutation.rescanExpected && !mutation.observerDelivered) reasons.push(`Mutation observer did not deliver: ${mutation.description}.`);
  }

  const textBeforeReset = sourceText(stage);
  resetRenderedConversions(stage);
  const resetPreservedSourceDom = stage.querySelector('[data-ehinium-badge="true"], [data-ehinium-converted="true"]') === null &&
    sourceText(stage) === textBeforeReset &&
    sourceElements.every((element) => element.isConnected && stage.contains(element));
  if (!resetPreservedSourceDom) reasons.push("Reset did not remove owned output while preserving source text.");
  if (!fixture.mutationSteps && originalSourceText !== sourceText(stage)) reasons.push("Static source text changed during rendering/reset.");

  // Leave the fixture visibly rendered in the development page after testing.
  renderStage(stage);

  return {
    fixtureId: fixture.id,
    market: fixture.market,
    locale: fixture.locale,
    domPattern: fixture.domPattern,
    eligibleTextNodeCount: maximumEligibleTextNodes,
    excludedTextNodes: [...excluded.values()],
    parserMatches: observedMatches,
    groupedPriceCandidates: [...observedGrouped.values()],
    renderedBadgeCount,
    badgeVisibleText: visibleBadges,
    duplicateBadgeDetected,
    placementSkipReasons: [...placementReasons],
    mutationSteps: mutationReports,
    sourceDomSnapshot,
    postRenderDomSnapshot,
    resetPreservedSourceDom,
    passed: reasons.length === 0,
    reasons: reasons.length ? reasons : ["Fixture passed production discovery, conversion, rendering, duplicate, mutation, and reset checks."],
  };
}

export async function runRetailFixtureSuite(root: HTMLElement): Promise<RetailFixtureReport[]> {
  const stages = mountRetailFixtureStages(root);
  const reports: RetailFixtureReport[] = [];
  for (const fixture of retailFixtures) {
    const stage = stages.get(fixture.id);
    if (!stage) throw new Error(`Missing retail fixture stage ${fixture.id}`);
    reports.push(await runRetailFixture(fixture, stage));
  }
  return reports;
}
