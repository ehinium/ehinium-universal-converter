import { Window } from "happy-dom";
import { getTextNodes, isHiddenOrDisconnectedRoot } from "./domScanner";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

document.body.innerHTML = "<span></span>";
const text = document.createTextNode("EUR 100");
document.querySelector("span")?.append(text);

expectEqual(getTextNodes(text).length, 1, "text root is scanned");

const badge = document.createElement("span");
badge.setAttribute("data-ehinium-badge", "true");
badge.textContent = "USD 100";
document.body.append(badge);

expectEqual(getTextNodes(badge).length, 0, "EUC badge root is ignored");

const stableOwned = document.createElement("span");
stableOwned.setAttribute("data-euc-owned", "true");
stableOwned.textContent = "TRY 338";
document.body.append(stableOwned);
expectEqual(getTextNodes(stableOwned).length, 0, "stable EUC-owned root is ignored");

const hidden = document.createElement("div");
hidden.hidden = true;
hidden.textContent = "USD 100";
document.body.append(hidden);

expectEqual(isHiddenOrDisconnectedRoot(hidden), true, "hidden root skipped");
