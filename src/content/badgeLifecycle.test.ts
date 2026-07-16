import { Window } from "happy-dom";
import type { CurrencyMatch } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";
import { renderConversions, resetRenderedConversions } from "./domRenderer";
import {
  clearBadgeLifecycles,
  cleanupMissingLifecycleSourcesNow,
  getOverlayPlacementDiagnostics,
  getRenderLifecycleDiagnostics,
  handleBadgeLifecycleMutations,
  scheduleOverlayPositionUpdate,
  verifyBadgeLifecyclesNow,
} from "./badgeLifecycle";
import { reconcileBadgeVisibility } from "./badgeVisibility";
import { getBadgeVisibleText } from "./badgeManager";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  DOMRect: window.DOMRect,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDialogElement: window.HTMLDialogElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
});

let sourceRect = new window.DOMRect(10, 20, 100, 20);
const badgeRect = new window.DOMRect(116, 20, 52, 18);
Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value(this: HTMLElement) {
    return this.matches('[data-ehinium-badge="true"]') ? badgeRect : sourceRect;
  },
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function createRoot(html: string): HTMLElement {
  clearBadgeLifecycles(document);
  document.body.innerHTML = "";
  sourceRect = new window.DOMRect(10, 20, 100, 20);
  const root = document.createElement("main");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function render(root: HTMLElement): number {
  return renderConversions(getTextNodes(root), {
    enabled: true,
    targetCurrency: "USD",
    converterMode: "currencies",
    badgeStyle: "default",
    badgeVisibility: "always",
    unitSystem: "metric",
    targetLengthUnit: "auto",
    targetWeightUnit: "auto",
    targetTemperatureUnit: "auto",
    convertAmount: (match: CurrencyMatch) => match.amount / 10,
  });
}

function removedRecord(target: Node, removed: Node, added?: Node): MutationRecord {
  return {
    type: "childList",
    target,
    addedNodes: added ? [added] : [],
    removedNodes: [removed],
  } as unknown as MutationRecord;
}

function stripInlineBadge(): HTMLElement {
  const badge = document.querySelector<HTMLElement>('[data-ehinium-badge="true"]')!;
  badge.remove();
  verifyBadgeLifecyclesNow();
  return badge;
}

{
  const root = createRoot("<span>338 TL</span>");
  render(root);
  expectEqual(root.querySelectorAll('[data-ehinium-badge="true"]').length, 1, "stable inline badge count");
  expectEqual(document.querySelectorAll('[data-euc-overlay-root="true"]').length, 0, "stable source has no overlay root");
  expectEqual(getRenderLifecycleDiagnostics()[0]?.finalMode, "inline", "stable source render mode");

  const unrelated = document.createElement("div");
  root.append(unrelated);
  handleBadgeLifecycleMutations([{
    type: "childList", target: root, addedNodes: [unrelated], removedNodes: [],
  } as unknown as MutationRecord]);
  verifyBadgeLifecyclesNow();
  expectEqual(getRenderLifecycleDiagnostics()[0]?.finalMode, "inline", "unrelated mutation remains inline");
}

{
  const root = createRoot("<span>338 TL</span>");
  render(root);
  const original = root.querySelector<HTMLElement>('[data-ehinium-badge="true"]')!;
  stripInlineBadge();
  expectEqual(original.isConnected, true, "first external removal retries inline");
  expectEqual(getRenderLifecycleDiagnostics()[0]?.externalRemovalCount, 1, "first external removal count");
  expectEqual(getRenderLifecycleDiagnostics()[0]?.finalMode, "inline", "first removal remains inline");

  original.remove();
  verifyBadgeLifecyclesNow();
  expectEqual(getRenderLifecycleDiagnostics()[0]?.finalMode, "overlay-fallback", "second removal activates fallback");
  expectEqual(root.querySelectorAll('[data-ehinium-badge="true"]').length, 0, "fallback has no inline badge");
  expectEqual(document.querySelectorAll('[data-euc-overlay-root="true"]').length, 1, "one overlay root");
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 1, "one overlay badge");
  const overlay = document.querySelector<HTMLElement>('[data-euc-overlay-badge="true"]')!;
  const overlayRoot = document.querySelector<HTMLElement>('[data-euc-overlay-root="true"]')!;
  expectEqual(overlayRoot.getAttribute("translate"), "no", "overlay root translation disabled");
  expectEqual(overlayRoot.classList.contains("notranslate"), true, "overlay root notranslate marker");
  expectEqual(overlay.dataset.eucBadgeHost, "true", "overlay uses protected badge host");
  expectEqual(overlay.childNodes.length, 0, "overlay host light DOM remains empty");
  expectEqual(getBadgeVisibleText(overlay), "$33.80", "overlay preserves shadow badge value");
  expectEqual(overlay.style.pointerEvents, "none", "overlay badge pointer events");
  expectEqual(overlay.hasAttribute("tabindex"), false, "overlay badge is not focusable");
  expectEqual(overlay.hasAttribute("role"), false, "overlay badge has no accessibility role");
  expectEqual(overlay.style.left, "116px", "overlay range-adjacent left position");
  expectEqual(getOverlayPlacementDiagnostics()[0]?.rangeValid, true, "overlay range is valid");

  const source = root.querySelector<HTMLElement>("span")!;
  source.style.display = "none";
  verifyBadgeLifecyclesNow();
  expectEqual(overlay.style.visibility, "hidden", "overlay hides with hidden source");
  source.style.display = "";
  verifyBadgeLifecyclesNow();
  expectEqual(overlay.style.visibility, "", "overlay returns with visible source");

  sourceRect = new window.DOMRect(30, 40, 100, 20);
  scheduleOverlayPositionUpdate("scroll");
  await new Promise((resolve) => setTimeout(resolve, 5));
  expectEqual(overlay.style.left, "136px", "overlay position updates after geometry change");

  const outside = document.createElement("section");
  document.body.append(outside);
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: outside });
  reconcileBadgeVisibility("fullscreen");
  expectEqual(overlay.style.visibility, "hidden", "fullscreen suppresses overlay badge");
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  reconcileBadgeVisibility("fullscreen");
  expectEqual(overlay.style.visibility, "", "overlay badge returns after fullscreen");
}

