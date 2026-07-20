import { parseCurrencies } from "../utils/currencyParser";
import type { CurrencyDomMatch } from "./currencyDomMatches";
import { collectSourceTextFragments } from "./currencyDomMatches";
import { markBadgeRemovalIntentional } from "./badgeLifecycle";
import {
  reconcileBadgeHostsForKey,
  registerAuthoritativeBadgeHost,
} from "./badgeHostRegistry";

export type PriceDiscoveryMode =
  | "leaf-text"
  | "split-text"
  | "price-cluster"
  | "combined-parent"
  | "aggregate-fallback";

export type RangeDescriptor = {
  startNode: Text;
  startOffset: number;
  endNode: Text;
  endOffset: number;
  signature: string;
};

export type PriceCandidate = {
  candidateId: string;
  domMatch: CurrencyDomMatch;
  sourceTextNodes: Text[];
  sourceElements: HTMLElement[];
  matchStart: number;
  matchEnd: number;
  rawText: string;
  normalizedMatchedText: string;
  amount: number;
  sourceCurrency: string;
  targetCurrency: string;
  tokenType: string;
  confidence: number;
  discoveryMode: PriceDiscoveryMode;
  rangeDescriptor: RangeDescriptor | null;
  clientRects: DOMRect[];
  boundingRect: DOMRect | null;
  localContext: string;
  localContextHash: string;
  stableContext: HTMLElement;
  rootContext: Document | ShadowRoot;
  sourceDepth: number;
  textScopeLength: number;
  parserMatchCount: number;
  canonicalKey: string;
  currencyOrigin: "explicit" | "inferred";
  clusterIndex: number | null;
};

export type CandidateDiscoveryDiagnostic = {
  candidateId: string;
  discoveryMode: PriceDiscoveryMode;
  sourceNodeCount: number;
  normalizedMatchedText: string;
  amount: number;
  sourceCurrency: string;
  currencyOrigin: "explicit" | "inferred";
  targetCurrency: string;
  rangeValid: boolean;
  rectCount: number;
  boundingRect: RectSnapshot | null;
};

export type CanonicalizationDiagnostic = {
  visualGroupId: string;
  candidateCount: number;
  candidateIds: string[];
  sameRangeMatches: number;
  ancestorDescendantMatches: number;
  selectedCandidateId: string;
  selectedDiscoveryMode: PriceDiscoveryMode;
  rejectedCandidates: Array<{ candidateId: string; reason: string }>;
};

export type VisualSourceReconciliationDiagnostic = {
  canonicalKey: string;
  existingRecordFound: boolean;
  existingBadgeConnected: boolean;
  sourceRebound: boolean;
  duplicateBadgeCount: number;
  duplicateBadgesRemoved: number;
  insertedNewBadge: boolean;
  updatedExistingBadge: boolean;
  reason: string;
};

type RectSnapshot = { x: number; y: number; width: number; height: number };
type VisualSourceRecord = {
  key: string;
  candidate: PriceCandidate;
  badge: HTMLElement;
  lastSeenAt: number;
};

const nodeIds = new WeakMap<Node, string>();
const rootIds = new WeakMap<Document | ShadowRoot, string>();
const contextIds = new WeakMap<Element, string>();
const registry = new Map<string, VisualSourceRecord>();
let nextNodeId = 1;
let nextRootId = 1;
let nextContextId = 1;
let nextBatchId = 1;
let latestDiscoveryDiagnostics: CandidateDiscoveryDiagnostic[] = [];
let latestCanonicalizationDiagnostics: CanonicalizationDiagnostic[] = [];
let latestReconciliationDiagnostics: VisualSourceReconciliationDiagnostic[] = [];
let reconciliationBatchBadges: HTMLElement[] | null = null;
let reconciliationBatchBadgeSet: Set<HTMLElement> | null = null;
let reconciliationBatchBadgesByRateKey: Map<string, HTMLElement[]> | null = null;

function rateKey(sourceCurrency: string | undefined, sourceAmount: string | number | undefined, targetCurrency: string | undefined): string {
  return `${sourceCurrency ?? ""}|${String(sourceAmount ?? "")}|${targetCurrency ?? ""}`;
}

