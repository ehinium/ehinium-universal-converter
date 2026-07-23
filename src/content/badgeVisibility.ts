export type BadgeVisibilityReason =
  | "visible"
  | "source-disconnected"
  | "source-hidden"
  | "source-outside-viewport"
  | "covered-by-modal"
  | "covered-by-overlay"
  | "outside-fullscreen-element"
  | "source-clipped"
  | "stale-anchor";

export type BadgeVisibilityTrigger =
  | "registration"
  | "mutation"
  | "resize"
  | "scroll"
  | "visual-viewport"
  | "fullscreen"
  | "toggle"
  | "manual";

export type BadgeVisibilityDiagnostic = {
  sourceSelector: string;
  renderingAnchorSelector: string;
  badgeRect: RectSnapshot;
  sourceRect: RectSnapshot;
  activeFullscreenElement?: string;
  detectedOverlays: Array<{
    selector: string;
    rect: RectSnapshot;
    semanticType: OverlaySemanticType;
  }>;
  hitTestResult: string[];
  coveringElement?: string;
  visible: boolean;
  visibilityReason: BadgeVisibilityReason;
  previousVisibilityReason: BadgeVisibilityReason;
  reconciliationTrigger: BadgeVisibilityTrigger;
  reconciledAt: string;
  warnings: string[];
};

type RectSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type OverlaySemanticType =
  | "native-dialog"
  | "aria-modal"
  | "dialog"
  | "popover"
  | "fixed-overlay";

type BadgeRecord = {
  badge: HTMLElement;
  source: HTMLElement;
  anchor: HTMLElement;
  visible: boolean;
  reason: BadgeVisibilityReason;
  previousReason: BadgeVisibilityReason;
  lastSourceRect: RectSnapshot;
  lastReconciliationTime: number;
  lastDiagnostic?: BadgeVisibilityDiagnostic;
};

type ActiveOverlay = {
  element: HTMLElement;
  rect: DOMRect;
  semanticType: OverlaySemanticType;
};

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';
const EXTENSION_OWNED_SELECTOR = [
  BADGE_SELECTOR,
  '[data-ehinium-converted="true"]',
  '[data-ehinium-ignore="true"]',
  "[data-ehinium-tooltip]",
  '[data-euc-owned="true"]',
  '[data-euc-badge="true"]',
].join(", ");
const SEMANTIC_OVERLAY_SELECTOR = [
  "dialog[open]",
  '[role="dialog"]',
  '[aria-modal="true"]',
  "[popover]",
].join(", ");
const MAX_MUTATION_CANDIDATES = 300;
const MAX_STYLE_ANCESTORS = 16;
const records = new Map<HTMLElement, BadgeRecord>();
const overlayCandidates = new Set<HTMLElement>();

let started = false;
let scheduledFrame: number | null = null;
let pendingTrigger: BadgeVisibilityTrigger = "manual";
let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

function diagnosticsEnabled(): boolean {
  return typeof __EUC_DIAGNOSTICS__ !== "undefined" && __EUC_DIAGNOSTICS__;
}

