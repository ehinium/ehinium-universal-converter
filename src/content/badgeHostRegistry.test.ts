import { Window } from "happy-dom";
import { createBadge } from "./badgeManager";
import { cloneProtectedBadgeHost } from "./badgeHost";
import {
  clearBadgeHostRegistry,
  getBadgeHostCensusDiagnostic,
  getBadgeHostReconciliationDiagnostics,
  reconcileAffectedBadgeHosts,
  reconcileAllBadgeHostRecords,
  registerAuthoritativeBadgeHost,
} from "./badgeHostRegistry";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});

function expect(value: unknown, description: string): void {
  if (!value) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
}

function reset(): void {
  clearBadgeHostRegistry();
  document.body.innerHTML = "";
}

function register(key: string, badge = createBadge("$12.69", "597 TRY → $12.69")): HTMLElement {
  document.body.append(badge);
  return registerAuthoritativeBadgeHost({
    sourceKey: key, badgeHost: badge, sourceElement: document.body,
    renderMode: "inline", creationReason: "Registry test",
  });
}

reset();
{
  const badge = register("price-a");
  registerAuthoritativeBadgeHost({
    sourceKey: "price-a", badgeHost: badge, sourceElement: document.body,
    renderMode: "inline", creationReason: "Repeated render",
  });
  expectEqual(document.querySelectorAll('[data-euc-source-key="price-a"]').length, 1, "repeated registration keeps one host");
  expectEqual(getBadgeHostCensusDiagnostic().totalRegistryRecordCount, 1, "one registry record exists");
}

reset();
{
  const authoritative = register("price-a");
  const translatedClone = cloneProtectedBadgeHost(authoritative);
  document.body.append(translatedClone);
  reconcileAffectedBadgeHosts([{
    type: "childList", target: document.body, addedNodes: [translatedClone], removedNodes: [],
  } as unknown as MutationRecord]);
  expect(authoritative.isConnected, "original authoritative host remains connected");
  expect(!translatedClone.isConnected, "translated clone is removed without a source rescan");
  expectEqual(getBadgeHostReconciliationDiagnostics().at(-1)?.competingHostsRemoved, 1, "duplicate removal is diagnosed");
}

reset();
{
  register("price-a");
  register("price-b", createBadge("$20.00", "1000 TRY → $20.00"));
  reconcileAllBadgeHostRecords();
  expectEqual(getBadgeHostCensusDiagnostic().totalDomBadgeHostCount, 2, "different canonical sources remain distinct");
}

reset();
{
  const orphan = createBadge("$1.00", "orphan");
  orphan.dataset.eucSourceKey = "orphan-key";
  document.body.append(orphan);
  reconcileAllBadgeHostRecords();
  expect(!orphan.isConnected, "a keyed DOM host without a registry owner is removed");
  expectEqual(getBadgeHostCensusDiagnostic().totalOrphanHostCount, 0, "post-reconciliation census has no orphan hosts");
}

reset();
{
  // A price inside a web component (Pull&Bear's <price-element>) gets its badge in the same shadow root.
  const host = document.createElement("price-element");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<p class="sale">109,00PLN</p>';
  const source = shadow.querySelector<HTMLElement>(".sale")!;
  const badge = createBadge("$26.66", "109,00 PLN → $26.66");
  source.after(badge);
  registerAuthoritativeBadgeHost({
    sourceKey: "shadow-price", badgeHost: badge, sourceElement: source,
    renderMode: "inline", creationReason: "Registry test",
  });
  const translatedClone = cloneProtectedBadgeHost(badge);
  badge.after(translatedClone);
  reconcileAffectedBadgeHosts([{
    type: "childList", target: source.parentNode, addedNodes: [translatedClone], removedNodes: [],
  } as unknown as MutationRecord]);
  expect(badge.isConnected, "the shadow-root badge keeps its registry record");
  expect(!translatedClone.isConnected, "a duplicate inside the shadow root is removed");
  expectEqual(getBadgeHostCensusDiagnostic().totalRegistryRecordCount, 1, "the shadow-root badge stays registered");
}

console.log("badgeHostRegistry tests passed");
