import { Window } from "happy-dom";
import { observeDomChanges } from "./observer";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
  MutationObserver: window.MutationObserver,
  Node: window.Node,
  Text: window.Text,
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

const price = document.createElement("span");
price.textContent = "EUR 100";
document.body.append(price);
await wait();
expectEqual(scanCount, 1, "normal mutation observed");

stop();
