import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import {
  formatConvertedCurrency,
  formatConvertedUnit,
  formatSourceCurrency,
  formatSourceUnit,
} from "../utils/displayFormatting";
import type {
  BadgeStyle,
  BadgeVisibility,
  ConverterMode,
  TargetLengthUnit,
  TargetTemperatureUnit,
  TargetWeightUnit,
  UnitSystem,
} from "../types/settings";
import { convertUnit, resolveTargetUnit } from "../utils/unitConverter";
import { parseUnits } from "../utils/unitParser";
import type { UnitCode, UnitMatch } from "../utils/unitTypes";
import {
  badgeExists,
  createBadge,
  insertBadgeAfter,
  insertBadgeAfterTextNode,
  markBadge,
  removeBadges,
  serializeBadgeKey,
  type BadgeKey,
  type UnitBadgeKey,
} from "./badgeManager";
import { debugLog } from "./debug";
import { isInsideExcludedContent } from "./domExclusions";
import {
  detectGroupedPricesForTextNodes,
  detectGroupedPricesInRoots,
} from "./groupedPriceDetector";
import { evaluateAnchorSafety, selectPriceAnchor } from "./priceAnchor";
import {
  collectSourceTextFragments,
  discoverCurrencyMatchesInRoots,
  type CurrencyDomMatch,
} from "./currencyDomMatches";
import {
  getDuplicateDecision,
  recordProcessedMatch,
} from "./currencyMatchState";
import {
  clearHoverTargets,
  registerHoverConversionTarget,
} from "./hoverRegistry";
import {
  clearBadgeVisibilityRecords,
  registerBadgeVisibility,
} from "./badgeVisibility";
import {
  beginVisualSourceReconciliationBatch,
  canonicalizePriceCandidates,
  clearVisualSourceRegistry,
  discoverPriceCandidates,
  reconcileCanonicalVisualSource,
  registerCanonicalVisualSource,
} from "./priceCandidatePipeline";
import { reconcileBadgeHosts } from "./badgeHost";
import {
  clearBadgeHostRegistry,
  registerStandaloneBadgeHost,
} from "./badgeHostRegistry";
import { incrementPerfCounter, measureSync } from "./perfDiagnostics";

const PERF_DIAGNOSTICS_ENABLED = typeof __EUC_PERF_DIAGNOSTICS__ !== "undefined" && __EUC_PERF_DIAGNOSTICS__;
let latestCurrencyRenderAccounting = {
  convertedCandidates: 0,
  rendererRejectedCandidates: 0,
};

export function getCurrencyRenderAccounting(): Readonly<typeof latestCurrencyRenderAccounting> {
  return { ...latestCurrencyRenderAccounting };
}

export type RenderConversionOptions = {
  enabled: boolean;
  targetCurrency: string;
  converterMode: ConverterMode;
  renderCurrencies?: boolean;
  renderUnits?: boolean;
  badgeStyle: BadgeStyle;
  badgeVisibility: BadgeVisibility;
  unitSystem: UnitSystem;
  targetLengthUnit: TargetLengthUnit;
  targetWeightUnit: TargetWeightUnit;
  targetTemperatureUnit: TargetTemperatureUnit;
  convertAmount: (match: CurrencyMatch) => number | null;
  scanRoots?: readonly Node[];
  currencyDomMatches?: readonly CurrencyDomMatch[];
};

const HIDDEN_PRICE_SELECTOR = '.a-offscreen, [aria-hidden="true"]';
const UNSAFE_INTERACTIVE_CONTROL_SELECTOR = [
  "input",
  "select",
  "textarea",
  "option",
  '[contenteditable="true"]',
].join(", ");
const MAX_BADGE_VERTICAL_DISTANCE = 12;
const UNIT_EXCLUDED_SELECTOR = [
  ".a-price",
  "script",
  "style",
  "code",
  "pre",
  "input",
  "textarea",
  "select",
  "option",
  '[contenteditable="true"]',
  "[data-ehinium-badge]",
  "[data-ehinium-converted]",
  "[data-ehinium-ignore]",
].join(", ");

function formatTooltip(source: string, converted: string): string {
  return `${source} → ${converted}`;
}

