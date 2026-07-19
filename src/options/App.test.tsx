import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ComponentType, ReactNode } from "react";
import type { Root } from "react-dom/client";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import type { UserSettings } from "../types/settings";

const SETTINGS_KEY = "euc-settings";
const THEME_KEY = "euc-theme";

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

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  expect(element, `Expected to find ${selector}`);
  return element;
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === name
  );
  expect(button, `Expected button named ${name}`);
  return button;
}

function getToggle(name: string): HTMLInputElement {
  const toggle = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
    (candidate) => candidate.textContent?.trim() === name
  )?.querySelector<HTMLInputElement>('[data-slot="radio-group-item"]');
  expect(toggle, `Expected toggle named ${name}`);
  return toggle;
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

const browserWindow = new Window({ url: "chrome-extension://ehinium/settings.html" });

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
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

let intersectionCallback: IntersectionObserverCallback | null = null;
let observedSectionIds = new Set<string>();
let lastScrolledSectionId: string | null = null;

class TestIntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    intersectionCallback = callback;
    this.rootMargin = options?.rootMargin ?? "0px";
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
  }

  observe(target: Element): void {
    observedSectionIds.add(target.id);
  }

  unobserve(target: Element): void {
    observedSectionIds.delete(target.id);
  }

  disconnect(): void {
    observedSectionIds = new Set();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: TestIntersectionObserver,
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
  hasPointerCapture: (): boolean => false,
  setPointerCapture: (): void => undefined,
  releasePointerCapture: (): void => undefined,
})) {
  Object.defineProperty(browserWindow.HTMLElement.prototype, name, {
    configurable: true,
    value,
  });
}
Object.defineProperty(browserWindow.Element.prototype, "scrollIntoView", {
  configurable: true,
  value(this: Element) {
    lastScrolledSectionId = this.id;
  },
});

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const mediaListeners = new Set<(event: { matches: boolean }) => void>();
Object.defineProperty(browserWindow, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => mediaListeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }),
});

let storedSettings = structuredClone(initialSettings);
let storedTheme = "system";
let settingsWriteCount = 0;
let themeWriteCount = 0;
let networkRequestCount = 0;
let holdNextSettingsWrite = false;
let releaseSettingsWrite: (() => void) | null = null;
let failNextSettingsWrite = false;
const storageListeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();

const chromeStub = {
  runtime: {
    getManifest: () => ({ version: "0.2.1" }),
    openOptionsPage: async () => undefined,
  },
  storage: {
    sync: {
      async get(key: string): Promise<Record<string, unknown>> {
        if (key === THEME_KEY) return { [THEME_KEY]: storedTheme };
        return { [SETTINGS_KEY]: structuredClone(storedSettings) };
      },
      async set(values: Record<string, unknown>): Promise<void> {
        if (THEME_KEY in values) {
          storedTheme = String(values[THEME_KEY]);
          themeWriteCount += 1;
          storageListeners.forEach((listener) => listener({ [THEME_KEY]: { newValue: storedTheme } }, "sync"));
          return;
        }

        if (failNextSettingsWrite) {
          failNextSettingsWrite = false;
          throw new Error("Simulated settings save failure");
        }

        if (holdNextSettingsWrite) {
          holdNextSettingsWrite = false;
          await new Promise<void>((resolve) => { releaseSettingsWrite = resolve; });
        }

        storedSettings = structuredClone(values[SETTINGS_KEY] as UserSettings);
        settingsWriteCount += 1;
      },
    },
    onChanged: {
      addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) {
        storageListeners.add(listener);
      },
      removeListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) {
        storageListeners.delete(listener);
      },
    },
  },
  tabs: {
    async query(): Promise<Array<{ id: number; url: string }>> {
      return [{ id: 9, url: "https://shop.example.com/product" }];
    },
    async sendMessage(): Promise<void> {
      return undefined;
    },
  },
};

Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeStub });
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => {
    networkRequestCount += 1;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return [{ date: "2026-07-10", base: "USD", quote: "EUR", rate: 0.92 }];
      },
    };
  },
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");

