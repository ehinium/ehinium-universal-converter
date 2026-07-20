import { Window } from "happy-dom";
import type { CurrencyMatch } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";
import {
  clearBadgeLifecycles,
  handleBadgeLifecycleMutations,
  markBadgeRemovalIntentional,
} from "./badgeLifecycle";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  DOMRect: window.DOMRect,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});

const visibleRect = new window.DOMRect(10, 20, 100, 20);
Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => visibleRect,
});

function expect(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description);
}

const root = document.createElement("main");
root.innerHTML = "<span>338 TL</span>";
document.body.append(root);
renderConversions(getTextNodes(root), {
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

const badge = root.querySelector<HTMLElement>('[data-ehinium-badge="true"]');
expect(badge, "stable natural-flow badge should render");
const parent = badge.parentElement;
window.dispatchEvent(new window.Event("scroll"));
expect(root.querySelector('[data-ehinium-badge="true"]') === badge, "scroll must preserve badge identity");
expect(badge.parentElement === parent, "scroll must not move badge to another host");
expect(badge.style.position !== "fixed" && badge.style.position !== "absolute" && !badge.style.transform, "badge must not receive viewport positioning styles");
expect(document.querySelector('[data-euc-overlay-root="true"]') === null, "no overlay root may exist");

markBadgeRemovalIntentional(badge);
handleBadgeLifecycleMutations([]);
clearBadgeLifecycles(document);
expect(document.querySelector('[data-euc-overlay-root="true"]') === null, "compatibility hooks must not create overlay state");
