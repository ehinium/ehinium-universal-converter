# Development performance audit

The performance audit is development-only. A normal `npm run build` sets `__EUC_PERF_DIAGNOSTICS__` to `false`; it does not expose the performance API or register the performance observers. `npm run build:perf` writes the explicitly instrumented build to `dist-perf`, keeping it separate from the normal `dist` extension.

## Commands

```text
npm run build:perf
npm run audit:perf -- --url "https://example.com"
npm run audit:perf -- --url "https://example.com" --runs 7
npm run audit:perf -- --urls performance-audit-urls.json --runs 5
npm run audit:perf -- --url fixture:static-prices --profile desktop
npm run audit:perf -- --url fixture:mutation-heavy-spa --profile throttled
npm run audit:perf -- --url "https://example.com" --headful --trace
npm run audit:perf -- --url "https://example.com" --headful --manual-translation
```

The harness builds both variants unless `--skip-build` is passed. Other flags are `--strict`, `--screenshot`, `--cpu-profile`, `--quiet-window <ms>`, `--max-wait <ms>`, and `--output <directory>`. Expensive tracing and CPU profiling are off by default. Install Playwright's Chromium once with `npx playwright install chromium` if the browser executable is not already present.

## Comparison architecture

Every mode and measured run receives a new temporary Chromium user-data directory. Run zero is a separately reported warm-up and is excluded from summary statistics.

- `baseline` starts Chromium without any extension command-line arguments.
- `extension-disabled` loads `dist`, writes `enabled: false` into extension storage before target navigation, and therefore measures package/content-script bootstrap without conversion.
- `extension-enabled` loads `dist` with the fixed audit settings.
- `diagnostics-enabled` loads `dist-perf` with the same enabled settings.

Each measured profile performs a cold navigation and then a warm reload. Contexts are never shared between modes or runs. The default viewport is 1440×900 at device scale factor 1, `en-US`, UTC, and cache disabled. The desktop profile has no artificial throttling. The throttled profile uses a Fast-4G-like network configuration and 4× CPU slowdown.

The bundled local HTTP server serves twelve deterministic offline fixtures from `performance-fixtures`: static 100 prices, 10,000 text nodes, a mutation-heavy SPA, infinite scroll, nested translation wrappers, repeated source replacement, sticky pricing, carousel clones, modal overlays, Shadow DOM prices, split-node prices, and duplicated semantic prices.

## Collection and stabilization

Browser Performance APIs provide navigation, paint, LCP, CLS, INP when interaction timing is available, resources, heap (when Chromium exposes `performance.memory`), DOM counts, and long tasks. Total Blocking Time is an approximation: the sum of each observed long task's duration above 50 ms. CDP separately provides `Performance.getMetrics` values (including task/script/layout/style duration and counts when Chromium reports them) and a pierced DOM-node count.

The diagnostics build records bounded extension lifecycle measures, mutation classification, counters, scan batches, inferred long-task overlap, scenario markers, and memory/DOM snapshots. The page API is available only in that build as `window.__EUC_PERF_DIAGNOSTICS__`:

- `getSnapshot()` and `getDetailedReport()`
- `reset()` and `markScenario(name)`
- `waitForIdle(options)`
- `exportJson()`
- `getActiveBadgeCount()` and `getPendingWork()`
- `getRecentBatches(limit)`

Detailed batches retain the newest 500 records; aggregate count and duration continue for evicted batches. Measurements, long tasks, snapshots, scenarios, selectors, and strings also have fixed caps.

Stabilization requires a configurable quiet window (default 1,000 ms) with no changed resource count, observed long task/layout/mutation activity, large DOM mutation burst, or pending extension scan work. It times out safely after 15,000 ms by default and records success or timeout. Network idle alone is not treated as stabilization. The default post-load scenario scrolls deterministically down and back up, then resizes through fixed widths. Manual translation is supported only with `--headful --manual-translation`; the developer confirms after Chrome translation finishes. The translation-wrapper fixture is the reproducible automated alternative.

## Reports and privacy

Artifacts are written under `performance-audits/<timestamp>/`. The JSON schema is `ehinium-performance-audit/v1` (documented by `docs/performance-audit.schema.json`) and contains audit/environment/extension metadata, all modes and runs, summaries (median, p75, p95, min, max, standard deviation), comparisons, warnings, and artifact paths. A concise Markdown table, extension-work readout, slowest-batch table, and warning summary is written beside it.

Reports never collect cookies, authorization headers, storage contents, response bodies, form values, complete HTML, or full page text. The recursive redactor removes sensitive keys, email addresses, and credential-like strings, caps arrays, and bounds strings. Extension settings include only audit-relevant preferences and allow/block lists.

Warnings are non-fatal unless `--strict` is used. Defaults cover: load median above baseline by 10%, FCP +100 ms, LCP +200 ms, CLS delta +0.02, mutation p95 above 16.7 ms, any extension batch above 100 ms, repeated post-load full scans, and diagnostics overhead above enabled mode by 25%. Screenshots are triggered by high CLS, batches over 100 ms, duplicate badges, crashes, or `--screenshot`.

## Measurement limits

Long-task overlap with extension work is explicitly marked inferred; browser APIs cannot prove exact script ownership. INP remains unavailable without a qualifying interaction. Cross-origin resource transfer sizes can be zero without Timing-Allow-Origin. `performance.memory` is Chromium-specific. CDP metric availability varies by Chromium version. WeakMap sizes cannot be inspected, so diagnostics use bounded mirrored counts where integration exposes them. Automated Chrome page translation is deliberately not claimed; use the manual flow or fixture. External pages can vary due to experiments, authentication, geography, bot defenses, and network conditions, so local fixtures are the reproducibility anchor.
