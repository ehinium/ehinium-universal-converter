import {
  EHINIUM_IGNORE_ATTRIBUTE,
  EHINIUM_TOOLTIP_CLASS,
} from "./domExclusions";

const TOOLTIP_OFFSET = 12;

let tooltipElement: HTMLDivElement | null = null;

function getTooltipElement(): HTMLDivElement {
  if (tooltipElement?.isConnected) {
    return tooltipElement;
  }

  const element = document.createElement("div");

  element.classList.add(EHINIUM_TOOLTIP_CLASS);
  element.setAttribute(EHINIUM_IGNORE_ATTRIBUTE, "true");
  element.setAttribute("data-ehinium-tooltip", "true");
  element.setAttribute("role", "tooltip");
  element.style.position = "fixed";
  element.style.pointerEvents = "none";
  element.style.zIndex = "2147483647";
  element.style.maxWidth = "280px";
  element.style.padding = "6px 9px";
  element.style.borderRadius = "6px";
  element.style.backgroundColor = "rgba(24, 29, 38, 0.96)";
  element.style.color = "#ffffff";
  element.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.22)";
  element.style.font =
    '12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  element.style.whiteSpace = "pre-wrap";
  element.style.opacity = "0";
  element.style.visibility = "hidden";
  element.style.transition = "opacity 140ms ease, visibility 140ms ease";

  document.documentElement.append(element);
  tooltipElement = element;

  return element;
}

export function showTooltip(x: number, y: number, content: string): void {
  const tooltip = getTooltipElement();

  tooltip.textContent = content;
  tooltip.style.left = `${x + TOOLTIP_OFFSET}px`;
  tooltip.style.top = `${y + TOOLTIP_OFFSET}px`;
  tooltip.style.visibility = "visible";
  tooltip.style.opacity = "1";
}

export function hideTooltip(): void {
  if (!tooltipElement) {
    return;
  }

  tooltipElement.style.opacity = "0";
  tooltipElement.style.visibility = "hidden";
}
