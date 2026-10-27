import { Window } from "happy-dom";
import {
  createBadge,
  getBadgeVisibleText,
  getBadgeColorContext,
  insertBadgeAfter,
  insertBadgeAfterTextNode,
  refreshBadgeColorContext,
  removeBadges,
  serializeBadgeKey,
} from "./badgeManager";
import { getHoverTarget, registerHoverConversionTarget, registerHoverTarget } from "./hoverRegistry";

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
  expectEqual(getBadgeVisibleText(badge), "Copied", "temporary copied feedback");
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
  expectEqual(badge.style.zIndex, "auto", "badge remains in local stacking context");

  await wait(950);

  expectEqual(getBadgeVisibleText(badge), "$4.70", "restored badge value");
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

  expectEqual(getBadgeVisibleText(badge), "22 lb", "failed copy badge value");
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
    badge.style.getPropertyValue("--euc-badge-color"),
    "rgb(20, 20, 20)",
    "light container badge text color"
  );
  expectEqual(
    badge.style.getPropertyValue("--euc-badge-background"),
    "rgba(20, 20, 20, 0.07)",
    "light container badge background color"
  );
}

{
  const { source } = createStyledContainer("rgb(255, 255, 255)", "rgb(20, 20, 20)");
  const badge = createBadge("$27.23", "100 AED → $27.23");

  insertBadgeAfter(source, badge);

  expectEqual(
    badge.style.getPropertyValue("--euc-badge-color"),
    "rgb(255, 255, 255)",
    "dark container badge text color"
  );
  expectEqual(
    badge.style.getPropertyValue("--euc-badge-background"),
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
    badge.style.getPropertyValue("--euc-badge-color"),
    "",
    "different background fallback badge text color"
  );
  expectEqual(
    badge.style.getPropertyValue("--euc-badge-background"),
    "",
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
    badge.style.getPropertyValue("--euc-badge-color"),
    "rgb(20, 20, 20)",
    "transparent nested compact badge text color"
  );
  expectEqual(
    badge.style.getPropertyValue("--euc-badge-background"),
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
    badge.style.getPropertyValue("--euc-badge-color"),
    "rgba(255, 255, 255, 0.6)",
    "semi-transparent badge text color"
  );
  expectEqual(
    badge.style.getPropertyValue("--euc-badge-background"),
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
    badge.style.getPropertyValue("--euc-badge-color"),
    "rgba(20, 20, 20, 0.5)",
    "minimal badge derived translucent text color"
  );
  expectEqual(badge.style.getPropertyValue("--euc-badge-background"), "", "minimal badge uses shadow background");
}

// Amazon UK swatches: a badge moved out of the tile's inner box lands on the
// tile's rim, blue once the swatch is selected (the inner box only looks white).
// It takes an opaque light pill; light text on a dark page keeps its colours.
{
  const tile = document.createElement("span");
  const inner = document.createElement("span");
  const price = document.createElement("span");
  const moved = createBadge("$29.41", "21.99 GBP → $29.41");

  tile.style.backgroundColor = "rgb(33, 98, 161)";
  price.style.color = "rgb(86, 89, 89)";
  price.textContent = "from £21.99";
  inner.append(price);
  tile.append(inner, moved);
  document.body.append(tile);
  refreshBadgeColorContext(moved, price);
  expectEqual(moved.style.getPropertyValue("--euc-badge-color"), "rgb(17, 24, 39)", "moved badge text");
  expectEqual(moved.style.getPropertyValue("--euc-badge-background"), "rgb(237, 238, 240)", "moved badge takes an opaque pill");
  tile.remove();

  const darkPage = document.createElement("div");
  const title = document.createElement("span");
  const badge = createBadge("81.28 cm", "32 in → 81.28 cm");
  darkPage.style.backgroundColor = "rgb(20, 20, 20)";
  title.style.color = "rgb(240, 240, 240)";
  title.textContent = "32 Inches";
  darkPage.append(title, badge);
  document.body.append(darkPage);
  refreshBadgeColorContext(badge, title);
  expectEqual(badge.style.getPropertyValue("--euc-badge-color"), "rgb(240, 240, 240)", "light text on a dark page keeps its colour");
  darkPage.remove();
}

// A tile whose price and list price both lost their badges shows both on hover;
// a hover conversion without `combine` replaces the earlier one.
{
  const tile = document.createElement("span");
  const label = document.createElement("span");
  document.body.append(tile, label);
  registerHoverConversionTarget(tile, "₹7,999.00 → $84.22", "7999|INR|USD", true);
  registerHoverConversionTarget(tile, "₹20,000.00 → $210.57", "20000|INR|USD", true);
  expectEqual(registerHoverConversionTarget(tile, "₹7,999.00 → $84.22", "7999|INR|USD", true), false, "same conversion registers once");
  expectEqual(getHoverTarget(tile)?.content, "₹7,999.00 → $84.22\n₹20,000.00 → $210.57", "combined hover conversions");
  registerHoverConversionTarget(label, "10 kg → 22.05 lb", "unit|10|kg");
  registerHoverConversionTarget(label, "20 kg → 44.09 lb", "unit|20|kg");
  expectEqual(getHoverTarget(label)?.content, "20 kg → 44.09 lb", "hover conversion replaced");
  tile.remove();
  label.remove();
}