async function waitFor(assertion: () => void, description: string, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw new Error(`${description}: ${String(lastError)}`);
}

function setNativeValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = control instanceof browserWindow.HTMLSelectElement
    ? browserWindow.HTMLSelectElement.prototype
    : control instanceof browserWindow.HTMLTextAreaElement
      ? browserWindow.HTMLTextAreaElement.prototype
      : browserWindow.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  expect(setter, "Expected native value setter");
  setter.call(control, value);
}

async function changeValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
  eventType: "change" | "input"
): Promise<void> {
  await act(async () => {
    setNativeValue(control, value);
    control.dispatchEvent(new browserWindow.Event(eventType, { bubbles: true }) as unknown as Event);
  });
}

async function openSection(name: string): Promise<void> {
  const button = getButton(name);
  const sectionId = button.getAttribute("aria-controls");
  expect(sectionId, `${name} navigation should identify its section`);
  await act(async () => { button.click(); });
  await waitFor(
    () => {
      expectEqual(button.getAttribute("aria-current"), "page", `${name} active navigation state`);
      expectEqual(lastScrolledSectionId, sectionId, `${name} scroll target`);
    },
    `${name} navigation`
  );
}

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } },
  define: { __EUC_DIAGNOSTICS__: "false" },
  root: process.cwd(),
  server: { middlewareMode: true, watch: { ignored: ["**/performance-audits/**"] } },
});

let root: Root | null = null;

