import { parseCurrencies } from "../utils/currencyParser";
import type { CurrencyDomMatch } from "./currencyDomMatches";
import { isInsideExcludedContent } from "./domExclusions";
import { registerBadgeVisibility } from "./badgeVisibility";
import {
  placeOverlayBatch,
  type OverlayPlacementDiagnostic,
  type OverlayPlacementGroupDiagnostic,
  type OverlayPlacementId,
} from "./overlayPlacement";
import { cloneProtectedBadgeHost, forgetBadgeHost } from "./badgeHost";
import {
  configureBadgeHostRemovalHandler,
  transitionAuthoritativeBadgeHost,
  unregisterBadgeHost,
} from "./badgeHostRegistry";

export type { OverlayPlacementDiagnostic, OverlayPlacementGroupDiagnostic } from "./overlayPlacement";

export type RenderMode = "inline" | "overlay-fallback";

export type LifecycleVerification = {
  delayMs: number;
  connected: boolean;
};

export type RenderLifecycleDiagnostic = {
  logicalSourceKey: string;
  initialMode: "inline";
  finalMode: RenderMode;
  inlineInsertSucceeded: boolean;
  inlineConnectedAfterInsert: boolean;
  verificationChecks: LifecycleVerification[];
  removalIntentional: boolean;
  sourceStillConnected: boolean;
  equivalentSourceFound: boolean;
  externalRemovalCount: number;
  ownerReplacementCount: number;
  markedUnstable: boolean;
  fallbackActivated: boolean;
  lastReason: string;
};

type LifecycleRecord = {
  logicalKey: string;
  mode: RenderMode;
  sourceNodes: Text[];
  sourceElement: HTMLElement;
  anchor: HTMLElement;
  badge: HTMLElement;
  overlayBadge?: HTMLElement;
  stableRoots: HTMLElement[];
  parserInput: string;
  raw: string;
  start: number;
  end: number;
  amount: number;
  sourceCurrency: string;
  targetCurrency: string;
  scanKind: CurrencyDomMatch["scanKind"];
  fragmentMap: Array<{ node: Text; combinedStart: number; combinedEnd: number }>;
  insertedAt: number;
  lastVerifiedAt: number;
  externalRemovalCount: number;
  ownerReplacementCount: number;
  intentionalRemoval: boolean;
  externalRemovalPending: boolean;
  ownerReplacementPending: boolean;
  unstable: boolean;
  verificationChecks: LifecycleVerification[];
  timers: Set<ReturnType<typeof setTimeout>>;
  lastRect: DOMRect;
  equivalentSourceFound: boolean;
  lastReason: string;
  overlayPlacement: OverlayPlacementId | null;
};

const OVERLAY_ROOT_SELECTOR = '[data-euc-overlay-root="true"]';
const VERIFY_DELAYS = [0, 350, 1400] as const;
const recordsByKey = new Map<string, LifecycleRecord>();
const recordsByBadge = new WeakMap<HTMLElement, LifecycleRecord>();

configureBadgeHostRemovalHandler((host) => {
  forgetBadgeHost(host);
  host.remove();
});
const containerIds = new WeakMap<Element, string>();
let nextContainerId = 1;
let overlayRoot: HTMLElement | null = null;
let overlayFrame: number | null = null;
let overlayListenersStarted = false;
let overlayResizeObserver: ResizeObserver | null = null;
let cleanupListenersStarted = false;
const placementDiagnostics = new Map<string, OverlayPlacementDiagnostic>();
let placementGroupDiagnostics: OverlayPlacementGroupDiagnostic[] = [];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(() => callback(now()), 0) as unknown as number;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function containerId(element: Element): string {
  const existing = containerIds.get(element);
  if (existing) return existing;
  const id = `host-${nextContainerId++}`;
  containerIds.set(element, id);
  return id;
}

function stableRootsFor(anchor: HTMLElement): HTMLElement[] {
  const roots: HTMLElement[] = [];
  let current: HTMLElement | null = anchor.parentElement ?? anchor;
  while (current && roots.length < 4) {
    roots.push(current);
    if (current === document.body || current === document.documentElement) break;
    current = current.parentElement;
  }
  return roots;
}

function logicalKey(candidate: CurrencyDomMatch, targetCurrency: string): string {
  const stable = candidate.renderingAnchor.parentElement ?? candidate.renderingAnchor;
  const rect = candidate.sourceElement.getBoundingClientRect();
  return [
    containerId(stable), normalize(candidate.parserInput), candidate.match.start,
    candidate.match.end, candidate.match.amount, candidate.match.currency,
    targetCurrency, Math.round(rect.left / 8), Math.round(rect.top / 8),
  ].join("|");
}

