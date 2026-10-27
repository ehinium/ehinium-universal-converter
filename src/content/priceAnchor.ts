import { parseCurrencies, type CurrencyMatch } from "../utils/currencyParser";

const EXCLUDED_ANCHOR_SELECTOR = [
  "[data-ehinium-ignore]",
  "[data-ehinium-badge]",
  "[data-ehinium-converted]",
  "[data-euc-owned]",
  "[data-euc-badge]",
].join(", ");
const SOURCE_CONTENT_SELECTOR = [
  "script", "style", "textarea", "input", "select", "option", "code", "pre",
].join(", ");
const INTERACTIVE_DESCENDANT_SELECTOR = [
  "a[href]", "button", "input", "select", "textarea", "[role='button']",
  "[role='link']", "[tabindex]",
].join(", ");
const BROAD_TAGS = new Set([
  "BODY", "MAIN", "NAV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER",
  "UL", "OL", "TABLE", "FORM",
]);
const MAX_ANCHOR_LEVEL = 6;
const MAX_ANCHOR_TEXT_LENGTH = 240;
// NodeFilter.SHOW_TEXT; content-script tests run without the NodeFilter global.
const SHOW_TEXT = 4;

export type AnchorRejectedRule =
  | "disconnected-source"
  | "disconnected-candidate"
  | "source-not-contained"
  | "source-range-invalid"
  | "source-text-changed"
  | "hidden-candidate"
  | "zero-size-layout-box"
  | "broad-text-container"
  | "multiple-unrelated-prices"
  | "unrelated-interactive-descendants"
  | "content-editable-region"
  | "source-content-element"
  | "extension-owned-node";

export type AnchorSafetyDiagnostic = {
  safe: boolean;
  rejectedRule?: AnchorRejectedRule;
  candidateSelector: string;
  candidateLevel: number;
  tagName: string;
  display: string;
  position: string;
  overflowX: string;
  overflowY: string;
  directTextLength: number;
  /** Capped at the anchor text limit + 1: longer containers are not measured further. */
  totalTextLength: number;
  childElementCount: number;
  /** Prices in the candidate's text; -1 when it is too long to be an anchor and was not parsed. */
  parserMatchCount: number;
  /** -1 when an earlier rule already rejected the candidate and they were not counted. */
  interactiveDescendantCount: number;
  containsSourceNode: boolean;
  sourceConnected: boolean;
  candidateConnected: boolean;
  visible: boolean;
  hasUsableBox: boolean;
};

export type PriceAnchorSelection = {
  anchor: HTMLElement | null;
  selected?: AnchorSafetyDiagnostic;
  candidates: AnchorSafetyDiagnostic[];
};