function registerHoverConversion(
  anchor: HTMLElement,
  identity: string,
  content: string,
  details: Omit<Parameters<typeof debugLog>[0], "type">
): boolean {
  if (!registerHoverConversionTarget(anchor, content, identity)) {
    debugLog({
      type: "skip:hover-duplicate",
      ...details,
    });
    return false;
  }

  debugLog({
    type: "render:hover-conversion",
    ...details,
  });
  return true;
}

function getBadgeKey(match: CurrencyMatch, targetCurrency: string): BadgeKey {
  return {
    sourceCurrency: match.currency,
    targetCurrency,
    amount: match.amount,
  };
}

function shouldSkipNode(node: Text): boolean {
  const parent = node.parentElement;

  return (
    !parent ||
    isInsideExcludedContent(parent) ||
    parent.closest(HIDDEN_PRICE_SELECTOR) !== null ||
    parent.closest(UNSAFE_INTERACTIVE_CONTROL_SELECTOR) !== null
  );
}

export function getCurrencyTextNodeRenderSkipReason(node: Text): string | null {
  if (shouldSkipNode(node)) {
    return "Text node is inside renderer-excluded or hidden content";
  }

  if (!node.textContent) {
    return "Text node has no content";
  }

  const selection = selectPriceAnchor([node], node.textContent ?? "");
  if (!selection.anchor) {
    const rejectedRule = selection.candidates.at(-1)?.rejectedRule ?? "unknown-rule";
    return `No safe price anchor was found: ${rejectedRule}`;
  }

  return null;
}

export function getCurrencyPlacementSkipReason(
  anchor: HTMLElement,
  badgeVisibility: BadgeVisibility
): string | null {
  if (badgeVisibility === "always" && !isSafeBadgePlacement(anchor)) {
    return "Price anchor is not safe for badge placement";
  }

  return null;
}

function getUnitBadgeKey(
  match: UnitMatch,
  targetUnit: UnitCode,
  convertedAmount: number
): UnitBadgeKey {
  return {
    sourceUnit: match.unit,
    targetUnit,
    amount: match.amount,
    convertedAmount,
  };
}

function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function shouldSkipUnitNode(node: Text): boolean {
  const parent = node.parentElement;

  return (
    !parent ||
    isInsideExcludedContent(parent) ||
    parent.closest(UNIT_EXCLUDED_SELECTOR) !== null ||
    parent.closest(UNSAFE_INTERACTIVE_CONTROL_SELECTOR) !== null
  );
}

function isHighConfidenceUnitMatch(match: UnitMatch): boolean {
  if (match.category !== "temperature") {
    return true;
  }

  return /(?:°[cf]|celsius|fahrenheit)\s*$/iu.test(match.raw);
}

