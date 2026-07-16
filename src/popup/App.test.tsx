import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
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
  HTMLFormElement: browserWindow.HTMLFormElement,
  HTMLInputElement: browserWindow.HTMLInputElement,
  HTMLSelectElement: browserWindow.HTMLSelectElement,
  HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
  DOMRect: browserWindow.DOMRect,
  DocumentFragment: browserWindow.DocumentFragment,
  Event: browserWindow.Event,
  CustomEvent: browserWindow.CustomEvent,
  MouseEvent: browserWindow.MouseEvent,
  PointerEvent: browserWindow.PointerEvent,
  KeyboardEvent: browserWindow.KeyboardEvent,
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

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

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

let storedSettings = cloneSettings(initialSettings);
let storageReadCount = 0;
let storageWriteCount = 0;
let openOptionsPageCount = 0;
let clipboardWriteCount = 0;
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
    async sendMessage(_tabId: number, message: { type?: string }): Promise<unknown> {
      if (message.type === "diagnostics:get-report") {
        return { ok: true, report: null };
      }
      return undefined;
    },
  },
};

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: chromeStub,
});

Object.defineProperty(browserWindow.navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(): Promise<void> {
      clipboardWriteCount += 1;
    },
  },
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

async function chooseSelect(id: string, label: string, expectedOptionCount?: number): Promise<void> {
  const trigger = getElement<HTMLButtonElement>(`#${id}`);
  await act(async () => {
    trigger.dispatchEvent(new browserWindow.PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerType: "mouse",
    }) as unknown as PointerEvent);
  });
  const option = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (expectedOptionCount !== undefined) {
    expectEqual(document.querySelectorAll('[data-slot="select-item"]').length, expectedOptionCount, `${id} option count`);
  }
  expect(option, `Expected ${id} option ${label}`);
  await act(async () => {
    option.focus();
    option.dispatchEvent(new browserWindow.KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
      code: "Enter",
    }) as unknown as KeyboardEvent);
  });
}

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../", import.meta.url)),
    },
  },
  define: { __EUC_DIAGNOSTICS__: "true" },
  root: process.cwd(),
  server: { middlewareMode: true, watch: { ignored: ["**/performance-audits/**"] } },
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
  const popupSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const quickSettingsSource = readFileSync(new URL("./components/QuickSettings.tsx", import.meta.url), "utf8");
  const manualPanelSource = readFileSync(new URL("./components/ManualConversionPanel.tsx", import.meta.url), "utf8");
  const popupHeaderSource = readFileSync(new URL("./components/PopupHeader.tsx", import.meta.url), "utf8");
  const switchRowSource = readFileSync(new URL("./components/SettingSwitchRow.tsx", import.meta.url), "utf8");
  expect(
    quickSettingsSource.includes('import { SegmentedControl } from "../../components/SegmentedControl"'),
    "Popup should use the shared conversion-mode component"
  );
  expect(
    !quickSettingsSource.includes('role="radiogroup"'),
    "Popup should not duplicate segmented-control markup"
  );
  expect(quickSettingsSource.includes("SelectTrigger") && quickSettingsSource.includes("SelectContent"), "Popup currency uses the shared Radix Select");
  expect(!quickSettingsSource.includes("NativeSelect"), "Popup has no native select usage");
  expect(!/(?:SelectTrigger|Input)[^>]*className="[^"]*(?:h-|rounded-)/u.test(quickSettingsSource), "Popup controls must not override official geometry");
  expect(quickSettingsSource.includes("collisionPadding={8}") && quickSettingsSource.includes("max-h-[min(20rem,var(--radix-select-content-available-height))]"), "Popup currency menu has a stable viewport-aware height cap");
  expect(quickSettingsSource.includes("z-(--layer-dropdown)") && quickSettingsSource.includes("w-[var(--radix-select-trigger-width)]"), "Popup currency menu uses the semantic dropdown layer and trigger width");
  expect(manualPanelSource.includes('<Card className="flex items-center gap-3 p-2.5">'), "Manual result uses the shared Card surface without a radius override");
  expect(!/Card[^>]*className="[^"]*(?:rounded|shadow|ring|border)/u.test(manualPanelSource), "Manual result must not override official Card surface");
  expect(popupHeaderSource.includes('className="h-8 px-2 text-xs"'), "Popup Settings action retains its compact approved geometry");
  expect(!/<Switch[\s\S]*?className=/u.test(switchRowSource), "Popup switches must use official geometry");
  expect(
    /html,\s*[\r\n]+body,\s*[\r\n]+#root\s*\{[^}]*width:\s*440px;[^}]*min-width:\s*440px;[^}]*max-width:\s*440px;/u.test(
      popupCss
    ),
    "Popup CSS should hard-code html/body/root to 440px"
  );
  expect(!popupCss.includes("780px"), "Popup CSS must not include options width");
  expect(!popupCss.includes("max-width: 100vw"), "Popup CSS must not use viewport width");
  expect(!popupCss.includes("@media (max-width"), "Popup CSS must not have responsive width breakpoints");
  expect(
    !/(?:min-|max-)?height\s*:\s*[^;]*(?:vh|%)/u.test(popupCss),
    "Popup document and shell must not use viewport-relative or percentage heights"
  );
  expect(
    !/\b(?:h-full|min-h-full|h-screen|max-h-screen)\b/u.test(popupSource),
    "Popup shell must not use Tailwind viewport or percentage-height utilities"
  );
  expect(
    !popupSource.includes("popup-scroll"),
    "Outer popup shell must not be the legacy short scroll container"
  );
  expectEqual(
    popupCss.match(/overflow-y\s*:/gu)?.length ?? 0,
    1,
    "popup vertical scroll region count"
  );
  expect(
    /body\s*\{[^}]*overflow-y\s*:\s*auto/u.test(popupCss),
    "Only the popup document body should provide vertical scrolling"
  );
  expect(
    /\.popup-shell\s*\{[^}]*min-height\s*:\s*max-content[^}]*overflow\s*:\s*visible/u.test(popupCss),
    "Popup shell should retain intrinsic height and visible overflow"
  );
  expect(
    !/\b(?:absolute|fixed)\b/u.test(
      popupSource.slice(
        popupSource.indexOf("<main"),
        popupSource.lastIndexOf("</main>")
      )
    ),
    "Popup header and content should remain in normal document flow"
  );

  const popupShell = getElement<HTMLElement>("main.popup-shell");
  const popupHeader = getElement<HTMLElement>("main.popup-shell > header");
  const targetCurrencyInFlow = getElement<HTMLButtonElement>("#target-currency");
  expect(
    popupShell.firstElementChild === popupHeader,
    "Popup header should be the first element in the shell's normal flow"
  );
  expect(
    Boolean(
      popupHeader.compareDocumentPosition(targetCurrencyInFlow) &
        browserWindow.Node.DOCUMENT_POSITION_FOLLOWING
    ),
    "Popup content after the header should remain later in document flow"
  );
  expectEqual(
    popupShell.lastElementChild?.tagName,
    "FOOTER",
    "popup footer flow position"
  );
  expect(popupShell.classList.contains("p-4"), "Popup should retain 16px outer padding");
  expect(
    !Array.from(popupShell.classList).some((className) => className.startsWith("gap-")),
    "Popup shell should not add a second spacing layer around separators"
  );
  const popupContent = getElement<HTMLElement>(".popup-content");
  expect(popupContent.classList.contains("gap-5"), "Major popup blocks should use a 20px rhythm");
  const popupSeparators = Array.from(popupShell.querySelectorAll<HTMLElement>(":scope > [role='none']"));
  expect(
    popupSeparators.length >= 2 && popupSeparators.every((separator) => separator.classList.contains("my-4")),
    "Popup separators should use consistent 16px vertical spacing"
  );
  const quickSettings = getElement<HTMLElement>('section[aria-label="Quick settings"]');
  expect(quickSettings.classList.contains("gap-5"), "Quick settings fields should use the major spacing rhythm");
  expect(
    Array.from(quickSettings.children).every((field) => field.classList.contains("gap-2")),
    "Popup labels and controls should use an 8px gap"
  );
  const manualSection = getElement<HTMLElement>('[aria-labelledby="manual-conversion-title"]');
  expect(manualSection.querySelector('[data-slot="field"]')?.classList.contains("gap-3"), "Manual conversion groups should use a 12px gap");
  expect(manualSection.querySelector('[data-slot="field"]')?.firstElementChild?.classList.contains("gap-1"), "Manual title and description should use a 4px gap");
  expect(popupHeader.classList.contains("min-h-12"), "Popup header should retain its compact 48px minimum");
  expectEqual(
    popupHeader.querySelector("img")?.getAttribute("src"),
    "/icons/icon-128.png",
    "popup high-resolution icon source"
  );

  expectEqual(
    Array.from(document.querySelectorAll("main section h2"), (heading) =>
      heading.textContent?.trim()
    ),
    ["Manual conversion", "Development diagnostics"],
    "popup section order"
  );

  expectEqual(
    document.querySelector("h1")?.textContent?.trim(),
    "Ehinium Universal Converter",
    "popup product name"
  );
  expect(
    document.querySelector("header")?.textContent?.includes("Active"),
    "Popup header should expose active status"
  );
  expect(
    document.querySelector(".diagnostics-panel"),
    "Diagnostics panel should retain its compile-time-enabled popup placement"
  );

  const masterToggle = getElement<HTMLButtonElement>("#extension-enabled");
  const masterLabels = masterToggle.labels;
  expectEqual(masterToggle.type, "button", "master switch native button type");
  expectEqual(masterToggle.getAttribute("role"), "switch", "master toggle role");
  expect(masterLabels, "Master toggle should expose its associated label");
  expectEqual(masterLabels.length, 1, "master toggle label association");
  expect(
    masterLabels[0]?.textContent?.includes("Enable converter"),
    "Master toggle should have the visible accessible label"
  );
  expectEqual(masterToggle.disabled, false, "master toggle remains operable");

  const labeledControlIds = [
    "target-currency",
    "manual-conversion-input",
    "current-site-enabled",
  ];

  for (const id of labeledControlIds) {
    const control = getElement<
      HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement
    >(`#${id}`);
    const labels = control.labels;
    expect(labels, `#${id} should expose its associated labels`);
    expect(labels.length > 0, `#${id} should use a native label association`);
  }

  const conversionModeGroup = getElement<HTMLDivElement>('[data-slot="radio-group"][aria-labelledby="conversion-mode-label"]');
  const conversionModeButtons = Array.from(
    conversionModeGroup.querySelectorAll<HTMLInputElement>('[data-slot="radio-group-item"]')
  );
  expect(conversionModeGroup.classList.contains("grid-cols-3"), "Conversion mode uses the shared connected segmented control");
  expect(conversionModeGroup.classList.contains("bg-muted"), "Conversion mode uses neutral segmented background");
  const [currencyOnlyMode, unitsOnlyMode, everythingMode] = conversionModeButtons;
  expectEqual(
    Array.from(conversionModeGroup.querySelectorAll("label > span")).map((button) => button.textContent?.trim()),
    ["Currency", "Units", "Everything"],
    "shared conversion modes"
  );
  expect(currencyOnlyMode && unitsOnlyMode && everythingMode, "Expected all three conversion modes");
  expectEqual(currencyOnlyMode.dataset.state, "checked", "initial segmented mode");
  expectEqual(unitsOnlyMode.dataset.state, "unchecked", "inactive units mode");
  expectEqual(everythingMode.dataset.state, "unchecked", "inactive everything mode");
  expect(conversionModeGroup.classList.contains("grid-cols-3"), "Segmented items share width equally");
  expect(getElement<HTMLButtonElement>("#target-currency").classList.contains("data-[size=default]:h-9"), "Popup select uses the official default sizing");
  expect(getElement<HTMLInputElement>("#manual-conversion-input").classList.contains("h-9"), "Popup input uses shared sizing");

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

  expect(document.querySelector('[aria-label="Exchange rate status"]'), "Popup should expose compact rate status");
  expect(!document.querySelector(".rate-status button"), "Popup should not add a new rate refresh action");

  const openSettingsButton = getElement<HTMLButtonElement>('[aria-label="Open settings"]');
  expectEqual(openSettingsButton.type, "button", "open settings native button type");
  expectEqual(openSettingsButton.title, "Open settings", "settings icon title");
  expectEqual(openSettingsButton.textContent?.trim(), "Settings", "visible settings action label");
  expectEqual(openSettingsButton.firstElementChild?.tagName, "SPAN", "settings label should precede icon");
  expectEqual(openSettingsButton.lastElementChild?.tagName, "svg", "settings action icon position");
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
    ).filter((control) =>
      control !== masterToggle &&
      control !== openSettingsButton &&
      !control.closest(".diagnostics-panel")
    );

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

  await act(async () => {
    unitsOnlyMode.click();
  });
  await waitFor(
    () =>
      expectEqual(
        storedSettings.converterMode,
        "units",
        "stored conversion mode"
      ),
    "conversion-mode persistence"
  );

  await act(async () => {
    everythingMode.click();
  });
  await waitFor(
    () => expectEqual(storedSettings.converterMode, "everything", "stored everything mode"),
    "everything-mode persistence"
  );

  await act(async () => {
    everythingMode.focus();
    everythingMode.dispatchEvent(
      new browserWindow.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }) as unknown as KeyboardEvent
    );
  });
  expect(document.activeElement === unitsOnlyMode, "ArrowLeft moves Toggle Group focus");
  await act(async () => {
    (document.activeElement as HTMLButtonElement).click();
  });
  await waitFor(
    () => expectEqual(storedSettings.converterMode, "units", "keyboard-focused segmented mode"),
    "conversion-mode keyboard activation"
  );
  await act(async () => {
    const currentEverythingMode = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
      (label) => label.textContent?.trim() === "Everything"
    )?.querySelector<HTMLInputElement>('[data-slot="radio-group-item"]');
    currentEverythingMode?.click();
  });
  await waitFor(
    () => expectEqual(storedSettings.converterMode, "everything", "restored segmented mode"),
    "conversion-mode keyboard restoration"
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
        getElement<HTMLInputElement>('[data-slot="radio-group-item"][data-state="checked"]').value,
        "everything",
        "remounted conversion mode"
      ),
    "settings remount"
  );
  expect(storageReadCount >= 2, "Remount should reload settings from Chrome storage");
  expect(storageWriteCount >= 3, "Interactive changes should auto-save to storage");
  document.documentElement.dataset.theme = "dark";
  expectEqual(document.documentElement.dataset.theme, "dark", "dark theme root compatibility");
  document.documentElement.dataset.theme = "light";
  expectEqual(document.documentElement.dataset.theme, "light", "light theme root compatibility");

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
  expect(
    document.querySelector("#manual-conversion-state")?.textContent?.includes("Converting"),
    "Manual converter should expose its loading state"
  );
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
  await chooseSelect("target-currency", "USD - United States Dollar", 155);
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

  const copyButton = getElement<HTMLButtonElement>("#manual-conversion-state button");
  expect(copyButton.textContent?.includes("Copy"), "Manual result should expose a named copy action");
  await act(async () => {
    copyButton.click();
  });
  await waitFor(
    () => expect(copyButton.textContent?.includes("Copied"), "Copy feedback should be announced in the control name"),
    "manual copy feedback"
  );
  expectEqual(clipboardWriteCount, 1, "manual copy clipboard write");

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
} finally {
  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount();
    });
  }

  await vite.close();
  browserWindow.close();
}
