import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
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
import { isInsideExcludedContent } from "./domExclusions";
import { detectGroupedPrices } from "./groupedPriceDetector";
import { findPriceAnchor } from "./priceAnchor";

export type RenderConversionOptions = {
  targetCurrency: string;
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
  let renderedCount = 0;

  for (const match of detectGroupedPrices(document)) {
    const currencyMatch: CurrencyMatch = {
      raw: `${match.currency} ${match.amount}`,
      amount: match.amount,
      currency: match.currency,
    };

    if (currencyMatch.currency === options.targetCurrency) {
      continue;
    }

    const badgeKey = getBadgeKey(currencyMatch, options.targetCurrency);

    if (badgeExists(match.anchor, badgeKey)) {
      continue;
    }

    if (!isSafeBadgePlacement(match.anchor)) {
      continue;
    }

    const convertedAmount = options.convertAmount(currencyMatch);

    if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
      continue;
    }

    const formattedAmount = formatAmount(
      convertedAmount,
      options.targetCurrency
    );
    const badge = createBadge(formattedAmount, formattedAmount);

    markBadge(badge, badgeKey);
    if (!insertGroupedBadgeIfNearby(match.anchor, badge)) {
      continue;
    }

    renderedCount++;
  }

  for (const node of Array.from(textNodes)) {
    if (shouldSkipNode(node)) {
      continue;
    }

    const text = node.textContent;
    const anchor = findPriceAnchor(node);

    if (!text || !anchor || isPromoTextNode(node)) {
      continue;
    }

    const matches = parseCurrencies(text);

    if (matches.length === 0) {
      continue;
    }

    for (const match of matches) {
      if (match.currency === options.targetCurrency) {
        continue;
      }

      const badgeKey = getBadgeKey(match, options.targetCurrency);

      if (priceScopeHasKey(node, badgeKey) || badgeExists(anchor, badgeKey)) {
        continue;
      }

      if (!isSafeBadgePlacement(anchor)) {
        continue;
      }

      const convertedAmount = options.convertAmount(match);

      if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
        continue;
      }

      const formattedAmount = formatAmount(
        convertedAmount,
        options.targetCurrency
      );
      const badge = createBadge(formattedAmount, formattedAmount);

      markBadge(badge, badgeKey);
      if (!insertTextBadgeIfNearby(node, anchor, badge)) {
        continue;
      }

      renderedCount++;
    }
  }

  return renderedCount;
}

export function resetRenderedConversions(root: ParentNode): void {
  removeBadges(root);
}
