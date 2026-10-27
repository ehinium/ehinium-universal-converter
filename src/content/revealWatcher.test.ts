import { Window } from "happy-dom";
import { rememberHiddenContent, startRevealWatcher } from "./revealWatcher";

const window = new Window();

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  Node: window.Node,
});

// happy-dom has no layout: an element is shown unless an ancestor is display:none.
Object.defineProperty(window.Element.prototype, "checkVisibility", {
  configurable: true,
  value(this: Element) {
    return this.closest('[style*="display: none"]') === null;
  },
});
Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 }),
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const revealed: Element[] = [];
const stop = startRevealWatcher((roots) => {
  revealed.push(...roots);
});

const tab = document.createElement("div");
tab.setAttribute("style", "display: none");
tab.innerHTML = "<p>Weight: 110 lb</p>";
document.body.append(tab);
const line = tab.querySelector("p")!;
rememberHiddenContent(line);

document.body.classList.add("unrelated");
await wait(800);
expectEqual(revealed.length, 0, "an unrelated attribute change rescans nothing");

tab.setAttribute("style", "display: block");
await wait(800);
expectEqual(revealed.length, 1, "revealed content is rescanned once");
expectEqual(revealed[0], line, "the remembered element is the scan root");

tab.setAttribute("style", "display: none");
tab.setAttribute("style", "display: block");
await wait(800);
expectEqual(revealed.length, 1, "revealed content is forgotten after its rescan");

stop();
const later = document.createElement("p");
later.setAttribute("style", "display: none");
document.body.append(later);
rememberHiddenContent(later);
later.setAttribute("style", "display: block");
await wait(800);
expectEqual(revealed.length, 1, "a stopped watcher remembers nothing");

console.log("Reveal watcher tests passed.");
