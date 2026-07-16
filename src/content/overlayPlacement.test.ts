import { Window } from "happy-dom";
import { parseCurrencies } from "../utils/currencyParser";
import { placeOverlayBatch, rectsOverlap, type OverlaySourceInput } from "./overlayPlacement";

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
Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 500 });
Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 300 });

function elementRect(element: HTMLElement): DOMRect {
  if (element.dataset.testBadge === "true") {
    return new window.DOMRect(Number.parseFloat(element.style.left) || 0, Number.parseFloat(element.style.top) || 0, 52, 18);
  }
  const owner = element.closest<HTMLElement>("[data-x]") ?? element;
  return new window.DOMRect(
    Number(owner.dataset.x ?? 0), Number(owner.dataset.y ?? 50),
    Number(owner.dataset.width ?? 200), Number(owner.dataset.height ?? 20)
  );
}

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value(this: HTMLElement) { return elementRect(this); },
});

document.createRange = (() => {
  let startNode: Text;
  let endNode: Text;
  let startOffset = 0;
  let endOffset = 0;
  const rangeRect = (): DOMRect => {
    const startOwner = startNode.parentElement!;
    const endOwner = endNode.parentElement!;
    const startBase = elementRect(startOwner);
    const endBase = elementRect(endOwner);
    const charWidth = Number(startOwner.dataset.charWidth ?? 5);
    const endCharWidth = Number(endOwner.dataset.charWidth ?? 5);
    const left = startBase.x + startOffset * charWidth;
    const right = startNode === endNode
      ? startBase.x + endOffset * charWidth
      : endBase.x + endOffset * endCharWidth;
    return new window.DOMRect(left, Math.min(startBase.y, endBase.y), Math.max(0, right - left), 20);
  };
  return () => ({
    setStart(node: Text, offset: number) { startNode = node; startOffset = offset; },
    setEnd(node: Text, offset: number) { endNode = node; endOffset = offset; },
    getClientRects() { return [rangeRect()]; },
    getBoundingClientRect() { return rangeRect(); },
  } as unknown as Range);
})() as typeof document.createRange;

function expect(value: unknown, description: string): void {
  if (!value) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
}

