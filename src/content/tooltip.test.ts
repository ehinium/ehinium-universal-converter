import { Window } from "happy-dom";
import { EHINIUM_TOOLTIP_CLASS } from "./domExclusions";
import { hideTooltip, showTooltip } from "./tooltip";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  HTMLElement: window.HTMLElement,
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

function getTooltipCount(): number {
  return document.querySelectorAll(`[data-ehinium-tooltip="true"]`).length;
}

showTooltip(10, 20, "869,900 AMD → $2,372.30");

const tooltip = document.querySelector<HTMLElement>(
  `[data-ehinium-tooltip="true"]`
);

expectEqual(getTooltipCount(), 1, "custom tooltip count after first show");
expectEqual(
  tooltip?.classList.contains(EHINIUM_TOOLTIP_CLASS),
  true,
  "custom tooltip class"
);
expectEqual(
  tooltip?.textContent,
  "869,900 AMD → $2,372.30",
  "custom tooltip content"
);
expectEqual(tooltip?.style.visibility, "visible", "custom tooltip visible");
expectEqual(tooltip?.hasAttribute("title"), false, "custom tooltip native title");

showTooltip(30, 40, "869,900 AMD → $2,372.30");

expectEqual(getTooltipCount(), 1, "custom tooltip count after repeated show");

hideTooltip();

expectEqual(tooltip?.style.visibility, "hidden", "custom tooltip hidden");