{
  const root = createRoot('<div class="host"><span>338 TL</span></div>');
  render(root);
  const host = root.querySelector<HTMLElement>(".host")!;
  const oldOwner = host.firstElementChild!;
  const replacement = document.createElement("span");
  replacement.textContent = "338 TL";
  oldOwner.replaceWith(replacement);
  handleBadgeLifecycleMutations([removedRecord(host, oldOwner, replacement)]);
  verifyBadgeLifecyclesNow();
  expectEqual(getRenderLifecycleDiagnostics()[0]?.ownerReplacementCount, 1, "first owner replacement count");
  expectEqual(getRenderLifecycleDiagnostics()[0]?.equivalentSourceFound, true, "replacement source rebound");
  expectEqual(getRenderLifecycleDiagnostics()[0]?.finalMode, "inline", "single owner replacement stays inline");
  expectEqual(replacement.querySelectorAll('[data-ehinium-badge="true"]').length, 1, "replacement owns rebound inline badge");

  const replacementTwo = document.createElement("span");
  replacementTwo.textContent = "338 TL";
  replacement.replaceWith(replacementTwo);
  handleBadgeLifecycleMutations([removedRecord(host, replacement, replacementTwo)]);
  verifyBadgeLifecyclesNow();
  expectEqual(getRenderLifecycleDiagnostics()[0]?.finalMode, "overlay-fallback", "repeated owner replacement activates fallback");
  render(root);
  expectEqual(replacementTwo.querySelectorAll('[data-ehinium-badge="true"]').length, 0, "fallback prevents inline recreation");
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 1, "replacement reuses one overlay badge");
  const activeOverlay = document.querySelector<HTMLElement>('[data-euc-overlay-badge="true"]');
  const replacementThree = document.createElement("span");
  replacementThree.textContent = "338 TL";
  replacementTwo.replaceWith(replacementThree);
  handleBadgeLifecycleMutations([removedRecord(host, replacementTwo, replacementThree)]);
  verifyBadgeLifecyclesNow();
  reconcileBadgeVisibility("manual");
  expectEqual(document.querySelector('[data-euc-overlay-badge="true"]'), activeOverlay, "overlay source replacement reuses badge");
  expectEqual(activeOverlay?.style.visibility, "", "rebound overlay visibility uses current source");
}

{
  const root = createRoot("<span class=\"one\">338 TL</span><span class=\"two\">448 TL</span>");
  render(root);
  for (const badge of [...root.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')]) badge.remove();
  verifyBadgeLifecyclesNow();
  for (const badge of [...root.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')]) badge.remove();
  verifyBadgeLifecyclesNow();
  expectEqual(document.querySelectorAll('[data-euc-overlay-root="true"]').length, 1, "multiple overlays share one root");
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 2, "two unstable sources have two overlay badges");
}

{
  const root = createRoot("<span><b>338</b><i> TL</i></span>");
  render(root);
  stripInlineBadge().remove();
  verifyBadgeLifecyclesNow();
  expectEqual(getOverlayPlacementDiagnostics()[0]?.rangeValid, true, "split price overlay uses mapped DOM range");
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 1, "split price fallback badge count");
}

{
  const root = createRoot("<span>338 TL</span>");
  render(root);
  stripInlineBadge().remove();
  verifyBadgeLifecyclesNow();
  root.querySelector("span")?.remove();
  cleanupMissingLifecycleSourcesNow();
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 0, "overlay removed when source disappears");
  expectEqual(getRenderLifecycleDiagnostics().length, 0, "missing source lifecycle removed");
}

{
  const root = createRoot("<span>338 TL</span>");
  render(root);
  stripInlineBadge().remove();
  verifyBadgeLifecyclesNow();
  root.querySelector("span")!.firstChild!.textContent = "448 TL";
  cleanupMissingLifecycleSourcesNow();
  render(root);
  expectEqual(document.querySelectorAll('[data-ehinium-badge="true"]').length, 1, "changed amount has one current badge");
  expectEqual(getBadgeVisibleText(document.querySelector<HTMLElement>('[data-ehinium-badge="true"]')), "$44.80", "changed amount badge value");
}

{
  const root = createRoot("<button type=\"button\">338 TL</button>");
  let clicks = 0;
  root.querySelector("button")?.addEventListener("click", () => clicks++);
  render(root);
  stripInlineBadge().remove();
  verifyBadgeLifecyclesNow();
  root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event);
  expectEqual(clicks, 1, "button remains clickable under passive overlay");
}

{
  const root = createRoot("<span>338 TL</span>");
  render(root);
  resetRenderedConversions(document);
  verifyBadgeLifecyclesNow();
  expectEqual(getRenderLifecycleDiagnostics().length, 0, "intentional cleanup removes lifecycle records");
  expectEqual(document.querySelectorAll('[data-euc-overlay-root="true"]').length, 0, "intentional cleanup removes overlay root");
}

clearBadgeLifecycles(document);
