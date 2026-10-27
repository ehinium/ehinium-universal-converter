import {
  getActiveCurrencyContext,
  parseCurrencies,
  resolveCurrencySymbol,
} from "../utils/currencyParser";
import { normalizeNumberToken } from "../utils/numberNormalizer";
import type { CurrencyDomMatch, TextFragmentMap } from "./currencyDomMatches";
import { isInsideExcludedContent } from "./domExclusions";
import { SCREEN_READER_ONLY_SELECTOR } from "./domScanner";
import { learnGlyphRemap } from "./glyphCurrencyRemap";
import { isInsideGroupedPrice } from "./groupedPriceDetector";
import { selectPriceAnchor } from "./priceAnchor";

/**
 * Prices whose currency is not written next to the number as text:
 *  - an icon names it: `<span>۳۹۵,۱۰۰</span><dds-icon name="value-toman">`,
 *    `<svg name="toman">`, an empty `<small class="unit">` in a price box;
 *  - a hidden label names it: `<span class="currency-code"> NOK</span>`,
 *    `<span class="global-currency-text">SAR</span>` drawn as an icon;
 *  - a screen-reader copy states the full price next to a bare visible
 *    number: `<span class="sr_true">Hinta 399,99 €.</span><data>399,99</data>`.
 * The visible number gets the badge; the currency comes from its marker.
 */

// Whole words of a name, test id or class: "value-toman" and "tomanIcon" name
// the toman; "bottomAnchor", "free-trial-icon" and "serial" do not.
const ICON_CURRENCIES: ReadonlyArray<[string, string]> = [
  ["toman", "IRT"], ["تومان", "IRT"],
  ["rial", "IRR"], ["ریال", "IRR"],
];
// A character from an icon font names nothing by itself.
const ICON_GLYPH = /^[\ue000-\uf8ff]+$/u;
// The selectors find candidates cheaply; `iconCurrency` checks whole words.
const ICON_MARKER_SELECTOR = [
  '[name*="toman" i]', '[data-test-id*="toman" i]', '[data-testid*="toman" i]', '[class*="toman" i]',
  '[name*="rial" i]', '[data-test-id*="rial" i]', '[data-testid*="rial" i]',
].join(", ");
const LABEL_MARKER_SELECTOR = '[class*="currency" i], [data-currency]';
// An empty element in a price box is a currency icon drawn with CSS.
const UNIT_MARKER_SELECTOR = '[class*="price" i] [class*="unit" i]:empty, [class*="price" i] [class*="currency" i]:empty';
const PRICE_CONTEXT_SELECTOR = '[class*="price" i], [data-testid*="price" i], [data-test-id*="price" i], [itemprop="price"], data[value]';
const NUMBER_TEXT = /^[+-]?[0-9٠-٩۰-۹][0-9٠-٩۰-۹\s.,'’٬٫]*$/u;
const MAX_MARKERS = 400;
const MAX_SUBTREE_ELEMENTS = 40;
// Numeric DOM constants: content-script tests run without the Node/NodeFilter globals.
const TEXT_NODE = 3;
const SHOW_TEXT = 4;

type SourceKind = "icon" | "label" | "unit" | "screen-reader";

type CurrencySource = {
  element: Element;
  currency: string;
  kind: SourceKind;
  /** Screen-reader copies only lend their currency to the same amount. */
  amounts?: Set<number>;
};

function isScreenReaderText(node: Node): boolean {
  return !!node.parentElement?.closest(SCREEN_READER_ONLY_SELECTOR);
}

function visibleText(element: Element): string {
  let text = "";
  const walker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isScreenReaderText(node)) text += node.textContent ?? "";
  }
  return text;
}

function textNodesOf(element: Element): Text[] {
  const nodes: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? "").trim() && !isScreenReaderText(node)) nodes.push(node as Text);
  }
  return nodes;
}

function numberValue(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const value = normalizeNumberToken(trimmed.replace(/\s+/gu, " "))?.value ?? null;
  return value !== null && value > 0 ? value : null;
}

/** The outermost elements in `root` whose whole visible text is one number. */
function numberGroups(root: Element): Text[][] {
  const found: Text[][] = [];
  const queue: Element[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_SUBTREE_ELEMENTS) {
    const element = queue.shift()!;
    visited++;
    if (element.matches(SCREEN_READER_ONLY_SELECTOR)) continue;
    if (numberValue(visibleText(element)) !== null) {
      found.push(textNodesOf(element));
      continue;
    }
    queue.push(...element.children);
  }
  return found;
}

