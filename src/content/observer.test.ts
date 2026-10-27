import { Window } from "happy-dom";
import { collectMutationRoots, observeDomChanges } from "./observer";
import { markBadgeRemovalIntentional } from "./badgeLifecycle";
import { createBadge, insertBadgeAfter, removeBadges } from "./badgeManager";

const window = new Window();

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});

function wait(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

let scanCount = 0;
const stop = observeDomChanges(() => {
  scanCount++;
});

const badge = document.createElement("span");
badge.setAttribute("data-ehinium-badge", "true");
document.body.append(badge);
badge.textContent = "$4.63";
await wait();
expectEqual(scanCount, 0, "badge mutation ignored");

const stableBadge = document.createElement("span");
stableBadge.setAttribute("data-euc-owned", "true");
stableBadge.setAttribute("data-euc-badge", "true");
document.body.append(stableBadge);
stableBadge.textContent = "$9.99";
await wait();
expectEqual(scanCount, 0, "stable extension-owned mutation ignored");

const price = document.createElement("span");
price.textContent = "EUR 100";
document.body.append(price);
await wait();
expectEqual(scanCount, 1, "normal mutation observed");

// One record inserting several nodes (append(...cards), innerHTML, a fragment)
// scans every inserted node, not just the first.
{
  const grid = document.createElement("div");
  document.body.append(grid);
  const cards = [1, 2, 3].map((index) => {
    const card = document.createElement("div");
    card.textContent = `Card ${index} ${index}0`;
    grid.append(card);
    return card;
  });
  const record = { type: "childList", target: grid, addedNodes: cards, removedNodes: [] } as unknown as MutationRecord;
  const roots = collectMutationRoots([record]);
  expectEqual(roots.length, 3, "every inserted card is a scan root");
  const many = Array.from({ length: 40 }, () => {
    const row = document.createElement("p");
    row.textContent = "€1";
    grid.append(row);
    return row;
  });
  const bulk = collectMutationRoots([{ type: "childList", target: grid, addedNodes: many, removedNodes: [] } as unknown as MutationRecord]);
  expectEqual(bulk.length === 1 && bulk[0] === grid, true, "a bulk insert is scanned through its parent");
  grid.remove();
}

// A badge the page strips (hydration, a re-render) is restored a few times;
// one the extension removed on purpose stays removed.
{
  const card = document.createElement("div");
  card.textContent = "Price $10";
  document.body.append(card);
  const removal = (removed: Node) =>
    ({ type: "childList", target: card, addedNodes: [], removedNodes: [removed] }) as unknown as MutationRecord;
  const stripped = document.createElement("span");
  stripped.setAttribute("data-ehinium-badge", "true");
  expectEqual(collectMutationRoots([removal(stripped)])[0], card, "a badge the page removed is restored");
  const ours = document.createElement("span");
  ours.setAttribute("data-ehinium-badge", "true");
  markBadgeRemovalIntentional(ours);
  expectEqual(collectMutationRoots([removal(ours)]).length, 0, "a badge the extension removed stays removed");
  for (let attempt = 0; attempt < 3; attempt++) collectMutationRoots([removal(stripped)]);
  expectEqual(collectMutationRoots([removal(stripped)]).length, 0, "a page that keeps stripping badges is not fought");
  card.remove();
}

// Wrapping a price into a badge group, and putting it back when its badge does
// not fit, are the extension's own moves: rescanning them inserted and removed
// the badge again without end (amazon.ae). The page moving the price is new.
{
  const card = document.createElement("div");
  card.innerHTML = `<span class="a-price"><span aria-hidden="true">AED 49</span></span>`;
  document.body.append(card);
  await wait();
  const before = scanCount;
  const price = card.querySelector<HTMLElement>(".a-price")!;
  const badge = createBadge("$13.34", "49 AED → $13.34");
  insertBadgeAfter(price, badge);
  expectEqual(price.parentElement === card, false, "the price is wrapped with its badge");
  removeBadges(badge);
  expectEqual(price.parentElement, card, "the price is back in place");
  await wait();
  expectEqual(scanCount, before, "the extension's own moves are not rescanned");
  card.append(price);
  await wait();
  expectEqual(scanCount, before + 1, "the page moving the price is rescanned");
  card.remove();
}


stop();