function emptyRect(): DOMRect {
  return typeof DOMRect === "function" ? new DOMRect() : ({
    x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0,
    width: 0, height: 0, toJSON: () => ({}),
  } as DOMRect);
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  let current: HTMLElement | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" ||
        style.visibility === "collapse" || Number(style.opacity || "1") <= 0.01) return false;
    current = current.parentElement;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function rectDistance(first: DOMRect, second: DOMRect): number {
  return Math.hypot(first.left - second.left, first.top - second.top);
}

function findEquivalentText(record: LifecycleRecord): Text | null {
  const candidates: Text[] = [];
  for (const root of record.stableRoots) {
    if (!root.isConnected) continue;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const text = current as Text;
      if (!isInsideExcludedContent(text)) {
        const parsed = parseCurrencies(text.textContent ?? "");
        if (parsed.some((match) =>
          match.amount === record.amount && match.currency === record.sourceCurrency &&
          normalize(match.raw) === normalize(record.raw)
        )) candidates.push(text);
      }
      current = walker.nextNode();
    }
    if (candidates.length > 0) break;
  }
  return candidates.sort((left, right) =>
    rectDistance(left.parentElement?.getBoundingClientRect() ?? emptyRect(), record.lastRect) -
    rectDistance(right.parentElement?.getBoundingClientRect() ?? emptyRect(), record.lastRect)
  )[0] ?? null;
}

function sourceStillMatches(record: LifecycleRecord): boolean {
  const input = record.sourceNodes.map((node) => node.textContent ?? "").join("");
  return record.sourceNodes.every((node) => node.isConnected) &&
    parseCurrencies(input).some((match) =>
      match.amount === record.amount && match.currency === record.sourceCurrency &&
      normalize(match.raw) === normalize(record.raw)
    );
}

function rebindSource(record: LifecycleRecord): boolean {
  if (sourceStillMatches(record)) return true;
  const replacement = findEquivalentText(record);
  if (!replacement?.parentElement) return false;
  const parsed = parseCurrencies(replacement.textContent ?? "").find((match) =>
    match.amount === record.amount && match.currency === record.sourceCurrency &&
    normalize(match.raw) === normalize(record.raw)
  );
  if (!parsed) return false;
  const previousSource = record.sourceElement;
  record.sourceNodes = [replacement];
  record.sourceElement = replacement.parentElement;
  record.anchor = replacement.parentElement;
  record.parserInput = replacement.textContent ?? "";
  record.start = parsed.start;
  record.end = parsed.end;
  record.scanKind = "direct";
  record.fragmentMap = [{ node: replacement, combinedStart: 0, combinedEnd: replacement.length }];
  record.equivalentSourceFound = true;
  record.lastReason = "Equivalent source rebound";
  if (record.overlayBadge?.isConnected) {
    overlayResizeObserver?.unobserve(previousSource);
    overlayResizeObserver?.observe(record.sourceElement);
    registerBadgeVisibility(record.overlayBadge, record.sourceElement, record.anchor);
  }
  return true;
}

function updateRecordFromCandidate(record: LifecycleRecord, candidate: CurrencyDomMatch): void {
  const previousSource = record.sourceElement;
  record.sourceNodes = [...candidate.sourceNodes];
  record.sourceElement = candidate.sourceElement;
  record.anchor = candidate.renderingAnchor;
  record.parserInput = candidate.parserInput;
  record.raw = candidate.match.raw;
  record.start = candidate.match.start;
  record.end = candidate.match.end;
  record.scanKind = candidate.scanKind;
  record.fragmentMap = candidate.fragmentMap.map((fragment) => ({ ...fragment }));
  record.lastRect = candidate.sourceElement.getBoundingClientRect();
  if (record.overlayBadge?.isConnected) {
    overlayResizeObserver?.unobserve(previousSource);
    overlayResizeObserver?.observe(record.sourceElement);
    registerBadgeVisibility(record.overlayBadge, record.sourceElement, record.anchor);
  }
}

function clearTimers(record: LifecycleRecord): void {
  for (const timer of record.timers) clearTimeout(timer);
  record.timers.clear();
}

