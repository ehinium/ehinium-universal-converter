import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

export function expect(condition: unknown, description: string): asserts condition {
  if (!condition) {
    throw new Error(description);
  }
}

export function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

export const browserWindow = new Window({
  url: "chrome-extension://ehinium/components.html",
});

for (const [name, value] of Object.entries({
  window: browserWindow,
  self: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  Node: browserWindow.Node,
  Element: browserWindow.Element,
  HTMLElement: browserWindow.HTMLElement,
  HTMLButtonElement: browserWindow.HTMLButtonElement,
  HTMLFormElement: browserWindow.HTMLFormElement,
  HTMLInputElement: browserWindow.HTMLInputElement,
  HTMLLabelElement: browserWindow.HTMLLabelElement,
  HTMLSelectElement: browserWindow.HTMLSelectElement,
  HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
  DOMRect: browserWindow.DOMRect,
  DocumentFragment: browserWindow.DocumentFragment,
  Event: browserWindow.Event,
  CustomEvent: browserWindow.CustomEvent,
  KeyboardEvent: browserWindow.KeyboardEvent,
  MouseEvent: browserWindow.MouseEvent,
  PointerEvent: browserWindow.PointerEvent,
  MutationObserver: browserWindow.MutationObserver,
  getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
  requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
  cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
})) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
  });
}

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

for (const [name, value] of Object.entries({
  scrollIntoView: (): void => undefined,
  hasPointerCapture: (): boolean => false,
  setPointerCapture: (): void => undefined,
  releasePointerCapture: (): void => undefined,
})) {
  Object.defineProperty(browserWindow.HTMLElement.prototype, name, {
    configurable: true,
    value,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

export const { act, createElement, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");

export type MountedView = {
  container: HTMLDivElement;
  root: Root;
  rerender: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
};

export async function mount(node: ReactNode): Promise<MountedView> {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);

  const rerender = async (nextNode: ReactNode): Promise<void> => {
    await act(async () => {
      root.render(nextNode);
    });
  };

  await rerender(node);

  return {
    container,
    root,
    rerender,
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function pressKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    const keyDown = new browserWindow.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    });
    element.dispatchEvent(keyDown as unknown as KeyboardEvent);
    element.dispatchEvent(
      new browserWindow.KeyboardEvent("keyup", { bubbles: true, key }) as unknown as KeyboardEvent
    );

    // Happy DOM does not synthesize the native button click that browsers
    // dispatch after un-cancelled Space/Enter activation.
    if (
      element instanceof HTMLButtonElement &&
      !keyDown.defaultPrevented &&
      (key === " " || key === "Enter")
    ) {
      element.click();
    }
  });
  await flush();
}