function setup(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function inputFor(element: HTMLElement, matchIndex = 0, previousPlacement: OverlaySourceInput["previousPlacement"] = null): OverlaySourceInput {
  const node = element.firstChild as Text;
  const match = parseCurrencies(node.textContent ?? "")[matchIndex];
  const badge = document.createElement("span");
  badge.dataset.eucBadge = "true";
  badge.dataset.testBadge = "true";
  document.body.append(badge);
  return {
    logicalKey: `${match.raw}-${matchIndex}`,
    badge, sourceElement: element, anchor: element, sourceNodes: [node],
    fragmentMap: [{ node, combinedStart: 0, combinedEnd: node.length }],
    parserInput: node.textContent ?? "", raw: match.raw, start: match.start, end: match.end,
    previousPlacement,
  };
}

{
  const line = setup('<div data-x="0" data-y="50" data-width="160">From £899 £1,199</div>');
  const first = inputFor(line, 0);
  const second = inputFor(line, 1);
  const placed = placeOverlayBatch([first, second], "test");
  const firstResult = placed.results.find((item) => item.logicalKey === first.logicalKey)!;
  const secondResult = placed.results.find((item) => item.logicalKey === second.logicalKey)!;
  expectEqual(firstResult.exactRect.width, 20, "exact £899 range width");
  expect(firstResult.semanticRect.width < elementRect(line).width, "exact source does not use full parent line");
  expect(firstResult.diagnostic.candidates.find((item) => item.id === "inline-end")?.rejectionReasons.includes("Overlaps adjacent old price"), "inline end rejects adjacent old price");
  expect(!rectsOverlap(firstResult.rect, firstResult.semanticRect), "first badge avoids source");
  expect(!rectsOverlap(firstResult.rect, secondResult.semanticRect), "first badge avoids old price");
  expect(!rectsOverlap(firstResult.rect, secondResult.rect), "two price badges do not overlap");
  expectEqual(placed.groups[0].badgeCount, 2, "nearby prices are solved as one group");
  expect(placed.groups[0].backtrackingSteps > 0, "group uses bounded search");
}

{
  const monthly = setup('<div data-x="20" data-y="70" data-width="300">or £24.97/month with 36-month financing</div>');
  const source = inputFor(monthly);
  const result = placeOverlayBatch([source], "test").results[0];
  expect(result.semanticRect.width > result.exactRect.width, "monthly semantic range includes suffix");
  expect(!rectsOverlap(result.rect, result.semanticRect), "monthly badge avoids /month suffix");
  expect(result.diagnostic.candidates.find((item) => item.id === "inline-end")?.rejectionReasons.includes("Overlaps nearby text"), "financing text blocks inline placement");
  expect(result.placement?.startsWith("above") || result.placement?.startsWith("below"), "monthly badge chooses vertical fallback");
}

{
  const line = setup('<div data-x="40" data-y="100" data-width="220">£100 £200 £300</div>');
  const inputs = [inputFor(line, 0), inputFor(line, 1), inputFor(line, 2)];
  const first = placeOverlayBatch(inputs, "test");
  expectEqual(first.groups[0].badgeCount, 3, "three nearby badges form one placement group");
  expectEqual(first.groups[0].unresolvedCollisionCount, 0, "three-badge group resolves all collisions");
  for (let left = 0; left < first.results.length; left++) {
    for (let right = left + 1; right < first.results.length; right++) {
      expect(!rectsOverlap(first.results[left].rect, first.results[right].rect), "three-badge solution has no collisions");
    }
  }
  const repeatedInputs = inputs.map((input) => ({
    ...input,
    previousPlacement: first.results.find((result) => result.logicalKey === input.logicalKey)?.placement ?? null,
  }));
  const second = placeOverlayBatch(repeatedInputs, "repeat");
  expectEqual(second.groups[0].placementOrder.join("|"), first.groups[0].placementOrder.join("|"), "placement order is deterministic");
}

{
  const roomy = setup('<div data-x="40" data-y="80" data-width="60">£899</div>');
  const source = inputFor(roomy);
  const first = placeOverlayBatch([source], "test").results[0];
  expectEqual(first.placement, "inline-end", "roomy source uses inline end");
  const retainedInput = { ...source, previousPlacement: first.placement };
  const second = placeOverlayBatch([retainedInput], "minor geometry change").results[0];
  expectEqual(second.placement, first.placement, "repeat calculation retains placement");
  expectEqual(second.diagnostic.retainedByHysteresis, true, "hysteresis retention is diagnosed");
}

{
  const clip = setup('<div data-x="0" data-y="20" data-width="115" data-height="100" style="overflow:hidden"><span data-x="75" data-y="55" data-width="25">£899</span></div>');
  const source = inputFor(clip.querySelector("span")!);
  const result = placeOverlayBatch([source], "test").results[0];
  expect(result.diagnostic.candidates.find((item) => item.id === "inline-end")?.rejectionReasons.includes("Clipped by overflow ancestor"), "clipping ancestor rejects inline end");
  expectEqual(result.diagnostic.clippingDetected, true, "clipping detection diagnostic");
  expect(result.placement !== "inline-end", "clipped source chooses alternate placement");
}

{
  const rtl = setup('<div data-x="200" data-y="80" data-width="80" dir="rtl" style="direction:rtl">899 TRY</div>');
  const source = inputFor(rtl);
  const result = placeOverlayBatch([source], "test").results[0];
  expectEqual(result.diagnostic.direction, "rtl", "RTL direction detected");
  expect(result.rect.x < result.semanticRect.x, "RTL inline end is placed before source");
}

{
  const split = setup('<div data-x="30" data-y="90"><span data-x="30" data-y="90">£24.97</span><span data-x="60" data-y="90">/month</span></div>');
  const firstNode = split.querySelectorAll("span")[0].firstChild as Text;
  const secondNode = split.querySelectorAll("span")[1].firstChild as Text;
  const badge = document.createElement("span");
  badge.dataset.eucBadge = "true";
  badge.dataset.testBadge = "true";
  document.body.append(badge);
  const input: OverlaySourceInput = {
    logicalKey: "split-month", badge, sourceElement: split, anchor: split,
    sourceNodes: [firstNode, secondNode],
    fragmentMap: [
      { node: firstNode, combinedStart: 0, combinedEnd: firstNode.length },
      { node: secondNode, combinedStart: firstNode.length, combinedEnd: firstNode.length + secondNode.length },
    ],
    parserInput: "£24.97/month", raw: "£24.97", start: 0, end: 6, previousPlacement: null,
  };
  const result = placeOverlayBatch([input], "test").results[0];
  expect(result.diagnostic.sourceRangeValid, "split range remains valid");
  expect(result.semanticRect.width > result.exactRect.width, "split-node suffix expands semantic range");
  expect(!rectsOverlap(result.rect, result.semanticRect), "split-node badge avoids semantic source");
}

console.log("overlay placement tests passed");