function disposeRecord(record: LifecycleRecord): void {
  record.intentionalRemoval = true;
  clearTimers(record);
  unregisterBadgeHost(record.badge);
  record.badge.remove();
  forgetBadgeHost(record.badge);
  if (record.overlayBadge) {
    unregisterBadgeHost(record.overlayBadge);
    forgetBadgeHost(record.overlayBadge);
    record.overlayBadge.remove();
  }
  overlayResizeObserver?.unobserve(record.sourceElement);
  recordsByKey.delete(record.logicalKey);
  placementDiagnostics.delete(record.logicalKey);
  stopOverlayListenersIfUnused();
}

function scheduleMissingSourceCleanup(record: LifecycleRecord): void {
  if ([...record.timers].length > 0) return;
  const timer = setTimeout(() => {
    record.timers.delete(timer);
    if (!rebindSource(record)) {
      record.lastReason = "Overlay badge removed because source no longer matches";
      disposeRecord(record);
    }
  }, 1400);
  record.timers.add(timer);
}

function scheduleVerification(record: LifecycleRecord): void {
  clearTimers(record);
  for (const delayMs of VERIFY_DELAYS) {
    const timer = setTimeout(() => {
      record.timers.delete(timer);
      verifyInlineRecord(record, delayMs);
    }, delayMs);
    record.timers.add(timer);
  }
}

function retryInline(record: LifecycleRecord): boolean {
  if (!rebindSource(record) || !isVisible(record.sourceElement)) return false;
  const node = record.sourceNodes[0];
  if (!node.parentElement) return false;
  node.parentElement.insertBefore(record.badge, node.nextSibling);
  record.anchor = node.parentElement;
  record.sourceElement = node.parentElement;
  record.insertedAt = now();
  record.lastVerifiedAt = record.insertedAt;
  record.intentionalRemoval = false;
  record.externalRemovalPending = false;
  record.ownerReplacementPending = false;
  record.lastReason = record.equivalentSourceFound
    ? "Equivalent source rebound"
    : "Inline badge rebound after external removal";
  record.badge.dataset.eucRenderMode = "inline";
  registerBadgeVisibility(record.badge, record.sourceElement, record.anchor);
  scheduleVerification(record);
  return record.badge.isConnected;
}

function getOverlayRoot(): HTMLElement {
  if (overlayRoot?.isConnected) return overlayRoot;
  overlayRoot = document.querySelector<HTMLElement>(OVERLAY_ROOT_SELECTOR) ?? document.createElement("div");
  overlayRoot.setAttribute("data-euc-overlay-root", "true");
  overlayRoot.setAttribute("data-euc-owned", "true");
  overlayRoot.setAttribute("translate", "no");
  overlayRoot.classList.add("notranslate");
  overlayRoot.setAttribute("aria-hidden", "true");
  Object.assign(overlayRoot.style, {
    position: "fixed", inset: "0", width: "0", height: "0",
    pointerEvents: "none", zIndex: "1000", overflow: "visible",
  });
  document.documentElement.append(overlayRoot);
  return overlayRoot;
}

function createOverlayBadge(record: LifecycleRecord): HTMLElement {
  const badge = cloneProtectedBadgeHost(record.badge);
  badge.setAttribute("data-euc-owned", "true");
  badge.setAttribute("data-euc-badge", "true");
  badge.setAttribute("data-euc-overlay-badge", "true");
  badge.setAttribute("translate", "no");
  badge.setAttribute("aria-hidden", "true");
  badge.removeAttribute("role");
  badge.removeAttribute("tabindex");
  badge.style.position = "fixed";
  badge.style.pointerEvents = "none";
  badge.style.margin = "0";
  badge.style.marginInlineStart = "0";
  badge.style.zIndex = "1000";
  return badge;
}

