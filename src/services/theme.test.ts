import type { ThemePreference } from "../types/theme";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  getThemePreference,
  normalizeThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeToThemePreferenceChanges,
} from "./theme";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

let storedValue: unknown;
let failRead = false;
let failWrite = false;
let savedValues: Record<string, unknown> | null = null;
const listeners = new Set<StorageListener>();

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      sync: {
        async get(): Promise<Record<string, unknown>> {
          if (failRead) {
            throw new Error("Storage unavailable");
          }

          return storedValue === undefined
            ? {}
            : { [THEME_STORAGE_KEY]: storedValue };
        },
        async set(values: Record<string, unknown>): Promise<void> {
          if (failWrite) {
            throw new Error("Storage unavailable");
          }

          savedValues = values;
        },
      },
      onChanged: {
        addListener(listener: StorageListener): void {
          listeners.add(listener);
        },
        removeListener(listener: StorageListener): void {
          listeners.delete(listener);
        },
      },
    },
  },
});

for (const preference of ["system", "light", "dark"] as const) {
  expectEqual(
    normalizeThemePreference(preference),
    preference,
    `normalize valid ${preference}`
  );
}

for (const invalid of [undefined, null, "sepia", 42, {}, []]) {
  expectEqual(
    normalizeThemePreference(invalid),
    DEFAULT_THEME_PREFERENCE,
    `normalize invalid ${String(invalid)}`
  );
}

storedValue = undefined;
expectEqual(await getThemePreference(), "system", "missing storage value");

for (const preference of ["system", "light", "dark"] as const) {
  storedValue = preference;
  expectEqual(await getThemePreference(), preference, `read stored ${preference}`);
}

storedValue = "unexpected";
expectEqual(await getThemePreference(), "system", "invalid stored value");

failRead = true;
expectEqual(await getThemePreference(), "system", "storage read failure fallback");
failRead = false;

expectEqual(await saveThemePreference("dark"), true, "successful theme save");
expectEqual(
  savedValues?.[THEME_STORAGE_KEY],
  "dark",
  "theme saved under isolated key"
);

failWrite = true;
expectEqual(await saveThemePreference("light"), false, "storage write failure");
failWrite = false;

expectEqual(resolveTheme("system", false), "light", "system light resolution");
expectEqual(resolveTheme("system", true), "dark", "system dark resolution");
expectEqual(resolveTheme("light", true), "light", "explicit light resolution");
expectEqual(resolveTheme("dark", false), "dark", "explicit dark resolution");

const received: ThemePreference[] = [];
const unsubscribe = subscribeToThemePreferenceChanges((preference) => {
  received.push(preference);
});

expectEqual(listeners.size, 1, "theme storage listener registration");

for (const listener of listeners) {
  listener(
    { [THEME_STORAGE_KEY]: { oldValue: "system", newValue: "light" } },
    "sync"
  );
  listener(
    { "euc-settings": { oldValue: {}, newValue: {} } },
    "sync"
  );
  listener(
    { [THEME_STORAGE_KEY]: { oldValue: "light", newValue: "dark" } },
    "local"
  );
  listener(
    { [THEME_STORAGE_KEY]: { oldValue: "light", newValue: "invalid" } },
    "sync"
  );
}

expectEqual(received.length, 2, "only sync theme changes emitted");
expectEqual(received[0], "light", "valid storage change emitted");
expectEqual(received[1], "system", "invalid storage change normalized");

unsubscribe();
expectEqual(listeners.size, 0, "theme storage listener cleanup");
