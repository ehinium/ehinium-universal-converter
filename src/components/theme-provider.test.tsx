import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import { THEME_STORAGE_KEY } from "../services/theme";
import type { ThemePreference } from "../types/theme";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

type MediaListener = (event: MediaQueryListEvent) => void;
type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

const browserWindow = new Window({
  url: "chrome-extension://ehinium/index.html",
});

for (const [name, value] of Object.entries({
  window: browserWindow,
  self: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  Node: browserWindow.Node,
  Element: browserWindow.Element,
  HTMLElement: browserWindow.HTMLElement,
})) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let systemIsDark = false;
let maximumMediaListenerCount = 0;
const mediaListeners = new Set<MediaListener>();

const mediaQuery = {
  get matches(): boolean {
    return systemIsDark;
  },
  media: "(prefers-color-scheme: dark)",
  onchange: null,
  addEventListener(type: string, listener: MediaListener): void {
    if (type === "change") {
      mediaListeners.add(listener);
      maximumMediaListenerCount = Math.max(
        maximumMediaListenerCount,
        mediaListeners.size
      );
    }
  },
  removeEventListener(type: string, listener: MediaListener): void {
    if (type === "change") {
      mediaListeners.delete(listener);
    }
  },
  addListener(listener: MediaListener): void {
    mediaListeners.add(listener);
  },
  removeListener(listener: MediaListener): void {
    mediaListeners.delete(listener);
  },
  dispatchEvent(): boolean {
    return true;
  },
} as MediaQueryList;

Object.defineProperty(browserWindow, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => {
    expectEqual(
      query,
      "(prefers-color-scheme: dark)",
      "system theme media query"
    );
    return mediaQuery;
  },
});

let storedPreference: unknown;
const storageListeners = new Set<StorageListener>();

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      sync: {
        async get(): Promise<Record<string, unknown>> {
          return storedPreference === undefined
            ? {}
            : { [THEME_STORAGE_KEY]: storedPreference };
        },
        async set(): Promise<void> {
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener(listener: StorageListener): void {
          storageListeners.add(listener);
        },
        removeListener(listener: StorageListener): void {
          storageListeners.delete(listener);
        },
      },
    },
  },
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ThemeProvider } = await import("./theme-provider");

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function emitSystemTheme(isDark: boolean): void {
  systemIsDark = isDark;
  const event = { matches: isDark, media: mediaQuery.media } as MediaQueryListEvent;

  for (const listener of [...mediaListeners]) {
    listener(event);
  }
}

function emitStoredTheme(preference: ThemePreference): void {
  for (const listener of [...storageListeners]) {
    listener(
      {
        [THEME_STORAGE_KEY]: {
          oldValue: storedPreference,
          newValue: preference,
        },
      },
      "sync"
    );
  }
  storedPreference = preference;
}

async function mountProvider(): Promise<Root> {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        null,
        createElement("div", null, "Theme test") as ReactNode
      )
    );
  });
  await flushEffects();
  return root;
}

async function unmountProvider(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  expectEqual(mediaListeners.size, 0, "media listener cleanup on unmount");
  expectEqual(storageListeners.size, 0, "storage listener cleanup on unmount");
}

storedPreference = undefined;
systemIsDark = false;
let root = await mountProvider();
expectEqual(document.documentElement.dataset.theme, "light", "default system light");
expectEqual(document.documentElement.style.colorScheme, "light", "root light color scheme");
expectEqual(mediaListeners.size, 1, "system mode media listener");

await act(async () => emitSystemTheme(true));
expectEqual(document.documentElement.dataset.theme, "dark", "system change to dark");
expectEqual(document.documentElement.style.colorScheme, "dark", "root dark color scheme");
await unmountProvider(root);

storedPreference = "light";
systemIsDark = true;
root = await mountProvider();
expectEqual(document.documentElement.dataset.theme, "light", "stored light preference");
expectEqual(document.documentElement.style.colorScheme, "light", "stored light color scheme");
expectEqual(mediaListeners.size, 0, "no media listener in explicit light mode");
await act(async () => emitSystemTheme(false));
expectEqual(
  document.documentElement.dataset.theme,
  "light",
  "explicit light ignores media changes"
);
await unmountProvider(root);

storedPreference = "dark";
systemIsDark = false;
root = await mountProvider();
expectEqual(document.documentElement.dataset.theme, "dark", "stored dark preference");
expectEqual(document.documentElement.style.colorScheme, "dark", "stored dark color scheme");
expectEqual(mediaListeners.size, 0, "no media listener in explicit dark mode");
await act(async () => emitSystemTheme(true));
expectEqual(
  document.documentElement.dataset.theme,
  "dark",
  "explicit dark ignores media changes"
);
await unmountProvider(root);

storedPreference = "system";
systemIsDark = false;
maximumMediaListenerCount = 0;
root = await mountProvider();
expectEqual(mediaListeners.size, 1, "one initial system listener");

await act(async () => emitStoredTheme("light"));
expectEqual(document.documentElement.dataset.theme, "light", "storage change to light");
expectEqual(mediaListeners.size, 0, "system listener removed for stored light");

await act(async () => emitSystemTheme(true));
expectEqual(
  document.documentElement.dataset.theme,
  "light",
  "stored explicit light continues ignoring media"
);

await act(async () => emitStoredTheme("dark"));
expectEqual(document.documentElement.dataset.theme, "dark", "storage change to dark");
expectEqual(mediaListeners.size, 0, "no listener added for stored dark");

await act(async () => emitStoredTheme("system"));
expectEqual(document.documentElement.dataset.theme, "dark", "storage change to system");
expectEqual(mediaListeners.size, 1, "system listener restored once");
expectEqual(maximumMediaListenerCount, 1, "no duplicate media listeners");

await act(async () => emitSystemTheme(false));
expectEqual(document.documentElement.dataset.theme, "light", "restored system listener works");
await unmountProvider(root);

browserWindow.close();
