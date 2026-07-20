import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } },
  server: { middlewareMode: true },
});

try {
  const appModule = (await vite.ssrLoadModule("/src/privacy/App.tsx")) as {
    default: ComponentType;
  };
  const markup = renderToStaticMarkup(createElement(appModule.default));
  const browserWindow = new Window({ url: "https://ehinium.github.io/ehinium-universal-converter/privacy.html" });
  browserWindow.document.body.innerHTML = markup;
  const document = browserWindow.document as unknown as Document;

  expectEqual(document.querySelectorAll("h1").length, 1, "single policy heading");
  expectEqual(document.querySelector("h1")?.textContent, "Privacy Policy", "policy heading");
  expectEqual(
    Array.from(document.querySelectorAll("article section > h2"), (heading) => heading.textContent),
    [
      "Overview",
      "Information processed by the extension",
      "Extension preferences",
      "Exchange-rate services",
      "Data collection",
      "Data sharing",
      "Analytics and advertising",
      "Remote code",
      "Data retention",
      "Security",
      "Changes to this privacy policy",
      "Contact",
    ],
    "policy section order"
  );

  const sectionIds = Array.from(document.querySelectorAll("article section"), (section) => section.id);
  const navigationTargets = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Privacy policy sections"] a'),
    (link) => link.getAttribute("href")?.slice(1)
  );
  expectEqual(navigationTargets, sectionIds, "section navigation targets");
  expectEqual(document.querySelector("time")?.getAttribute("datetime"), "2026-07-20", "machine-readable revision date");

  const policyText = document.querySelector("article")?.textContent ?? "";
  for (const statement of [
    "does not sell personal data",
    "processing occurs locally inside the user's browser",
    "may retrieve the shared USD/IRT market rate",
    "does not download or execute remotely hosted code",
    "does not use advertising trackers or third-party analytics services",
    "hello@ehsanrp.com",
  ]) {
    expect(policyText.includes(statement), `preserved legal statement: ${statement}`);
  }

  for (const slot of ["button", "card", "card-header", "card-content", "card-title", "separator", "alert"]) {
    expect(document.querySelector(`[data-slot="${slot}"]`), `shared shadcn ${slot} primitive`);
  }

  const externalLink = document.querySelector<HTMLAnchorElement>('a[target="_blank"]');
  expect(externalLink, "external repository link");
  expectEqual(externalLink.getAttribute("rel"), "noopener noreferrer", "external link safety");
  expect(document.querySelector('a[href="mailto:hello@ehsanrp.com"]'), "contact email link");

  const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  expect(!/(?:bg|text|border)-(?:white|black|gray|slate|zinc)-?/u.test(appSource), "policy uses semantic theme colors");
  expect(!/(?:#[\da-f]{3,8}|rgb\(|hsl\()/iu.test(appSource), "policy has no hardcoded colors");

  browserWindow.close();
} finally {
  await vite.close();
}
