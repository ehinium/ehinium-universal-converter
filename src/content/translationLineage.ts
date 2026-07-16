import type { CurrencyDomMatch } from "./currencyDomMatches";

const OWNED_SELECTOR = [
  '[data-euc-owned="true"]',
  '[data-euc-badge="true"]',
  '[data-ehinium-badge="true"]',
  '[data-ehinium-converted="true"]',
  '[data-ehinium-ignore="true"]',
].join(", ");

export type RectDiagnostic = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TranslationWrapperDiagnostic = {
  detected: boolean;
  sourceNodeSelector: string;
  canonicalSourceSelector: string;
  candidateDepth: number;
  canonicalDepth: number;
  normalizedTextEqual: boolean;
  ancestorContainsCanonical: boolean;
  relationship: "same-node" | "ancestor-descendant";
  normalizedSourceText: string;
  parsedAmount: number;
  sourceCurrency: string;
  textRange: { start: number; end: number };
  candidateRect: RectDiagnostic;
  canonicalRect: RectDiagnostic;
  clientRectOverlap: number;
  skippedAsNestedDuplicate: boolean;
  existingBadgeOwnerSelector?: string;
  duplicateRejectionReason?: string;
};

export type TranslationLineage = {
  canonicalNode: Text;
  canonicalElement: HTMLElement;
  lineageRoot: HTMLElement;
  wrappers: HTMLElement[];
  normalizedText: string;
  overlapRatio: number;
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function depthOf(node: Node): number {
  let depth = 0;
  let current: Node | null = node;
  while (current.parentNode) {
    depth++;
    current = current.parentNode;
  }
  return depth;
}

function selectorFor(element: Element): string {
  if (element.id) return `#${element.id}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 6 && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
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

function sourceText(element: HTMLElement): string {
  let text = "";
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const parent = (current as Text).parentElement;
    if (!parent?.closest(OWNED_SELECTOR)) text += current.textContent ?? "";
    current = walker.nextNode();
  }
  return text;
}

function rectSnapshot(rect: DOMRect): RectDiagnostic {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function rectangleOverlap(first: DOMRect, second: DOMRect): number {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const intersection = width * height;
  const smallerArea = Math.min(first.width * first.height, second.width * second.height);
  return smallerArea > 0 ? intersection / smallerArea : 0;
}

export function resolveTranslationLineage(candidate: CurrencyDomMatch): TranslationLineage {
  const canonicalNode = candidate.sourceNodes.reduce((deepest, node) =>
    depthOf(node) > depthOf(deepest) ? node : deepest
  );
  const canonicalElement = canonicalNode.parentElement ?? candidate.sourceElement;
  const normalizedText = normalize(candidate.parserInput);
  const wrappers: HTMLElement[] = [canonicalElement];
  const canonicalRect = canonicalElement.getBoundingClientRect();
  let current = canonicalElement.parentElement;
  let lineageRoot = canonicalElement;
  let overlapRatio = 1;

  if (candidate.scanKind === "direct") {
    while (current) {
      const normalizedAncestorText = normalize(sourceText(current));
      const overlap = rectangleOverlap(current.getBoundingClientRect(), canonicalRect);
      if (normalizedAncestorText !== normalizedText || overlap < 0.8) break;
      wrappers.push(current);
      lineageRoot = current;
      overlapRatio = Math.min(overlapRatio, overlap);
      current = current.parentElement;
    }
  }

  return { canonicalNode, canonicalElement, lineageRoot, wrappers, normalizedText, overlapRatio };
}

function amountMatches(badge: HTMLElement, amount: number): boolean {
  return Number(badge.dataset.ehiniumSourceAmount) === amount;
}

export function findExistingLineageBadges(
  candidate: CurrencyDomMatch,
  targetCurrency: string
): HTMLElement[] {
  const lineage = resolveTranslationLineage(candidate);
  return [...lineage.lineageRoot.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"], [data-euc-badge="true"]')]
    .filter((badge) => {
      const ownedRoot = badge.closest<HTMLElement>(OWNED_SELECTOR);
      const outsideOwner = ownedRoot?.parentElement;
      return !!outsideOwner && lineage.wrappers.includes(outsideOwner) &&
        badge.isConnected &&
        badge.dataset.ehiniumSourceCurrency === candidate.match.currency &&
        amountMatches(badge, candidate.match.amount) &&
        badge.dataset.ehiniumTargetCurrency === targetCurrency;
    });
}

export function getTranslationWrapperDiagnostic(
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  duplicateReason?: string
): TranslationWrapperDiagnostic {
  const lineage = resolveTranslationLineage(candidate);
  const candidateRect = lineage.lineageRoot.getBoundingClientRect();
  const canonicalRect = lineage.canonicalElement.getBoundingClientRect();
  const existingBadge = findExistingLineageBadges(candidate, targetCurrency)[0];
  return {
    detected: lineage.wrappers.length > 1,
    sourceNodeSelector: `${selectorFor(candidate.sourceElement)}::text`,
    canonicalSourceSelector: `${selectorFor(lineage.canonicalElement)}::text`,
    candidateDepth: depthOf(lineage.lineageRoot),
    canonicalDepth: depthOf(lineage.canonicalNode),
    normalizedTextEqual: normalize(sourceText(lineage.lineageRoot)) === lineage.normalizedText,
    ancestorContainsCanonical: lineage.lineageRoot.contains(lineage.canonicalNode),
    relationship: lineage.lineageRoot === lineage.canonicalElement ? "same-node" : "ancestor-descendant",
    normalizedSourceText: lineage.normalizedText,
    parsedAmount: candidate.match.amount,
    sourceCurrency: candidate.match.currency,
    textRange: { start: candidate.match.start, end: candidate.match.end },
    candidateRect: rectSnapshot(candidateRect),
    canonicalRect: rectSnapshot(canonicalRect),
    clientRectOverlap: rectangleOverlap(candidateRect, canonicalRect),
    skippedAsNestedDuplicate: duplicateReason === "Nested translation wrapper duplicate" || duplicateReason === "Existing badge owns same canonical text lineage",
    existingBadgeOwnerSelector: existingBadge?.parentElement
      ? selectorFor(existingBadge.parentElement)
      : undefined,
    duplicateRejectionReason: duplicateReason,
  };
}