function identity<T extends Node>(map: WeakMap<T, string>, node: T, prefix: string, next: () => number): string {
  const existing = map.get(node);
  if (existing) return existing;
  const id = `${prefix}-${next()}`;
  map.set(node, id);
  return id;
}

function nodeId(node: Node): string {
  return identity(nodeIds, node, "node", () => nextNodeId++);
}

function rootId(root: Document | ShadowRoot): string {
  return identity(rootIds, root, "root", () => nextRootId++);
}

function contextId(element: Element): string {
  return identity(contextIds, element, "context", () => nextContextId++);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function snapshot(rect: DOMRect): RectSnapshot {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function stableContextFor(match: CurrencyDomMatch): HTMLElement {
  const matchedText = normalize(match.parserInput);
  let current: HTMLElement | null = match.renderingAnchor;
  let fallback = match.renderingAnchor;
  for (let depth = 0; current && depth < 5; depth++) {
    fallback = current;
    const text = normalize(collectSourceTextFragments(current).input);
    if (text && text !== matchedText) return current;
    const parent: HTMLElement | null = current.parentElement;
    if (parent) {
      const parentText = normalize(collectSourceTextFragments(parent).input);
      if (parentText && parentText !== matchedText) return current;
    }
    current = parent;
  }
  return fallback;
}

function createRangeDescriptor(match: CurrencyDomMatch): RangeDescriptor | null {
  const startFragment = match.fragmentMap.find((fragment) =>
    match.match.start >= fragment.combinedStart && match.match.start < fragment.combinedEnd
  );
  const endFragment = match.fragmentMap.find((fragment) =>
    match.match.end > fragment.combinedStart && match.match.end <= fragment.combinedEnd
  );
  if (!startFragment || !endFragment) return null;
  const startOffset = match.match.start - startFragment.combinedStart;
  const endOffset = match.match.end - endFragment.combinedStart;
  if (startOffset < 0 || endOffset < 0 || startOffset > startFragment.node.length || endOffset > endFragment.node.length) return null;
  return {
    startNode: startFragment.node,
    startOffset,
    endNode: endFragment.node,
    endOffset,
    signature: `${nodeId(startFragment.node)}:${startOffset}-${nodeId(endFragment.node)}:${endOffset}`,
  };
}

function rangeGeometry(
  descriptor: RangeDescriptor | null,
  fallback: HTMLElement
): { rects: DOMRect[]; bounding: DOMRect | null } {
  if (descriptor) {
    try {
      const range = document.createRange();
      range.setStart(descriptor.startNode, descriptor.startOffset);
      range.setEnd(descriptor.endNode, descriptor.endOffset);
      const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
      const bounding = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : rects[0] ?? null;
      if (bounding && bounding.width > 0 && bounding.height > 0) return { rects, bounding };
    } catch {
      // Element geometry below is the final fallback.
    }
  }
  const rect = fallback.getBoundingClientRect();
  return { rects: rect.width > 0 && rect.height > 0 ? [rect] : [], bounding: rect.width > 0 && rect.height > 0 ? rect : null };
}

function discoveryMode(match: CurrencyDomMatch, aggregate: boolean): PriceDiscoveryMode {
  if (aggregate) return "aggregate-fallback";
  if (match.scanKind === "direct") return "leaf-text";
  if (match.scanKind === "cluster-explicit" || match.scanKind === "cluster-inferred") return "price-cluster";
  return match.sourceNodes.length > 1 ? "split-text" : "combined-parent";
}

function canonicalKeyFor(
  match: CurrencyDomMatch,
  targetCurrency: string,
  stableContext: HTMLElement,
  localContextHash: string,
  bounding: DOMRect | null,
  descriptor: RangeDescriptor | null
): string {
  const root = match.sourceElement.getRootNode() as Document | ShadowRoot;
  const contextRect = stableContext.getBoundingClientRect();
  const relativeX = bounding ? Math.round((bounding.left - contextRect.left) / 4) : 0;
  const relativeY = bounding ? Math.round((bounding.top - contextRect.top) / 4) : 0;
  return hashText([
    rootId(root), contextId(stableContext), match.match.amount, match.match.currency,
    targetCurrency, normalize(match.match.raw), match.currencyOrigin ?? "explicit",
    match.clusterIndex ?? "none", descriptor?.signature ?? "no-range",
    localContextHash, relativeX, relativeY,
  ].join("|"));
}

export function discoverPriceCandidates(
  matches: readonly CurrencyDomMatch[],
  targetCurrency: string,
  aggregateAnchors: ReadonlySet<HTMLElement> = new Set()
): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  latestDiscoveryDiagnostics = [];
  for (const match of matches) {
    const descriptor = createRangeDescriptor(match);
    const geometry = rangeGeometry(descriptor, match.renderingAnchor);
    const stableContext = stableContextFor(match);
    const localContext = normalize(collectSourceTextFragments(stableContext).input).slice(0, 240);
    const localContextHash = hashText(localContext);
    const root = match.sourceElement.getRootNode();
    if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) continue;
    const rootContext = root as Document | ShadowRoot;
    const mode = discoveryMode(match, aggregateAnchors.has(match.renderingAnchor));
    const candidateId = `candidate-${nextBatchId}-${candidates.length + 1}`;
    const candidate: PriceCandidate = {
      candidateId,
      domMatch: match,
      sourceTextNodes: [...match.sourceNodes],
      sourceElements: [...new Set(match.sourceNodes.map((node) => node.parentElement).filter((element): element is HTMLElement => !!element))],
      matchStart: match.match.start,
      matchEnd: match.match.end,
      rawText: match.match.raw,
      normalizedMatchedText: normalize(match.match.raw),
      amount: match.match.amount,
      sourceCurrency: match.match.currency,
      targetCurrency,
      tokenType: match.match.tokenType,
      confidence: match.match.confidence,
      discoveryMode: mode,
      rangeDescriptor: descriptor,
      clientRects: geometry.rects,
      boundingRect: geometry.bounding,
      localContext,
      localContextHash,
      stableContext,
      rootContext,
      sourceDepth: Math.max(...match.sourceNodes.map(depthOf)),
      textScopeLength: (match.renderingAnchor.textContent ?? "").length,
      parserMatchCount: parseCurrencies(match.renderingAnchor.textContent ?? "").length,
      canonicalKey: canonicalKeyFor(match, targetCurrency, stableContext, localContextHash, geometry.bounding, descriptor),
      currencyOrigin: match.currencyOrigin ?? "explicit",
      clusterIndex: match.clusterIndex ?? null,
    };
    candidates.push(candidate);
    latestDiscoveryDiagnostics.push({
      candidateId,
      discoveryMode: mode,
      sourceNodeCount: candidate.sourceTextNodes.length,
      normalizedMatchedText: candidate.normalizedMatchedText,
      amount: candidate.amount,
      sourceCurrency: candidate.sourceCurrency,
      currencyOrigin: candidate.currencyOrigin,
      targetCurrency,
      rangeValid: descriptor !== null,
      rectCount: geometry.rects.length,
      boundingRect: geometry.bounding ? snapshot(geometry.bounding) : null,
    });
  }
  nextBatchId++;
  return candidates;
}

