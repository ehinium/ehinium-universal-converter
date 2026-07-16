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
  totalTextLength: number;
  childElementCount: number;
  parserMatchCount: number;
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

function isVisible(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (style.opacity !== "" && Number(style.opacity) === 0) return false;
  let ancestor = element.parentElement;
  while (ancestor) {
    const ancestorStyle = getComputedStyle(ancestor);
    if (ancestorStyle.display === "none" || ancestorStyle.visibility === "hidden" || ancestorStyle.visibility === "collapse") return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

function currentSourceText(sourceNodes: readonly Text[]): string {
  return sourceNodes.map((node) => node.textContent ?? "").join("");
}

export function evaluateAnchorSafety(
  candidate: HTMLElement,
  sourceNodes: readonly Text[],
  parserInput: string,
  match: CurrencyMatch | undefined,
  candidateLevel: number
): AnchorSafetyDiagnostic {
  const style = getComputedStyle(candidate);
  const rect = candidate.getBoundingClientRect();
  const sourceConnected = sourceNodes.length > 0 && sourceNodes.every((node) => node.isConnected);
  const candidateConnected = candidate.isConnected;
  const containsSourceNode = sourceNodes.length > 0 && sourceNodes.every((node) => candidate.contains(node));
  const totalText = candidate.textContent ?? "";
  const parserMatchCount = parseCurrencies(totalText).length;
  const interactiveDescendantCount = [...candidate.querySelectorAll(INTERACTIVE_DESCENDANT_SELECTOR)]
    .filter((element) =>
      !element.closest(EXCLUDED_ANCHOR_SELECTOR) &&
      !sourceNodes.some((node) => element.contains(node))
    ).length;
  const visible = isVisible(candidate, style) && sourceNodes.every((node) => {
    const parent = node.parentElement;
    return !!parent && isVisible(parent, getComputedStyle(parent));
  });
  const hasUsableBox = rect.width > 0 && rect.height > 0;
  const liveSourceText = currentSourceText(sourceNodes);
  const sourceRangeValid = !match || (match.start >= 0 && match.end <= liveSourceText.length && match.start < match.end);
  const sourceTextMatches = liveSourceText === parserInput;
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
  else if (candidateLevel > 0 && (BROAD_TAGS.has(candidate.tagName) || totalText.length > MAX_ANCHOR_TEXT_LENGTH)) rejectedRule = "broad-text-container";
  else if (candidateLevel > 0 && parserMatchCount > 1) rejectedRule = "multiple-unrelated-prices";
  else if (interactiveDescendantCount > 0) rejectedRule = "unrelated-interactive-descendants";

  return {
    safe: rejectedRule === undefined,
    rejectedRule,
    candidateSelector: selectorFor(candidate),
    candidateLevel,
    tagName: candidate.tagName.toLowerCase(),
    display: style.display,
    position: style.position,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    directTextLength: directTextLength(candidate),
    totalTextLength: totalText.length,
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

  for (let level = 0; candidate && level <= MAX_ANCHOR_LEVEL; level++) {
    const diagnostic = evaluateAnchorSafety(candidate, sourceNodes, parserInput, match, level);
    candidates.push(diagnostic);
    if (diagnostic.safe) return { anchor: candidate, selected: diagnostic, candidates };
    candidate = candidate.parentElement;
  }
  return { anchor: null, candidates };
}

export function findPriceAnchor(node: Text, match?: CurrencyMatch): HTMLElement | null {
  return selectPriceAnchor([node], node.textContent ?? "", match).anchor;
}