export function isSafeBadgePlacement(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  const style = getComputedStyle(anchor);

  return (
    anchor.isConnected &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    Number(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function getCandidateRevalidationReason(
  candidate: CurrencyDomMatch,
  targetCurrency: string
): string | null {
  const { match, renderingAnchor: anchor } = candidate;
  const currentInput = [...new Set(candidate.fragmentMap.map((fragment) => fragment.node))]
    .map((node) => node.textContent ?? "")
    .join("");
  if (!candidate.sourceNodes.every((node) => node.isConnected)) return "disconnected-source";
  if (!anchor.isConnected) return "disconnected-candidate";
  if (!candidate.sourceNodes.every((node) => anchor.contains(node))) return "source-not-contained";
  if (currentInput !== candidate.parserInput) return "source-text-changed";
  if (match.start < 0 || match.end > currentInput.length || match.start >= match.end) return "source-range-invalid";
  if (currentInput.slice(match.start, match.end) !== match.raw) return "source-range-invalid";
  if (!targetCurrency) return "target-currency-changed";
  const safetyInput = candidate.scanKind === "direct"
    ? candidate.parserInput
    : candidate.sourceNodes.map((node) => node.textContent ?? "").join("");
  const safety = evaluateAnchorSafety(
    anchor,
    candidate.sourceNodes,
    safetyInput,
    candidate.scanKind === "direct" ? match : undefined,
    0
  );
  if (!safety.safe) return safety.rejectedRule ?? "unsafe-anchor";
  const fullscreen = document.fullscreenElement;
  if (fullscreen && !fullscreen.contains(anchor)) return "outside-fullscreen-element";
  return null;
}

function getVerticalDistance(
  anchorRect: DOMRect,
  badgeRect: DOMRect
): number {
  if (badgeRect.bottom < anchorRect.top) {
    return anchorRect.top - badgeRect.bottom;
  }

  if (badgeRect.top > anchorRect.bottom) {
    return badgeRect.top - anchorRect.bottom;
  }

  return 0;
}

function isBadgeNearby(anchor: HTMLElement, badge: HTMLElement): boolean {
  const verticalDistance = getVerticalDistance(
    anchor.getBoundingClientRect(),
    badge.getBoundingClientRect()
  );

  return verticalDistance <= MAX_BADGE_VERTICAL_DISTANCE;
}

function insertGroupedBadgeIfNearby(
  anchor: HTMLElement,
  badge: HTMLElement
): boolean {
  insertBadgeAfter(anchor, badge);

  if (isBadgeNearby(anchor, badge)) {
    return true;
  }

  removeBadges(badge);
  return false;
}

function insertTextBadgeIfNearby(
  node: Text,
  anchor: HTMLElement,
  badge: HTMLElement
): boolean {
  insertBadgeAfterTextNode(node, badge);

  if (isBadgeNearby(anchor, badge)) {
    return true;
  }

  removeBadges(badge);
  return false;
}

function renderUnitConversions(
  textNodes: readonly Text[],
  options: Pick<
    RenderConversionOptions,
    | "badgeStyle"
    | "badgeVisibility"
    | "unitSystem"
    | "targetLengthUnit"
    | "targetWeightUnit"
    | "targetTemperatureUnit"
  >
): number {
  let renderedCount = 0;

  for (const node of textNodes) {
    if (shouldSkipUnitNode(node)) {
      continue;
    }

    const text = node.textContent;
    const anchor = node.parentElement;

    if (
      !text ||
      !anchor ||
      (options.badgeVisibility === "always" && !isSafeBadgePlacement(anchor))
    ) {
      continue;
    }

    for (const match of parseUnits(text)) {
      debugLog({
        type: "match:unit",
        sourceUnit: match.unit,
        amount: match.amount,
        text: match.raw,
      });

      if (!isHighConfidenceUnitMatch(match)) {
        continue;
      }

      const preferredTarget =
        match.category === "length"
          ? options.targetLengthUnit
          : match.category === "weight"
            ? options.targetWeightUnit
            : options.targetTemperatureUnit;
      const targetUnit = resolveTargetUnit(
        match.unit,
        options.unitSystem,
        preferredTarget
      );

      if (!targetUnit || targetUnit === match.unit) {
        continue;
      }

      const convertedAmount = convertUnit(match.amount, match.unit, targetUnit);

      if (
        convertedAmount === null ||
        !Number.isFinite(convertedAmount)
      ) {
        continue;
      }

      const formattedAmount = formatConvertedUnit(convertedAmount, targetUnit);

      if (normalizeDisplayText(formattedAmount) === normalizeDisplayText(match.raw)) {
        continue;
      }

      const badgeKey = getUnitBadgeKey(match, targetUnit, convertedAmount);
      const formattedTooltip = formatTooltip(
        formatSourceUnit(match.amount, match.unit),
        formattedAmount
      );

      if (options.badgeVisibility === "hover") {
        if (
          registerHoverConversion(
            anchor,
            serializeBadgeKey(badgeKey),
            formattedTooltip,
            {
              sourceUnit: match.unit,
              targetUnit,
              amount: match.amount,
              formatted: formattedAmount,
              text: match.raw,
            }
          )
        ) {
          renderedCount++;
        }
        continue;
      }

      if (badgeExists(anchor, badgeKey)) {
        debugLog({
          type: "skip:unit-duplicate",
          sourceUnit: match.unit,
          targetUnit,
          amount: match.amount,
          text: match.raw,
        });
        continue;
      }

      const badge = createBadge(
        formattedAmount,
        formattedTooltip,
        options.badgeStyle
      );

      markBadge(badge, badgeKey);
      if (!insertTextBadgeIfNearby(node, anchor, badge)) {
        continue;
      }
      registerBadgeVisibility(badge, anchor, anchor);
      registerStandaloneBadgeHost(
        badge,
        node,
        `unit|${serializeBadgeKey(badgeKey)}`,
        anchor
      );

      debugLog({
        type: "render:unit-badge",
        sourceUnit: match.unit,
        targetUnit,
        amount: match.amount,
        formatted: formattedAmount,
        text: match.raw,
      });
      renderedCount++;
    }
  }

  return renderedCount;
}

export function renderConversions(
  textNodes: Iterable<Text>,
  options: RenderConversionOptions
): number {
  if (!options.enabled) {
    return 0;
  }

  reconcileBadgeHosts(document);

  const nodes = [...new Set(textNodes)];
  let renderedCount = 0;
  const shouldRenderCurrencies =
    options.renderCurrencies ?? options.converterMode !== "units";
  const shouldRenderUnits =
    options.renderUnits ?? options.converterMode !== "currencies";
  latestCurrencyRenderAccounting = {
    convertedCandidates: 0,
    rendererRejectedCandidates: 0,
  };

  if (shouldRenderCurrencies) {
    const groupedPrices = options.scanRoots
      ? detectGroupedPricesInRoots(options.scanRoots)
      : detectGroupedPricesForTextNodes(nodes);
    const groupedPriceAnchors = new Set(groupedPrices.map((match) => match.anchor));
    const groupedCandidates: CurrencyDomMatch[] = [];

    for (const grouped of groupedPrices) {
      const sourceCollection = collectSourceTextFragments(grouped.anchor);
      const sourceNodes = sourceCollection.fragments.map((fragment) => fragment.node);
      if (sourceNodes.length === 0) continue;
      const parsedSourceMatch = parseCurrencies(sourceCollection.input).find((parsed) =>
        parsed.currency === grouped.currency && Math.abs(parsed.amount - grouped.amount) < 1e-9
      );
      const raw = parsedSourceMatch?.raw ?? `${grouped.currency} ${grouped.amount}`;
      groupedCandidates.push({
        parserInput: sourceCollection.input,
        match: parsedSourceMatch ?? {
          raw,
          amount: grouped.amount,
          currency: grouped.currency,
          start: -1,
          end: -1,
          tokenType: "iso",
          confidence: 1,
        },
        fragmentMap: sourceCollection.fragments,
        sourceNodes,
        sourceElement: grouped.anchor,
        renderingAnchor: grouped.anchor,
        scanKind: "combined-inline",
        directNodeParserSucceeded: false,
        localCombinedScanAttempted: true,
        excludedExtensionFragmentCount: sourceCollection.excludedExtensionFragmentCount,
        combinedTextContainsExtensionUi: false,
      });
    }

    const eligibleCurrencyNodes = nodes.filter((node) => {
      const groupedAncestor = node.parentElement?.closest<HTMLElement>(".a-price");
      return !groupedAncestor || !groupedPriceAnchors.has(groupedAncestor);
    });
    const discoveryRoots = options.scanRoots ?? eligibleCurrencyNodes;
    const discoveredDomMatches = [
      ...groupedCandidates,
      ...(options.currencyDomMatches ?? discoverCurrencyMatchesInRoots(discoveryRoots, {
        candidateNodes: eligibleCurrencyNodes,
      }).matches),
    ];
    const discoveredCandidates = PERF_DIAGNOSTICS_ENABLED
      ? measureSync("candidate-discovery", () => discoverPriceCandidates(discoveredDomMatches, options.targetCurrency, groupedPriceAnchors))
      : discoverPriceCandidates(discoveredDomMatches, options.targetCurrency, groupedPriceAnchors);
    const canonicalCandidates = PERF_DIAGNOSTICS_ENABLED
      ? measureSync("canonicalization", () => canonicalizePriceCandidates(discoveredCandidates))
      : canonicalizePriceCandidates(discoveredCandidates);
    if (PERF_DIAGNOSTICS_ENABLED) {
      incrementPerfCounter("canonicalCandidates", canonicalCandidates.length);
      incrementPerfCounter("candidatesDiscardedAsDuplicates", Math.max(0, discoveredCandidates.length - canonicalCandidates.length));
    }
    beginVisualSourceReconciliationBatch();

    for (const priceCandidate of canonicalCandidates) {
      const candidate = priceCandidate.domMatch;
      const { match } = candidate;
      const anchor = candidate.renderingAnchor;
      const aggregateFallback = priceCandidate.discoveryMode === "aggregate-fallback";
      debugLog({
        type: aggregateFallback ? "match:grouped" : "match:text",
        sourceCurrency: match.currency,
        targetCurrency: options.targetCurrency,
        amount: match.amount,
        text: match.raw,
      });

      if (match.currency === options.targetCurrency) {
        debugLog({
          type: "skip:same-currency",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
        });
        continue;
      }

      const canonicalBadge = reconcileCanonicalVisualSource(priceCandidate);
      const duplicateDecision = getDuplicateDecision(
        candidate,
        options.targetCurrency
      );

      if (canonicalBadge?.isConnected) {
        if (!duplicateDecision.duplicate) {
          recordProcessedMatch(
            candidate,
            options.targetCurrency,
            canonicalBadge,
            duplicateDecision,
            false
          );
        }
        registerBadgeVisibility(canonicalBadge, candidate.sourceElement, anchor);
        debugLog({
          type: "skip:duplicate",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: "Existing canonical badge reused",
        });
        continue;
      }

      if (duplicateDecision.duplicate) {
        if (duplicateDecision.existingBadge?.isConnected) {
          registerCanonicalVisualSource(priceCandidate, duplicateDecision.existingBadge);
        }
        debugLog({
          type: "skip:duplicate",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: duplicateDecision.reason,
        });
        continue;
      }

      const placementSkipReason = getCurrencyPlacementSkipReason(
        anchor,
        options.badgeVisibility
      );
      if (placementSkipReason) {
        latestCurrencyRenderAccounting.rendererRejectedCandidates++;
        debugLog({
          type: "skip:unsafe-placement",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: placementSkipReason,
        });
        continue;
      }
      const convertedAmount = options.convertAmount(match);

      if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
        debugLog({
          type: "error",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: "Text price conversion returned an invalid amount",
        });
        continue;
      }
      latestCurrencyRenderAccounting.convertedCandidates++;

      const formattedAmount = formatConvertedCurrency(
        convertedAmount,
        options.targetCurrency
      );
      const formattedTooltip = formatTooltip(
        formatSourceCurrency(match.amount, match.currency),
        formattedAmount
      );

      const revalidationReason = aggregateFallback
        ? null
        : getCandidateRevalidationReason(candidate, options.targetCurrency);
      if (revalidationReason) {
        latestCurrencyRenderAccounting.rendererRejectedCandidates++;
        debugLog({
          type: "skip:unsafe-placement",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: `Stale render attempt discarded: ${revalidationReason}`,
        });
        continue;
      }

      if (options.badgeVisibility === "hover") {
        if (
          registerHoverConversion(
            anchor,
            duplicateDecision.processedMatchKey,
            formattedTooltip,
            {
              sourceCurrency: match.currency,
              targetCurrency: options.targetCurrency,
              amount: match.amount,
              formatted: formattedAmount,
              text: match.raw,
            }
          )
        ) {
          renderedCount++;
        }
        continue;
      }

      const badgeKey = getBadgeKey(match, options.targetCurrency);
      const badge = createBadge(
        formattedAmount,
        formattedTooltip,
        options.badgeStyle
      );

      markBadge(badge, badgeKey);
      const inserted =
        !aggregateFallback && candidate.scanKind === "direct"
          ? insertTextBadgeIfNearby(candidate.sourceNodes[0], anchor, badge)
          : insertGroupedBadgeIfNearby(anchor, badge);
      if (!inserted) {
        latestCurrencyRenderAccounting.rendererRejectedCandidates++;
        debugLog({
          type: "skip:unsafe-placement",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          formatted: formattedAmount,
          text: match.raw,
          reason: "Text price badge was too far from its anchor",
        });
        continue;
      }

      recordProcessedMatch(
        candidate,
        options.targetCurrency,
        badge,
        duplicateDecision
      );
      // Supplemental grouped matches can originate in aria-hidden visual
      // fragments while their validated rendering anchor is visible.
      registerBadgeVisibility(badge, anchor, anchor);
      registerCanonicalVisualSource(priceCandidate, badge);

      debugLog({
        type: "render:badge",
        sourceCurrency: match.currency,
        targetCurrency: options.targetCurrency,
        amount: match.amount,
        formatted: formattedAmount,
        text: match.raw,
      });
      renderedCount++;
    }
  }

  if (shouldRenderUnits) {
    renderedCount += renderUnitConversions(nodes, options);
  }

  return renderedCount;
}

export function resetRenderedConversions(root: ParentNode): void {
  clearVisualSourceRegistry(root);
  clearBadgeVisibilityRecords(root);
  removeBadges(root);
  if (root === document) clearBadgeHostRegistry();
  clearHoverTargets();
}