function rectOverlap(first: DOMRect | null, second: DOMRect | null): number {
  if (!first || !second) return 0;
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const smaller = Math.min(first.width * first.height, second.width * second.height);
  return smaller > 0 ? width * height / smaller : 0;
}

function centerDistance(first: DOMRect | null, second: DOMRect | null): number {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    first.left + first.width / 2 - second.left - second.width / 2,
    first.top + first.height / 2 - second.top - second.height / 2
  );
}

function ancestorRelated(first: PriceCandidate, second: PriceCandidate): boolean {
  return first.sourceElements.some((left) => second.sourceElements.some((right) => left.contains(right) || right.contains(left)));
}

function sharesLeaf(first: PriceCandidate, second: PriceCandidate): boolean {
  return first.sourceTextNodes.some((node) => second.sourceTextNodes.includes(node));
}

function sameVisualSource(first: PriceCandidate, second: PriceCandidate): boolean {
  if (first.rootContext !== second.rootContext || first.amount !== second.amount ||
      first.sourceCurrency !== second.sourceCurrency || first.targetCurrency !== second.targetCurrency ||
      first.normalizedMatchedText !== second.normalizedMatchedText) return false;
  const related = sharesLeaf(first, second) || ancestorRelated(first, second) ||
    first.rangeDescriptor?.signature === second.rangeDescriptor?.signature;
  if (!related) return false;
  if (sharesLeaf(first, second)) return true;
  return rectOverlap(first.boundingRect, second.boundingRect) >= 0.9 &&
    centerDistance(first.boundingRect, second.boundingRect) <= 2;
}