function positionOverlays(reason: string): void {
  const active: LifecycleRecord[] = [];
  for (const record of recordsByKey.values()) {
    if (record.mode !== "overlay-fallback" || !record.overlayBadge) continue;
    if (!rebindSource(record) || !isVisible(record.sourceElement)) {
      record.overlayBadge.style.visibility = "hidden";
      record.lastReason = "Overlay badge hidden because source is not visible";
      placementDiagnostics.delete(record.logicalKey);
      scheduleMissingSourceCleanup(record);
      continue;
    }
    active.push(record);
  }
  const placement = placeOverlayBatch(active.map((record) => ({
    logicalKey: record.logicalKey,
    badge: record.overlayBadge!,
    sourceElement: record.sourceElement,
    anchor: record.anchor,
    sourceNodes: record.sourceNodes,
    fragmentMap: record.fragmentMap,
    parserInput: record.parserInput,
    raw: record.raw,
    start: record.start,
    end: record.end,
    previousPlacement: record.overlayPlacement,
  })), reason);
  placementGroupDiagnostics = placement.groups;
  for (const result of placement.results) {
    const record = recordsByKey.get(result.logicalKey);
    const badge = record?.overlayBadge;
    if (!record || !badge) continue;
    placementDiagnostics.set(record.logicalKey, result.diagnostic);
    record.lastRect = new DOMRect(result.exactRect.x, result.exactRect.y, result.exactRect.width, result.exactRect.height);
    record.overlayPlacement = result.placement;
    if (!result.placement) {
      badge.style.visibility = "hidden";
      record.lastReason = "No collision-free overlay placement";
      continue;
    }
    badge.style.left = `${Math.round(result.rect.x)}px`;
    badge.style.top = `${Math.round(result.rect.y)}px`;
    badge.dataset.eucOverlayPlacement = result.placement;
    if (!badge.dataset.eucVisibilityReason || badge.dataset.eucVisibilityReason === "visible") badge.style.visibility = "";
    record.lastReason = result.diagnostic.lastPositionReason;
  }
}

function scheduleOverlayPositions(reason: string): void {
  if (overlayFrame !== null) return;
  overlayFrame = requestFrame(() => {
    overlayFrame = null;
    positionOverlays(reason);
  });
}

function onGeometryChange(): void { scheduleOverlayPositions("viewport-geometry-change"); }
function onPageHide(): void { clearBadgeLifecycles(document); }

function startCleanupListeners(): void {
  if (cleanupListenersStarted || typeof window === "undefined") return;
  cleanupListenersStarted = true;
  window.addEventListener("pagehide", onPageHide, { once: true });
}

function startOverlayListeners(): void {
  if (overlayListenersStarted) return;
  overlayListenersStarted = true;
  window.addEventListener("scroll", onGeometryChange, true);
  window.addEventListener("resize", onGeometryChange, true);
  window.visualViewport?.addEventListener("scroll", onGeometryChange);
  window.visualViewport?.addEventListener("resize", onGeometryChange);
  if (typeof ResizeObserver === "function") {
    overlayResizeObserver = new ResizeObserver(onGeometryChange);
  }
}

function stopOverlayListenersIfUnused(): void {
  if ([...recordsByKey.values()].some((record) => record.mode === "overlay-fallback")) return;
  if (!overlayListenersStarted) return;
  overlayListenersStarted = false;
  window.removeEventListener("scroll", onGeometryChange, true);
  window.removeEventListener("resize", onGeometryChange, true);
  window.visualViewport?.removeEventListener("scroll", onGeometryChange);
  window.visualViewport?.removeEventListener("resize", onGeometryChange);
  overlayResizeObserver?.disconnect();
  overlayResizeObserver = null;
  overlayRoot?.remove();
  overlayRoot = null;
}

function activateOverlay(record: LifecycleRecord): void {
  if (record.mode === "overlay-fallback") return;
  clearTimers(record);
  record.unstable = true;
  record.mode = "overlay-fallback";
  record.lastReason = "Portal overlay fallback activated";
  const previousHost = record.badge;
  const overlayBadge = createOverlayBadge(record);
  overlayBadge.dataset.eucRenderMode = "overlay";
  record.overlayBadge = overlayBadge;
  getOverlayRoot().append(overlayBadge);
  recordsByBadge.set(overlayBadge, record);
  record.intentionalRemoval = true;
  transitionAuthoritativeBadgeHost(
    previousHost,
    overlayBadge,
    "overlay",
    "Portal overlay fallback activated"
  );
  startOverlayListeners();
  overlayResizeObserver?.observe(record.sourceElement);
  positionOverlays("Portal overlay fallback activated");
  registerBadgeVisibility(record.overlayBadge, record.sourceElement, record.anchor);
}

function handleExternalRemoval(record: LifecycleRecord): void {
  if (record.mode !== "inline" || record.intentionalRemoval) return;
  const rebound = rebindSource(record);
  if (!rebound || !isVisible(record.sourceElement)) {
    record.lastReason = "Inline owner subtree replaced";
    scheduleMissingSourceCleanup(record);
    return;
  }
  if (record.ownerReplacementPending) record.ownerReplacementCount++;
  else record.externalRemovalCount++;
  record.lastReason = record.ownerReplacementPending
    ? "Inline owner subtree replaced"
    : "Inline badge externally removed";
  const shouldFallback = record.externalRemovalCount >= 2 ||
    record.ownerReplacementCount >= 2 ||
    (record.equivalentSourceFound && record.externalRemovalCount >= 1);
  if (shouldFallback) {
    activateOverlay(record);
    return;
  }
  retryInline(record);
}

