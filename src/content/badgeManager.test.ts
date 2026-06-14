import { Window } from "happy-dom";
import { createBadge, serializeBadgeKey } from "./badgeManager";
import { getHoverTarget } from "./hoverRegistry";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
});

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: window.navigator,
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

expectEqual(
  serializeBadgeKey({
    amount: 10000000,
    sourceCurrency: "IRR",
    targetCurrency: "USD",
  }),
  "10000000|IRR|USD",
  "large amount badge identity"
);

{
  let copiedText: string | null = null;
  let parentClicks = 0;
  const parent = document.createElement("button");
  const badge = createBadge("$4.70", "AED 16.99 → $4.70");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(value: string): Promise<void> {
        copiedText = value;
        return Promise.resolve();
      },
    },
  });

  parent.addEventListener("click", () => {
    parentClicks++;
  });
  parent.append(badge);
  document.body.append(parent);

  badge.click();
  await Promise.resolve();

  expectEqual(copiedText, "$4.70", "copied badge value");
  expectEqual(badge.textContent, "Copied", "temporary copied feedback");
  expectEqual(badge.title, "AED 16.99 → $4.70", "badge title tooltip");
  expectEqual(
    getHoverTarget(badge)?.content,
    "AED 16.99 → $4.70",
    "registered hover tooltip"
  );
  expectEqual(parentClicks, 0, "parent click count");
  expectEqual(badge.style.cursor, "pointer", "clickable cursor");

  await wait(950);

  expectEqual(badge.textContent, "$4.70", "restored badge value");
}

{
  const badge = createBadge("22 lb", "22 lb");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(): Promise<void> {
        return Promise.reject(new Error("Clipboard unavailable"));
      },
    },
  });

  document.body.append(badge);
  badge.click();
  await Promise.resolve();
  await Promise.resolve();

  expectEqual(badge.textContent, "22 lb", "failed copy badge value");
}