function rank(candidate: PriceCandidate): number[] {
  const modeRank: Record<PriceDiscoveryMode, number> = {
    "leaf-text": 0, "split-text": 1, "price-cluster": 2, "combined-parent": 3, "aggregate-fallback": 4,
  };
  const area = candidate.boundingRect ? candidate.boundingRect.width * candidate.boundingRect.height : Number.MAX_SAFE_INTEGER;
  return [
    modeRank[candidate.discoveryMode], candidate.rangeDescriptor ? 0 : 1,
    candidate.textScopeLength, candidate.parserMatchCount, -candidate.sourceDepth,
    area, -candidate.confidence,
  ];
}

function compareRank(first: PriceCandidate, second: PriceCandidate): number {
  const left = rank(first);
  const right = rank(second);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function rejectionReason(selected: PriceCandidate, rejected: PriceCandidate): string {
  if (selected.discoveryMode === "leaf-text" && rejected.discoveryMode !== "leaf-text") {
    return "Complete leaf match supersedes ancestor aggregate";
  }
  if (selected.discoveryMode === "split-text" && rejected.discoveryMode === "combined-parent") {
    return "Exact split range supersedes combined parent";
  }
  if (selected.rangeDescriptor?.signature === rejected.rangeDescriptor?.signature) {
    return "Same visual range as canonical source";
  }
  return "Ancestor aggregate duplicate";
}

function validCandidate(
  candidate: PriceCandidate,
  visibilityCache: WeakMap<HTMLElement, boolean>
): boolean {
  if (!candidate.sourceTextNodes.every((node) => node.isConnected) ||
      !candidate.domMatch.renderingAnchor.isConnected || candidate.boundingRect === null ||
      (candidate.boundingRect.width <= 1 && candidate.boundingRect.height <= 1)) return false;
  if (typeof candidate.domMatch.sourceElement.checkVisibility === "function") {
    return candidate.domMatch.sourceElement.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    });
  }
  let current: HTMLElement | null = candidate.domMatch.sourceElement;
  while (current) {
    const cachedVisible = visibilityCache.get(current);
    if (cachedVisible === false) return false;
    if (cachedVisible === true) {
      current = current.parentElement;
      continue;
    }
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" ||
        (style.opacity !== "" && Number(style.opacity) === 0)) {
      visibilityCache.set(current, false);
      return false;
    }
    visibilityCache.set(current, true);
    current = current.parentElement;
  }
  return true;
}

export function canonicalizePriceCandidates(candidates: readonly PriceCandidate[]): PriceCandidate[] {
  const visibilityCache = new WeakMap<HTMLElement, boolean>();
  const valid = candidates.filter((candidate) => validCandidate(candidate, visibilityCache));
  const groups: PriceCandidate[][] = [];
  for (const candidate of valid) {
    const related = groups.find((group) => group.some((member) => sameVisualSource(candidate, member)));
    if (related) related.push(candidate);
    else groups.push([candidate]);
  }
  latestCanonicalizationDiagnostics = [];
  return groups.map((group, index) => {
    const ranked = [...group].sort(compareRank);
    const selected = ranked[0];
    latestCanonicalizationDiagnostics.push({
      visualGroupId: `visual-group-${nextBatchId}-${index + 1}`,
      candidateCount: group.length,
      candidateIds: group.map((candidate) => candidate.candidateId),
      sameRangeMatches: group.filter((candidate) => candidate !== selected && candidate.rangeDescriptor?.signature === selected.rangeDescriptor?.signature).length,
      ancestorDescendantMatches: group.filter((candidate) => candidate !== selected && ancestorRelated(candidate, selected)).length,
      selectedCandidateId: selected.candidateId,
      selectedDiscoveryMode: selected.discoveryMode,
      rejectedCandidates: ranked.slice(1).map((candidate) => ({
        candidateId: candidate.candidateId,
        reason: rejectionReason(selected, candidate),
      })),
    });
    return selected;
  });
}

