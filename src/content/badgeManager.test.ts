import { Window } from "happy-dom";
import {
  createBadge,
  getBadgeColorContext,
  insertBadgeAfter,
  insertBadgeAfterTextNode,
  removeBadges,
  serializeBadgeKey,
} from "./badgeManager";
import { getHoverTarget, registerHoverTarget } from "./hoverRegistry";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle.bind(window),
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

function createStyledContainer(
  color: string,
  backgroundColor: string
): { container: HTMLElement; source: HTMLElement } {
  const container = document.createElement("div");
  const source = document.createElement("span");

  container.style.backgroundColor = backgroundColor;
  source.style.color = color;
  source.textContent = "100 AED";
  container.append(source);
  document.body.append(container);

  return { container, source };
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
  expectEqual(badge.hasAttribute("title"), false, "badge native title tooltip");
  expectEqual(badge.getAttribute("role"), "button", "badge role button");
  expectEqual(badge.getAttribute("tabindex"), "0", "badge tabindex");
  expectEqual(
    badge.getAttribute("aria-label"),
    "Copied. Convert AED 16.99 to $4.70. Click to copy.",
    "copied badge aria label"
  );
  expectEqual(
    getHoverTarget(badge)?.content,
    "AED 16.99 → $4.70",
    "registered hover tooltip"
  );
  expectEqual(parentClicks, 0, "parent click count");
  expectEqual(badge.style.cursor, "pointer", "clickable cursor");

  await wait(950);

  expectEqual(badge.textContent, "$4.70", "restored badge value");
  expectEqual(
    badge.getAttribute("aria-label"),
    "Convert AED 16.99 to $4.70. Click to copy.",
    "restored badge aria label"
  );
}

{
  let copiedText: string | null = null;
  const badge = createBadge("$4.63", "AED 16.99 → $4.63");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(value: string): Promise<void> {
        copiedText = value;
        return Promise.resolve();
      },
    },
  });

  document.body.append(badge);
  badge.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event
  );
  await Promise.resolve();

  expectEqual(copiedText, "$4.63", "enter key copied value");
}

{
  let copiedText: string | null = null;
  const badge = createBadge("$4.63", "AED 16.99 → $4.63");
  const event = new window.KeyboardEvent("keydown", {
    key: " ",
    bubbles: true,
    cancelable: true,
  });

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(value: string): Promise<void> {
        copiedText = value;
        return Promise.resolve();
      },
    },
  });

  document.body.append(badge);
  badge.dispatchEvent(event as unknown as Event);
  await Promise.resolve();

  expectEqual(copiedText, "$4.63", "space key copied value");
  expectEqual(event.defaultPrevented, true, "space key prevents scrolling");
}

