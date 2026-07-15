import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "https://example.test/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDialogElement: window.HTMLDialogElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  DOMRect: window.DOMRect,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  },
});
(globalThis as typeof globalThis & { __EUC_DIAGNOSTICS__: boolean }).__EUC_DIAGNOSTICS__ = true;

const {
  clearBadgeVisibilityRecords,
  getBadgeVisibilityDiagnostics,
  reconcileBadgeVisibility,
  registerBadgeVisibility,
  stopBadgeVisibilityManager,
} = await import("./badgeVisibility");

type RectInput = { x: number; y: number; width: number; height: number };

function setRect(element: Element, input: RectInput): void {
  const rect = new window.DOMRect(input.x, input.y, input.width, input.height);
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function createPrice(id: string, rect: RectInput): {
  source: HTMLElement;
  badge: HTMLElement;
} {
  const source = document.createElement("span");
  source.id = id;
  source.textContent = "AED 120";
  const badge = document.createElement("span");
  badge.className = "ehinium-converter-badge";
  badge.dataset.ehiniumBadge = "true";
  badge.dataset.ehiniumConverted = "true";
  badge.textContent = "$32.68";
  source.after(badge);
  setRect(source, rect);
  setRect(badge, { x: rect.x + rect.width, y: rect.y, width: 50, height: rect.height });
  return { source, badge };
}

function reset(): void {
  stopBadgeVisibilityManager();
  clearBadgeVisibilityRecords(document);
  document.body.replaceChildren();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [],
  });
}

function createFixedOverlay(rect: RectInput): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
    pointerEvents: "auto",
    background: "black",
  });
  setRect(overlay, rect);
  return overlay;
}

// A full viewport overlay suppresses and restores the same locally positioned badge.
reset();
const fullPrice = createPrice("page-price", { x: 100, y: 100, width: 80, height: 20 });
document.body.append(fullPrice.source, fullPrice.badge);
const fullscreenOverlay = createFixedOverlay({ x: 0, y: 0, width: 1024, height: 768 });
document.body.append(fullscreenOverlay);
Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [fullscreenOverlay, fullPrice.badge, fullPrice.source] });
registerBadgeVisibility(fullPrice.badge, fullPrice.source, fullPrice.source);
reconcileBadgeVisibility("manual");
assert.equal(fullPrice.badge.style.visibility, "hidden");
assert.equal(fullPrice.badge.style.zIndex, "");
fullscreenOverlay.style.display = "none";
reconcileBadgeVisibility("manual");
assert.equal(fullPrice.badge.style.visibility, "");
assert.equal(document.querySelectorAll('[data-ehinium-badge="true"]').length, 1);

// A partial drawer hides only the price it actually covers.
reset();
const leftPrice = createPrice("left-price", { x: 80, y: 120, width: 70, height: 20 });
const rightPrice = createPrice("right-price", { x: 800, y: 120, width: 70, height: 20 });
document.body.append(leftPrice.source, leftPrice.badge, rightPrice.source, rightPrice.badge);
const drawer = createFixedOverlay({ x: 700, y: 0, width: 324, height: 768 });
document.body.append(drawer);
Object.defineProperty(document, "elementsFromPoint", {
  configurable: true,
  value: (x: number) => x >= 700 ? [drawer, rightPrice.badge, rightPrice.source] : [leftPrice.source],
});
registerBadgeVisibility(leftPrice.badge, leftPrice.source, leftPrice.source);
registerBadgeVisibility(rightPrice.badge, rightPrice.source, rightPrice.source);
reconcileBadgeVisibility("manual");
assert.equal(leftPrice.badge.style.visibility, "");
assert.equal(rightPrice.badge.style.visibility, "hidden");

// Semantic portal dialogs hide background badges but keep badges whose source is inside.
reset();
const backgroundPrice = createPrice("background-price", { x: 100, y: 100, width: 70, height: 20 });
document.body.append(backgroundPrice.source, backgroundPrice.badge);
const dialog = document.createElement("div");
dialog.setAttribute("role", "dialog");
dialog.setAttribute("aria-modal", "true");
setRect(dialog, { x: 50, y: 50, width: 900, height: 650 });
const dialogPrice = createPrice("dialog-price", { x: 200, y: 200, width: 70, height: 20 });
dialog.append(dialogPrice.source, dialogPrice.badge);
document.body.append(dialog);
Object.defineProperty(document, "elementsFromPoint", {
  configurable: true,
  value: (x: number, y: number) => x >= 190 && y >= 190
    ? [dialogPrice.source, dialog]
    : [dialog, backgroundPrice.source],
});
registerBadgeVisibility(backgroundPrice.badge, backgroundPrice.source, backgroundPrice.source);
registerBadgeVisibility(dialogPrice.badge, dialogPrice.source, dialogPrice.source);
reconcileBadgeVisibility("manual");
assert.equal(backgroundPrice.badge.style.visibility, "hidden");
assert.equal(dialogPrice.badge.style.visibility, "");