function matchingBadges(candidate: PriceCandidate): HTMLElement[] {
  const badges = reconciliationBatchBadges ??
    [...document.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"][data-euc-canonical-key]')];
  const rateBadges = reconciliationBatchBadgesByRateKey?.get(
    rateKey(candidate.sourceCurrency, candidate.amount, candidate.targetCurrency)
  ) ?? badges;
  return rateBadges
    .filter((badge) => badge.dataset.ehiniumSourceCurrency === candidate.sourceCurrency &&
      Number(badge.dataset.ehiniumSourceAmount) === candidate.amount &&
      badge.dataset.ehiniumTargetCurrency === candidate.targetCurrency &&
      (badge.dataset.eucCanonicalKey === candidate.canonicalKey ||
        (badge.dataset.eucStableContextId === contextId(candidate.stableContext) &&
          badge.dataset.eucLocalContextHash === candidate.localContextHash &&
          rectSnapshotOverlap(badge.dataset.eucSourceRect, candidate.boundingRect) >= 0.9)));
}

function matchingNearbyBadges(candidate: PriceCandidate, known: HTMLElement): HTMLElement[] {
  const roots = new Set<ParentNode>();
  if (known.parentElement) roots.add(known.parentElement);
  if (candidate.domMatch.sourceElement.parentElement) roots.add(candidate.domMatch.sourceElement.parentElement);
  roots.add(candidate.domMatch.renderingAnchor);
  const matches = new Set<HTMLElement>(known.isConnected ? [known] : []);
  for (const root of roots) {
    for (const badge of root.querySelectorAll<HTMLElement>('[data-euc-source-key]')) {
      if (badge.dataset.eucSourceKey === candidate.canonicalKey) matches.add(badge);
    }
  }
  return [...matches];
}

function rectSnapshotOverlap(serialized: string | undefined, candidate: DOMRect | null): number {
  if (!serialized || !candidate) return 0;
  const [x, y, width, height] = serialized.split(",").map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return 0;
  const right = x + width;
  const bottom = y + height;
  const overlapWidth = Math.max(0, Math.min(right, candidate.right) - Math.max(x, candidate.left));
  const overlapHeight = Math.max(0, Math.min(bottom, candidate.bottom) - Math.max(y, candidate.top));
  const smaller = Math.min(width * height, candidate.width * candidate.height);
  return smaller > 0 ? overlapWidth * overlapHeight / smaller : 0;
}

export function reconcileCanonicalVisualSource(candidate: PriceCandidate): HTMLElement | null {
  const existingRecord = registry.get(candidate.canonicalKey);
  const badges = existingRecord
    ? existingRecord.badge.isConnected ? matchingNearbyBadges(candidate, existingRecord.badge) : []
    : matchingBadges(candidate);
  const registered = existingRecord?.badge.isConnected
    ? existingRecord.badge
    : badges.length > 0 ? reconcileBadgeHostsForKey(candidate.canonicalKey, existingRecord?.badge) : null;
  const authoritative = registered?.isConnected
    ? registered
    : existingRecord?.badge.isConnected ? existingRecord.badge : badges.find((badge) => badge.isConnected) ?? null;
  let removed = 0;
  for (const duplicate of badges) {
    if (duplicate === authoritative) continue;
    markBadgeRemovalIntentional(duplicate);
    duplicate.remove();
    removed++;
  }
  if (authoritative) {
    registry.set(candidate.canonicalKey, {
      key: candidate.canonicalKey,
      candidate,
      badge: authoritative,
      lastSeenAt: Date.now(),
    });
  } else if (existingRecord) {
    registry.delete(candidate.canonicalKey);
  }
  latestReconciliationDiagnostics.push({
    canonicalKey: candidate.canonicalKey,
    existingRecordFound: existingRecord !== undefined,
    existingBadgeConnected: authoritative?.isConnected ?? false,
    sourceRebound: !!authoritative && existingRecord?.candidate.domMatch.sourceNodes[0] !== candidate.domMatch.sourceNodes[0],
    duplicateBadgeCount: badges.length,
    duplicateBadgesRemoved: removed,
    insertedNewBadge: false,
    updatedExistingBadge: authoritative !== null,
    reason: authoritative ? "Existing canonical badge reused" : removed > 0 ? "Stale duplicate badge removed" : "Separate visual instance preserved",
  });
  return authoritative;
}

export function registerCanonicalVisualSource(candidate: PriceCandidate, badge: HTMLElement): void {
  badge.dataset.eucCanonicalKey = candidate.canonicalKey;
  badge.dataset.eucStableContextId = contextId(candidate.stableContext);
  badge.dataset.eucLocalContextHash = candidate.localContextHash;
  if (candidate.boundingRect) {
    badge.dataset.eucSourceRect = [candidate.boundingRect.x, candidate.boundingRect.y, candidate.boundingRect.width, candidate.boundingRect.height].join(",");
  }
  const authoritative = registerAuthoritativeBadgeHost({
    sourceKey: candidate.canonicalKey,
    badgeHost: badge,
    sourceElement: candidate.domMatch.sourceElement,
    renderMode: badge.dataset.eucRenderMode === "overlay" ? "overlay" : "inline",
    sourceFingerprint: badge.dataset.ehiniumSourceFingerprint,
    amount: candidate.amount,
    sourceCurrency: candidate.sourceCurrency,
    targetCurrency: candidate.targetCurrency,
    creationReason: "Canonical currency badge registered",
  });
  if (reconciliationBatchBadges && !reconciliationBatchBadgeSet?.has(authoritative)) {
    reconciliationBatchBadges.push(authoritative);
    reconciliationBatchBadgeSet?.add(authoritative);
    const key = rateKey(
      authoritative.dataset.ehiniumSourceCurrency,
      authoritative.dataset.ehiniumSourceAmount,
      authoritative.dataset.ehiniumTargetCurrency
    );
    const keyed = reconciliationBatchBadgesByRateKey?.get(key);
    if (keyed) keyed.push(authoritative);
    else reconciliationBatchBadgesByRateKey?.set(key, [authoritative]);
  }
  registry.set(candidate.canonicalKey, { key: candidate.canonicalKey, candidate, badge: authoritative, lastSeenAt: Date.now() });
  latestReconciliationDiagnostics.push({
    canonicalKey: candidate.canonicalKey,
    existingRecordFound: false,
    existingBadgeConnected: false,
    sourceRebound: false,
    duplicateBadgeCount: 0,
    duplicateBadgesRemoved: 0,
    insertedNewBadge: true,
    updatedExistingBadge: false,
    reason: "New canonical badge inserted",
  });
}

export function beginVisualSourceReconciliationBatch(): void {
  latestReconciliationDiagnostics = [];
  reconciliationBatchBadges = [
    ...document.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"][data-euc-canonical-key]'),
  ];
  reconciliationBatchBadgeSet = new Set(reconciliationBatchBadges);
  reconciliationBatchBadgesByRateKey = new Map();
  for (const badge of reconciliationBatchBadges) {
    const key = rateKey(
      badge.dataset.ehiniumSourceCurrency,
      badge.dataset.ehiniumSourceAmount,
      badge.dataset.ehiniumTargetCurrency
    );
    const keyed = reconciliationBatchBadgesByRateKey.get(key);
    if (keyed) keyed.push(badge);
    else reconciliationBatchBadgesByRateKey.set(key, [badge]);
  }
  for (const [key, record] of registry) {
    const hasConnectedSource = record.candidate.sourceTextNodes.some((node) => node.isConnected);
    if (!record.badge.isConnected && !hasConnectedSource) registry.delete(key);
  }
}

export function clearVisualSourceRegistry(root: ParentNode = document): void {
  for (const [key, record] of registry) {
    if (root === document || root === record.badge || root.contains(record.badge) || root.contains(record.candidate.domMatch.sourceElement)) {
      registry.delete(key);
    }
  }
}

export function getCandidateDiscoveryDiagnostics(): CandidateDiscoveryDiagnostic[] {
  return latestDiscoveryDiagnostics.map((item) => ({ ...item, boundingRect: item.boundingRect ? { ...item.boundingRect } : null }));
}

export function getCanonicalizationDiagnostics(): CanonicalizationDiagnostic[] {
  return latestCanonicalizationDiagnostics.map((item) => ({
    ...item,
    candidateIds: [...item.candidateIds],
    rejectedCandidates: item.rejectedCandidates.map((rejected) => ({ ...rejected })),
  }));
}

export function getVisualSourceReconciliationDiagnostics(): VisualSourceReconciliationDiagnostic[] {
  return latestReconciliationDiagnostics.map((item) => ({ ...item }));
}
