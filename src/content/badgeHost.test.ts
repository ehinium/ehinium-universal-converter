import { Window } from "happy-dom";
import { createBadge } from "./badgeManager";
import { getTextNodes } from "./domScanner";
import { isExtensionOwnedMutation } from "./observer";
import {
  getBadgeEncapsulationDiagnostics,
  getBadgeShadowStyleText,
  getBadgeVisibleText,
  getTranslationProtectionDiagnostics,
  handleBadgeHostMutations,
  reconcileBadgeHosts,
  registerLegacyBadgeAuthoritativeState,
} from "./badgeHost";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });

function expect(value: unknown, description: string): void {
  if (!value) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
}

function childMutation(host: HTMLElement, added: Node): MutationRecord {
  return {
    type: "childList", target: host, addedNodes: [added], removedNodes: [],
  } as unknown as MutationRecord;
}

document.body.innerHTML = "";

{
  const badge = createBadge("$12.69", "597 TRY → $12.69");
  document.body.append(badge);
  const diagnostic = getBadgeEncapsulationDiagnostics().find((item) => item.hostSelector.includes("badge-host"))!;
  expectEqual(badge.getAttribute("translate"), "no", "protected host translate attribute");
  expect(badge.classList.contains("notranslate"), "protected host notranslate class");
  expectEqual(badge.dataset.eucBadgeHost, "true", "protected host marker");
  expectEqual(badge.childNodes.length, 0, "protected host light DOM child count");
  expectEqual(badge.textContent, "", "protected host has no light DOM text");
  expectEqual(getBadgeVisibleText(badge), "$12.69", "visible text is controlled inside shadow root");
  expectEqual(badge.shadowRoot, null, "shadow root is closed to page scripts");
  expectEqual(diagnostic.shadowRootPresent, true, "closed shadow root diagnostic");
  expectEqual(diagnostic.shadowMode, "closed", "closed shadow mode diagnostic");
  expect(getBadgeShadowStyleText(badge).includes("padding: 2px 6px"), "default styling exists inside shadow root");
  expect(getBadgeShadowStyleText(badge).includes('data-ehinium-badge-style="compact"'), "compact variant styling exists inside shadow root");
  expectEqual(getTextNodes(badge).length, 0, "normal scanner cannot traverse shadow badge text");
}

{
  const badge = document.querySelector<HTMLElement>('[data-euc-badge-host="true"]')!;
  const outer = document.createElement("font");
  const inner = document.createElement("font");
  inner.textContent = "$12.69";
  outer.append(inner);
  badge.append(outer);
  const mutation = childMutation(badge, outer);
  expectEqual(isExtensionOwnedMutation(mutation), true, "translator contamination remains extension-owned");
  handleBadgeHostMutations([mutation]);
  expectEqual(badge.childNodes.length, 0, "foreign translated wrapper removed");
  expectEqual(getBadgeVisibleText(badge), "$12.69", "shadow text survives contamination cleanup");
  const protection = getTranslationProtectionDiagnostics().find((item) => item.translatorMutationInsideHostDetected)!;
  expectEqual(protection.foreignWrapperCount, 1, "foreign wrapper count diagnosed");
  expectEqual(protection.authoritativeTextSource, "badge-controller", "controller remains authoritative");

  const repeated = document.createElement("span");
  repeated.textContent = "$12.69";
  badge.append(repeated);
  handleBadgeHostMutations([childMutation(badge, repeated)]);
  expectEqual(badge.childNodes.length, 0, "repeated contamination removed in one batch");
  expectEqual(getBadgeVisibleText(badge), "$12.69", "repeated contamination cannot duplicate visible text");
}

{
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText(value: string) { copied = value; return Promise.resolve(); } },
  });
  const badge = createBadge("$12.69", "597 TRY → $12.69");
  const contamination = document.createElement("font");
  contamination.textContent = "$999.99";
  badge.append(contamination);
  document.body.append(badge);
  badge.click();
  await Promise.resolve();
  expectEqual(copied, "$12.69", "copy value comes from controller state");
  expectEqual(badge.getAttribute("aria-label"), "Copied. Convert 597 TRY to $12.69. Click to copy.", "host exposes one authoritative accessible name");
}

{
  const legacy = document.createElement("span");
  legacy.dataset.ehiniumBadge = "true";
  legacy.dataset.ehiniumConverted = "true";
  legacy.dataset.ehiniumOwnerId = "owner-1";
  legacy.innerHTML = "<font><font>$12.69</font></font>";
  document.body.append(legacy);
  registerLegacyBadgeAuthoritativeState(
    legacy, "$12.69", "Convert 597 TRY to $12.69. Click to copy.", "597 TRY → $12.69"
  );
  reconcileBadgeHosts(document);
  expectEqual(legacy.isConnected, true, "owned legacy host migrates atomically in place");
  expectEqual(legacy.dataset.ehiniumOwnerId, "owner-1", "legacy ownership preserved");
  expectEqual(legacy.childNodes.length, 0, "legacy translated wrappers removed");
  expectEqual(getBadgeVisibleText(legacy), "$12.69", "legacy value comes from authoritative registry state");
  expect(getBadgeEncapsulationDiagnostics().some((item) => item.legacyBadgeMigrated), "legacy migration diagnosed");
  let migratedCopy = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText(value: string) { migratedCopy = value; return Promise.resolve(); } },
  });
  legacy.click();
  await Promise.resolve();
  expectEqual(migratedCopy, "$12.69", "migrated legacy host preserves controller copy behavior");
}

{
  const stale = document.createElement("span");
  stale.dataset.ehiniumBadge = "true";
  stale.dataset.ehiniumConverted = "true";
  stale.textContent = "$12.69 $12.69";
  document.body.append(stale);
  reconcileBadgeHosts(document);
  expectEqual(stale.isConnected, false, "unowned legacy badge is removed");
}

console.log("badge host encapsulation tests passed");
