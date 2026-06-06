import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";

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
const EXCLUDED_SELECTOR =
  "script, style, noscript, textarea, input, select, option";
const renderedTextNodes = new WeakSet<Text>();
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

function createConversionSpan(
  document: Document,
  formattedAmount: string
): HTMLSpanElement {
  const span = document.createElement("span");

  span.setAttribute(CONVERTED_ATTRIBUTE, "true");
  span.style.opacity = "0.72";
  span.style.marginInlineStart = "4px";
  span.style.fontSize = "0.92em";
  span.style.whiteSpace = "nowrap";
  span.textContent = `(≈ ${formattedAmount})`;

  return span;
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
    renderedTextNodes.has(node) ||
    parent.closest(EXCLUDED_SELECTOR) !== null ||
    parent.closest(`[${CONVERTED_ATTRIBUTE}]`) !== null
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
  renderedTextNodes.add(textNode);
  fragment.append(textNode);
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

    if (!text) {
      continue;
    }

    const matches = positionMatches(text, parseCurrencies(text));

    if (matches.length === 0) {
      continue;
    }

    const document = node.ownerDocument;
    const fragment = document.createDocumentFragment();
    let textOffset = 0;
    let nodeRenderedCount = 0;

    for (const positionedMatch of matches) {
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
        createConversionSpan(
          document,
          formatAmount(convertedAmount, options.targetCurrency)
        )
      );
      textOffset = positionedMatch.end;
      nodeRenderedCount++;
    }

    if (nodeRenderedCount === 0) {
      continue;
    }

    appendText(fragment, document, text.slice(textOffset));
    node.replaceWith(fragment);
    renderedCount += nodeRenderedCount;
  }

  return renderedCount;
}
