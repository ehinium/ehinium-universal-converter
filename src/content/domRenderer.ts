import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import {
  badgeExists,
  createBadge,
  insertBadgeAfter,
  markBadge,
  removeBadges,
  type BadgeKey,
} from "./badgeManager";
import { isInsideExcludedContent } from "./domExclusions";
import { findPriceAnchor } from "./priceAnchor";

export type RenderConversionOptions = {
  targetCurrency: string;
  convertAmount: (match: CurrencyMatch) => number | null;
};

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

  return !parent || isInsideExcludedContent(parent);
}

export function renderConversions(
  textNodes: Iterable<Text>,
  options: RenderConversionOptions
): number {
  let renderedCount = 0;

  for (const node of Array.from(textNodes)) {
    if (shouldSkipNode(node)) {
      continue;
    }

    const text = node.textContent;
    const anchor = findPriceAnchor(node);

    if (!text || !anchor) {
      continue;
    }

    const matches = parseCurrencies(text);

    if (matches.length === 0) {
      continue;
    }

    for (const match of matches) {
      const badgeKey = getBadgeKey(match, options.targetCurrency);

      if (badgeExists(anchor, badgeKey)) {
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
      const badge = createBadge(`≈ ${formattedAmount}`, formattedAmount);

      markBadge(badge, badgeKey);
      insertBadgeAfter(anchor, badge);
      renderedCount++;
    }
  }

  return renderedCount;
}

export function resetRenderedConversions(root: ParentNode): void {
  removeBadges(root);
}
