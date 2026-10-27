// Loads one real page in Chromium with the built extension (dist/) and reports
// which visible prices and measurements received a conversion badge.
//
//   npx tsx scripts/site-check.ts --url <url> --out <dir> [--target USD]
//     [--mode everything|currencies|units] [--wait 8000] [--scrolls 3] [--headed]
//     [--locale en-US] [--click "<css selector>"]...
import { chromium, type BrowserContext } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

type Options = {
  url: string;
  out: string;
  target: string;
  mode: string;
  wait: number;
  scrolls: number;
  headed: boolean;
  locale: string;
  clicks: string[];
  /** Serve the main document from a dom-capture snapshot under the original URL. */
  snapshot: string;
  /** A JavaScript expression file evaluated in the page at the end; its value goes into the report. */
  evalFile: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    url: "", out: "", target: "USD", mode: "everything", wait: 8000, scrolls: 3,
    headed: false, locale: "en-US", clicks: [], snapshot: "", evalFile: "",
  };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index + 1];
    switch (argv[index]) {
      case "--url": options.url = value; index++; break;
      case "--out": options.out = value; index++; break;
      case "--target": options.target = value.toUpperCase(); index++; break;
      case "--mode": options.mode = value; index++; break;
      case "--wait": options.wait = Number(value); index++; break;
      case "--scrolls": options.scrolls = Number(value); index++; break;
      case "--locale": options.locale = value; index++; break;
      case "--click": options.clicks.push(value); index++; break;
      case "--snapshot": options.snapshot = value; index++; break;
      case "--eval": options.evalFile = value; index++; break;
      case "--headed": options.headed = true; break;
    }
  }
  if (!options.url || !options.out) {
    throw new Error("Usage: --url <url> --out <dir> [--target USD] [--mode everything]");
  }
  return options;
}

async function configureExtension(context: BrowserContext, options: Options): Promise<void> {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  await worker.evaluate(async (settings) => {
    await chrome.storage.sync.set({ "euc-settings": settings });
  }, {
    targetCurrency: options.target, enabled: true, converterMode: options.mode,
    badgeStyle: "default", badgeVisibility: "always", unitSystem: "metric",
    targetLengthUnit: "auto", targetWeightUnit: "auto", targetTemperatureUnit: "auto",
    whitelist: [], blacklist: [],
  });
}

