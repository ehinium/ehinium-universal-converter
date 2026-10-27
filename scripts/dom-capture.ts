// Captures the real DOM of retail pages (without the extension) for debugging:
// page-level currency signals, the markup around given probe texts, and a
// static snapshot that `site-check.ts --snapshot` can replay under the
// original URL.
//
//   npx tsx scripts/dom-capture.ts <sites.json> <outDir> [name,...]
//
// sites.json: [{ "name": "...", "url": "...", "wait": 8000, "probes": ["17.90"],
//               "click": ["css selector"], "scrolls": 2 }]
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

type Site = {
  name: string;
  url: string;
  wait?: number;
  probes?: string[];
  click?: string[];
  scrolls?: number;
};

async function main(): Promise<void> {
  const [sitesFile, outDir, onlyArg] = process.argv.slice(2);
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;
  const sites = (JSON.parse(await readFile(sitesFile, "utf8")) as Site[])
    .filter((site) => !only || only.has(site.name));
  const context = await chromium.launchPersistentContext(
    resolve(tmpdir(), `euc-dom-capture-${process.pid}`),
    {
      channel: "chromium",
      executablePath: process.env.EUC_CHROMIUM_PATH || undefined,
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: (process.env.EUC_CHROMIUM_ARGS ?? "").split(" ").filter(Boolean),
    }
  );

  for (const site of sites) {
    const page = await context.newPage();
    const dir = resolve(outDir, site.name);
    await mkdir(dir, { recursive: true });
    let navigationError: string | null = null;
    try {
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (error) {
      navigationError = String(error).slice(0, 300);
    }
    await page.waitForTimeout(site.wait ?? 8000);
    for (const selector of site.click ?? []) {
      try {
        await page.locator(selector).first().click({ timeout: 5000 });
        await page.waitForTimeout(3000);
      } catch (error) {
        navigationError = `${navigationError ?? ""} click ${selector}: ${String(error).slice(0, 120)}`;
      }
    }
    for (let index = 0; index < (site.scrolls ?? 2); index++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(1500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(dir, "page.png") });

    // tsx (esbuild keepNames) wraps nested functions in __name(), which the page lacks.
    await page.evaluate("globalThis.__name = globalThis.__name || ((target) => target)");
    const info = await page.evaluate((probes: string[]) => {
      const styleChain = (element: Element | null, depth = 8) => {
        const chain: string[] = [];
        for (let current = element, level = 0; current && level < depth; current = current.parentElement, level++) {
          const style = getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          const classes = [...current.classList].slice(0, 3).join(".");
          chain.push([
            `${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ""}${classes ? `.${classes}` : ""}`,
            current.getAttribute("aria-hidden") ? "[aria-hidden]" : "",
            `disp=${style.display}`, `pos=${style.position}`,
            `ov=${style.overflowX}/${style.overflowY}`, `w=${Math.round(rect.width)}`, `h=${Math.round(rect.height)}`,
            style.getPropertyValue("-webkit-line-clamp") && style.getPropertyValue("-webkit-line-clamp") !== "none"
              ? `clamp=${style.getPropertyValue("-webkit-line-clamp")}` : "",
            style.opacity !== "1" ? `op=${style.opacity}` : "",
            style.clip && style.clip !== "auto" ? `clip=${style.clip}` : "",
            style.clipPath && style.clipPath !== "none" ? `clipPath=${style.clipPath}` : "",
            style.direction === "rtl" ? "rtl" : "",
            style.verticalAlign !== "baseline" ? `va=${style.verticalAlign}` : "",
          ].filter(Boolean).join(" "));
        }
        return chain;
      };
      const smallestContaining = (needle: string): Element[] => {
        const found: Element[] = [];
        for (const element of document.body.querySelectorAll("*")) {
          if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)) continue;
          const text = element.textContent ?? "";
          if (!text.includes(needle)) continue;
          if ([...element.children].some((child) => (child.textContent ?? "").includes(needle))) continue;
          found.push(element);
          if (found.length >= 4) break;
        }
        return found;
      };
      // When the probe is split across elements, climb until the joined text contains it.
      const containerFor = (needle: string): Element[] => {
        const compact = needle.replace(/\s+/gu, "");
        const results: Element[] = [];
        for (const element of document.body.querySelectorAll("*")) {
          if (["SCRIPT", "STYLE", "NOSCRIPT", "HTML", "BODY"].includes(element.tagName)) continue;
          const text = (element.textContent ?? "").replace(/\s+/gu, "");
          if (!text.includes(compact) || text.length > compact.length * 6 + 40) continue;
          if ([...element.children].some((child) => (child.textContent ?? "").replace(/\s+/gu, "").includes(compact))) continue;
          results.push(element);
          if (results.length >= 3) break;
        }
        return results;
      };
      const ldCurrencies = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .flatMap((script) => [...(script.textContent ?? "").matchAll(/"priceCurrency"\s*:\s*"([A-Za-z]{3})"/gu)].map((match) => match[1]))
        .slice(0, 20);
      return {
        url: location.href,
        title: document.title,
        htmlLang: document.documentElement.lang,
        htmlDir: document.documentElement.dir,
        metas: [...document.querySelectorAll("meta[property*='currency'], meta[name*='currency'], meta[itemprop='priceCurrency'], [itemprop='priceCurrency']")]
          .slice(0, 10).map((meta) => meta.outerHTML.slice(0, 200)),
        ldCurrencies,
        probes: probes.map((probe) => {
          const direct = smallestContaining(probe);
          const elements = direct.length > 0 ? direct : containerFor(probe);
          return {
            probe,
            matches: elements.map((element) => {
              let context: Element = element;
              for (let level = 0; level < 3 && context.parentElement && (context.parentElement.outerHTML.length < 3000); level++) {
                context = context.parentElement;
              }
              return {
                element: element.outerHTML.slice(0, 1500),
                context: context.outerHTML.replace(/\s+/gu, " ").slice(0, 3000),
                styles: styleChain(element),
              };
            }),
          };
        }),
      };
    }, site.probes ?? []);

    const snapshot = await page.evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll("script:not([type='application/ld+json']), iframe, link[rel='preload'], link[rel='prefetch'], link[rel='modulepreload']")) {
        node.remove();
      }
      const head = clone.querySelector("head");
      const base = document.createElement("base");
      base.href = location.href;
      head?.prepend(base);
      return `<!doctype html>\n${clone.outerHTML}`;
    });
    await writeFile(resolve(dir, "snapshot.html"), snapshot);
    await writeFile(resolve(dir, "info.json"), JSON.stringify({ ...info, navigationError }, null, 2));
    console.log(`${site.name}: ${navigationError ? "ERROR " + navigationError.slice(0, 80) : "ok"} | ${info.title.slice(0, 60)} | lang=${info.htmlLang} ld=${[...new Set(info.ldCurrencies)].join(",")} | probes ${info.probes.map((probe) => `${probe.probe}:${probe.matches.length}`).join(" ")}`);
    await page.close();
  }
  await context.close();
}

await main();
