import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import type { UserSettings } from "../types/settings";

const STORAGE_KEY = "euc-settings";

const initialSettings: UserSettings = {
  targetCurrency: "EUR",
  enabled: true,
  converterMode: "currencies",
  badgeStyle: "default",
  badgeVisibility: "always",
  unitSystem: "auto",
  targetLengthUnit: "auto",
  targetWeightUnit: "auto",
  targetTemperatureUnit: "auto",
  whitelist: [],
  blacklist: [],
};

function cloneSettings(settings: UserSettings): UserSettings {
  return {
    ...settings,
    whitelist: [...settings.whitelist],
    blacklist: [...settings.blacklist],
  };
}

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) {
    throw new Error(description);
  }
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  expect(element, `Expected to find ${selector}`);
  return element;
}

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
  HTMLInputElement: browserWindow.HTMLInputElement,
  HTMLSelectElement: browserWindow.HTMLSelectElement,
  HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
  Event: browserWindow.Event,
  MouseEvent: browserWindow.MouseEvent,
  KeyboardEvent: browserWindow.KeyboardEvent,
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

let storedSettings = cloneSettings(initialSettings);
let storageReadCount = 0;
let storageWriteCount = 0;
let openOptionsPageCount = 0;
let resolveFirstStorageRead!: () => void;
const firstStorageReadGate = new Promise<void>((resolve) => {
  resolveFirstStorageRead = resolve;
});

const chromeStub = {
  runtime: {
    async openOptionsPage(): Promise<void> {
      openOptionsPageCount += 1;
    },
  },
  storage: {
    sync: {
      async get(): Promise<Record<string, UserSettings>> {
        storageReadCount += 1;

        if (storageReadCount === 1) {
          await firstStorageReadGate;
        }

        return { [STORAGE_KEY]: cloneSettings(storedSettings) };
      },
      async set(values: Record<string, UserSettings>): Promise<void> {
        storageWriteCount += 1;
        storedSettings = cloneSettings(values[STORAGE_KEY]);
      },
    },
  },
  tabs: {
    async query(): Promise<Array<{ id: number; url: string }>> {
      return [{ id: 7, url: "https://shop.example.com/product" }];
    },
    async sendMessage(): Promise<void> {
      return Promise.resolve();
    },
  },
};

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: chromeStub,
});

let networkRequestCount = 0;
let allowRateRequests = false;

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => {
    networkRequestCount += 1;

    if (!allowRateRequests) {
      throw new Error("Unexpected network request in popup integration test");
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return [
          {
            date: "2026-07-10",
            base: "USD",
            quote: "EUR",
            rate: 0.92,
          },
        ];
      },
    };
  },
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");

async function waitFor(
  assertion: () => void,
  description: string,
  timeoutMs = 2_000
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error(
    `${description}: ${lastError instanceof Error ? lastError.message : "timed out"}`
  );
}

function setNativeValue(
  control: HTMLInputElement | HTMLSelectElement,
  value: string
): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(control),
    "value"
  );

  expect(descriptor?.set, `Expected a native value setter for #${control.id}`);
  descriptor.set.call(control, value);
}

async function changeValue(
  control: HTMLInputElement | HTMLSelectElement,
  value: string,
  eventType: "change" | "input"
): Promise<void> {
  await act(async () => {
    setNativeValue(control, value);
    control.dispatchEvent(
      new browserWindow.Event(eventType, { bubbles: true }) as unknown as Event
    );
  });
}

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [react()],
  define: { __EUC_DIAGNOSTICS__: "false" },
  root: process.cwd(),
  server: { middlewareMode: true },
});

let activeRoot: Root | null = null;

