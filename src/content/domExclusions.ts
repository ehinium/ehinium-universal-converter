export const EHINIUM_IGNORE_ATTRIBUTE = "data-ehinium-ignore";
export const EHINIUM_TOOLTIP_CLASS = "ehinium-converter-tooltip";

const EXCLUDED_CONTENT_SELECTORS = [
  "script",
  "style",
  "noscript",
  "code",
  "pre",
  "textarea",
  "input",
  "select",
  "option",
  '[contenteditable="true"]',
  "[data-ehinium-converted]",
  "[data-ehinium-badge]",
  `[${EHINIUM_IGNORE_ATTRIBUTE}="true"]`,
  `.${EHINIUM_TOOLTIP_CLASS}`,
];

export const EXCLUDED_CONTENT_SELECTOR = EXCLUDED_CONTENT_SELECTORS.join(", ");

function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList].slice(0, 3).map((name) => `.${name}`).join("");
  return `<${element.tagName.toLowerCase()}${id}${classes}>`;
}

export type ContentExclusionDetail = {
  rule: string;
  element: Element;
  reason: string;
  category: "extension-ui" | "source-content";
};

export function getContentExclusionDetail(node: Node): ContentExclusionDetail | null {
  const element = node instanceof Element ? node : node.parentElement;

  if (!element) {
    return null;
  }

  for (const selector of EXCLUDED_CONTENT_SELECTORS) {
    const excludedAncestor = element.closest(selector);
    if (excludedAncestor) {
      const category = /ehinium/iu.test(selector) ? "extension-ui" : "source-content";
      return {
        rule: selector,
        element: excludedAncestor,
        reason: `Matched excluded ancestor selector ${selector} on ${describeElement(excludedAncestor)}`,
        category,
      };
    }
  }

  return null;
}

export function getContentExclusionReason(node: Node): string | null {
  const element = node instanceof Element ? node : node.parentElement;

  if (!element) {
    return "Node has no parent element";
  }

  return getContentExclusionDetail(element)?.reason ?? null;
}

export function isInsideExcludedContent(node: Node): boolean {
  return getContentExclusionReason(node) !== null;
}
