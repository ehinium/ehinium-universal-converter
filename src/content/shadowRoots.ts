/**
 * Prices inside open shadow roots (web components such as Pull&Bear's
 * `<price-element>`) are invisible to tree walkers, selectors and observers
 * started from the document. Scans add the open shadow roots under their
 * roots; those found are remembered so the content observer can watch them
 * and badge lookups can search them. Closed roots (the extension's own badges)
 * are out of reach by design.
 */

const knownRoots = new Set<ShadowRoot>();
let onDiscovered: ((root: ShadowRoot) => void) | null = null;

export function setShadowRootListener(listener: ((root: ShadowRoot) => void) | null): void {
  onDiscovered = listener;
}

// Roots of removed components are let go, so their detached trees can be collected.
function forgetDetachedRoots(): void {
  for (const root of knownRoots) {
    if (!root.isConnected) knownRoots.delete(root);
  }
}

export function getKnownShadowRoots(): ShadowRoot[] {
  forgetDetachedRoots();
  return [...knownRoots];
}

/** The roots followed by every open shadow root inside them, nested ones included. */
export function withOpenShadowRoots(roots: readonly Node[]): Node[] {
  forgetDetachedRoots();
  const result = [...roots];
  const seen = new Set<Node>(roots);
  for (let index = 0; index < result.length; index++) {
    const root = result[index];
    if (root.nodeType !== 1 && root.nodeType !== 11) continue;
    const walker = (root.ownerDocument ?? document).createTreeWalker(root, 1 /* SHOW_ELEMENT */);
    for (let node: Node | null = root; node; node = walker.nextNode()) {
      const shadowRoot = (node as Element).shadowRoot;
      if (!shadowRoot || seen.has(shadowRoot)) continue;
      seen.add(shadowRoot);
      result.push(shadowRoot);
      if (!knownRoots.has(shadowRoot)) {
        knownRoots.add(shadowRoot);
        onDiscovered?.(shadowRoot);
      }
    }
  }
  return result;
}

/** `document.querySelectorAll` that also searches the known shadow roots. */
export function querySelectorAllDeep<T extends Element>(selector: string): T[] {
  const found = [...document.querySelectorAll<T>(selector)];
  for (const root of getKnownShadowRoots()) found.push(...root.querySelectorAll<T>(selector));
  return found;
}

export function shadowHostOf(node: Node): Element | null {
  return node.nodeType === 11 && "host" in node ? (node as ShadowRoot).host : null;
}

/** The parent element, or the shadow host for an element at the top of a shadow root. */
export function composedParent(element: Element): Element | null {
  return element.parentElement ?? (element.parentNode ? shadowHostOf(element.parentNode) : null);
}

/** `ancestor.contains(node)` across shadow boundaries. */
export function containsComposed(ancestor: Node, node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode ?? shadowHostOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
}