// Runs in the page: finds the smallest visible elements whose text looks like a
// price or a measurement and checks whether a badge was rendered next to them.
function analyzePage(): unknown {
  const BADGE = '[data-ehinium-badge="true"]';
  const currencyToken =
    "(?:\\b[A-Z]{3}\\b|US\\$|C\\$|A\\$|S\\$|HK\\$|NT\\$|NZ\\$|R\\$|MX\\$|[$€£¥₹₩₺₽₪₫฿₱₦₴]|USD|EUR|GBP|AED|SAR|QAR|KWD|BHD|OMR|EGP|TRY|TL|JPY|CNY|RMB|INR|KRW|IRR|IRT|PKR|IDR|Rp|MYR|RM|SGD|THB|VND|PHP|CHF|SEK|NOK|DKK|PLN|zł|CZK|Kč|HUF|Ft|RON|lei|kr|Rs\\.?|AUD|CAD|NZD|MXN|BRL|ZAR|円|元|ريال|تومان|درهم|دينار|جنيه|ر\\.س|د\\.إ|ج\\.م|ر\\.ق|د\\.ك)";
  const digit = "[0-9۰-۹٠-٩]";
  const priceRegex = new RegExp(
    `${currencyToken}\\s?[-+]?${digit}|${digit}[0-9۰-۹٠-٩.,٬٫'\\s\\u00a0\\u202f]*\\s?${currencyToken}`, "u");
  const unitRegex =
    /[0-9۰-۹٠-٩]+(?:[.,][0-9۰-۹٠-٩]+)?\s?(?:"|″|''|-?(?:inch(?:es)?|in)\b|-?(?:cm|mm|kg|lbs?|oz|ft|feet|ml|l|gal)\b|°\s?[FC]\b|سانتی\u200c?متر|کیلوگرم|گرم|اینچ)/iu;
  const badges = [...document.querySelectorAll<HTMLElement>(BADGE)];

  function isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  }

  function describe(element: Element): string {
    const id = element.id ? `#${element.id}` : "";
    const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join("");
    return `${element.tagName.toLowerCase()}${id}${classes}`;
  }

  // A badge whose middle lies outside a box with hidden overflow (a fixed-size
  // swatch tile) cannot be read, so it does not cover its price.
  function isClippedOut(badge: Element): boolean {
    const rect = badge.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (let current = badge.parentElement, depth = 0; current && depth < 15; current = current.parentElement, depth++) {
      const style = getComputedStyle(current);
      if (!/hidden|clip/u.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const box = current.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return true;
    }
    return false;
  }

  function nearbyBadge(element: Element): "visible" | "clipped" | null {
    let clipped = false;
    let current: Element | null = element;
    for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
      const nearby = [...current.querySelectorAll(BADGE)];
      const next = current.nextElementSibling;
      if (next?.matches(BADGE)) nearby.push(next);
      for (const badge of nearby) {
        if (!isClippedOut(badge)) return "visible";
        clipped = true;
      }
    }
    return clipped ? "clipped" : null;
  }

  function collect(regex: RegExp) {
    const candidates: Element[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (element.closest(`${BADGE}, script, style, noscript, svg, [data-euc-owned="true"]`)) continue;
      const text = (element as HTMLElement).innerText?.trim() ?? "";
      if (!text || text.length > 80 || !regex.test(text)) continue;
      // keep the smallest matching element
      const childMatches = [...element.children].some((child) =>
        regex.test((child as HTMLElement).innerText ?? "") && isVisible(child));
      if (childMatches) continue;
      if (!isVisible(element)) continue;
      candidates.push(element);
    }
    const covered: string[] = [];
    const missed: { text: string; element: string; ariaHidden: boolean; inButton: boolean; badgeClipped: boolean }[] = [];
    for (const element of candidates) {
      const text = (element as HTMLElement).innerText.trim().replace(/\s+/gu, " ");
      const badge = nearbyBadge(element);
      if (badge === "visible") {
        covered.push(text);
      } else {
        missed.push({
          text,
          element: describe(element),
          ariaHidden: element.closest('[aria-hidden="true"]') !== null,
          inButton: element.closest('button, [role="button"], a, label') !== null,
          badgeClipped: badge === "clipped",
        });
      }
    }
    return {
      total: candidates.length,
      covered: covered.length,
      coveredSamples: covered.slice(0, 25),
      missed: missed.slice(0, 60),
      missedCount: missed.length,
      clippedBadgeCount: missed.filter((entry) => entry.badgeClipped).length,
    };
  }

  const keyCounts = new Map<string, number>();
  const badgeKeys = new Map<string, number>();
  for (const badge of badges) {
    const container = badge.parentElement;
    const key = `${badge.getAttribute("data-ehinium-key")}@${container ? describe(container) : "?"}`;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    const badgeKey = `${badge.getAttribute("data-ehinium-key")}${isClippedOut(badge) ? " (clipped)" : ""}`;
    badgeKeys.set(badgeKey, (badgeKeys.get(badgeKey) ?? 0) + 1);
  }

  return {
    title: document.title,
    finalUrl: location.href,
    badgeCount: badges.length,
    hiddenBadgeCount: badges.filter((badge) => badge.getAttribute("aria-hidden") === "true" || !isVisible(badge)).length,
    overlayBadgeCount: document.querySelectorAll('[data-euc-overlay-badge="true"]').length,
    duplicateBadgeGroups: [...keyCounts.entries()].filter(([, count]) => count > 1).slice(0, 20),
    // Every conversion on the page, to compare two builds exactly.
    badgeKeys: [...badgeKeys.entries()].sort(([first], [second]) => first.localeCompare(second)).slice(0, 600),
    prices: collect(priceRegex),
    units: collect(unitRegex),
    bodyTextSample: document.body.innerText.slice(0, 600),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const extensionPath = resolve(import.meta.dirname, "..", "dist");
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const profile = resolve(tmpdir(), `euc-site-check-${process.pid}-${Date.now()}`);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    // Override when the bundled Playwright expects a Chromium build that is not installed.
    executablePath: process.env.EUC_CHROMIUM_PATH || undefined,
    headless: !options.headed,
    viewport: { width: 1440, height: 900 },
    locale: options.locale,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      // Extra flags for network quirks, e.g. a VPN path that drops large TLS ClientHellos.
      ...(process.env.EUC_CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? [])],
  });
  const events: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const screenshots: string[] = [];
  let analysis: unknown;
  let evaluation: unknown = null;
  let navigationError: string | null = null;
  try {
    await configureExtension(context, options);
    await context.addInitScript(() => {
      try { localStorage.setItem("ehinium-debug", "true"); } catch { /* storage blocked */ }
    });
    const page = context.pages()[0] ?? await context.newPage();
    page.on("console", async (message) => {
      if (!message.text().startsWith("[EUC debug]")) return;
      try {
        const payload = await message.args()[1]?.jsonValue();
        if (payload && typeof payload === "object") events.push(payload as Record<string, unknown>);
      } catch { /* handle disposed */ }
    });
    if (options.snapshot) {
      const body = await readFile(resolve(options.snapshot), "utf8");
      await page.route((url) => url.href === new URL(options.url).href, (route) =>
        route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
    }
    page.on("pageerror", (error) => {
      if (/euc|ehinium|chrome-extension/iu.test(`${error.message}\n${error.stack ?? ""}`)) errors.push(error.message);
    });
    try {
      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (error) {
      navigationError = String(error);
    }
    await page.waitForTimeout(options.wait);
    for (const selector of options.clicks) {
      try {
        await page.locator(selector).first().click({ timeout: 5000 });
        await page.waitForTimeout(3000);
      } catch (error) {
        errors.push(`click ${selector} failed: ${String(error).slice(0, 200)}`);
      }
    }
    for (let index = 0; index <= options.scrolls; index++) {
      const path = resolve(outDir, `shot-${index}.png`);
      await page.screenshot({ path });
      screenshots.push(path);
      if (index === options.scrolls) break;
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(2500);
    }
    // tsx (esbuild keepNames) wraps nested functions in __name(), which the page lacks.
    await page.evaluate("globalThis.__name = globalThis.__name || ((target) => target)");
    analysis = await page.evaluate(analyzePage);
    if (options.evalFile) evaluation = await page.evaluate(await readFile(resolve(options.evalFile), "utf8"));
  } finally {
    await context.close().catch(() => {});
  }

  const summarizeEvents = (type: string) => events.filter((event) => event.type === type);
  const report = {
    url: options.url,
    target: options.target,
    navigationError,
    extensionErrors: errors,
    eventCounts: events.reduce<Record<string, number>>((counts, event) => {
      const type = String(event.type);
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {}),
    renderedCurrency: summarizeEvents("render:badge").slice(0, 40).map((event) => `${event.text} -> ${event.formatted}`),
    renderedUnits: summarizeEvents("render:unit-badge").slice(0, 40).map((event) => `${event.text} -> ${event.formatted}`),
    hoverConversions: summarizeEvents("render:hover-conversion").map((event) => `${event.text} -> ${event.formatted}`),
    skips: events.filter((event) => String(event.type).startsWith("skip")).slice(0, 30),
    analysis,
    evaluation,
    screenshots,
  };
  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    url: options.url,
    navigationError,
    title: (analysis as { title?: string } | null)?.title,
    badges: (analysis as { badgeCount?: number } | null)?.badgeCount,
    prices: (analysis as { prices?: { total: number; covered: number } } | null)?.prices
      && `${(analysis as { prices: { covered: number } }).prices.covered}/${(analysis as { prices: { total: number } }).prices.total}`,
    units: (analysis as { units?: { total: number; covered: number } } | null)?.units
      && `${(analysis as { units: { covered: number } }).units.covered}/${(analysis as { units: { total: number } }).units.total}`,
    report: resolve(outDir, "report.json"),
  }));
}

await main();
