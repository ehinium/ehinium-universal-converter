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

// Amazon size/colour swatches: the aria-hidden span is the visible label that
// the button input names via aria-labelledby, so its text is scanned. Nested
// aria-hidden fragments and unreferenced aria-hidden content stay excluded.
document.body.innerHTML = `
  <span class="a-button"><span class="a-button-inner">
    <input class="a-button-input" type="submit" aria-labelledby="size_name_0-announce">
    <span id="size_name_0-announce" class="a-button-text" aria-hidden="true">
      <span class="swatch-title-text-display">52" x 52" (Square)</span>
      <span class="a-price"><span aria-hidden="true">$17.91</span></span>
    </span>
  </span></span>
  <span id="decorative" aria-hidden="true">70" (Round)</span>
`;
const swatchLabel = document.getElementById("size_name_0-announce") as unknown as Element;
expectEqual(
  getTextNodes(swatchLabel).map((node) => node.textContent?.trim()).filter(Boolean).join("|"),
  '52" x 52" (Square)',
  "control label inside aria-hidden is scanned"
);
expectEqual(
  getTextNodes(document.getElementById("decorative") as unknown as Element).length,
  0,
  "unreferenced aria-hidden content stays excluded"
);
expectEqual(
  isHiddenOrDisconnectedRoot(swatchLabel.querySelector(".a-price") as Element),
  false,
  "aria-hidden alone does not make a mutation root hidden"
);
