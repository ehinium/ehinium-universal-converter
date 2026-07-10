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
import { detectGroupedPrices } from "./groupedPriceDetector";
import { findPriceAnchor } from "./priceAnchor";
import {
  clearHoverTargets,
  registerHoverConversionTarget,
} from "./hoverRegistry";

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
};

const PRICE_SCOPE_SELECTOR = [
  ".a-price",
  "[data-ehinium-price-key]",
  '[class*="price"]',
  '[class*="Price"]',
  '[data-testid*="price"]',
].join(", ");

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
const PROMO_TEXT_PATTERN =
  /\b(?:savings?|discount|coupon|promo|redeem|credit\s+card|enter\s+code|max)\b/iu;
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

function priceScopeHasKey(node: Text, key: BadgeKey): boolean {
  const scope = node.parentElement?.closest<HTMLElement>(PRICE_SCOPE_SELECTOR);

  return (
    scope?.getAttribute("data-ehinium-price-key") === serializeBadgeKey(key)
  );
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

function isPromoTextNode(node: Text): boolean {
  return PROMO_TEXT_PATTERN.test(node.parentElement?.textContent ?? "");
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
    for (const match of detectGroupedPrices(document)) {
    const currencyMatch: CurrencyMatch = {
      raw: `${match.currency} ${match.amount}`,
      amount: match.amount,
      currency: match.currency,
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

    if (badgeExists(match.anchor, badgeKey)) {
      debugLog({
        type: "skip:duplicate",
        sourceCurrency: currencyMatch.currency,
        targetCurrency: options.targetCurrency,
        amount: currencyMatch.amount,
        text: currencyMatch.raw,
        reason: "Grouped price badge already exists",
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
          serializeBadgeKey(badgeKey),
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

    for (const node of nodes) {
    if (shouldSkipNode(node)) {
      continue;
    }

    const text = node.textContent;
    const anchor = findPriceAnchor(node);

    if (!text || !anchor) {
      continue;
    }

    if (isPromoTextNode(node)) {
      debugLog({
        type: "skip:unsafe-placement",
        targetCurrency: options.targetCurrency,
        text: text.slice(0, 500),
        reason: "Text is inside promotional content",
      });
      continue;
    }

    const matches = parseCurrencies(text);

    if (matches.length === 0) {
      continue;
    }

    for (const match of matches) {
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

      if (priceScopeHasKey(node, badgeKey) || badgeExists(anchor, badgeKey)) {
        debugLog({
          type: "skip:duplicate",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: "Text price badge already exists",
        });
        continue;
      }

      if (
        options.badgeVisibility === "always" &&
        !isSafeBadgePlacement(anchor)
      ) {
        debugLog({
          type: "skip:unsafe-placement",
          sourceCurrency: match.currency,
          targetCurrency: options.targetCurrency,
          amount: match.amount,
          text: match.raw,
          reason: "Text price anchor is not safe for badge placement",
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
            serializeBadgeKey(badgeKey),
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
      if (!insertTextBadgeIfNearby(node, anchor, badge)) {
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
  }

  if (shouldRenderUnits) {
    renderedCount += renderUnitConversions(nodes, options);
  }

  return renderedCount;
}

export function resetRenderedConversions(root: ParentNode): void {
  removeBadges(root);
  clearHoverTargets();
}
