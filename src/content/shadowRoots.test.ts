import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "https://example.test/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
});

const {
  composedParent,
  containsComposed,
  getKnownShadowRoots,
  querySelectorAllDeep,
  setShadowRootListener,
  withOpenShadowRoots,
} = await import("./shadowRoots");
const { scanConversionRoots } = await import("./conversionScan");
const { observeDomChanges } = await import("./observer");
const { collectTextNodesForScan } = await import("./scanRoots");
const { getClosestHoverTarget, registerHoverTarget } = await import("./hoverRegistry");
const { defaultSettings } = await import("../utils/defaultSettings");

// A product card whose price lives in a web component, Pull&Bear style:
// <price-element> → #shadow-root → <p class="sale">109,00PLN</p>, plus a nested component.
function createCard(): { card: HTMLElement; host: HTMLElement; shadow: ShadowRoot; nested: ShadowRoot; closedHost: HTMLElement } {
  const card = document.createElement("article");
  const host = document.createElement("price-element");
  card.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<div class="wrap"><p class="old">179,00PLN</p><p class="sale">109,00PLN</p><badge-tag></badge-tag></div>`;
  const nested = shadow.querySelector("badge-tag")!.attachShadow({ mode: "open" });
  nested.innerHTML = `<span class="promo">-39%</span>`;
  const closedHost = document.createElement("closed-element");
  closedHost.attachShadow({ mode: "closed" }).innerHTML = "<span>5,00PLN</span>";
  card.append(closedHost);
  document.body.append(card);
  return { card, host: host as HTMLElement, shadow, nested, closedHost: closedHost as HTMLElement };
}

// Discovery: nested open roots are found, the root's own shadow root counts, closed roots stay out of reach.
{
  const { card, host, shadow, nested } = createCard();
  const discovered: ShadowRoot[] = [];
  setShadowRootListener((root) => discovered.push(root));
  assert.deepEqual(withOpenShadowRoots([card]), [card, shadow, nested]);
  assert.deepEqual(discovered, [shadow, nested]);
  assert.deepEqual(withOpenShadowRoots([host]), [host, shadow, nested], "a host given as the root is searched too");
  assert.equal(discovered.length, 2, "known roots are announced once");
  assert.deepEqual(getKnownShadowRoots(), [shadow, nested]);
  assert.deepEqual(querySelectorAllDeep(".sale").map((element) => element.textContent), ["109,00PLN"]);

  const sale = shadow.querySelector(".sale")!;
  assert.equal(composedParent(shadow.querySelector(".wrap")!), host);
  assert.equal(containsComposed(card, sale), true);
  assert.equal(containsComposed(card, nested.querySelector(".promo")!), true);
  assert.equal(card.contains(sale), false, "the plain DOM check stops at the shadow boundary");

  card.remove();
  assert.deepEqual(getKnownShadowRoots(), [], "roots of removed hosts are forgotten");
  setShadowRootListener(null);
}

// The scan hands prices inside open shadow roots to the renderer.
{
  const { card } = createCard();
  let renderedTexts: string[] = [];
  const result = await scanConversionRoots(
    { reason: "initial", roots: [document.body] },
    { ...defaultSettings, enabled: true, converterMode: "currencies", targetCurrency: "USD" },
    {
      getExchangeRates: async (base) => ({ base, date: "2026-01-01", rates: { USD: 1, PLN: 4 }, provider: "frankfurter" }),
      renderConversions: (nodes) => {
        renderedTexts = [...nodes].map((node) => node.textContent ?? "");
        return renderedTexts.length;
      },
    }
  );
  assert.deepEqual(renderedTexts, ["179,00PLN", "109,00PLN", "-39%"]);
  assert.equal(result.scannedNodeCount, 3);
  card.remove();
}

// The content observer follows changes inside shadow roots found by a scan.
{
  const { card, shadow } = createCard();
  const batches: Node[][] = [];
  const stop = observeDomChanges((roots) => batches.push(roots));
  withOpenShadowRoots([document.body]);
  const price = document.createElement("p");
  price.textContent = "59,90PLN";
  shadow.querySelector(".wrap")!.append(price);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(batches.some((roots) => roots.includes(price)), "a price added inside a shadow root is scanned");
  stop();
  card.remove();
}

// A component that renders straight into its shadow root (no wrapper) is rescanned too.
{
  const { card, shadow } = createCard();
  const batches: Node[][] = [];
  const stop = observeDomChanges((roots) => batches.push(roots));
  withOpenShadowRoots([document.body]);
  const price = document.createElement("p");
  price.textContent = "89,90PLN";
  shadow.replaceChildren(price);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(batches.some((roots) => roots.includes(price)), "a re-render into the shadow root itself is scanned");
  stop();
  card.remove();
}

// A text-heavy page does not use up the budget of the shadow roots after it.
{
  const { card } = createCard();
  const filler = document.createElement("div");
  for (let index = 0; index < 2600; index++) filler.append(document.createElement("span"), `line ${index}`);
  document.body.append(filler);
  const nodes = await collectTextNodesForScan(withOpenShadowRoots([document.body]));
  assert.ok(nodes.some((node) => node.textContent === "109,00PLN"), "the shadow price is collected");
  assert.ok(nodes.filter((node) => node.textContent?.startsWith("line ")).length <= 2500, "the page budget still holds");
  filler.remove();
  card.remove();
}

// A hover target on a tile is found from inside a web component in it.
{
  const { card, shadow } = createCard();
  registerHoverTarget(card, "109,00 PLN → $26.66");
  assert.equal(getClosestHoverTarget(shadow.querySelector<HTMLElement>(".sale")!)?.element, card);
  card.remove();
}

console.log("Shadow root tests passed.");