// Fullscreen containment is authoritative and restores on exit.
reset();
const media = document.createElement("div");
const insidePrice = createPrice("inside-fullscreen", { x: 200, y: 200, width: 70, height: 20 });
const outsidePrice = createPrice("outside-fullscreen", { x: 50, y: 50, width: 70, height: 20 });
media.append(insidePrice.source, insidePrice.badge);
document.body.append(media, outsidePrice.source, outsidePrice.badge);
Object.defineProperty(document, "fullscreenElement", { configurable: true, value: media });
registerBadgeVisibility(insidePrice.badge, insidePrice.source, insidePrice.source);
registerBadgeVisibility(outsidePrice.badge, outsidePrice.source, outsidePrice.source);
reconcileBadgeVisibility("fullscreen");
assert.equal(insidePrice.badge.style.visibility, "");
assert.equal(outsidePrice.badge.style.visibility, "hidden");
Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
reconcileBadgeVisibility("fullscreen");
assert.equal(outsidePrice.badge.style.visibility, "");

// Transparent pointer-events:none layers are not treated as occluding overlays.
reset();
const transparentPrice = createPrice("transparent-price", { x: 100, y: 100, width: 70, height: 20 });
document.body.append(transparentPrice.source, transparentPrice.badge);
const transparentLayer = createFixedOverlay({ x: 0, y: 0, width: 1024, height: 768 });
transparentLayer.style.pointerEvents = "none";
transparentLayer.style.background = "transparent";
document.body.append(transparentLayer);
registerBadgeVisibility(transparentPrice.badge, transparentPrice.source, transparentPrice.source);
reconcileBadgeVisibility("manual");
assert.equal(transparentPrice.badge.style.visibility, "");

// Repeated open/close is visibility-only and remains idempotent.
reset();
const repeatedPrice = createPrice("repeated-price", { x: 100, y: 100, width: 70, height: 20 });
document.body.append(repeatedPrice.source, repeatedPrice.badge);
const repeatedOverlay = createFixedOverlay({ x: 0, y: 0, width: 1024, height: 768 });
document.body.append(repeatedOverlay);
Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [repeatedOverlay, repeatedPrice.source] });
registerBadgeVisibility(repeatedPrice.badge, repeatedPrice.source, repeatedPrice.source);
reconcileBadgeVisibility("manual");
for (let index = 0; index < 20; index++) {
  repeatedOverlay.style.display = "block";
  reconcileBadgeVisibility("mutation");
  assert.equal(repeatedPrice.badge.style.visibility, "hidden");
  repeatedOverlay.style.display = "none";
  reconcileBadgeVisibility("mutation");
  assert.equal(repeatedPrice.badge.style.visibility, "");
}
assert.equal(document.querySelectorAll('[data-ehinium-badge="true"]').length, 1);
assert.equal(getBadgeVisibilityDiagnostics().at(-1)?.visibilityReason, "visible");

// Bounded performance fixture: 100 badges and several popovers.
reset();
const performanceOverlay = createFixedOverlay({ x: 700, y: 0, width: 324, height: 768 });
document.body.append(performanceOverlay);
for (let index = 0; index < 100; index++) {
  const price = createPrice(`performance-${index}`, {
    x: index % 2 === 0 ? 100 : 800,
    y: (index % 30) * 20,
    width: 60,
    height: 16,
  });
  document.body.append(price.source, price.badge);
  registerBadgeVisibility(price.badge, price.source, price.source);
}
Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: (x: number) => x >= 700 ? [performanceOverlay] : [] });
reconcileBadgeVisibility("manual");
const startedAt = performance.now();
for (let index = 0; index < 40; index++) reconcileBadgeVisibility(index % 2 ? "scroll" : "mutation");
const elapsed = performance.now() - startedAt;
assert.ok(elapsed < 2000, `Visibility stress fixture took ${elapsed.toFixed(1)} ms`);
console.log(`Badge visibility regressions passed; 100 badges × 40 reconciliations in ${elapsed.toFixed(1)} ms.`);

stopBadgeVisibilityManager();
