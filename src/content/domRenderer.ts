import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import type { ConverterMode } from "../types/settings";
import {
  badgeExists,
  createBadge,
  insertBadgeAfter,
  insertBadgeAfterTextNode,
  markBadge,
  removeBadges,
  serializeBadgeKey,
  type BadgeKey,
} from "./badgeManager";
import { debugLog } from "./debug";
import { isInsideExcludedContent } from "./domExclusions";
import { detectGroupedPrices } from "./groupedPriceDetector";
import { findPriceAnchor } from "./priceAnchor";

export type RenderConversionOptions = {
  targetCurrency: string;
  converterMode: ConverterMode;
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
  ".a-button",
  '[role="button"]',
  "[aria-pressed]",
  "#promoPriceBlockMessage_feature_div",
  "#vouchers_feature_div",
  '[id*="coupon"]',
  '[id*="promo"]',
  '[id*="promotion"]',
].join(", ");
const MAX_BADGE_VERTICAL_DISTANCE = 12;
const PROMO_TEXT_PATTERN =
  /\b(?:savings?|discount|coupon|promo|redeem|credit\s+card|enter\s+code|max)\b/iu;

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
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
    parent.closest(HIDDEN_PRICE_SELECTOR) !== null
  );
}

function priceScopeHasKey(node: Text, key: BadgeKey): boolean {
  const scope = node.parentElement?.closest<HTMLElement>(PRICE_SCOPE_SELECTOR);

  return (
    scope?.getAttribute("data-ehinium-price-key") === serializeBadgeKey(key)
  );
}

function isPromoTextNode(node: Text): boolean {
  return PROMO_TEXT_PATTERN.test(node.parentElement?.textContent ?? "");
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

export function renderConversions(
  textNodes: Iterable<Text>,
  options: RenderConversionOptions
): number {
  if (options.converterMode === "units") {
    return 0;
  }

  let renderedCount = 0;

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

    if (!isSafeBadgePlacement(match.anchor)) {
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

    const formattedAmount = formatAmount(
      convertedAmount,
      options.targetCurrency
    );
    const badge = createBadge(formattedAmount, formattedAmount);

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

  for (const node of Array.from(textNodes)) {
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

      if (!isSafeBadgePlacement(anchor)) {
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

      const formattedAmount = formatAmount(
        convertedAmount,
        options.targetCurrency
      );
      const badge = createBadge(formattedAmount, formattedAmount);

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

  return renderedCount;
}

export function resetRenderedConversions(root: ParentNode): void {
  removeBadges(root);
}