try {
  const popupModule = (await vite.ssrLoadModule("/src/popup/App.tsx")) as {
    default: ComponentType;
  };
  const App = popupModule.default;

  function mountApp(): Root {
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const root = createRoot(container);
    activeRoot = root;
    return root;
  }

  let root = mountApp();

  await act(async () => {
    root.render(createElement(App));
  });

  expect(
    document.querySelector('[role="status"]')?.textContent?.includes("Loading settings"),
    "Popup should expose its initial loading state"
  );
  resolveFirstStorageRead();

  await waitFor(
    () => expect(document.querySelector("main section"), "Settings did not load"),
    "settings load"
  );

  const popupCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
  expect(
    /html,\s*[\r\n]+body,\s*[\r\n]+#root\s*\{[^}]*width:\s*440px;[^}]*min-width:\s*440px;[^}]*max-width:\s*440px;/u.test(
      popupCss
    ),
    "Popup CSS should hard-code html/body/root to 440px"
  );
  expect(!popupCss.includes("780px"), "Popup CSS must not include options width");
  expect(!popupCss.includes("max-width: 100vw"), "Popup CSS must not use viewport width");
  expect(!popupCss.includes("@media (max-width"), "Popup CSS must not have responsive width breakpoints");

  expectEqual(
    Array.from(document.querySelectorAll("main section h2"), (heading) =>
      heading.textContent?.trim()
    ),
    ["Manual conversion"],
    "popup section order"
  );

  const masterToggle = getElement<HTMLInputElement>("#extension-enabled");
  const masterLabels = masterToggle.labels;
  expectEqual(masterToggle.type, "checkbox", "master toggle native input type");
  expectEqual(masterToggle.getAttribute("role"), "switch", "master toggle role");
  expect(masterLabels, "Master toggle should expose its associated label");
  expectEqual(masterLabels.length, 1, "master toggle label association");
  expect(
    masterLabels[0]?.textContent?.includes("Enable converter"),
    "Master toggle should have the visible accessible label"
  );
  expectEqual(masterToggle.disabled, false, "master toggle remains operable");

  const labeledControlIds = [
    "conversion-mode",
    "target-currency",
    "manual-conversion-input",
    "current-site-enabled",
  ];

  for (const id of labeledControlIds) {
    const control = getElement<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(`#${id}`);
    const labels = control.labels;
    expect(labels, `#${id} should expose its associated labels`);
    expect(labels.length > 0, `#${id} should use a native label association`);
  }

  for (const movedControlId of [
    "badge-style",
    "badge-visibility",
    "unit-system",
    "length-target",
    "weight-target",
    "temperature-target",
    "whitelist-domains",
    "blacklist-domains",
  ]) {
    expect(
      !document.querySelector(`#${movedControlId}`),
      `#${movedControlId} should move out of the popup`
    );
  }

  expect(
    !document.querySelector(".rate-status"),
    "Rate diagnostics should move out of the popup"
  );

  const openSettingsButton = getElement<HTMLButtonElement>(".button--primary");
  expectEqual(openSettingsButton.type, "button", "open settings native button type");
  expect(
    openSettingsButton.textContent?.includes("Open settings"),
    "Popup should expose an Open settings command"
  );
  await act(async () => {
    openSettingsButton.click();
  });
  expectEqual(openOptionsPageCount, 1, "Open settings should call chrome.runtime.openOptionsPage");

  type NativeControl =
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement;
  const getDependentControls = (): NativeControl[] =>
    Array.from(
      document.querySelectorAll<NativeControl>("button, input, select, textarea")
    ).filter((control) => control !== masterToggle && control !== openSettingsButton);

  expect(getDependentControls().length >= 4, "Expected popup dependent native controls");
  expect(
    getDependentControls().every((control) => !control.disabled),
    "Dependent controls should initially be enabled"
  );

  await act(async () => {
    masterToggle.click();
  });
  await waitFor(
    () => expectEqual(storedSettings.enabled, false, "stored disabled state"),
    "disable persistence"
  );
  expectEqual(masterToggle.disabled, false, "master toggle stays enabled when off");
  expect(
    getDependentControls().every((control) => control.disabled),
    "Master toggle should natively disable dependent popup controls"
  );
  expectEqual(openSettingsButton.disabled, false, "Open settings stays enabled when off");

  await act(async () => {
    masterToggle.click();
  });
  await waitFor(
    () => expectEqual(storedSettings.enabled, true, "stored enabled state"),
    "enable persistence"
  );
  expect(
    getDependentControls().every((control) => !control.disabled),
    "Master toggle should natively re-enable every dependent control"
  );

  const conversionMode = getElement<HTMLSelectElement>("#conversion-mode");
  await changeValue(conversionMode, "everything", "change");
  await waitFor(
    () =>
      expectEqual(
        storedSettings.converterMode,
        "everything",
        "stored conversion mode"
      ),
    "conversion-mode persistence"
  );

  await act(async () => {
    root.unmount();
  });
  activeRoot = null;

  root = mountApp();
  await act(async () => {
    root.render(createElement(App));
  });
  await waitFor(
    () =>
      expectEqual(
        getElement<HTMLSelectElement>("#conversion-mode").value,
        "everything",
        "remounted conversion mode"
      ),
    "settings remount"
  );
  expect(storageReadCount >= 2, "Remount should reload settings from Chrome storage");
  expect(storageWriteCount >= 3, "Interactive changes should auto-save to storage");

  const manualInput = getElement<HTMLInputElement>("#manual-conversion-input");
  expectEqual(manualInput.type, "text", "manual converter native input type");
  expectEqual(manualInput.disabled, false, "manual converter enabled state");
  expectEqual(manualInput.getAttribute("aria-invalid"), "false", "empty input validity");
  expect(
    document.querySelector("#manual-conversion-state")?.textContent?.includes(
      "Enter a value to see its conversion"
    ),
    "Manual converter should explain its empty state"
  );

  await changeValue(manualInput, "100", "input");
  await waitFor(
    () => {
      expectEqual(
        manualInput.getAttribute("aria-invalid"),
        "false",
        "incomplete input validity"
      );
      expect(
        document.querySelector("#manual-conversion-state")?.textContent?.includes(
          "complete the value"
        ),
        "Manual converter should guide an incomplete value without marking an error"
      );
    },
    "manual incomplete state"
  );

  await changeValue(manualInput, "100 EUR", "input");
  await waitFor(
    () => {
      expectEqual(
        manualInput.getAttribute("aria-invalid"),
        "false",
        "same-target input validity"
      );
      expect(
        document.querySelector("#manual-conversion-state")?.textContent?.includes(
          "already in EUR"
        ),
        "Manual converter should explain a valid no-op value"
      );
    },
    "manual same-target state"
  );
  expectEqual(networkRequestCount, 0, "same-target conversion network isolation");

  allowRateRequests = true;
  await changeValue(
    getElement<HTMLSelectElement>("#target-currency"),
    "USD",
    "change"
  );
  await waitFor(
    () => expectEqual(storedSettings.targetCurrency, "USD", "stored target currency"),
    "target-currency persistence"
  );
  await waitFor(
    () =>
      expectEqual(
        document.querySelector(".manual-converted")?.textContent,
        "$108.70",
        "100 EUR manual conversion result"
      ),
    "manual currency result"
  );
  expectEqual(manualInput.getAttribute("aria-invalid"), "false", "valid currency state");

  await changeValue(manualInput, "180 cm", "input");
  await waitFor(
    () =>
      expectEqual(
        document.querySelector(".manual-converted")?.textContent,
        "70.87 in",
        "180 cm manual conversion result"
      ),
    "manual unit result"
  );

  await changeValue(manualInput, "definitely not convertible", "input");
  await waitFor(
    () => {
      expectEqual(manualInput.getAttribute("aria-invalid"), "true", "invalid input state");
      expect(
        document.querySelector("#manual-conversion-state")?.textContent?.includes(
          "Unsupported value"
        ),
        "Manual converter should explain its unsupported state"
      );
    },
    "manual invalid state"
  );

  await changeValue(manualInput, "", "input");
  await waitFor(
    () => {
      expectEqual(manualInput.getAttribute("aria-invalid"), "false", "cleared input state");
      expect(
        document.querySelector("#manual-conversion-state")?.textContent?.includes(
          "Enter a value to see its conversion"
        ),
        "Manual converter should restore its empty state"
      );
    },
    "manual cleared state"
  );

  expectEqual(
    networkRequestCount,
    2,
    "manual conversion primary and supplemental request count"
  );

  await act(async () => {
    root.unmount();
  });
  activeRoot = null;

  const optionsModule = (await vite.ssrLoadModule("/src/options/App.tsx")) as {
    default: ComponentType;
  };
  const OptionsApp = optionsModule.default;
  root = mountApp();
  await act(async () => {
    root.render(createElement(OptionsApp));
  });
  await waitFor(
    () => expect(document.querySelector("#badge-style"), "Options settings did not load"),
    "options load"
  );

  expectEqual(
    Array.from(document.querySelectorAll("main section h2"), (heading) =>
      heading.textContent?.trim()
    ),
    ["General", "Currency", "Appearance", "Units", "Sites"],
    "options section order"
  );
  expect(!document.querySelector("#manual-conversion-input"), "Manual converter stays in popup");
  expect(!document.querySelector("#current-site-enabled"), "Current-site toggle stays in popup");
  expect(!document.querySelector(".button--primary"), "Options page should not render Open settings");

  for (const [id, value, key] of [
    ["badge-style", "compact", "badgeStyle"],
    ["badge-visibility", "hover", "badgeVisibility"],
    ["unit-system", "imperial", "unitSystem"],
    ["length-target", "in", "targetLengthUnit"],
    ["weight-target", "lb", "targetWeightUnit"],
    ["temperature-target", "f", "targetTemperatureUnit"],
  ] as const) {
    await changeValue(getElement<HTMLSelectElement>(`#${id}`), value, "change");
    await waitFor(
      () =>
        expectEqual(
          String(storedSettings[key]),
          value,
          `stored ${key} preference`
        ),
      `${key} persistence`
    );
  }

  const refreshButton = getElement<HTMLButtonElement>(".rate-status .button");
  await act(async () => {
    refreshButton.click();
  });
  await waitFor(
    () =>
      expectEqual(
        networkRequestCount,
        4,
        "manual and forced primary plus supplemental requests"
      ),
    "rate refresh request"
  );
  await waitFor(
    () =>
      expect(
        document.querySelector(".rate-status")?.textContent?.includes(
          "Updated just now"
        ),
        "Rate status should report a successful refresh"
      ),
    "rate refresh status"
  );
} finally {
  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount();
    });
  }

  await vite.close();
  browserWindow.close();
}
