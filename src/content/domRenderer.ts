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
import { convertUnit, resolveTargetUnit, unitSystemOf } from "../utils/unitConverter";
import { parseUnits, unitMatchAmounts } from "../utils/unitParser";
import type { UnitCode, UnitMatch } from "../utils/unitTypes";
import {
  badgeExists,
  createBadge,
  insertBadgeAfter,
  insertBadgeAfterTextNode,
  markBadge,
  refreshBadgeColorContext,
  removeBadges,
  serializeBadgeKey,
  type BadgeKey,
  type UnitBadgeKey,
} from "./badgeManager";
import { debugLog } from "./debug";
import { isInsideExcludedContent } from "./domExclusions";
import { SCREEN_READER_ONLY_SELECTOR } from "./domScanner";
import { escapeClippedBadge, type BadgeSource } from "./badgePlacement";
import { rememberHiddenContent } from "./revealWatcher";
import {
  detectGroupedPricesForTextNodes,
  detectGroupedPricesInRoots,
} from "./groupedPriceDetector";
import { evaluateAnchorSafety, selectPriceAnchor } from "./priceAnchor";
import {
  collectSourceTextFragments,
  discoverCurrencyMatchesInRoots,
  withSourceTextMemo,
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

const HIDDEN_PRICE_SELECTOR = SCREEN_READER_ONLY_SELECTOR;
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

/** `combine`: the element collects several conversions (clipped prices of one tile). */
function registerHoverConversion(
  anchor: HTMLElement,
  identity: string,
  content: string,
  details: Omit<Parameters<typeof debugLog>[0], "type">,
  combine = false
): boolean {
  if (!registerHoverConversionTarget(anchor, content, identity, combine)) {
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
  convertedAmounts: readonly number[]
): UnitBadgeKey {
  return {
    sourceUnit: match.unit,
    targetUnit,
    amount: match.amount,
    convertedAmount: convertedAmounts[0],
    ...(match.dimensions ? { dimensions: match.dimensions } : {}),
    ...(match.range ? { range: match.range } : {}),
  };
}

// Within this tolerance a stated metric value is the same measurement rounded.
const EQUIVALENT_MEASUREMENT_TOLERANCE = 0.03;

/**
 * True when the same text already gives the measurement in the target system,
 * as in `138 cm (55 inch)` or `1/4” (6.35 mm)`; a badge would only repeat it.
 */
function hasEquivalentMeasurement(
  matches: readonly UnitMatch[],
  match: UnitMatch,
  targetUnit: UnitCode,
  convertedAmounts: readonly number[]
): boolean {
  return matches.some((other) => {
    if (other === match || other.category !== match.category || other.unit === match.unit) return false;
    // "6 ft (72 in)" states it twice in the same system; a metric reader still needs a badge.
    if (unitSystemOf(other.unit) !== unitSystemOf(targetUnit)) return false;
    const otherAmounts = unitMatchAmounts(other).amounts;
    if (otherAmounts.length !== convertedAmounts.length) return false;
    return otherAmounts.every((amount, index) => {
      const inTarget = convertUnit(amount, other.unit, targetUnit);
      const expected = convertedAmounts[index];
      return inTarget !== null && expected !== 0 &&
        Math.abs(inTarget - expected) / Math.abs(expected) <= EQUIVALENT_MEASUREMENT_TOLERANCE;
    });
  });
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

/**
 * "clipped": no nearby place shows the badge (a fixed-size swatch tile); it is
 * removed and the conversion belongs on `hoverTarget`, the box that cut it off.
 */
type BadgePlacementResult =
  | { status: "placed" | "too-far" }
  | { status: "clipped"; hoverTarget: HTMLElement };

/**
 * Moves a clipped badge out of its box, then keeps it only when it still sits
 * next to the price (or next to the box it was moved after). `source` is what
 * the badge converts, never an element that holds the badge itself.
 */
function settleBadgePlacement(anchor: HTMLElement, badge: HTMLElement, source: BadgeSource): BadgePlacementResult {
  const { escapedAfter, clipped, clippedBy } = escapeClippedBadge(badge, source, anchor);
  if (clipped) {
    removeBadges(badge);
    return { status: "clipped", hoverTarget: clippedBy instanceof HTMLElement ? clippedBy : anchor };
  }
  const reference = escapedAfter instanceof HTMLElement ? escapedAfter : anchor;

  if (isBadgeNearby(reference, badge)) {
    if (escapedAfter) refreshBadgeColorContext(badge, anchor);
    return { status: "placed" };
  }

  removeBadges(badge);
  return { status: "too-far" };
}

function insertGroupedBadgeIfNearby(
  anchor: HTMLElement,
  badge: HTMLElement
): BadgePlacementResult {
  insertBadgeAfter(anchor, badge);
  return settleBadgePlacement(anchor, badge, anchor);
}

/** Inserts after a currency icon that follows the number, still measured against the price. */
function insertBadgeAfterElementIfNearby(
  element: HTMLElement,
  anchor: HTMLElement,
  badge: HTMLElement
): BadgePlacementResult {
  insertBadgeAfter(element, badge);
  return settleBadgePlacement(anchor, badge, element);
}

/** `start` and `end` locate the match in the node's text. */
function insertTextBadgeIfNearby(
  node: Text,
  anchor: HTMLElement,
  badge: HTMLElement,
  match: { start: number; end: number },
  previous?: HTMLElement | null
): BadgePlacementResult {
  insertBadgeAfterTextNode(node, badge, previous);
  return settleBadgePlacement(anchor, badge, { node, ...match });
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
  // Parse everything and check every anchor before the first badge goes in:
  // a layout read after an insertion forces a new synchronous layout of the page.
  const work: { node: Text; anchor: HTMLElement; matches: UnitMatch[] }[] = [];
  for (const node of textNodes) {
    if (shouldSkipUnitNode(node)) {
      continue;
    }
    const text = node.textContent;
    const anchor = node.parentElement;
    if (!text || !anchor) {
      continue;
    }
    const matches = parseUnits(text);
    if (matches.length > 0) work.push({ node, anchor, matches });
  }
  const safeAnchors = new Map<HTMLElement, boolean>();
  if (options.badgeVisibility === "always") {
    for (const { anchor } of work) {
      if (!safeAnchors.has(anchor)) safeAnchors.set(anchor, isSafeBadgePlacement(anchor));
    }
  }

  for (const { node, anchor, matches } of work) {
    if (options.badgeVisibility === "always" && !safeAnchors.get(anchor)) {
      // A hidden tab or variant gets its badges when the page reveals it.
      if (anchor.isConnected) rememberHiddenContent(anchor);
      continue;
    }

    let previousBadge: HTMLElement | null = null;
    // Where each measurement sits in the text, to tell whether a box hides it.
    const text = node.textContent ?? "";
    let searchFrom = 0;
    const positions = matches.map((match) => {
      const start = text.indexOf(match.raw, searchFrom);
      if (start < 0) return { start: 0, end: text.length };
      searchFrom = start + match.raw.length;
      return { start, end: searchFrom };
    });

    for (const [index, match] of matches.entries()) {
      debugLog({
        type: "match:unit",
        sourceUnit: match.unit,
        amount: match.amount,
        text: match.raw,
      });

      const preferredTarget =
        match.category === "length"
          ? options.targetLengthUnit
          : match.category === "weight"
            ? options.targetWeightUnit
            : match.category === "temperature"
              ? options.targetTemperatureUnit
              : "auto";
      const targetUnit = resolveTargetUnit(
        match.unit,
        options.unitSystem,
        preferredTarget
      );

      if (!targetUnit || targetUnit === match.unit) {
        continue;
      }

      const { amounts: sourceAmounts, joiner } = unitMatchAmounts(match);
      const convertedAmounts = sourceAmounts.map((amount) =>
        convertUnit(amount, match.unit, targetUnit)
      );

      if (
        convertedAmounts.some((amount) => amount === null || !Number.isFinite(amount))
      ) {
        continue;
      }

      if (hasEquivalentMeasurement(matches, match, targetUnit, convertedAmounts as number[])) {
        debugLog({
          type: "skip:unit-duplicate",
          sourceUnit: match.unit,
          targetUnit,
          amount: match.amount,
          text: match.raw,
          reason: "The text already states this measurement in the target system",
        });
        continue;
      }

      const formattedAmount = formatConvertedUnit(convertedAmounts as number[], targetUnit, joiner);

      if (normalizeDisplayText(formattedAmount) === normalizeDisplayText(match.raw)) {
        continue;
      }

      const badgeKey = getUnitBadgeKey(match, targetUnit, convertedAmounts as number[]);
      const formattedTooltip = formatTooltip(
        formatSourceUnit(sourceAmounts, match.unit, joiner),
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
      const placement = insertTextBadgeIfNearby(node, anchor, badge, positions[index], previousBadge);
      if (placement.status === "clipped") {
        // No room beside it (a fixed-size tile): the conversion shows on hover instead.
        if (registerHoverConversion(placement.hoverTarget, serializeBadgeKey(badgeKey), formattedTooltip, {
          sourceUnit: match.unit,
          targetUnit,
          amount: match.amount,
          formatted: formattedAmount,
          text: match.raw,
        }, true)) {
          renderedCount++;
        }
        continue;
      }
      if (placement.status !== "placed") {
        continue;
      }
      previousBadge = badge;
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
  // Containers shared by many prices are read once per pass, not once per price.
  return withSourceTextMemo(() => renderConversionsPass(textNodes, options));
}

function renderConversionsPass(
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
    // Several prices in one text node ("$40 to $50") keep their source order.
    const lastBadgeByNode = new Map<Text, HTMLElement>();
    // Layout reads for every candidate happen before the first badge goes in:
    // a read after an insertion forces a new synchronous layout of the page.
    // Badges live in shadow roots and add no text, so the answers are unchanged.
    const placementSkipReasons = new Map(canonicalCandidates.map((priceCandidate) => [
      priceCandidate,
      priceCandidate.domMatch.match.amount === 0
        ? null
        : getCurrencyPlacementSkipReason(priceCandidate.domMatch.renderingAnchor, options.badgeVisibility),
    ]));
    const revalidationReasons = new Map(canonicalCandidates.map((priceCandidate) => [
      priceCandidate,
      priceCandidate.discoveryMode === "aggregate-fallback" || priceCandidate.domMatch.match.amount === 0
        ? null
        : getCandidateRevalidationReason(priceCandidate.domMatch, options.targetCurrency),
    ]));

    for (const priceCandidate of canonicalCandidates) {
      const candidate = priceCandidate.domMatch;
      const { match } = candidate;
      const anchor = candidate.renderingAnchor;
      const aggregateFallback = priceCandidate.discoveryMode === "aggregate-fallback";
      // "Pay $0.00" and free shipping need no conversion.
      if (match.amount === 0) continue;
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

      const placementSkipReason = placementSkipReasons.get(priceCandidate) ?? null;
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

      const revalidationReason = revalidationReasons.get(priceCandidate) ?? null;
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
      const sourceNode = candidate.sourceNodes[0];
      const placement =
        !aggregateFallback && candidate.scanKind === "direct"
          ? insertTextBadgeIfNearby(sourceNode, anchor, badge, match, lastBadgeByNode.get(sourceNode))
          : candidate.placementAfter
            ? insertBadgeAfterElementIfNearby(candidate.placementAfter, anchor, badge)
            : insertGroupedBadgeIfNearby(anchor, badge);
      if (placement.status === "placed" && candidate.scanKind === "direct") lastBadgeByNode.set(sourceNode, badge);
      if (placement.status === "clipped") {
        // No room beside the price (a fixed-size swatch tile): the conversion shows on hover.
        if (registerHoverConversion(placement.hoverTarget, duplicateDecision.processedMatchKey, formattedTooltip, {
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          formatted: formattedAmount,
          text: match.raw,
        }, true)) {
          renderedCount++;
        }
        continue;
      }
      if (placement.status !== "placed") {
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