function selectorFor(element: Element): string {
  if (element.id) return `#${element.id}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 5 && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    if (current.classList.length > 0) part += `.${current.classList[0]}`;
    const parent: Element | null = current.parentElement;
    if (parent) {
      const peers = [...parent.children].filter((child) => child.tagName === current?.tagName);
      if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(" > ");
}

function directTextLength(element: HTMLElement): number {
  return [...element.childNodes]
    .filter((node): node is Text => node instanceof Text)
    .reduce((total, node) => total + (node.textContent?.length ?? 0), 0);
}

/**
 * Whether `element` and all its ancestors are displayed. Answers are shared
 * through `cache` within one anchor search, so climbing levels does not walk
 * the same ancestors again.
 */
function ancestorsShown(start: Element | null, cache?: WeakMap<Element, boolean>): boolean {
  const visited: Element[] = [];
  let shown = true;
  for (let ancestor = start; ancestor; ancestor = ancestor.parentElement) {
    const cached = cache?.get(ancestor);
    if (cached !== undefined) {
      shown = cached;
      break;
    }
    visited.push(ancestor);
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      shown = false;
      break;
    }
  }
  if (cache) for (const element of visited) cache.set(element, shown);
  return shown;
}

function isVisible(element: HTMLElement, style: CSSStyleDeclaration, cache?: WeakMap<Element, boolean>): boolean {
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (style.opacity !== "" && Number(style.opacity) === 0) return false;
  return ancestorsShown(element.parentElement, cache);
}

function sourcesVisible(sourceNodes: readonly Text[], cache?: WeakMap<Element, boolean>): boolean {
  return sourceNodes.every((node) => {
    const parent = node.parentElement;
    return !!parent && isVisible(parent, getComputedStyle(parent), cache);
  });
}

/** The element's text when it is at most `limit` characters long; null once it is longer. */
function textUpTo(element: Element, limit: number): string | null {
  let text = "";
  const walker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    text += node.textContent ?? "";
    if (text.length > limit) return null;
  }
  return text;
}

function currentSourceText(sourceNodes: readonly Text[]): string {
  return sourceNodes.map((node) => node.textContent ?? "").join("");
}

export function evaluateAnchorSafety(
  candidate: HTMLElement,
  sourceNodes: readonly Text[],
  parserInput: string,
  match: CurrencyMatch | undefined,
  candidateLevel: number,
  visibilityCache?: WeakMap<Element, boolean>
): AnchorSafetyDiagnostic {
  const style = getComputedStyle(candidate);
  const rect = candidate.getBoundingClientRect();
  const sourceConnected = sourceNodes.length > 0 && sourceNodes.every((node) => node.isConnected);
  const candidateConnected = candidate.isConnected;
  const containsSourceNode = sourceNodes.length > 0 && sourceNodes.every((node) => candidate.contains(node));
  // A container longer than an anchor may be is rejected as broad; its full
  // text is never built or parsed (lengths past the limit read as limit + 1).
  const totalText = textUpTo(candidate, MAX_ANCHOR_TEXT_LENGTH);
  const totalTextLength = totalText?.length ?? MAX_ANCHOR_TEXT_LENGTH + 1;
  const parserMatchCount = totalText === null ? -1 : parseCurrencies(totalText).length;
  const visible = isVisible(candidate, style, visibilityCache) && sourcesVisible(sourceNodes, visibilityCache);
  const hasUsableBox = rect.width > 0 && rect.height > 0;
  const liveSourceText = currentSourceText(sourceNodes);
  const sourceRangeValid = !match || (match.start >= 0 && match.end <= liveSourceText.length && match.start < match.end);
  const sourceTextMatches = liveSourceText === parserInput;
  // Counted only when the earlier rules pass: querying a large container is costly.
  let interactiveDescendantCount = -1;
  let rejectedRule: AnchorRejectedRule | undefined;

  if (!sourceConnected) rejectedRule = "disconnected-source";
  else if (!candidateConnected) rejectedRule = "disconnected-candidate";
  else if (!containsSourceNode) rejectedRule = "source-not-contained";
  else if (candidate.closest(EXCLUDED_ANCHOR_SELECTOR)) rejectedRule = "extension-owned-node";
  else if (candidate.closest(SOURCE_CONTENT_SELECTOR)) rejectedRule = "source-content-element";
  else if (candidate.closest("[contenteditable='true'], [contenteditable='']")) rejectedRule = "content-editable-region";
  else if (!sourceRangeValid) rejectedRule = "source-range-invalid";
  else if (!sourceTextMatches) rejectedRule = "source-text-changed";
  else if (!visible) rejectedRule = "hidden-candidate";
  else if (!hasUsableBox) rejectedRule = "zero-size-layout-box";
  else if (candidateLevel > 0 && (BROAD_TAGS.has(candidate.tagName) || totalText === null)) rejectedRule = "broad-text-container";
  else if (candidateLevel > 0 && parserMatchCount > 1) rejectedRule = "multiple-unrelated-prices";
  else {
    interactiveDescendantCount = [...candidate.querySelectorAll(INTERACTIVE_DESCENDANT_SELECTOR)]
      .filter((element) =>
        !element.closest(EXCLUDED_ANCHOR_SELECTOR) &&
        !sourceNodes.some((node) => element.contains(node))
      ).length;
    // A link beside the price in its own element ("Lieferung für 14,99 € … Details")
    // is a sibling of the price text, not a container around it.
    if (interactiveDescendantCount > 0 && !(candidateLevel === 0 && sourceNodes.every((node) => node.parentNode === candidate))) {
      rejectedRule = "unrelated-interactive-descendants";
    }
  }

  return {
    safe: rejectedRule === undefined,
    rejectedRule,
    // Only diagnostics read it; building the path walks every sibling list.
    get candidateSelector() {
      return selectorFor(candidate);
    },
    candidateLevel,
    tagName: candidate.tagName.toLowerCase(),
    display: style.display,
    position: style.position,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    directTextLength: directTextLength(candidate),
    totalTextLength,
    childElementCount: candidate.childElementCount,
    parserMatchCount,
    interactiveDescendantCount,
    containsSourceNode,
    sourceConnected,
    candidateConnected,
    visible,
    hasUsableBox,
  };
}

export function selectPriceAnchor(
  sourceNodes: readonly Text[],
  parserInput: string,
  match?: CurrencyMatch
): PriceAnchorSelection {
  let candidate = sourceNodes[0]?.parentElement ?? null;
  while (candidate && !sourceNodes.every((node) => candidate?.contains(node))) candidate = candidate.parentElement;
  const candidates: AnchorSafetyDiagnostic[] = [];
  const visibilityCache = new WeakMap<Element, boolean>();

  for (let level = 0; candidate && level <= MAX_ANCHOR_LEVEL; level++) {
    const diagnostic = evaluateAnchorSafety(candidate, sourceNodes, parserInput, match, level, visibilityCache);
    candidates.push(diagnostic);
    if (diagnostic.safe) return { anchor: candidate, selected: diagnostic, candidates };
    // Hidden source text fails every level the same way; climbing would only re-check it.
    if (diagnostic.rejectedRule === "hidden-candidate" && !sourcesVisible(sourceNodes, visibilityCache)) break;
    candidate = candidate.parentElement;
  }
  return { anchor: null, candidates };
}

export function findPriceAnchor(node: Text, match?: CurrencyMatch): HTMLElement | null {
  return selectPriceAnchor([node], node.textContent ?? "", match).anchor;
}
