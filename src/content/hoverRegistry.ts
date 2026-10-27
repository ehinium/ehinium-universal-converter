export type HoverTarget = {
  element: HTMLElement;
  content: string;
};

const EXTENSION_TITLE_OWNER_SELECTOR =
  "[data-ehinium-badge], [data-ehinium-hover], [data-ehinium-converted]";

let hoverTargets = new WeakMap<HTMLElement, HoverTarget>();
let hoverIdentities = new WeakMap<HTMLElement, Map<string, string>>();

export function removeExtensionOwnedTitle(element: HTMLElement): void {
  if (element.matches(EXTENSION_TITLE_OWNER_SELECTOR)) {
    element.removeAttribute("title");
  }
}

export function removeExtensionOwnedTitles(root: ParentNode): void {
  if (root instanceof HTMLElement) {
    removeExtensionOwnedTitle(root);
  }

  for (const element of root.querySelectorAll<HTMLElement>(
    EXTENSION_TITLE_OWNER_SELECTOR
  )) {
    element.removeAttribute("title");
  }
}

export function registerHoverTarget(
  element: HTMLElement,
  content: string
): void {
  removeExtensionOwnedTitle(element);
  hoverTargets.set(element, {
    element,
    content,
  });
}

export function getHoverTarget(element: HTMLElement): HoverTarget | null {
  return hoverTargets.get(element) ?? null;
}

export function getClosestHoverTarget(element: HTMLElement): HoverTarget | null {
  let current: HTMLElement | null = element;

  while (current) {
    const target = getHoverTarget(current);

    if (target) {
      return target;
    }

    current = current.parentElement;
  }

  return null;
}

/**
 * `combine` keeps every conversion registered on the element, one per line:
 * a swatch tile whose price and list price both lost their badges shows both.
 * Otherwise the latest conversion replaces the tooltip.
 */
export function registerHoverConversionTarget(
  element: HTMLElement,
  content: string,
  identity: string,
  combine = false
): boolean {
  const conversions = hoverIdentities.get(element) ?? new Map<string, string>();

  if (conversions.has(identity)) {
    return false;
  }

  conversions.set(identity, content);
  hoverIdentities.set(element, conversions);
  registerHoverTarget(element, combine ? [...conversions.values()].join("\n") : content);
  return true;
}

export function clearHoverTargets(): void {
  hoverTargets = new WeakMap<HTMLElement, HoverTarget>();
  hoverIdentities = new WeakMap<HTMLElement, Map<string, string>>();
}
