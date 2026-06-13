export type HoverTarget = {
  element: HTMLElement;
  content: string;
};

let hoverTargets = new WeakMap<HTMLElement, HoverTarget>();
let hoverIdentities = new WeakMap<HTMLElement, Set<string>>();

export function registerHoverTarget(
  element: HTMLElement,
  content: string
): void {
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

export function registerHoverConversionTarget(
  element: HTMLElement,
  content: string,
  identity: string
): boolean {
  const identities = hoverIdentities.get(element) ?? new Set<string>();

  if (identities.has(identity)) {
    return false;
  }

  identities.add(identity);
  hoverIdentities.set(element, identities);
  registerHoverTarget(element, content);
  return true;
}

export function clearHoverTargets(): void {
  hoverTargets = new WeakMap<HTMLElement, HoverTarget>();
  hoverIdentities = new WeakMap<HTMLElement, Set<string>>();
}
