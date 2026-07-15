import {
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
import { findPriceAnchor } from "./priceAnchor";
import {
  collectCurrencyDomMatches,
  collectSourceTextFragments,
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
};

const HIDDEN_PRICE_SELECTOR = '.a-offscreen, [aria-hidden="true"]';
const UNSAFE_BADGE_PLACEMENT_SELECTOR = [
  ".twisterSlotDiv",
  ".twisterSwatchWrapper",
  "#promoPriceBlockMessage_feature_div",
  "#vouchers_feature_div",
  '[id*="coupon"]',
  '[id*="promo"]',
  '[id*="promotion"]',
].join(", ");
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

  if (!findPriceAnchor(node)) {
    return "No safe price anchor was found";
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

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    anchor.closest(UNSAFE_BADGE_PLACEMENT_SELECTOR) === null
  );
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

  const nodes = Array.from(textNodes);
  let renderedCount = 0;
  const shouldRenderCurrencies =
    options.renderCurrencies ?? options.converterMode !== "units";
  const shouldRenderUnits =
    options.renderUnits ?? options.converterMode !== "currencies";

  if (shouldRenderCurrencies) {
    const groupedPrices = options.scanRoots
      ? detectGroupedPricesInRoots(options.scanRoots)
      : detectGroupedPricesForTextNodes(nodes);
    const groupedPriceAnchors = new Set(groupedPrices.map((match) => match.anchor));

    for (const match of groupedPrices) {
    const sourceCollection = collectSourceTextFragments(match.anchor);
    const sourceNodes = sourceCollection.fragments.map((fragment) => fragment.node);
    if (sourceNodes.length === 0) {
      continue;
    }
    const currencyMatch: CurrencyMatch = {
      raw: `${match.currency} ${match.amount}`,
      amount: match.amount,
      currency: match.currency,
      start: 0,
      end: `${match.currency} ${match.amount}`.length,
      tokenType: "iso",
      confidence: 1,
    };
    const groupedCandidate: CurrencyDomMatch = {
      parserInput: sourceCollection.input,
      match: currencyMatch,
      fragmentMap: sourceCollection.fragments,
      sourceNodes,
      sourceElement: match.anchor,
      renderingAnchor: match.anchor,
      scanKind: "combined-inline",
      directNodeParserSucceeded: false,
      localCombinedScanAttempted: true,
      excludedExtensionFragmentCount:
        sourceCollection.excludedExtensionFragmentCount,
      combinedTextContainsExtensionUi: false,
    };

    debugLog({
      type: "match:grouped",
      sourceCurrency: currencyMatch.currency,
      targetCurrency: options.targetCurrency,
      amount: currencyMatch.amount,
      text: currencyMatch.raw,
    });

    if (currencyMatch.currency === options.targetCurrency) {
      debugLog({
        type: "skip:same-currency",
        sourceCurrency: currencyMatch.currency,
        targetCurrency: options.targetCurrency,
        amount: currencyMatch.amount,
        text: currencyMatch.raw,
      });
      continue;
    }

    const badgeKey = getBadgeKey(currencyMatch, options.targetCurrency);
    const duplicateDecision = getDuplicateDecision(
      groupedCandidate,
      options.targetCurrency
    );

    if (duplicateDecision.duplicate) {
      debugLog({
        type: "skip:duplicate",
        sourceCurrency: currencyMatch.currency,
        targetCurrency: options.targetCurrency,
        amount: currencyMatch.amount,
        text: currencyMatch.raw,
        reason: duplicateDecision.reason,
      });
      continue;
    }

    if (
      options.badgeVisibility === "always" &&
      !isSafeBadgePlacement(match.anchor)
    ) {
      debugLog({
        type: "skip:unsafe-placement",
        sourceCurrency: currencyMatch.currency,
        targetCurrency: options.targetCurrency,
        amount: currencyMatch.amount,
        text: currencyMatch.raw,
        reason: "Grouped price anchor is not safe for badge placement",
      });
      continue;
    }

    const convertedAmount = options.convertAmount(currencyMatch);

    if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
      debugLog({
        type: "error",
        sourceCurrency: currencyMatch.currency,
        targetCurrency: options.targetCurrency,
        amount: currencyMatch.amount,
        text: currencyMatch.raw,
        reason: "Grouped price conversion returned an invalid amount",
      });
      continue;
    }

    const formattedAmount = formatConvertedCurrency(
      convertedAmount,
      options.targetCurrency
    );
    const formattedTooltip = formatTooltip(
      formatSourceCurrency(currencyMatch.amount, currencyMatch.currency),
      formattedAmount
    );

    if (options.badgeVisibility === "hover") {
      if (
        registerHoverConversion(
          match.anchor,
          duplicateDecision.processedMatchKey,
          formattedTooltip,
          {
            sourceCurrency: currencyMatch.currency,
            targetCurrency: options.targetCurrency,
            amount: currencyMatch.amount,
            formatted: formattedAmount,
            text: currencyMatch.raw,
          }
        )
      ) {
        renderedCount++;
      }
      continue;
    }

    const badge = createBadge(
      formattedAmount,
      formattedTooltip,
      options.badgeStyle
    );

    markBadge(badge, badgeKey);
    if (!insertGroupedBadgeIfNearby(match.anchor, badge)) {
      debugLog({
        type: "skip:unsafe-placement",
        sourceCurrency: currencyMatch.currency,
        targetCurrency: options.targetCurrency,
        amount: currencyMatch.amount,
        formatted: formattedAmount,
        text: currencyMatch.raw,
        reason: "Grouped price badge was too far from its anchor",
      });
      continue;
    }

    recordProcessedMatch(
      groupedCandidate,
      options.targetCurrency,
      badge,
      duplicateDecision
    );
    registerBadgeVisibility(badge, match.anchor, match.anchor);

    debugLog({
      type: "render:badge",
      sourceCurrency: currencyMatch.currency,
      targetCurrency: options.targetCurrency,
      amount: currencyMatch.amount,
      formatted: formattedAmount,
      text: currencyMatch.raw,
    });
      renderedCount++;
    }

    const eligibleCurrencyNodes = nodes.filter(
      (node) => {
        if (getCurrencyTextNodeRenderSkipReason(node) !== null) {
          return false;
        }

        const groupedAncestor = node.parentElement?.closest<HTMLElement>(".a-price");
        return !groupedAncestor || !groupedPriceAnchors.has(groupedAncestor);
      }
    );

    for (const candidate of collectCurrencyDomMatches(eligibleCurrencyNodes)) {
      const { match } = candidate;
      const anchor = candidate.renderingAnchor;
      debugLog({
        type: "match:text",
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

      const badgeKey = getBadgeKey(match, options.targetCurrency);
      const duplicateDecision = getDuplicateDecision(
        candidate,
        options.targetCurrency
      );

      if (duplicateDecision.duplicate) {
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

      const formattedAmount = formatConvertedCurrency(
        convertedAmount,
        options.targetCurrency
      );
      const formattedTooltip = formatTooltip(
        formatSourceCurrency(match.amount, match.currency),
        formattedAmount
      );

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

      const badge = createBadge(
        formattedAmount,
        formattedTooltip,
        options.badgeStyle
      );

      markBadge(badge, badgeKey);
      const inserted =
        candidate.scanKind === "direct"
          ? insertTextBadgeIfNearby(candidate.sourceNodes[0], anchor, badge)
          : insertGroupedBadgeIfNearby(anchor, badge);
      if (!inserted) {
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
      registerBadgeVisibility(badge, candidate.sourceElement, anchor);

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
  clearBadgeVisibilityRecords(root);
  removeBadges(root);
  clearHoverTargets();
}