try {
  const appModule = (await vite.ssrLoadModule("/src/options/App.tsx")) as { default: ComponentType };
  const themeModule = (await vite.ssrLoadModule("/src/components/theme-provider.tsx")) as {
    ThemeProvider: ComponentType<{ children: ReactNode }>;
  };

  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(themeModule.ThemeProvider, null, createElement(appModule.default)));
  });

  await waitFor(() => expect(document.querySelector("#extension-enabled"), "Options settings did not load"), "options load");

  expect(document.querySelector("h1")?.textContent === "Settings", "Dedicated settings shell should render");
  expect(
    document.querySelector("header")?.textContent?.includes("Ehinium Universal Converter"),
    "Settings header should expose the exact product name"
  );
  const settingsHeader = getElement<HTMLElement>("header");
  const settingsLogo = getElement<HTMLImageElement>('header img[src="/icons/icon-128.png"]');
  expect(settingsLogo.classList.contains("size-9"), "Settings header should retain a compact visible logo");
  expect(!settingsHeader.textContent?.includes("Configure conversions, website rules, and appearance."), "Settings header should remove the descriptive sentence");
  expect(settingsHeader.classList.contains("border-b") && settingsHeader.classList.contains("border-border"), "Settings header should retain its subtle bottom separator");
  expectEqual(
    Array.from(document.querySelectorAll("nav button"), (button) => button.textContent?.trim()),
    ["General", "Currencies", "Units", "Website rules", "Appearance", "About"],
    "settings navigation"
  );
  expectEqual(getButton("General").getAttribute("aria-current"), "page", "active navigation state");
  expectEqual(
    Array.from(document.querySelectorAll("section h2"), (heading) => heading.textContent?.trim()),
    ["General", "Currencies", "Units", "Website rules", "Appearance", "About"],
    "all settings sections should remain mounted in document order"
  );
  expectEqual(
    Array.from(observedSectionIds),
    ["general", "currencies", "units", "website-rules", "appearance", "about"],
    "scrollspy section observations"
  );
  for (const button of document.querySelectorAll<HTMLButtonElement>("nav button")) {
    const sectionId = button.getAttribute("aria-controls");
    expect(sectionId && document.getElementById(sectionId), `${button.textContent} should target a stable section id`);
  }

  const unitsSection = getElement<HTMLElement>("#units");
  await act(async () => {
    intersectionCallback?.(
      [{ target: unitsSection, isIntersecting: true, intersectionRatio: 0.8 } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  });
  expectEqual(getButton("Units").getAttribute("aria-current"), "page", "scrollspy active navigation state");
  await openSection("General");

  const optionsSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const generalSectionSource = readFileSync(new URL("./components/GeneralSection.tsx", import.meta.url), "utf8");
  const optionsHeaderSource = readFileSync(new URL("./components/OptionsHeader.tsx", import.meta.url), "utf8");
  const optionsSectionSource = readFileSync(new URL("./components/OptionsSection.tsx", import.meta.url), "utf8");
  const currenciesSectionSource = readFileSync(new URL("./components/CurrenciesSection.tsx", import.meta.url), "utf8");
  const unitsSectionSource = readFileSync(new URL("./components/UnitsSection.tsx", import.meta.url), "utf8");
  const themeControlSource = readFileSync(new URL("./components/ThemePreferenceControl.tsx", import.meta.url), "utf8");
  const appearanceSectionSource = readFileSync(new URL("./components/AppearanceSection.tsx", import.meta.url), "utf8");
  const settingsGroupSource = readFileSync(new URL("./components/SettingsGroup.tsx", import.meta.url), "utf8");
  const settingsRowSource = readFileSync(new URL("./components/SettingsRow.tsx", import.meta.url), "utf8");
  const controlWidthsSource = readFileSync(new URL("./components/settings-control-widths.ts", import.meta.url), "utf8");
  const segmentedControlSource = readFileSync(new URL("../components/SegmentedControl.tsx", import.meta.url), "utf8");
  const selectSource = readFileSync(new URL("../components/ui/select.tsx", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../components/ui/input.tsx", import.meta.url), "utf8");
  const optionsCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
  const globalsCss = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");
  expect(!optionsSource.includes("SettingsApp"), "Options must not use the legacy shared composition");
  expect(
    generalSectionSource.includes('import { SegmentedControl } from "../../components/SegmentedControl"') &&
      themeControlSource.includes('import { SegmentedControl } from "../../components/SegmentedControl"'),
    "Settings should use the shared conversion-mode component"
  );
  expect(
    !generalSectionSource.includes('role="radiogroup"') &&
      !themeControlSource.includes('role="radiogroup"'),
    "Theme and Conversion mode should not duplicate segmented-control markup"
  );
  expect(settingsGroupSource.includes('<Card className="gap-0 overflow-hidden py-0">'), "Settings groups should use the shared Card without radius overrides");
  expect(settingsGroupSource.includes('<FieldGroup className="gap-0">'), "Grouped rows should use one edge-to-edge content region");
  expect(settingsGroupSource.includes("<Separator />"), "Grouped settings should use direct 1px separators");
  expect(!/Card className=.*(?:rounded|shadow|ring|border)/u.test(settingsGroupSource), "Card usage must not override official surface geometry");
  expect(settingsRowSource.includes('flex min-h-14 flex-col items-stretch justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6'), "Settings rows share one responsive alignment contract");
  expect(settingsRowSource.includes('space-y-1'), "Settings rows use a consistent title-to-description gap");
  expect(segmentedControlSource.includes('RadioGroup'), "Shared segmented control uses single-selection radios");
  expect(segmentedControlSource.includes('grid-cols-3') && segmentedControlSource.includes('rounded-lg bg-muted p-1'), "Theme and Conversion mode share one connected visual treatment");
  expect(segmentedControlSource.includes('bg-background text-foreground shadow-sm') && !segmentedControlSource.includes('bg-primary'), "Shared segmented selection uses a raised neutral surface");
  expect(!segmentedControlSource.includes('bg-foreground text-background'), "Shared segmented selection avoids foreground/background inversion");
  expect(appearanceSectionSource.includes("SelectTrigger") && appearanceSectionSource.includes("SelectContent"), "Short appearance choices use the shared Radix Select");
  expect(![appearanceSectionSource, currenciesSectionSource, unitsSectionSource].some((source) => source.includes("NativeSelect") || source.includes("<select")), "Settings have no native select usage");
  expect(!globalsCss.includes("native-select"), "Obsolete native-select dark-mode CSS is removed");
  expect(!/(?:SelectTrigger)[^>]*className="[^"]*(?:h-|rounded-|py-|px-|text-|leading-|shadow-|ring-|border-)/u.test(appearanceSectionSource), "Settings selects do not override official control geometry");
  expect(inputSource.includes('h-9 w-full min-w-0 rounded-md border border-input') && selectSource.includes('data-[size=default]:h-9') && selectSource.includes('rounded-md border border-input'), "Input and SelectTrigger share the official height, radius, and border contract");
  expect(inputSource.includes('focus-visible:ring-[3px] focus-visible:ring-ring/50') && selectSource.includes('focus-visible:ring-[3px] focus-visible:ring-ring/50'), "Input and SelectTrigger share the official focus treatment");
  expect(selectSource.includes("<SelectScrollUpButton />") && selectSource.includes("<SelectScrollDownButton />"), "SelectContent preserves official scroll controls");
  expect(selectSource.includes("SelectPrimitive.Portal") && selectSource.includes("max-h-(--radix-select-content-available-height)") && selectSource.includes("overflow-y-auto"), "SelectContent uses the official portal and bounded scroll viewport");
  expect(!optionsSource.includes("switch (activeSection)"), "Options must not conditionally replace active sections");
  expect(optionsSource.includes('className="grid gap-12"'), "Options should render a continuous section stack");
  expect(optionsSource.includes("max-w-[1120px]"), "Options shell should retain its restrained desktop width contract");
  expect(optionsSource.includes("lg:grid-cols-[192px_minmax(0,1fr)]") && optionsSource.includes("lg:gap-10"), "Options shell should use the refined desktop grid");
  expect(optionsSource.includes('max-w-[780px]'), "Options main content should remain width-constrained");
  expect(optionsHeaderSource.includes('max-w-[1120px]') && optionsHeaderSource.includes('px-6') && optionsHeaderSource.includes('sm:px-8'), "Settings header should align with the page grid");
  expect(optionsHeaderSource.includes('py-3') && !optionsHeaderSource.includes('py-4'), "Settings header should use reduced vertical padding");
  expect(optionsHeaderSource.includes('size-9') && !optionsHeaderSource.includes('size-10'), "Settings header should use the reduced logo size");
  expect(optionsHeaderSource.includes('gap-2.5') && optionsHeaderSource.includes('gap-0.5'), "Settings header should use compact horizontal and title spacing");
  expect(optionsHeaderSource.includes('text-[22px]') && optionsHeaderSource.includes('text-xs'), "Settings header should use the compact title and product-name scale");
  expect(!optionsHeaderSource.includes('Configure conversions, website rules, and appearance.'), "Settings header source should omit the former description");
  expect(optionsSectionSource.includes('gap-5') && optionsSectionSource.includes('mt-1.5'), "Sections should share the refined vertical rhythm");
  expect(controlWidthsSource.includes('short: "w-full sm:w-52 sm:max-w-[50%]"') && controlWidthsSource.includes('standard: "w-full sm:w-72 sm:max-w-[50%]"') && controlWidthsSource.includes('wide: "w-full sm:w-80 sm:max-w-[50%]"'), "Control widths should use shared responsive presets");
  expect(appearanceSectionSource.match(/settingsControlWidths\.short/gu)?.length === 2, "Equivalent appearance selects should share the short width preset");
  expect(currenciesSectionSource.includes('settingsControlWidths.wide'), "Currency controls should use the wide width preset");
  expect(!unitsSectionSource.includes('controlClassName='), "Equivalent unit selects should share the standard default width");
  expect(!/#[0-9a-f]{3,8}\b/iu.test(optionsCss), "Options document CSS should not use hard-coded colors");
  expect(/overflow-x\s*:\s*hidden/u.test(optionsCss), "Options document should prevent horizontal scrolling");

  const activeNavigation = getButton("General");
  const masterSwitch = getElement<HTMLButtonElement>("#extension-enabled");
  expect(activeNavigation.classList.contains("h-9"), "Settings navigation retains its compact approved height");
  expect(activeNavigation.classList.contains("bg-secondary"), "Selected navigation should use a semantic neutral surface");
  expect(!activeNavigation.classList.contains("bg-primary"), "Selected navigation should not use the brand surface");
  expect(document.querySelector("section h2")?.className.includes("text-[22px]"), "Section headings should use the compact 22px scale");
  expect(masterSwitch.closest<HTMLElement>(".flex.min-h-14") !== null, "Switch row uses stable horizontal alignment");
  expect(!/<Switch[\s\S]*?className=/u.test(generalSectionSource), "Switch usage should not override official geometry");

  for (const token of [
    "background",
    "foreground",
    "card",
    "card-foreground",
    "secondary",
    "secondary-foreground",
    "muted",
    "muted-foreground",
    "accent",
    "accent-foreground",
    "border",
    "input",
  ]) {
    const declarations = Array.from(
      globalsCss.matchAll(new RegExp(`--${token}:\\s*oklch\\([^\\n;]+`, "gu")),
      (match) => match[0]
    );
    expect(declarations.length > 0, `Expected semantic token --${token}`);
    for (const declaration of declarations) {
      const chroma = declaration.match(/oklch\([^\s]+\s+([^\s/)]+)/u)?.[1];
      expectEqual(chroma, "0", `${token} should remain neutral`);
    }
  }

  expectEqual(masterSwitch.getAttribute("role"), "switch", "master switch role");
  expectEqual(document.querySelector('[data-slot="item"]'), null, "Settings rows use the stable shared row layout");
  for (const id of ["extension-enabled", "target-currency", "unit-system", "length-target", "weight-target", "temperature-target", "badge-style", "badge-visibility"]) {
    expectEqual(
      getElement<HTMLElement>(`#${id}`).closest<HTMLElement>(".flex.min-h-14") !== null,
      true,
      `${id} stable horizontal row alignment`
    );
  }

  const conversionModeGroup = getElement<HTMLDivElement>('#conversion-mode[data-slot="radio-group"]');
  const conversionModeButtons = Array.from(
    conversionModeGroup.querySelectorAll<HTMLInputElement>('[data-slot="radio-group-item"]')
  );
  expectEqual(
    Array.from(conversionModeGroup.querySelectorAll("label > span")).map((button) => button.textContent?.trim()),
    ["Currency", "Units", "Everything"],
    "settings shared conversion modes"
  );

  holdNextSettingsWrite = true;
  await act(async () => { conversionModeButtons[1]?.click(); });
  await waitFor(() => expect(masterSwitch.disabled, "Controls should disable while saving"), "saving disabled state");
  expect(conversionModeButtons.every((button) => button.disabled), "Dependent modes should disable while saving");
  await act(async () => { releaseSettingsWrite?.(); });
  await waitFor(() => expectEqual(storedSettings.converterMode, "units", "units mode persistence"), "units mode save");
  await act(async () => { conversionModeButtons[2]?.click(); });
  await waitFor(() => expectEqual(storedSettings.converterMode, "everything", "everything mode persistence"), "everything mode save");

  await act(async () => { masterSwitch.click(); });
  await waitFor(() => expectEqual(storedSettings.enabled, false, "master disable persistence"), "master disable");
  expect(conversionModeButtons.every((button) => button.disabled), "Global disable should disable conversion settings");
  await act(async () => { masterSwitch.click(); });
  await waitFor(() => expectEqual(storedSettings.enabled, true, "master enable persistence"), "master enable");

  await openSection("Currencies");
  await chooseSelect("target-currency", "USD - United States Dollar", 155);
  await waitFor(() => expectEqual(storedSettings.targetCurrency, "USD", "target currency persistence"), "target currency save");
  await act(async () => { getButton("Refresh").click(); });
  await waitFor(() => expect(networkRequestCount >= 2, "Rate refresh should use configured providers"), "rate refresh requests");
  await waitFor(() => expect(document.querySelector(".rate-status")?.textContent?.includes("Updated just now"), "Rate refresh status"), "rate refresh status");

  await openSection("Units");
  for (const [id, value, key] of [
    ["unit-system", "imperial", "unitSystem"],
    ["length-target", "in", "targetLengthUnit"],
    ["weight-target", "lb", "targetWeightUnit"],
    ["temperature-target", "f", "targetTemperatureUnit"],
  ] as const) {
    const optionLabel = {
      "unit-system": "Imperial",
      "length-target": "Inches (in)",
      "weight-target": "Pounds (lb)",
      "temperature-target": "Fahrenheit (deg F)",
    }[id];
    await chooseSelect(id, optionLabel);
    await waitFor(() => expectEqual(String(storedSettings[key]), value, `${key} persistence`), `${key} save`);
  }

  await openSection("Website rules");
  const whitelistField = getElement<HTMLTextAreaElement>("#whitelist-domains");
  await changeValue(whitelistField, " amazon.com \n\nebay.co.uk", "input");
  await waitFor(() => expectEqual(storedSettings.whitelist, ["amazon.com", "ebay.co.uk"], "whitelist normalization"), "whitelist save");
  await changeValue(getElement<HTMLTextAreaElement>("#blacklist-domains"), "example.com\nblocked.test", "input");
  await waitFor(() => expectEqual(storedSettings.blacklist, ["example.com", "blocked.test"], "blacklist normalization"), "blacklist save");
  await openSection("About");
  const aboutSection = getElement<HTMLElement>("#about");
  const autosaveStatus = Array.from(document.querySelectorAll<HTMLElement>('[role="status"]')).find(
    (element) => element.textContent?.includes("Settings saved automatically.")
  );
  expect(Boolean(autosaveStatus), "Global autosave status should remain available");
  expect(!aboutSection.contains(autosaveStatus ?? null), "Global autosave status should not be part of About");
  await openSection("Website rules");
  expect(
    getElement<HTMLTextAreaElement>("#whitelist-domains") === whitelistField,
    "Navigation should preserve mounted field identity and drafts"
  );

  await openSection("Appearance");
  const themeGroup = getElement<HTMLDivElement>('[data-slot="radio-group"][aria-label="Theme preference"]');
  expect(themeGroup.classList.contains("grid-cols-3"), "Theme uses the shared connected segmented control");
  expectEqual(getToggle("System").dataset.state, "checked", "default theme preference");
  await act(async () => { getToggle("Dark").click(); });
  await waitFor(() => expectEqual(storedTheme, "dark", "dark theme persistence"), "dark theme save");
  expectEqual(document.documentElement.dataset.theme, "dark", "dark theme immediate application");
  await act(async () => {
    const darkToggle = getToggle("Dark");
    darkToggle.focus();
    darkToggle.dispatchEvent(new browserWindow.KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", bubbles: true }) as unknown as KeyboardEvent);
  });
  expect(document.activeElement === getToggle("Light"), "Theme Toggle Group supports arrow-key roving focus");
  await act(async () => { getToggle("Light").click(); });
  await waitFor(() => expectEqual(storedTheme, "light", "theme keyboard persistence"), "theme keyboard navigation");
  expectEqual(document.documentElement.dataset.theme, "light", "light theme immediate application");
  await act(async () => { getToggle("System").click(); });
  await waitFor(() => expectEqual(storedTheme, "system", "system theme persistence"), "system theme save");
  expectEqual(document.documentElement.dataset.theme, "light", "system theme resolution");
  expect(themeWriteCount >= 3, "Theme changes should persist through Chrome sync storage");

  await chooseSelect("badge-style", "Compact");
  await waitFor(() => expectEqual(storedSettings.badgeStyle, "compact", "badge style persistence"), "badge style save");
  await chooseSelect("badge-visibility", "Show on hover");
  await waitFor(() => expectEqual(storedSettings.badgeVisibility, "hover", "badge visibility persistence"), "badge visibility save");

  failNextSettingsWrite = true;
  await chooseSelect("badge-style", "Minimal");
  await waitFor(
    () => expect(document.querySelector('[role="alert"]')?.textContent?.includes("Simulated settings save failure"), "Save error should be visible"),
    "save error status"
  );

  await openSection("About");
  expect(aboutSection.textContent?.includes("0.2.1"), "About should expose manifest version");
  expect(aboutSection.textContent?.includes("Frankfurter with Fawaz fallback"), "About should expose existing providers");
  expect(aboutSection.textContent?.includes("Ehsan Rabipour"), "About should identify the creator");
  const creatorName = Array.from(aboutSection.querySelectorAll("p")).find(
    (element) => element.textContent?.trim() === "Ehsan Rabipour"
  );
  expectEqual(creatorName?.nextElementSibling?.textContent?.trim(), "Creator", "creator subtitle");
  expect(
    !aboutSection.textContent?.includes("Product designer and creator of Ehinium Universal Converter."),
    "About should remove the former creator subtitle"
  );
  expect(
    !aboutSection.textContent?.includes("Designed and built by Ehsan Rabipour."),
    "About should remove the standalone creator description"
  );
  expect(
    !Array.from(aboutSection.querySelectorAll("h1, h2, h3, h4, h5, h6, [data-slot='card-title']")).some(
      (element) => element.textContent?.trim() === "Creator"
    ),
    "About should remove the standalone Creator heading"
  );
  const versionLabel = Array.from(aboutSection.querySelectorAll("p")).find(
    (element) => element.textContent?.trim() === "Version"
  );
  const projectLabel = Array.from(aboutSection.querySelectorAll("p")).find(
    (element) => element.textContent?.trim() === "Project and legal"
  );
  expect(Boolean(projectLabel), "Project and legal should remain visible");
  expectEqual(projectLabel?.className, versionLabel?.className, "shared About label typography");

  const expectedAboutLinks = [
    ["Email", "mailto:hello@ehsanrp.com", false],
    ["Telegram", "https://t.me/ehinium", true],
    ["X", "https://x.com/ehinium", true],
    ["Instagram", "https://instagram.com/ehinium", true],
    ["GitHub repository", "https://github.com/ehinium/ehinium-universal-converter", true],
    ["Privacy policy", "https://ehinium.github.io/ehinium-universal-converter/privacy.html", true],
  ] as const;

  for (const [label, href, external] of expectedAboutLinks) {
    const link = aboutSection.querySelector<HTMLAnchorElement>(`a[aria-label^="${label}:"]`);
    expect(Boolean(link), `${label} link should have an accessible name`);
    expectEqual(link?.getAttribute("href"), href, `${label} link destination`);
    expect(Boolean(link?.textContent?.trim()), `${label} link should have a visible label`);
    if (external) {
      expectEqual(link?.getAttribute("target"), "_blank", `${label} external target`);
      const rel = link?.getAttribute("rel")?.split(/\s+/) ?? [];
      expect(rel.includes("noreferrer") && rel.includes("noopener"), `${label} external rel safety`);
    } else {
      expectEqual(link?.getAttribute("target"), null, `${label} mail link target`);
    }
  }
  expect(settingsWriteCount >= 12, "Options interactions should persist through the settings controller");
} finally {
  if (root) {
    await act(async () => { root?.unmount(); });
  }
  await vite.close();
  browserWindow.close();
}
