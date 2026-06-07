import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import {
  EHINIUM_IGNORE_ATTRIBUTE,
  isInsideExcludedContent,
} from "./domExclusions";
import { registerHoverTarget } from "./hoverRegistry";
import { isProcessed, markProcessed, resetProcessed } from "./processedNodes";

export type RenderConversionOptions = {
  targetCurrency: string;
  convertAmount: (match: CurrencyMatch) => number | null;
};

type PositionedMatch = {
  match: CurrencyMatch;
  start: number;
  end: number;
};

const CONVERTED_ATTRIBUTE = "data-ehinium-converted";
const BADGE_ATTRIBUTE = "data-ehinium-badge";
const RAW_ATTRIBUTE = "data-ehinium-raw";
const CURRENCY_ATTRIBUTE = "data-ehinium-currency";
const wordCharacterPattern = /[\p{L}\p{N}_]/u;

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

function createConversionBadge(
  document: Document,
  match: CurrencyMatch,
  formattedAmount: string
): HTMLSpanElement {
  const badge = document.createElement("span");

  badge.setAttribute(CONVERTED_ATTRIBUTE, "true");
  badge.setAttribute(BADGE_ATTRIBUTE, "true");
  badge.setAttribute(EHINIUM_IGNORE_ATTRIBUTE, "true");
  badge.setAttribute(RAW_ATTRIBUTE, match.raw);
  badge.setAttribute(CURRENCY_ATTRIBUTE, match.currency);
  badge.title = formattedAmount;
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.verticalAlign = "middle";
  badge.style.marginInlineStart = "6px";
  badge.style.padding = "2px 6px";
  badge.style.borderRadius = "999px";
  badge.style.background = "rgba(17, 24, 39, 0.08)";
  badge.style.color = "rgb(17, 24, 39)";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "600";
  badge.style.lineHeight = "1.4";
  badge.style.whiteSpace = "nowrap";
  badge.style.textDecoration = "none";
  badge.style.pointerEvents = "auto";
  badge.style.position = "relative";
  badge.style.zIndex = "2147483647";
  badge.textContent = `≈ ${formattedAmount}`;
  registerHoverTarget(badge, formattedAmount);

  return badge;
}

function getMatchFingerprint(match: CurrencyMatch): string {
  return `${match.raw}\u0000${match.currency}`;
}

function getExistingBadgeCounts(parent: HTMLElement): Map<string, number> {
  const counts = new Map<string, number>();

  for (const badge of parent.querySelectorAll<HTMLElement>(
    `[${BADGE_ATTRIBUTE}="true"]`
  )) {
    if (badge.parentElement !== parent) {
      continue;
    }

    const raw = badge.getAttribute(RAW_ATTRIBUTE);
    const currency = badge.getAttribute(CURRENCY_ATTRIBUTE);

    if (raw === null || currency === null) {
      continue;
    }

    const fingerprint = `${raw}\u0000${currency}`;
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }

  return counts;
}

function consumeExistingBadge(
  counts: Map<string, number>,
  match: CurrencyMatch
): boolean {
  const fingerprint = getMatchFingerprint(match);
  const count = counts.get(fingerprint) ?? 0;

  if (count === 0) {
    return false;
  }

  counts.set(fingerprint, count - 1);
  return true;
}

function positionMatches(text: string, matches: CurrencyMatch[]): PositionedMatch[] {
  const positioned: PositionedMatch[] = [];

  for (const match of matches) {
    let searchFrom = 0;

    while (searchFrom < text.length) {
      const start = text.indexOf(match.raw, searchFrom);

      if (start === -1) {
        break;
      }

      const end = start + match.raw.length;
      const previousCharacter = text[start - 1];
      const nextCharacter = text[end];

      if (
        (previousCharacter && wordCharacterPattern.test(previousCharacter)) ||
        (nextCharacter && wordCharacterPattern.test(nextCharacter))
      ) {
        searchFrom = end;
        continue;
      }

      positioned.push({
        match,
        start,
        end,
      });
      searchFrom = end;
    }
  }

  positioned.sort(
    (left, right) =>
      left.start - right.start || right.end - left.end
  );

  const nonOverlapping: PositionedMatch[] = [];
  let previousEnd = -1;

  for (const positionedMatch of positioned) {
    if (positionedMatch.start >= previousEnd) {
      nonOverlapping.push(positionedMatch);
      previousEnd = positionedMatch.end;
    }
  }

  return nonOverlapping;
}

function shouldSkipNode(node: Text): boolean {
  const parent = node.parentElement;

  return (
    !parent ||
    isProcessed(node) ||
    isInsideExcludedContent(parent)
  );
}

function appendText(
  fragment: DocumentFragment,
  document: Document,
  text: string
): void {
  if (text.length === 0) {
    return;
  }

  const textNode = document.createTextNode(text);
  markProcessed(textNode);
  fragment.append(textNode);
}

export function renderConversions(
  textNodes: Iterable<Text>,
  options: RenderConversionOptions
): number {
  let renderedCount = 0;
  const existingBadgesByParent = new WeakMap<HTMLElement, Map<string, number>>();

  for (const node of Array.from(textNodes)) {
    if (shouldSkipNode(node)) {
      continue;
    }

    const text = node.textContent;
    const parent = node.parentElement;

    if (!text || !parent) {
      markProcessed(node);
      continue;
    }

    const matches = positionMatches(text, parseCurrencies(text));

    if (matches.length === 0) {
      markProcessed(node);
      continue;
    }

    const document = node.ownerDocument;
    const fragment = document.createDocumentFragment();
    const existingBadgeCounts =
      existingBadgesByParent.get(parent) ?? getExistingBadgeCounts(parent);
    existingBadgesByParent.set(parent, existingBadgeCounts);
    let textOffset = 0;
    let nodeRenderedCount = 0;

    for (const positionedMatch of matches) {
      if (consumeExistingBadge(existingBadgeCounts, positionedMatch.match)) {
        continue;
      }

      const convertedAmount = options.convertAmount(positionedMatch.match);

      if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
        continue;
      }

      appendText(
        fragment,
        document,
        text.slice(textOffset, positionedMatch.end)
      );
      fragment.append(
        createConversionBadge(
          document,
          positionedMatch.match,
          formatAmount(convertedAmount, options.targetCurrency)
        )
      );
      textOffset = positionedMatch.end;
      nodeRenderedCount++;
    }

    if (nodeRenderedCount === 0) {
      markProcessed(node);
      continue;
    }

    appendText(fragment, document, text.slice(textOffset));
    markProcessed(node);
    node.replaceWith(fragment);
    renderedCount += nodeRenderedCount;
  }

  return renderedCount;
}

export function resetRenderedConversions(root: ParentNode): void {
  for (const span of root.querySelectorAll<HTMLElement>(
    `[${CONVERTED_ATTRIBUTE}]`
  )) {
    span.remove();
  }

  const ownerDocument = root.ownerDocument ?? document;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    resetProcessed(node as Text);
    node = walker.nextNode();
  }
}
