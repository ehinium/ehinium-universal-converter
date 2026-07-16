import "./smokeTest.css";
import { fiatCurrencies } from "../data/currencies";
import { renderCurrencyConversionsOnly } from "../content/conversionScan";
import { getTextNodes } from "../content/domScanner";
import { resetRenderedConversions } from "../content/domRenderer";
import { getBadgeVisibleText } from "../content/badgeManager";
import { observeDomChanges } from "../content/observer";
import { getExchangeRates } from "../services/rates";
import type { ExchangeRates, NormalizedRatesResponse } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import {
  getCurrencyIdentifierSupport,
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import { defaultSettings } from "../utils/defaultSettings";
import { formatConvertedCurrency } from "../utils/displayFormatting";
import {
  generateCurrencyTestMatrix,
  type TestCase,
} from "./testMatrix";

export type StageStatus = "pass" | "fail" | "skip" | "not-run";
export type OverallStatus = "pass" | "fail" | "warning" | "not-run";
export type FailureCode =
  | "PARSER_MATCH_COUNT_MISMATCH"
  | "PARSER_CURRENCY_MISMATCH"
  | "PARSER_AMOUNT_MISMATCH"
  | "PARSER_UNEXPECTED_MATCH"
  | "CONVERSION_RATE_MISSING"
  | "CONVERSION_INVALID_RESULT"
  | "RENDERER_BADGE_COUNT_MISMATCH"
  | "RENDERER_BADGE_CONTENT_MISMATCH";

export type ParsedMatch = CurrencyMatch;

export type ConversionRequest = {
  matchIndex: number;
  amount: number;
  sourceCurrency: string;
  targetCurrency: string;
  sourceRate?: number;
};

export type ConversionResult = {
  matchIndex: number;
  status: "success" | "fail" | "skip";
  convertedAmount?: number;
  formatted?: string;
  reason?: string;
};

export type RenderedBadge = {
  text: string;
  ariaLabel: string | null;
  key: string | null;
  style: string | null;
};

export type TestCaseResult = {
  testCase: TestCase;
  parser: {
    status: StageStatus;
    matches: ParsedMatch[];
    reasons: string[];
    durationMs: number;
  };
  conversion: {
    status: StageStatus;
    requests: ConversionRequest[];
    results: ConversionResult[];
    reasons: string[];
  };
  renderer: {
    status: StageStatus;
    renderedBadgeCount: number;
    renderedBadges: RenderedBadge[];
    reasons: string[];
  };
  overall: {
    status: OverallStatus;
    failureCodes: FailureCode[];
  };
};

type DomCheckResult = {
  id: string;
  expectedBadgeCount?: number;
  actualBadgeCount?: number;
  expectedObserved?: boolean;
  actualObserved?: boolean;
  passed: boolean;
  details: string;
};

type ReportScope = "full-run" | "failures-only";

type ExportBundle = {
  schema: "ehinium-smoke-test-report/v3";
  reportScope: ReportScope;
  totalGeneratedCases: number;
  totalIncludedResults: number;
  generatedAt: string;
  environment: ReturnType<typeof getEnvironment>;
  run: {
    targetCurrency: string;
    rateProvider: string;
    rateDate?: string;
    rateError?: string;
    filters: ReturnType<typeof readFilters>;
  };
  summary: ReturnType<typeof summarize>;
  results: TestCaseResult[];
  domChecks: DomCheckResult[];
};

const matrix = generateCurrencyTestMatrix();
const resultById = new Map<string, TestCaseResult>();
const app = document.querySelector<HTMLElement>("#app") ?? failMissingRoot();

let running = false;
let rateInfo: NormalizedRatesResponse | null = null;
let rateError: string | undefined;
let domChecks: DomCheckResult[] = [];

function failMissingRoot(): never {
  throw new Error("Smoke-test application root is missing.");
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function option(value: string, label = value): string {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function init(): void {
  const categories = [...new Set(matrix.map((testCase) => testCase.category))].sort();
  const savedTarget = localStorage.getItem("euc-smoke-target") ?? defaultSettings.targetCurrency;
  const resultFilters = [
    ["overall:fail", "Overall failures"],
    ["overall:warning", "Overall warnings"],
    ["overall:pass", "Overall passes"],
    ["overall:not-run", "Overall not run"],
    ["parser:fail", "Parser failures"],
    ["conversion:fail", "Conversion failures"],
    ["renderer:fail", "Renderer failures"],
  ];

  app.innerHTML = `
    <div class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Ehinium engineering</p>
          <h1>Currency pipeline smoke tests</h1>
          <p class="lede">Each case reports parser, conversion, and renderer stages independently. A correct parser match can no longer be overwritten by a downstream conversion or rendering failure.</p>
        </div>
        <span class="dev-only">Development only</span>
      </header>

      <section class="panel" aria-label="Test controls">
        <div class="controls">
          <label>Search<input id="search" type="search" placeholder="Case, source, currency, failure code…" /></label>
          <label>Target currency<select id="target">${fiatCurrencies.map((currency) => option(currency.code, `${currency.code} — ${currency.name}`)).join("")}</select></label>
          <label>Category<select id="category">${option("all", "All categories")}${categories.map((value) => option(value)).join("")}</select></label>
          <label>Result<select id="outcome">${option("all", "All results")}${resultFilters.map(([value, label]) => option(value, label)).join("")}</select></label>
        </div>
        <div class="actions">
          <button id="run" type="button">Run full self-test</button>
          <button id="export-json" class="secondary" type="button">Export full JSON</button>
          <button id="export-failures-json" class="secondary" type="button">Export failures JSON</button>
          <button id="export-jsonl" class="secondary" type="button">Export full JSONL</button>
          <button id="export-failures-jsonl" class="secondary" type="button">Export failures JSONL</button>
          <button id="copy-failures" class="secondary" type="button">Copy failure report</button>
          <button id="clear" class="danger" type="button">Reset results</button>
          <span class="run-note" id="run-note">Parser preflight has not run.</span>
        </div>
      </section>

      <section class="panel summary" id="summary" aria-label="Result summary"></section>

      <section class="panel" aria-labelledby="dom-checks-title">
        <div class="status-line"><strong id="dom-checks-title">DOM pipeline checks</strong><span id="dom-check-summary">Pending full self-test</span></div>
        <div id="dom-checks" class="dom-checks"><span class="meta">The full run uses production scanner, exclusions, renderer, duplicate guards, and mutation observer.</span></div>
      </section>

      <section class="panel">
        <div class="status-line"><span id="status">Ready</span><div class="progress"><span id="progress"></span></div><span id="shown"></span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Overall</th><th>Case</th><th>Currency / format</th><th>Source text</th><th>Parser</th><th>Conversion</th><th>Renderer</th><th>Failure codes</th><th>Report</th></tr></thead>
            <tbody id="results"></tbody>
          </table>
        </div>
        <p class="footer-note">The table renders the first 750 filtered rows. JSON and JSONL exports always include every result and every stage.</p>
      </section>
    </div>`;

  const target = getSelect("target");
  target.value = fiatCurrencies.some((currency) => currency.code === savedTarget)
    ? savedTarget
    : defaultSettings.targetCurrency;

  for (const id of ["search", "category", "outcome"]) {
    document.getElementById(id)?.addEventListener("input", render);
  }
  target.addEventListener("change", () => {
    localStorage.setItem("euc-smoke-target", target.value);
    rateInfo = null;
    rateError = undefined;
    runParserPreflight();
  });
  document.getElementById("run")?.addEventListener("click", () => void runFullSelfTest());
  document.getElementById("export-json")?.addEventListener("click", () => download("json", "full-run"));
  document.getElementById("export-failures-json")?.addEventListener("click", () => download("json", "failures-only"));
  document.getElementById("export-jsonl")?.addEventListener("click", () => download("jsonl", "full-run"));
  document.getElementById("export-failures-jsonl")?.addEventListener("click", () => download("jsonl", "failures-only"));
  document.getElementById("copy-failures")?.addEventListener("click", () => void copyFailures());
  document.getElementById("clear")?.addEventListener("click", runParserPreflight);
  document.getElementById("results")?.addEventListener("click", handleTableClick);
  runParserPreflight();
}

function getSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing select #${id}`);
  return element;
}

function readFilters() {
  return {
    search: (document.getElementById("search") as HTMLInputElement | null)?.value.trim().toLocaleLowerCase() ?? "",
    category: getSelect("category").value,
    outcome: getSelect("outcome").value,
  };
}

function addFailureCode(result: TestCaseResult, code: FailureCode): void {
  if (!result.overall.failureCodes.includes(code)) result.overall.failureCodes.push(code);
}

function updateOverall(result: TestCaseResult): void {
  if ([result.parser, result.conversion, result.renderer].some((stage) => stage.status === "fail")) {
    result.overall.status = "fail";
  } else if (result.testCase.expectedBehavior === "ambiguous") {
    result.overall.status = "warning";
  } else if ([result.parser, result.conversion, result.renderer].some((stage) => stage.status === "not-run")) {
    result.overall.status = "not-run";
  } else {
    result.overall.status = "pass";
  }
}

function evaluateParser(testCase: TestCase): TestCaseResult {
  const started = performance.now();
  const matches = parseCurrencies(testCase.sourceText);
  const result: TestCaseResult = {
    testCase,
    parser: { status: "pass", matches, reasons: [], durationMs: 0 },
    conversion: { status: "not-run", requests: [], results: [], reasons: ["Full conversion stage has not run."] },
    renderer: { status: "not-run", renderedBadgeCount: 0, renderedBadges: [], reasons: ["Full renderer stage has not run."] },
    overall: { status: "not-run", failureCodes: [] },
  };

  if (testCase.expectedBehavior === "ambiguous") {
    result.parser.reasons.push(matches.length
      ? `Production convention resolved ambiguous input as ${matches.map((match) => match.currency).join(", ")}.`
      : "Parser declined to guess an ambiguous identifier.");
    result.conversion = { status: "skip", requests: [], results: [], reasons: ["Ambiguous cases are not conversion assertions."] };
    result.renderer = { status: "skip", renderedBadgeCount: 0, renderedBadges: [], reasons: ["Ambiguous cases are not renderer assertions."] };
  } else if (testCase.expectedBehavior === "ignore" || testCase.expectedBehavior === "unsupported") {
    if (matches.length === 0) {
      result.parser.reasons.push(`Expected ${testCase.expectedBehavior}; no match was emitted.`);
    } else {
      result.parser.status = "fail";
      result.parser.reasons.push(`Expected ${testCase.expectedBehavior}, but ${matches.length} match(es) were emitted.`);
      addFailureCode(result, "PARSER_UNEXPECTED_MATCH");
    }
    result.conversion = { status: "skip", requests: [], results: [], reasons: ["No conversion is expected for this case."] };
    result.renderer = { status: "skip", renderedBadgeCount: 0, renderedBadges: [], reasons: ["No badge is expected for this case."] };
  } else {
    const expectedCount = testCase.expectedMatchCount ?? 1;
    const currenciesMatch = matches.every((match) => match.currency === testCase.expectedSourceCurrency);
    const amountMatches = testCase.expectedAmount === undefined || matches.every((match, index) =>
      index > 0 && expectedCount > 1
        ? Number.isFinite(match.amount)
        : Object.is(match.amount, testCase.expectedAmount));

    if (matches.length !== expectedCount) {
      result.parser.status = "fail";
      result.parser.reasons.push(`Expected ${expectedCount} match(es), received ${matches.length}.`);
      addFailureCode(result, "PARSER_MATCH_COUNT_MISMATCH");
    }
    if (!currenciesMatch) {
      result.parser.status = "fail";
      result.parser.reasons.push(`Expected ${testCase.expectedSourceCurrency}; received ${matches.map((match) => match.currency).join(", ") || "none"}.`);
      addFailureCode(result, "PARSER_CURRENCY_MISMATCH");
    }
    if (!amountMatches) {
      result.parser.status = "fail";
      result.parser.reasons.push(`Expected amount ${testCase.expectedAmount}; received ${matches.map((match) => match.amount).join(", ") || "none"}.`);
      addFailureCode(result, "PARSER_AMOUNT_MISMATCH");
    }
    if (result.parser.status === "pass") {
      result.parser.reasons.push("Parser matches the structured expectation.");
      if (testCase.expectedSourceCurrency === getSelect("target").value) {
        result.conversion = { status: "skip", requests: [], results: [], reasons: ["Source and target currencies are identical."] };
        result.renderer = { status: "skip", renderedBadgeCount: 0, renderedBadges: [], reasons: ["Same-currency conversions intentionally render no badge."] };
      }
    }
  }

  result.parser.durationMs = performance.now() - started;
  updateOverall(result);
  return result;
}

function runParserPreflight(): void {
  if (running) return;
  runParserPreflightUnsafe();
  setText("run-note", `${matrix.length.toLocaleString()} parser cases evaluated; conversion and renderer stages are not yet run.`);
  setText("status", "Parser preflight complete");
  setProgress(0);
  render();
}

function runParserPreflightUnsafe(): void {
  domChecks = [];
  resultById.clear();
  for (const testCase of matrix) resultById.set(testCase.id, evaluateParser(testCase));
}

async function loadProductionRates(targetCurrency: string): Promise<ExchangeRates> {
  try {
    rateInfo = await getExchangeRates(targetCurrency, { forceRefresh: true });
    rateError = undefined;
    return { ...rateInfo.rates, [targetCurrency]: 1 };
  } catch (error) {
    rateInfo = null;
    rateError = error instanceof Error ? error.message : String(error);
    return Object.fromEntries(fiatCurrencies.map((currency) => [currency.code, 1]));
  }
}

function runConversionStage(result: TestCaseResult, targetCurrency: string, rates: ExchangeRates): void {
  if (result.parser.status !== "pass" || result.conversion.status === "skip") {
    if (result.parser.status !== "pass") {
      result.conversion = { status: "not-run", requests: [], results: [], reasons: ["Parser stage failed; conversion input is not trustworthy."] };
      result.renderer = { status: "not-run", renderedBadgeCount: 0, renderedBadges: [], reasons: ["Parser stage failed; renderer assertion was not run."] };
    }
    updateOverall(result);
    return;
  }

  const requests: ConversionRequest[] = result.parser.matches.map((match, matchIndex) => ({
    matchIndex,
    amount: match.amount,
    sourceCurrency: match.currency,
    targetCurrency,
    sourceRate: rates[match.currency],
  }));
  const conversionResults: ConversionResult[] = requests.map((request) => {
    if (request.sourceCurrency === targetCurrency) {
      return { matchIndex: request.matchIndex, status: "skip", reason: "Source and target currencies are identical." };
    }
    if (!request.sourceRate) {
      return { matchIndex: request.matchIndex, status: "fail", reason: `No ${request.sourceCurrency} rate was supplied for target ${targetCurrency}.` };
    }
    const convertedAmount = convertCurrency(request.amount, request.sourceCurrency, targetCurrency, rates);
    if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
      return { matchIndex: request.matchIndex, status: "fail", reason: "Production converter returned an invalid amount." };
    }
    return {
      matchIndex: request.matchIndex,
      status: "success",
      convertedAmount,
      formatted: formatConvertedCurrency(convertedAmount, targetCurrency),
    };
  });

  const failures = conversionResults.filter((item) => item.status === "fail");
  result.conversion = {
    status: failures.length ? "fail" : "pass",
    requests,
    results: conversionResults,
    reasons: failures.length
      ? failures.map((item) => item.reason ?? "Conversion failed.")
      : [`Converted ${conversionResults.length} parser match(es) with production rates and converter.`],
  };
  if (failures.some((item) => item.reason?.startsWith("No "))) addFailureCode(result, "CONVERSION_RATE_MISSING");
  if (failures.some((item) => item.reason?.includes("invalid"))) addFailureCode(result, "CONVERSION_INVALID_RESULT");

  if (result.conversion.status === "fail") {
    result.renderer = {
      status: "skip",
      renderedBadgeCount: 0,
      renderedBadges: [],
      reasons: ["Renderer assertion skipped because conversion failed."],
    };
  } else {
    result.renderer = {
      status: "not-run",
      renderedBadgeCount: 0,
      renderedBadges: [],
      reasons: ["Conversion passed; renderer stage is pending."],
    };
  }
  updateOverall(result);
}

async function runFullSelfTest(): Promise<void> {
  if (running) return;
  running = true;
  toggleRunControls(true);
  runParserPreflightUnsafe();
  const target = getSelect("target").value;
  setText("status", `Loading production rates for ${target}…`);
  const rates = await loadProductionRates(target);

  for (const result of resultById.values()) runConversionStage(result, target, rates);
  const eligible = [...resultById.values()].filter((result) => result.conversion.status === "pass");
  const batchSize = 120;

  for (let offset = 0; offset < eligible.length; offset += batchSize) {
    const batch = eligible.slice(offset, offset + batchSize);
    runDomBatch(batch, target, rates);
    setProgress((offset + batch.length) / Math.max(eligible.length, 1));
    setText("status", `Rendering ${Math.min(offset + batch.length, eligible.length).toLocaleString()} / ${eligible.length.toLocaleString()} conversion-passing cases…`);
    if (offset % (batchSize * 4) === 0) render();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  setText("status", "Checking DOM exclusions, duplicates, and mutation delivery…");
  domChecks = await runDomInfrastructureChecks(target, rates);
  running = false;
  toggleRunControls(false);
  setText("status", `Self-test complete${rateError ? " with offline rates" : ` using ${rateInfo?.provider ?? "production rates"}`}`);
  setText("run-note", rateError
    ? `Rate providers failed; deterministic 1:1 fallback used. ${rateError}`
    : `Rates: ${rateInfo?.provider}, base ${rateInfo?.base}, date ${rateInfo?.date}.`);
  render();
}

function runDomBatch(batch: TestCaseResult[], targetCurrency: string, rates: ExchangeRates): void {
  const sandbox = document.createElement("div");
  sandbox.id = "dev-render-sandbox";
  for (const result of batch) {
    const row = document.createElement("p");
    // Production duplicate protection scopes badges to the nearest price
    // container. Every test case needs its own scope or identical amounts in a
    // batch incorrectly suppress one another.
    row.className = "smoke-price-anchor";
    row.dataset.caseId = result.testCase.id;
    row.dir = result.testCase.category === "direction" ? "auto" : "ltr";
    row.textContent = result.testCase.sourceText;
    sandbox.append(row);
  }
  document.body.append(sandbox);

  const settings: UserSettings = {
    ...defaultSettings,
    targetCurrency,
    converterMode: "currencies",
    badgeVisibility: "always",
  };
  renderCurrencyConversionsOnly(getTextNodes(sandbox), settings, rates);

  for (const result of batch) {
    const row = sandbox.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(result.testCase.id)}"]`);
    const badgeElements = [...(row?.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]') ?? [])];
    const badges: RenderedBadge[] = badgeElements.map((badge) => ({
      text: getBadgeVisibleText(badge),
      ariaLabel: badge.getAttribute("aria-label"),
      key: badge.getAttribute("data-ehinium-key"),
      style: badge.getAttribute("data-ehinium-badge-style"),
    }));
    const expectedTexts = result.conversion.results
      .filter((item) => item.status === "success")
      .map((item) => item.formatted ?? "")
      .sort();
    const actualTexts = badges.map((badge) => badge.text).sort();
    const countMatches = badges.length === expectedTexts.length;
    const contentMatches = JSON.stringify(actualTexts) === JSON.stringify(expectedTexts);

    result.renderer = {
      status: countMatches && contentMatches ? "pass" : "fail",
      renderedBadgeCount: badges.length,
      renderedBadges: badges,
      reasons: [],
    };
    if (!countMatches) {
      result.renderer.reasons.push(`Expected ${expectedTexts.length} badge(s), received ${badges.length}.`);
      addFailureCode(result, "RENDERER_BADGE_COUNT_MISMATCH");
    }
    if (countMatches && !contentMatches) {
      result.renderer.reasons.push(`Expected badge text ${JSON.stringify(expectedTexts)}, received ${JSON.stringify(actualTexts)}.`);
      addFailureCode(result, "RENDERER_BADGE_CONTENT_MISMATCH");
    }
    if (result.renderer.status === "pass") {
      result.renderer.reasons.push(`Rendered ${badges.length} expected badge(s) in an isolated production price scope.`);
    }
    updateOverall(result);
  }

  resetRenderedConversions(sandbox);
  sandbox.remove();
}

async function runDomInfrastructureChecks(targetCurrency: string, rates: ExchangeRates): Promise<DomCheckResult[]> {
  const sourceCurrency = targetCurrency === "USD" ? "EUR" : "USD";
  const checkRates = { ...rates, [sourceCurrency]: rates[sourceCurrency] ?? 1 };
  const settings: UserSettings = { ...defaultSettings, targetCurrency, converterMode: "currencies", badgeVisibility: "always" };
  const sandbox = document.createElement("div");
  sandbox.id = "dev-render-sandbox";
  const scenarios = [
    ["visible-text", "p", {}, 1],
    ["code-exclusion", "code", {}, 0],
    ["pre-exclusion", "pre", {}, 0],
    ["contenteditable-exclusion", "div", { contenteditable: "true" }, 0],
    ["ignore-attribute-exclusion", "div", { "data-ehinium-ignore": "true" }, 0],
    ["hidden-exclusion", "div", { hidden: "" }, 0],
  ] as const;

  for (const [id, tag, attributes] of scenarios) {
    const wrapper = document.createElement("section");
    wrapper.dataset.domCheck = id;
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.textContent = `${sourceCurrency} 42.50`;
    wrapper.append(element);
    sandbox.append(wrapper);
  }
  document.body.append(sandbox);
  renderCurrencyConversionsOnly(getTextNodes(sandbox), settings, checkRates);

  const checks: DomCheckResult[] = scenarios.map(([id, , , expectedBadgeCount]) => {
    const actualBadgeCount = sandbox.querySelector(`[data-dom-check="${id}"]`)?.querySelectorAll('[data-ehinium-badge="true"]').length ?? 0;
    return { id, expectedBadgeCount, actualBadgeCount, passed: actualBadgeCount === expectedBadgeCount, details: `Expected ${expectedBadgeCount} badge(s); received ${actualBadgeCount}.` };
  });

  const visible = sandbox.querySelector<HTMLElement>('[data-dom-check="visible-text"]');
  if (visible) {
    renderCurrencyConversionsOnly(getTextNodes(visible), settings, checkRates);
    const actualBadgeCount = visible.querySelectorAll('[data-ehinium-badge="true"]').length;
    checks.push({ id: "duplicate-prevention", expectedBadgeCount: 1, actualBadgeCount, passed: actualBadgeCount === 1, details: `A repeated render should retain one badge; received ${actualBadgeCount}.` });
  }

  let mutationObserved = false;
  const stopObserver = observeDomChanges((roots) => {
    if (roots.some((root) => root instanceof Element && root.closest('[data-dom-check="mutation"]'))) mutationObserved = true;
  });
  const mutationWrapper = document.createElement("section");
  mutationWrapper.dataset.domCheck = "mutation";
  const mutationText = document.createElement("p");
  mutationText.textContent = `${sourceCurrency} 84.25`;
  mutationWrapper.append(mutationText);
  sandbox.append(mutationWrapper);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  stopObserver();
  renderCurrencyConversionsOnly(getTextNodes(mutationWrapper), settings, checkRates);
  const mutationBadgeCount = mutationWrapper.querySelectorAll('[data-ehinium-badge="true"]').length;
  checks.push({
    id: "mutation-observer-delivery",
    expectedBadgeCount: 1,
    actualBadgeCount: mutationBadgeCount,
    expectedObserved: true,
    actualObserved: mutationObserved,
    passed: mutationObserved && mutationBadgeCount === 1,
    details: `Observer callback: ${mutationObserved}; rendered badges after mutation: ${mutationBadgeCount}.`,
  });

  resetRenderedConversions(sandbox);
  sandbox.remove();
  return checks;
}

function countStatuses<T extends string>(values: T[], statuses: readonly T[]): Record<T, number> {
  return Object.fromEntries(statuses.map((status) => [status, values.filter((value) => value === status).length])) as Record<T, number>;
}

function summarize(results = [...resultById.values()]) {
  const stageStatuses: StageStatus[] = ["pass", "fail", "skip", "not-run"];
  const overallStatuses: OverallStatus[] = ["pass", "fail", "warning", "not-run"];
  return {
    total: results.length,
    currencies: fiatCurrencies.length,
    formats: new Set(matrix.map((testCase) => testCase.formatId)).size,
    parser: countStatuses(results.map((result) => result.parser.status), stageStatuses),
    conversion: countStatuses(results.map((result) => result.conversion.status), stageStatuses),
    renderer: countStatuses(results.map((result) => result.renderer.status), stageStatuses),
    overall: countStatuses(results.map((result) => result.overall.status), overallStatuses),
    failureCodes: Object.fromEntries(
      [...new Set(results.flatMap((result) => result.overall.failureCodes))]
        .sort()
        .map((code) => [code, results.filter((result) => result.overall.failureCodes.includes(code)).length])
    ),
    domChecks: domChecks.length,
    domFailures: domChecks.filter((check) => !check.passed).length,
  };
}

function matchesResultFilter(result: TestCaseResult, filter: string): boolean {
  if (filter === "all") return true;
  const [stage, status] = filter.split(":");
  if (stage === "overall") return result.overall.status === status;
  if (stage === "parser" || stage === "conversion" || stage === "renderer") return result[stage].status === status;
  return true;
}

function filteredResults(): TestCaseResult[] {
  const filters = readFilters();
  return [...resultById.values()].filter((result) => {
    const haystack = [
      result.testCase.id,
      result.testCase.sourceText,
      result.testCase.currency,
      result.testCase.formatId,
      result.testCase.notes,
      ...result.parser.reasons,
      ...result.conversion.reasons,
      ...result.renderer.reasons,
      ...result.overall.failureCodes,
    ].join(" ").toLocaleLowerCase();
    return (!filters.search || haystack.includes(filters.search))
      && (filters.category === "all" || result.testCase.category === filters.category)
      && matchesResultFilter(result, filters.outcome);
  });
}

function tag(status: StageStatus | OverallStatus): string {
  const className = status === "pass" ? "converted" : status === "fail" ? "incorrect" : status === "warning" ? "ambiguous" : "skipped";
  return `<span class="tag tag-${className}">${status}</span>`;
}

function render(): void {
  const visible = filteredResults();
  const summary = summarize();
  const summaryElement = document.getElementById("summary");
  if (summaryElement) summaryElement.innerHTML = [
    ["Cases", summary.total, ""],
    ["Overall pass", summary.overall.pass, "converted"],
    ["Overall fail", summary.overall.fail, "failed"],
    ["Warnings", summary.overall.warning, "ambiguous"],
    ["Parser fail", summary.parser.fail, summary.parser.fail ? "failed" : "converted"],
    ["Conversion fail", summary.conversion.fail, summary.conversion.fail ? "failed" : "converted"],
    ["Renderer fail", summary.renderer.fail, summary.renderer.fail ? "failed" : "converted"],
    ["Not run", summary.overall["not-run"], ""],
  ].map(([label, value, className]) => `<div class="metric ${className}">${label}<strong>${Number(value).toLocaleString()}</strong></div>`).join("");
  renderDomChecks();

  setText("shown", `${Math.min(visible.length, 750).toLocaleString()} shown / ${visible.length.toLocaleString()} matched`);
  const body = document.getElementById("results");
  if (!body) return;
  body.innerHTML = visible.length === 0
    ? '<tr><td colspan="9" class="empty">No cases match these filters.</td></tr>'
    : visible.slice(0, 750).map(renderRow).join("");
}

function renderDomChecks(): void {
  const container = document.getElementById("dom-checks");
  if (!container) return;
  if (domChecks.length === 0) {
    container.innerHTML = '<span class="meta">Pending full self-test.</span>';
    setText("dom-check-summary", "Pending full self-test");
    return;
  }
  const failures = domChecks.filter((check) => !check.passed).length;
  setText("dom-check-summary", `${domChecks.length - failures}/${domChecks.length} passed`);
  container.innerHTML = domChecks.map((check) =>
    `<div class="dom-check">${tag(check.passed ? "pass" : "fail")}<strong>${escapeHtml(check.id)}</strong><span class="meta">${escapeHtml(check.details)}</span></div>`
  ).join("");
}

function stageDetails(status: StageStatus, lines: string[]): string {
  return `${tag(status)}<div class="meta">${escapeHtml(lines.join(" "))}</div>`;
}

function renderRow(result: TestCaseResult): string {
  const testCase = result.testCase;
  const parserLines = result.parser.matches.length
    ? result.parser.matches.map((match) => `${match.currency} ${match.amount} [${match.raw}]`)
    : result.parser.reasons;
  const conversionLines = result.conversion.results.length
    ? result.conversion.results.map((item) => item.status === "success" ? item.formatted ?? "Converted" : item.reason ?? item.status)
    : result.conversion.reasons;
  const rendererLines = result.renderer.renderedBadges.length
    ? result.renderer.renderedBadges.map((badge) => badge.text)
    : result.renderer.reasons;
  return `<tr>
    <td>${tag(result.overall.status)}</td>
    <td class="case-id">${escapeHtml(testCase.id)}</td>
    <td><strong>${escapeHtml(testCase.currency ?? "—")}</strong><div class="meta">${escapeHtml(testCase.category)} / ${escapeHtml(testCase.formatId)}${testCase.locale ? `<br>${escapeHtml(testCase.locale)}` : ""}</div></td>
    <td class="source" dir="auto">${escapeHtml(testCase.sourceText)}${testCase.notes ? `<div class="meta">${escapeHtml(testCase.notes)}</div>` : ""}</td>
    <td class="actual">${stageDetails(result.parser.status, parserLines)}</td>
    <td class="actual">${stageDetails(result.conversion.status, conversionLines)}</td>
    <td class="actual">${stageDetails(result.renderer.status, rendererLines)}</td>
    <td class="case-id">${result.overall.failureCodes.length ? result.overall.failureCodes.map(escapeHtml).join("<br>") : "—"}</td>
    <td><button class="secondary bug-button" type="button" data-report-id="${escapeHtml(testCase.id)}">Bug report</button></td>
  </tr>`;
}

function getEnvironment() {
  return {
    page: location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: [...navigator.languages],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    platform: navigator.platform,
    online: navigator.onLine,
    metadataCurrencyCount: fiatCurrencies.length,
  };
}

function makeBundle(
  results = [...resultById.values()],
  reportScope: ReportScope = "full-run"
): ExportBundle {
  return {
    schema: "ehinium-smoke-test-report/v3",
    reportScope,
    totalGeneratedCases: matrix.length,
    totalIncludedResults: results.length,
    generatedAt: new Date().toISOString(),
    environment: getEnvironment(),
    run: {
      targetCurrency: getSelect("target").value,
      rateProvider: rateError ? "deterministic-offline-fallback" : rateInfo?.provider ?? "not-run",
      rateDate: rateInfo?.date,
      rateError,
      filters: readFilters(),
    },
    summary: summarize(results),
    results,
    domChecks,
  };
}

function makeBugReport(result: TestCaseResult) {
  const currency = fiatCurrencies.find((item) => item.code === result.testCase.currency);
  return {
    ...makeBundle([result], "failures-only"),
    kind: "ehinium-currency-case-bug-report",
    case: result,
    diagnostics: {
      currencyDefinition: currency,
      identifierSupport: currency?.symbols.map((identifier) => getCurrencyIdentifierSupport(identifier)),
      unicodeCodePoints: [...result.testCase.sourceText].map((character) => ({
        character,
        codePoint: `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
      })),
      relatedResults: [...resultById.values()]
        .filter((item) => item.testCase.currency === result.testCase.currency && item.testCase.formatId === result.testCase.formatId)
        .slice(0, 25),
    },
  };
}

function handleTableClick(event: Event): void {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-report-id]");
  const result = button ? resultById.get(button.dataset.reportId ?? "") : undefined;
  if (result) saveFile(`euc-bug-${result.testCase.id}.json`, JSON.stringify(makeBugReport(result), null, 2), "application/json");
}

function download(format: "json" | "jsonl", reportScope: ReportScope): void {
  const results = reportScope === "full-run"
    ? [...resultById.values()]
    : [...resultById.values()].filter((result) => result.overall.status === "fail");
  const bundle = makeBundle(results, reportScope);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const scopeName = reportScope === "full-run" ? "full" : "failures";
  if (format === "json") {
    saveFile(`euc-smoke-${scopeName}-${stamp}.json`, JSON.stringify(bundle, null, 2), "application/json");
  } else {
    const header = JSON.stringify({
      schema: bundle.schema,
      reportScope: bundle.reportScope,
      totalGeneratedCases: bundle.totalGeneratedCases,
      totalIncludedResults: bundle.totalIncludedResults,
      generatedAt: bundle.generatedAt,
      environment: bundle.environment,
      run: bundle.run,
      summary: bundle.summary,
    });
    saveFile(`euc-smoke-${scopeName}-${stamp}.jsonl`, [header, ...bundle.results.map((result) => JSON.stringify(result))].join("\n"), "application/x-ndjson");
  }
}

function saveFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyFailures(): Promise<void> {
  const failures = [...resultById.values()].filter((result) => result.overall.status === "fail");
  await navigator.clipboard.writeText(JSON.stringify(makeBundle(failures, "failures-only"), null, 2));
  setText("status", `Copied ${failures.length} staged failure(s) as a Codex-ready JSON report.`);
}

function toggleRunControls(disabled: boolean): void {
  for (const id of ["run", "clear"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = disabled;
  }
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setProgress(value: number): void {
  const element = document.getElementById("progress");
  if (element) element.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
}

init();
