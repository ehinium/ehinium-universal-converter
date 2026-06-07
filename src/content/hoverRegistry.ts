export type HoverTarget = {
  element: HTMLElement;
  content: string;
};

let hoverTargets = new WeakMap<HTMLElement, HoverTarget>();

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

export function clearHoverTargets(): void {
  hoverTargets = new WeakMap<HTMLElement, HoverTarget>();
}
