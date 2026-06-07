export const EHINIUM_IGNORE_ATTRIBUTE = "data-ehinium-ignore";
export const EHINIUM_TOOLTIP_CLASS = "ehinium-converter-tooltip";

export const EXCLUDED_CONTENT_SELECTOR = [
  "script",
  "style",
  "noscript",
  "textarea",
  "input",
  "select",
  "option",
  "[data-ehinium-converted]",
  "[data-ehinium-badge]",
  `[${EHINIUM_IGNORE_ATTRIBUTE}="true"]`,
  `.${EHINIUM_TOOLTIP_CLASS}`,
].join(", ");

export function isInsideExcludedContent(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(EXCLUDED_CONTENT_SELECTOR) != null;
}