function verifyInlineRecord(record: LifecycleRecord, delayMs: number): void {
  if (record.mode !== "inline") return;
  record.lastVerifiedAt = now();
  record.verificationChecks.push({ delayMs, connected: record.badge.isConnected });
  if (!record.badge.isConnected && !record.intentionalRemoval) handleExternalRemoval(record);
}

function findRecordForCandidate(candidate: CurrencyDomMatch, targetCurrency: string): LifecycleRecord | undefined {
  const exact = recordsByKey.get(logicalKey(candidate, targetCurrency));
  if (exact) return exact;
  const rect = candidate.sourceElement.getBoundingClientRect();
  return [...recordsByKey.values()].find((record) =>
    record.targetCurrency === targetCurrency && record.amount === candidate.match.amount &&
    record.sourceCurrency === candidate.match.currency && normalize(record.raw) === normalize(candidate.match.raw) &&
    record.stableRoots.some((root) => root.isConnected && root.contains(candidate.sourceElement)) &&
    rectDistance(rect, record.lastRect) < 48
  );
}

export function registerInlineBadgeLifecycle(
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  badge: HTMLElement
): void {
  startCleanupListeners();
  const key = logicalKey(candidate, targetCurrency);
  const previous = findRecordForCandidate(candidate, targetCurrency);
  if (previous?.mode === "inline" && previous.badge === badge &&
      previous.sourceNodes.length === candidate.sourceNodes.length &&
      previous.sourceNodes.every((node, index) => node === candidate.sourceNodes[index])) {
    return;
  }
  if (previous?.mode === "overlay-fallback") {
    updateRecordFromCandidate(previous, candidate);
    badge.remove();
    scheduleOverlayPositions("Equivalent source rebound");
    return;
  }
  const record: LifecycleRecord = {
    logicalKey: key,
    mode: "inline",
    sourceNodes: [...candidate.sourceNodes],
    sourceElement: candidate.sourceElement,
    anchor: candidate.renderingAnchor,
    badge,
    stableRoots: stableRootsFor(candidate.renderingAnchor),
    parserInput: candidate.parserInput,
    raw: candidate.match.raw,
    start: candidate.match.start,
    end: candidate.match.end,
    amount: candidate.match.amount,
    sourceCurrency: candidate.match.currency,
    targetCurrency,
    scanKind: candidate.scanKind,
    fragmentMap: candidate.fragmentMap.map((fragment) => ({ ...fragment })),
    insertedAt: now(),
    lastVerifiedAt: now(),
    externalRemovalCount: previous?.externalRemovalCount ?? 0,
    ownerReplacementCount: previous?.ownerReplacementCount ?? 0,
    intentionalRemoval: false,
    externalRemovalPending: false,
    ownerReplacementPending: false,
    unstable: false,
    verificationChecks: previous?.verificationChecks ?? [],
    timers: new Set(),
    lastRect: candidate.sourceElement.getBoundingClientRect(),
    equivalentSourceFound: false,
    lastReason: "Inline badge inserted",
    overlayPlacement: null,
  };
  if (previous) clearTimers(previous);
  recordsByKey.delete(previous?.logicalKey ?? "");
  recordsByKey.set(key, record);
  recordsByBadge.set(badge, record);
  badge.dataset.eucRenderMode = "inline";
  scheduleVerification(record);
}

export function shouldSuppressInlineForLifecycle(
  candidate: CurrencyDomMatch,
  targetCurrency: string
): boolean {
  const record = findRecordForCandidate(candidate, targetCurrency);
  if (record?.mode !== "overlay-fallback") return false;
  updateRecordFromCandidate(record, candidate);
  scheduleOverlayPositions("Equivalent source rebound");
  return true;
}

