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

// aria-hidden only hides content from assistive technology. Visible text marked
// aria-hidden (IKEA product names, Amazon swatch labels) is scanned; the
// screen-reader-only copies next to it are not.
document.body.innerHTML = `
  <h3><a aria-label="LOHALS, Rug, flatwoven, natural, 5 ' 3 &quot;x7 ' 7 &quot;" href="#">LOHALS</a>
    <span><span aria-hidden="true">Rug, flatwoven, natural, 5 ' 3 "x7 ' 7 "</span></span></h3>
  <span class="pipcom-price"><span aria-hidden="true"><span>$</span><span>109</span><span><span>.</span>99</span></span><span class="pipcom-price__sr-text">Price $ 109.99</span></span>
  <span class="a-price"><span class="a-offscreen">$17.90</span><span aria-hidden="true">$17.90</span></span>
  <span class="sr-only">Hidden copy 70"</span>
  <span class="sr_true">Hinta 399,99 €.</span>
`;
const scanned = getTextNodes(document.body).map((node) => node.textContent?.trim()).filter(Boolean);
expectEqual(scanned.includes(`Rug, flatwoven, natural, 5 ' 3 "x7 ' 7 "`), true, "aria-hidden product name is scanned");
expectEqual(scanned.join("|").includes("Price $ 109.99"), false, "IKEA screen-reader price is skipped");
expectEqual(scanned.filter((text) => text === "$17.90").length, 1, "Amazon offscreen copy is skipped");
expectEqual(scanned.some((text) => text.includes("Hidden copy") || text.includes("Hinta")), false, "sr-only classes are skipped");
expectEqual(
  isHiddenOrDisconnectedRoot(document.querySelector('[aria-hidden="true"]') as Element),
  false,
  "aria-hidden alone does not make a mutation root hidden"
);