{
  const badge = createBadge("$4.63", "AED 16.99 → $4.63");

  document.body.append(badge);
  badge.dispatchEvent(new window.FocusEvent("focus") as unknown as Event);

  const tooltip = document.querySelector<HTMLElement>(
    '[data-ehinium-tooltip="true"]'
  );

  expectEqual(tooltip?.textContent, "AED 16.99 → $4.63", "focus tooltip content");
  expectEqual(tooltip?.style.visibility, "visible", "focus tooltip visible");

  badge.dispatchEvent(new window.FocusEvent("blur") as unknown as Event);

  expectEqual(tooltip?.style.visibility, "hidden", "blur tooltip hidden");
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

{
  const legacyBadge = document.createElement("span");
  legacyBadge.setAttribute("data-ehinium-badge", "true");
  legacyBadge.setAttribute("title", "AED 16.99 → $4.70");

  registerHoverTarget(legacyBadge, "AED 16.99 → $4.70");

  expectEqual(
    legacyBadge.hasAttribute("title"),
    false,
    "legacy extension-owned hover title removed"
  );
  expectEqual(
    getHoverTarget(legacyBadge)?.content,
    "AED 16.99 → $4.70",
    "legacy extension-owned hover content"
  );
}

{
  const websiteElement = document.createElement("span");
  websiteElement.setAttribute("title", "Website title");

  registerHoverTarget(websiteElement, "Conversion tooltip");

  expectEqual(
    websiteElement.getAttribute("title"),
    "Website title",
    "website title preserved during hover registration"
  );
}

{
  const root = document.createElement("div");
  const legacyConverted = document.createElement("span");

  legacyConverted.setAttribute("data-ehinium-converted", "true");
  legacyConverted.setAttribute("title", "Old conversion tooltip");
  root.append(legacyConverted);
  document.body.append(root);

  removeBadges(root);

  expectEqual(
    legacyConverted.hasAttribute("title"),
    false,
    "legacy extension-owned cleanup title removed"
  );
}

{
  const { source } = createStyledContainer("rgb(20, 20, 20)", "rgb(255, 255, 255)");
  const badge = createBadge("$27.23", "100 AED → $27.23");

  insertBadgeAfter(source, badge);

  expectEqual(
    badge.style.color,
    "rgb(20, 20, 20)",
    "light container badge text color"
  );
  expectEqual(
    badge.style.background,
    "rgba(20, 20, 20, 0.07)",
    "light container badge background color"
  );
}

{
  const { source } = createStyledContainer("rgb(255, 255, 255)", "rgb(20, 20, 20)");
  const badge = createBadge("$27.23", "100 AED → $27.23");

  insertBadgeAfter(source, badge);

  expectEqual(
    badge.style.color,
    "rgb(255, 255, 255)",
    "dark container badge text color"
  );
  expectEqual(
    badge.style.background,
    "rgba(255, 255, 255, 0.07)",
    "dark container badge background color"
  );
}

{
  const outer = document.createElement("div");
  const sourcePrice = document.createElement("span");
  const source = document.createElement("span");
  const badge = createBadge("$27.23", "100 AED → $27.23");

  outer.style.backgroundColor = "rgb(255, 255, 255)";
  sourcePrice.className = "a-price";
  sourcePrice.style.backgroundColor = "rgb(20, 20, 20)";
  source.style.color = "rgb(255, 255, 255)";
  source.textContent = "100 AED";
  sourcePrice.append(source);
  outer.append(sourcePrice);
  document.body.append(outer);

  insertBadgeAfter(source, badge);

  expectEqual(
    badge.style.color,
    "rgb(17, 24, 39)",
    "different background fallback badge text color"
  );
  expectEqual(
    badge.style.background,
    "rgba(17, 24, 39, 0.08)",
    "different background fallback badge background"
  );
}

{
  const container = document.createElement("div");
  const wrapper = document.createElement("span");
  const source = document.createTextNode("100 AED");
  const badge = createBadge("$27.23", "100 AED → $27.23", "compact");

  container.style.backgroundColor = "rgb(255, 255, 255)";
  wrapper.style.color = "rgb(20, 20, 20)";
  wrapper.append(source);
  container.append(wrapper);
  document.body.append(container);

  insertBadgeAfterTextNode(source, badge);

  expectEqual(
    badge.style.color,
    "rgb(20, 20, 20)",
    "transparent nested compact badge text color"
  );
  expectEqual(
    badge.style.background,
    "rgba(20, 20, 20, 0.07)",
    "transparent nested compact badge background"
  );
}

{
  const { source, container } = createStyledContainer(
    "rgb(20, 20, 20)",
    "rgb(255, 255, 255)"
  );
  const context = getBadgeColorContext(source, container);

  expectEqual(
    context?.isSharedBackground,
    true,
    "shared background color context"
  );
  expectEqual(
    context?.textColor,
    "rgb(20, 20, 20)",
    "shared background context text color"
  );
}

{
  const { source } = createStyledContainer(
    "rgba(255, 255, 255, 0.6)",
    "rgb(20, 20, 20)"
  );
  const badge = createBadge("$27.23", "100 AED → $27.23");

  insertBadgeAfter(source, badge);

  expectEqual(
    badge.style.color,
    "rgba(255, 255, 255, 0.6)",
    "semi-transparent badge text color"
  );
  expectEqual(
    badge.style.background,
    "rgba(255, 255, 255, 0.07)",
    "semi-transparent badge background"
  );
}

{
  const { source } = createStyledContainer(
    "rgba(20, 20, 20, 0.5)",
    "rgb(255, 255, 255)"
  );
  const badge = createBadge("$27.23", "100 AED → $27.23", "minimal");

  insertBadgeAfter(source, badge);

  expectEqual(
    badge.style.color,
    "rgba(20, 20, 20, 0.5)",
    "minimal badge derived translucent text color"
  );
  expectEqual(badge.style.background, "transparent", "minimal badge background");
}