export function handleBadgeLifecycleMutations(mutations: readonly MutationRecord[]): void {
  for (const record of recordsByKey.values()) {
    if (record.mode === "overlay-fallback") {
      if (mutations.some((mutation) => !isInsideExcludedContent(mutation.target))) {
        scheduleOverlayPositions("source-subtree-mutation");
      }
      continue;
    }
    let badgeRemoved = false;
    let ownerRemoved = false;
    for (const mutation of mutations) {
      for (const removed of mutation.removedNodes) {
        if (removed === record.badge || removed.contains(record.badge)) badgeRemoved = true;
        if (record.sourceNodes.some((source) => removed === source || removed.contains(source))) ownerRemoved = true;
      }
    }
    if (!badgeRemoved && !ownerRemoved) continue;
    record.externalRemovalPending = badgeRemoved;
    record.ownerReplacementPending = ownerRemoved;
    const timer = setTimeout(() => {
      record.timers.delete(timer);
      if (!record.intentionalRemoval && !record.badge.isConnected) handleExternalRemoval(record);
    }, 0);
    record.timers.add(timer);
  }
}

export function markBadgeRemovalIntentional(root: Node): void {
  const dispose: LifecycleRecord[] = [];
  for (const record of recordsByKey.values()) {
    const affectsInline = root === record.badge || root.contains(record.badge);
    const affectsOverlay = !!record.overlayBadge && (root === record.overlayBadge || root.contains(record.overlayBadge));
    if ((affectsInline || affectsOverlay) && !record.externalRemovalPending && !record.ownerReplacementPending) {
      record.intentionalRemoval = true;
      clearTimers(record);
      dispose.push(record);
    }
  }
  for (const record of dispose) disposeRecord(record);
}

export function clearBadgeLifecycles(root: ParentNode = document): void {
  for (const [key, record] of recordsByKey) {
    const affected = root === document || root === record.badge || root.contains(record.badge) ||
      (!!record.overlayBadge && (root === record.overlayBadge || root.contains(record.overlayBadge))) ||
      root.contains(record.sourceElement);
    if (!affected) continue;
    record.intentionalRemoval = true;
    clearTimers(record);
    record.badge.remove();
    unregisterBadgeHost(record.badge);
    forgetBadgeHost(record.badge);
    if (record.overlayBadge) {
      unregisterBadgeHost(record.overlayBadge);
      forgetBadgeHost(record.overlayBadge);
      record.overlayBadge.remove();
    }
    overlayResizeObserver?.unobserve(record.sourceElement);
    recordsByKey.delete(key);
    placementDiagnostics.delete(key);
  }
  stopOverlayListenersIfUnused();
}

export function getRenderLifecycleDiagnostics(): RenderLifecycleDiagnostic[] {
  return [...recordsByKey.values()].map((record) => ({
    logicalSourceKey: record.logicalKey,
    initialMode: "inline",
    finalMode: record.mode,
    inlineInsertSucceeded: true,
    inlineConnectedAfterInsert: record.verificationChecks[0]?.connected ?? record.badge.isConnected,
    verificationChecks: [...record.verificationChecks],
    removalIntentional: record.intentionalRemoval,
    sourceStillConnected: record.sourceNodes.every((node) => node.isConnected),
    equivalentSourceFound: record.equivalentSourceFound,
    externalRemovalCount: record.externalRemovalCount,
    ownerReplacementCount: record.ownerReplacementCount,
    markedUnstable: record.unstable,
    fallbackActivated: record.mode === "overlay-fallback",
    lastReason: record.lastReason,
  }));
}

export function getOverlayPlacementDiagnostics(): OverlayPlacementDiagnostic[] {
  return [...placementDiagnostics.values()].map((item) => ({
    ...item,
    sourceRect: { ...item.sourceRect }, badgeRect: { ...item.badgeRect },
    exactSourceRect: { ...item.exactSourceRect }, semanticSourceRect: { ...item.semanticSourceRect },
    candidates: item.candidates.map((candidate) => ({
      ...candidate, rect: { ...candidate.rect }, rejectionReasons: [...candidate.rejectionReasons],
    })),
  }));
}

export function getOverlayPlacementGroupDiagnostics(): OverlayPlacementGroupDiagnostic[] {
  return placementGroupDiagnostics.map((item) => ({
    ...item, sourceSelectors: [...item.sourceSelectors], placementOrder: [...item.placementOrder],
  }));
}

export function verifyBadgeLifecyclesNow(): void {
  for (const record of recordsByKey.values()) {
    if (record.mode === "inline") verifyInlineRecord(record, 0);
    else positionOverlays("manual-verification");
  }
}

export function scheduleOverlayPositionUpdate(reason = "manual"): void {
  scheduleOverlayPositions(reason);
}

export function cleanupMissingLifecycleSourcesNow(): void {
  for (const record of [...recordsByKey.values()]) {
    if (!rebindSource(record)) disposeRecord(record);
  }
}
