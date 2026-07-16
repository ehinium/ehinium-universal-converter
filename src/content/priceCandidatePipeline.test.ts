import { Window } from "happy-dom";
import { getTextNodes } from "./domScanner";
import { collectCurrencyDomMatches, type CurrencyDomMatch } from "./currencyDomMatches";
import {
  beginVisualSourceReconciliationBatch,
  canonicalizePriceCandidates,
  clearVisualSourceRegistry,
  discoverPriceCandidates,
  getCanonicalizationDiagnostics,
  reconcileCanonicalVisualSource,
  registerCanonicalVisualSource,
} from "./priceCandidatePipeline";

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

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value(this: HTMLElement) {
    const x = Number(this.closest<HTMLElement>("[data-x]")?.dataset.x ?? 0);
    const y = Number(this.closest<HTMLElement>("[data-y]")?.dataset.y ?? 0);
    return new window.DOMRect(x, y, 100, 20);
  },
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
}

function root(html: string): HTMLElement {
  clearVisualSourceRegistry(document);
  document.body.innerHTML = `<main>${html}</main>`;
  return document.body.firstElementChild as HTMLElement;
}

function candidates(element: HTMLElement) {
  return discoverPriceCandidates(collectCurrencyDomMatches(getTextNodes(element)), "USD");
}

{
  const element = root("<span>597 TL</span>");
  const found = candidates(element);
  expectEqual(found.length, 1, "simple leaf discovery count");
  expectEqual(canonicalizePriceCandidates(found).length, 1, "simple leaf canonical count");
  expectEqual(found[0].discoveryMode, "leaf-text", "simple leaf discovery mode");
}

{
  const element = root("<div class='outer'><span><font><span><em>597 TL</em></span></font></span></div>");
  expectEqual(canonicalizePriceCandidates(candidates(element)).length, 1, "five translation wrappers remain one price");
}

{
  const element = root("<div id='price'><span>597 TL</span></div>");
  const direct = collectCurrencyDomMatches(getTextNodes(element))[0];
  const ancestor = element.querySelector<HTMLElement>("#price")!;
  const aggregate: CurrencyDomMatch = {
    ...direct,
    sourceElement: ancestor,
    renderingAnchor: ancestor,
    scanKind: "combined-inline",
    directNodeParserSucceeded: false,
    localCombinedScanAttempted: true,
  };
  const canonical = canonicalizePriceCandidates(discoverPriceCandidates([aggregate, direct], "USD"));
  expectEqual(canonical.length, 1, "ancestor aggregate and leaf collapse");
  expectEqual(canonical[0].discoveryMode, "leaf-text", "leaf beats ancestor aggregate");
  expectEqual(getCanonicalizationDiagnostics()[0].candidateCount, 2, "ancestor collision is diagnosed");
}

{
  const element = root("<span><b>597</b><i> TL</i></span>");
  const canonical = canonicalizePriceCandidates(candidates(element));
  expectEqual(canonical.length, 1, "split token canonical count");
  expectEqual(canonical[0].sourceTextNodes.length, 2, "split token exact source nodes");
  expectEqual(canonical[0].discoveryMode, "split-text", "split token discovery mode");
}

{
  const element = root("<span><s>700 TL</s> <strong>597 TL</strong></span>");
  expectEqual(canonicalizePriceCandidates(candidates(element)).length, 2, "old and current prices stay separate");
}

{
  const element = root("<article data-x='0'><span>597 TL</span></article><article data-x='300'><span>597 TL</span></article>");
  expectEqual(canonicalizePriceCandidates(candidates(element)).length, 2, "same amount in repeated cards stays separate");
}

{
  const element = root("<header data-y='0'><span>597 TL</span></header><main data-y='400'><span>597 TL</span></main>");
  expectEqual(canonicalizePriceCandidates(candidates(element)).length, 2, "sticky and main prices stay separate");
}

{
  const element = root("<span style='display:none'>597 TL</span><span>597 TL</span>");
  expectEqual(canonicalizePriceCandidates(candidates(element)).length, 1, "hidden duplicate is rejected");
}

{
  const element = root("<span>597 TL</span>");
  const match = collectCurrencyDomMatches(getTextNodes(element))[0];
  expectEqual(
    canonicalizePriceCandidates(discoverPriceCandidates([match, match, match], "USD")).length,
    1,
    "same source repeated in a batch renders once"
  );
}

{
  const element = root("<span>597 TL</span><span data-euc-owned='true'>597 TL</span>");
  expectEqual(canonicalizePriceCandidates(candidates(element)).length, 1, "extension-owned text is excluded from discovery");
}

{
  const element = root("<span>597 TL</span>");
  const candidate = canonicalizePriceCandidates(candidates(element))[0];
  const badge = document.createElement("span");
  badge.dataset.ehiniumBadge = "true";
  badge.dataset.ehiniumSourceCurrency = candidate.sourceCurrency;
  badge.dataset.ehiniumSourceAmount = String(candidate.amount);
  badge.dataset.ehiniumTargetCurrency = candidate.targetCurrency;
  element.append(badge);
  registerCanonicalVisualSource(candidate, badge);
  const duplicate = badge.cloneNode(true) as HTMLElement;
  element.append(duplicate);
  beginVisualSourceReconciliationBatch();
  expectEqual(reconcileCanonicalVisualSource(candidate), badge, "connected canonical badge is reused");
  expectEqual(duplicate.isConnected, false, "stale duplicate badge is removed");
}

console.log("price candidate pipeline tests passed");