/** Climbs from a marker to the wrapper that holds nothing but the marker. */
function markerBox(marker: Element): Element {
  let box = marker;
  for (let depth = 0; depth < 2; depth++) {
    const parent = box.parentElement;
    if (!parent || parent.children.length !== 1 || visibleText(parent).trim() !== visibleText(box).trim()) break;
    box = parent;
  }
  return box;
}

/** The nearest number before or after the marker box: an element or a bare text node. */
function siblingNumbers(box: Element, direction: "previous" | "next"): Text[][] {
  for (
    let sibling = direction === "previous" ? box.previousSibling : box.nextSibling;
    sibling;
    sibling = direction === "previous" ? sibling.previousSibling : sibling.nextSibling
  ) {
    if (sibling.nodeType === TEXT_NODE) {
      if (!(sibling.textContent ?? "").trim()) continue;
      return numberValue(sibling.textContent ?? "") !== null ? [[sibling as Text]] : [];
    }
    if (!(sibling instanceof Element) || !visibleText(sibling).trim()) continue;
    const groups = numberGroups(sibling);
    return direction === "previous" ? groups.reverse() : groups;
  }
  return [];
}

function hasPriceContext(marker: Element, nodes: readonly Text[]): boolean {
  const candidates = [marker, ...nodes.map((node) => node.parentElement)];
  return candidates.some((element) => {
    for (let current = element, depth = 0; current && depth < 3; current = current.parentElement, depth++) {
      if (current.matches(PRICE_CONTEXT_SELECTOR)) return true;
    }
    return false;
  });
}

function iconCurrency(hint: string): string | undefined {
  const words = hint.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return ICON_CURRENCIES.find(([word]) => words.includes(word))?.[1];
}

/**
 * What CSS draws in an empty currency element: the currency of a drawn sign,
 * null for drawn text that names none, undefined when nothing readable is
 * drawn (an icon font glyph or a background image).
 */