function snapshotRect(rect: DOMRect | DOMRectReadOnly): RectSnapshot {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function selectorFor(element: Element | null): string {
  if (!element) return "(none)";
  if (element.id) return `#${element.id}`;
  const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join("");
  return `${element.tagName.toLowerCase()}${classes}`;
}

function isExtensionOwned(element: Element): boolean {
  return element.matches(EXTENSION_OWNED_SELECTOR) || element.closest(EXTENSION_OWNED_SELECTOR) !== null;
}

function rectHasArea(rect: DOMRect | DOMRectReadOnly): boolean {
  return rect.width > 0 && rect.height > 0;
}

function rectsIntersect(first: DOMRect, second: DOMRect): boolean {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

function viewportRect(): DOMRect {
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  return new DOMRect(0, 0, width, height);
}

function getOverlaySemanticType(element: HTMLElement, style: CSSStyleDeclaration): OverlaySemanticType | null {
  if (element instanceof HTMLDialogElement && element.open) return "native-dialog";
  if (element.getAttribute("aria-modal") === "true") return "aria-modal";
  if (element.getAttribute("role") === "dialog") return "dialog";
  try {
    if (element.matches(":popover-open")) return "popover";
  } catch {
    // The browser does not support the popover pseudo-class.
  }
  return style.position === "fixed" ? "fixed-overlay" : null;
}

function isVisibleOverlayCandidate(element: HTMLElement): ActiveOverlay | null {
  if (!element.isConnected || isExtensionOwned(element)) return null;
  const style = getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    Number(style.opacity || "1") <= 0.01 ||
    style.pointerEvents === "none"
  ) {
    return null;
  }
  const semanticType = getOverlaySemanticType(element, style);
  if (!semanticType) return null;
  const rect = element.getBoundingClientRect();
  if (!rectHasArea(rect) || !rectsIntersect(rect, viewportRect())) return null;
  return { element, rect, semanticType };
}

function seedOverlayCandidates(root: ParentNode = document): void {
  if (root instanceof HTMLElement) overlayCandidates.add(root);
  for (const element of root.querySelectorAll<HTMLElement>(SEMANTIC_OVERLAY_SELECTOR)) {
    overlayCandidates.add(element);
  }
  const bodyChildren = document.body?.children ?? [];
  for (const child of [...bodyChildren].slice(0, MAX_MUTATION_CANDIDATES)) {
    if (child instanceof HTMLElement) overlayCandidates.add(child);
  }
}

function collectAddedCandidates(node: Node): void {
  if (!(node instanceof HTMLElement) || isExtensionOwned(node)) return;
  overlayCandidates.add(node);
  let count = 0;
  for (const element of node.querySelectorAll<HTMLElement>(SEMANTIC_OVERLAY_SELECTOR)) {
    overlayCandidates.add(element);
    count++;
    if (count >= MAX_MUTATION_CANDIDATES) break;
  }
}

function getActiveOverlays(): ActiveOverlay[] {
  const active: ActiveOverlay[] = [];
  for (const candidate of overlayCandidates) {
    if (!candidate.isConnected) {
      overlayCandidates.delete(candidate);
      continue;
    }
    const overlay = isVisibleOverlayCandidate(candidate);
    if (overlay) active.push(overlay);
  }
  return active;
}

function getHiddenReason(source: HTMLElement): BadgeVisibilityReason | null {
  if (!source.isConnected) return "source-disconnected";
  // aria-hidden is an accessibility-tree hint and does not imply that an
  // element is visually hidden. Retailers commonly apply it to visible price
  // glyph layers while exposing a separate semantic copy to assistive tech.
  if (source.closest("[inert]")) return "source-hidden";
  let current: HTMLElement | null = source;
  let depth = 0;
  while (current && depth < MAX_STYLE_ANCESTORS) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number(style.opacity || "1") <= 0.01
    ) {
      return "source-hidden";
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

function isFullyClipped(source: HTMLElement, sourceRect: DOMRect): boolean {
  let current = source.parentElement;
  let depth = 0;
  let visibleRect = sourceRect;
  while (current && depth < MAX_STYLE_ANCESTORS) {
    const style = getComputedStyle(current);
    if (/(?:hidden|clip)/u.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
      const clip = current.getBoundingClientRect();
      const left = Math.max(visibleRect.left, clip.left);
      const right = Math.min(visibleRect.right, clip.right);
      const top = Math.max(visibleRect.top, clip.top);
      const bottom = Math.min(visibleRect.bottom, clip.bottom);
      if (right <= left || bottom <= top) return true;
      visibleRect = new DOMRect(left, top, right - left, bottom - top);
    }
    current = current.parentElement;
    depth++;
  }
  return false;
}

function pointAtCenter(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function coveringOverlayAtPoint(
  point: { x: number; y: number },
  source: HTMLElement,
  overlays: readonly ActiveOverlay[]
): { overlay?: ActiveOverlay; covering?: Element; hitStack: Element[] } {
  const applicable = overlays.filter(
    (overlay) =>
      !overlay.element.contains(source) &&
      point.x >= overlay.rect.left && point.x <= overlay.rect.right &&
      point.y >= overlay.rect.top && point.y <= overlay.rect.bottom
  );
  if (applicable.length === 0) return { hitStack: [] };
  const hitStack = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(point.x, point.y).filter((element) => !isExtensionOwned(element))
    : [];
  for (const hit of hitStack) {
    if (hit === source || source.contains(hit)) return { hitStack };
    const overlay = applicable.find(
      (candidate) => candidate.element === hit || candidate.element.contains(hit)
    );
    if (overlay) return { overlay, covering: hit, hitStack };
  }
  const semantic = applicable.find((overlay) => overlay.semanticType !== "fixed-overlay");
  return semantic ? { overlay: semantic, covering: semantic.element, hitStack } : { hitStack };
}

function decideVisibility(
  record: BadgeRecord,
  overlays: readonly ActiveOverlay[]
): {
  reason: BadgeVisibilityReason;
  sourceRect: DOMRect;
  badgeRect: DOMRect;
  covering?: Element;
  hitStack: Element[];
} {
  const emptyRect = new DOMRect();
  if (!record.badge.isConnected || !record.anchor.isConnected) {
    return { reason: "stale-anchor", sourceRect: emptyRect, badgeRect: emptyRect, hitStack: [] };
  }
  const hiddenReason = getHiddenReason(record.source);
  if (hiddenReason) return { reason: hiddenReason, sourceRect: emptyRect, badgeRect: emptyRect, hitStack: [] };
  const sourceRect = record.source.getBoundingClientRect();
  const badgeRect = record.badge.getBoundingClientRect();
  if (!rectHasArea(sourceRect)) return { reason: "source-hidden", sourceRect, badgeRect, hitStack: [] };
  if (!rectsIntersect(sourceRect, viewportRect())) {
    return { reason: "source-outside-viewport", sourceRect, badgeRect, hitStack: [] };
  }
  if (isFullyClipped(record.source, sourceRect)) {
    return { reason: "source-clipped", sourceRect, badgeRect, hitStack: [] };
  }
  const fullscreen = document.fullscreenElement;
  if (fullscreen && !fullscreen.contains(record.source)) {
    return { reason: "outside-fullscreen-element", sourceRect, badgeRect, covering: fullscreen, hitStack: [] };
  }
  for (const point of [pointAtCenter(sourceRect), pointAtCenter(badgeRect)]) {
    const hit = coveringOverlayAtPoint(point, record.source, overlays);
    if (hit.overlay) {
      return {
        reason: hit.overlay.semanticType === "fixed-overlay" ? "covered-by-overlay" : "covered-by-modal",
        sourceRect,
        badgeRect,
        covering: hit.covering,
        hitStack: hit.hitStack,
      };
    }
  }
  return { reason: "visible", sourceRect, badgeRect, hitStack: [] };
}

function applyVisibility(record: BadgeRecord, reason: BadgeVisibilityReason): void {
  const visible = reason === "visible";
  record.previousReason = record.reason;
  record.reason = reason;
  record.visible = visible;
  record.badge.style.visibility = visible ? "" : "hidden";
  record.badge.style.pointerEvents = visible ? "auto" : "none";
  record.badge.setAttribute("aria-hidden", visible ? "false" : "true");
}

function getDiagnosticWarnings(
  record: BadgeRecord,
  reason: BadgeVisibilityReason,
  covering: Element | undefined
): string[] {
  const warnings: string[] = [];
  const badgeZIndex = Number.parseInt(getComputedStyle(record.badge).zIndex, 10);
  const sourceZIndex = Number.parseInt(getComputedStyle(record.source).zIndex, 10);
  if (Number.isFinite(badgeZIndex) && badgeZIndex > (Number.isFinite(sourceZIndex) ? sourceZIndex : 0) + 100) {
    warnings.push("Badge stacking level is much higher than its source context");
  }
  if (reason === "visible" && document.fullscreenElement && !document.fullscreenElement.contains(record.source)) {
    warnings.push("Badge is visible outside the active fullscreen element");
  }
  if (reason === "visible" && covering) {
    warnings.push("Badge is visible while its source center is covered by an overlay");
  }
  return warnings;
}

export function reconcileBadgeVisibility(trigger: BadgeVisibilityTrigger = "manual"): void {
  if (trigger === "manual") seedOverlayCandidates();
  const overlays = getActiveOverlays();
  const now = Date.now();
  for (const [badge, record] of records) {
    if (!badge.isConnected) {
      records.delete(badge);
      resizeObserver?.unobserve(record.source);
      continue;
    }
    const decision = decideVisibility(record, overlays);
    applyVisibility(record, decision.reason);
    record.lastSourceRect = snapshotRect(decision.sourceRect);
    record.lastReconciliationTime = now;
    if (diagnosticsEnabled()) {
      record.lastDiagnostic = {
        sourceSelector: selectorFor(record.source),
        renderingAnchorSelector: selectorFor(record.anchor),
        badgeRect: snapshotRect(decision.badgeRect),
        sourceRect: snapshotRect(decision.sourceRect),
        activeFullscreenElement: document.fullscreenElement
          ? selectorFor(document.fullscreenElement)
          : undefined,
        detectedOverlays: overlays.map((overlay) => ({
          selector: selectorFor(overlay.element),
          rect: snapshotRect(overlay.rect),
          semanticType: overlay.semanticType,
        })),
        hitTestResult: decision.hitStack.map(selectorFor),
        coveringElement: decision.covering ? selectorFor(decision.covering) : undefined,
        visible: decision.reason === "visible",
        visibilityReason: decision.reason,
        previousVisibilityReason: record.previousReason,
        reconciliationTrigger: trigger,
        reconciledAt: new Date(now).toISOString(),
        warnings: getDiagnosticWarnings(record, decision.reason, decision.covering),
      };
    }
  }
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(performance.now()), 0) as unknown as number;
}

export function scheduleBadgeVisibilityReconciliation(trigger: BadgeVisibilityTrigger): void {
  pendingTrigger = trigger;
  if (scheduledFrame !== null) return;
  scheduledFrame = requestFrame(() => {
    scheduledFrame = null;
    reconcileBadgeVisibility(pendingTrigger);
  });
}

export function registerBadgeVisibility(
  badge: HTMLElement,
  source: HTMLElement,
  anchor: HTMLElement
): void {
  const previous = records.get(badge);
  if (previous && previous.source !== source) resizeObserver?.unobserve(previous.source);
  const record: BadgeRecord = {
    badge,
    source,
    anchor,
    visible: true,
    reason: "visible",
    previousReason: "visible",
    lastSourceRect: snapshotRect(source.getBoundingClientRect()),
    lastReconciliationTime: 0,
  };
  records.set(badge, record);
  resizeObserver?.observe(source);
  if (started) {
    scheduleBadgeVisibilityReconciliation("registration");
  }
}

function onMutation(mutations: MutationRecord[]): void {
  let relevant = false;
  for (const mutation of mutations) {
    if (mutation.target instanceof Element && isExtensionOwned(mutation.target)) continue;
    relevant = true;
    if (mutation.target instanceof HTMLElement) overlayCandidates.add(mutation.target);
    for (const node of mutation.addedNodes) collectAddedCandidates(node);
  }
  if (relevant) scheduleBadgeVisibilityReconciliation("mutation");
}

export function startBadgeVisibilityManager(): void {
  if (started) return;
  started = true;
  seedOverlayCandidates();
  mutationObserver = new MutationObserver(onMutation);
  mutationObserver.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "class", "style", "hidden", "aria-hidden", "aria-modal", "role", "popover", "inert"],
  });
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => scheduleBadgeVisibilityReconciliation("resize"));
    for (const record of records.values()) resizeObserver.observe(record.source);
  }
  document.addEventListener("fullscreenchange", onFullscreenChange, true);
  document.addEventListener("toggle", onToggle, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize, true);
  window.visualViewport?.addEventListener("scroll", onVisualViewport);
  window.visualViewport?.addEventListener("resize", onVisualViewport);
  scheduleBadgeVisibilityReconciliation("registration");
}