function drawnCurrency(marker: Element): string | null | undefined {
  const view = marker.ownerDocument.defaultView;
  if (!view) return undefined;
  for (const pseudo of ["::before", "::after"]) {
    const content = view.getComputedStyle(marker, pseudo).content;
    if (!content || content === "none" || content === "normal") continue;
    const text = content.replace(/^(["'])(.*)\1$/su, "$2").trim();
    if (!text || ICON_GLYPH.test(text)) return undefined;
    return resolveCurrencySymbol(text) ?? null;
  }
  return undefined;
}

function isRendered(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 && !element.closest(SCREEN_READER_ONLY_SELECTOR);
}

function collectSources(root: Element): CurrencySource[] {
  const context = getActiveCurrencyContext();
  const sources: CurrencySource[] = [];

  for (const marker of [...root.querySelectorAll(ICON_MARKER_SELECTOR)].slice(0, MAX_MARKERS)) {
    const hint = [
      marker.getAttribute("name"), marker.getAttribute("data-test-id"),
      marker.getAttribute("data-testid"), marker.getAttribute("class"),
    ].join(" ");
    const currency = iconCurrency(hint);
    if (currency && !visibleText(marker).trim()) sources.push({ element: marker, currency, kind: "icon" });
  }

  for (const marker of [...root.querySelectorAll(LABEL_MARKER_SELECTOR)].slice(0, MAX_MARKERS)) {
    const label = (marker.getAttribute("data-currency") || marker.textContent || "").trim();
    if (!label || label.length > 12 || /[0-9٠-٩۰-۹]/u.test(label)) continue;
    const currency = resolveCurrencySymbol(label);
    if (!currency) continue;
    sources.push({ element: marker, currency, kind: "label" });
    learnGlyphRemap(marker, currency);
  }

  for (const marker of [...root.querySelectorAll(UNIT_MARKER_SELECTOR)].slice(0, MAX_MARKERS)) {
    // A drawn sign ("€" on an English-language page) names its own currency;
    // an icon takes the page's.
    const drawn = drawnCurrency(marker);
    const currency = drawn === undefined ? context?.currency : drawn;
    if (currency) sources.push({ element: marker, currency, kind: "unit" });
  }

  let screenReaderCopies = 0;
  for (const copy of root.querySelectorAll(SCREEN_READER_ONLY_SELECTOR)) {
    if (screenReaderCopies >= MAX_MARKERS) break;
    const text = copy.textContent ?? "";
    // Grouped prices (Amazon `.a-price`) are converted whole by their own detector.
    if (!/[0-9٠-٩۰-۹]/u.test(text) || text.length > 160 || isInsideGroupedPrice(copy)) continue;
    screenReaderCopies++;
    for (const match of parseCurrencies(text)) {
      const existing = sources.find((source) => source.element === copy && source.currency === match.currency);
      if (existing) existing.amounts?.add(match.amount);
      else sources.push({ element: copy, currency: match.currency, kind: "screen-reader", amounts: new Set([match.amount]) });
    }
  }
  return sources;
}

function fragmentsFor(nodes: readonly Text[]): { input: string; fragments: TextFragmentMap[] } {
  let input = "";
  const fragments: TextFragmentMap[] = nodes.map((node, index) => {
    const text = node.textContent ?? "";
    const start = input.length;
    input += text;
    const boundary = { kind: index === 0 ? "same-node" as const : "adjacent-inline" as const, visuallyAdjacent: true, safeForPriceJoin: true };
    return {
      node, text, combinedStart: start, combinedEnd: input.length,
      parserStart: start, parserEnd: input.length, boundaryBefore: boundary, boundaryAfter: boundary,
    };
  });
  return { input, fragments };
}

function domMatchFor(
  source: CurrencySource,
  nodes: readonly Text[],
  placementAfter: HTMLElement | undefined
): CurrencyDomMatch | null {
  if (nodes.length === 0 || nodes.some((node) => isInsideExcludedContent(node))) return null;
  const { input, fragments } = fragmentsFor(nodes);
  const amount = numberValue(input);
  if (amount === null || (source.amounts && !source.amounts.has(amount))) return null;
  const start = input.search(/[0-9٠-٩۰-۹+-]/u);
  const end = input.trimEnd().length;
  const sourceElement = nodes[0].parentElement;
  const renderingAnchor = selectPriceAnchor(nodes, input).anchor;
  if (!sourceElement || !renderingAnchor) return null;
  return {
    parserInput: input,
    match: {
      raw: input.slice(start, end),
      amount,
      currency: source.currency,
      start,
      end,
      tokenType: "symbol",
      confidence: source.amounts ? 0.9 : 0.85,
    },
    fragmentMap: fragments,
    sourceNodes: [...nodes],
    sourceElement,
    renderingAnchor,
    scanKind: "combined-inline",
    currencyOrigin: "inferred",
    placementAfter: placementAfter && !renderingAnchor.contains(placementAfter) ? placementAfter : undefined,
    directNodeParserSucceeded: false,
    localCombinedScanAttempted: true,
    excludedExtensionFragmentCount: 0,
    combinedTextContainsExtensionUi: false,
  };
}

export function detectMarkedPrices(
  roots: readonly Node[],
  existing: readonly CurrencyDomMatch[]
): CurrencyDomMatch[] {
  const covered = new Set(existing.flatMap((match) => match.sourceNodes));
  const elements = [...new Set(roots.map((root) => root instanceof Element ? root : root.parentElement))]
    .filter((element): element is Element => !!element);
  const results: CurrencyDomMatch[] = [];

  for (const root of elements) {
    for (const source of collectSources(root)) {
      const box = markerBox(source.element);
      const previous = siblingNumbers(box, "previous");
      const next = siblingNumbers(box, "next");
      const candidates = source.amounts
        ? [...next, ...previous]
        : previous.length > 0 ? [previous[0]] : next.slice(0, 1);
      for (const nodes of candidates) {
        if ((source.kind === "label" || source.kind === "unit") && !hasPriceContext(source.element, nodes)) continue;
        // A visible icon after the number (toman) gets the badge after the icon.
        const iconAfterNumber = previous.includes(nodes) && !source.amounts && isRendered(box) &&
          !!box.parentElement?.contains(nodes[0] ?? null);
        const match = domMatchFor(source, nodes, iconAfterNumber ? box as HTMLElement : undefined);
        if (!match || match.sourceNodes.some((node) => covered.has(node))) continue;
        match.sourceNodes.forEach((node) => covered.add(node));
        results.push(match);
        if (!source.amounts) break;
      }
    }
  }
  return results;
}