function onFullscreenChange(): void { scheduleBadgeVisibilityReconciliation("fullscreen"); }
function onToggle(): void { seedOverlayCandidates(); scheduleBadgeVisibilityReconciliation("toggle"); }
function onScroll(): void { scheduleBadgeVisibilityReconciliation("scroll"); }
function onResize(): void { scheduleBadgeVisibilityReconciliation("resize"); }
function onVisualViewport(): void { scheduleBadgeVisibilityReconciliation("visual-viewport"); }

export function stopBadgeVisibilityManager(): void {
  if (!started) return;
  started = false;
  mutationObserver?.disconnect();
  mutationObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  document.removeEventListener("fullscreenchange", onFullscreenChange, true);
  document.removeEventListener("toggle", onToggle, true);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onResize, true);
  window.visualViewport?.removeEventListener("scroll", onVisualViewport);
  window.visualViewport?.removeEventListener("resize", onVisualViewport);
}

export function getBadgeVisibilityDiagnostics(): BadgeVisibilityDiagnostic[] {
  return [...records.values()]
    .map((record) => record.lastDiagnostic)
    .filter((item): item is BadgeVisibilityDiagnostic => item !== undefined);
}

export function clearBadgeVisibilityRecords(root: ParentNode = document): void {
  for (const [badge, record] of records) {
    if (root === document || root === badge || root.contains(badge)) {
      resizeObserver?.unobserve(record.source);
      records.delete(badge);
    }
  }
}
