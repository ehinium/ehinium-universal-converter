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
npm run audit:perf -- --url "https://store.google.com/gb/config/pixel_10_pro?hl=en-GB" --scenario google-store-pixel-config --runs 3 --headful --fail-on-invalid-workload
npm run audit:perf -- --url "https://www.trendyol.com/..." --scenario trendyol-manual-translation --runs 2 --headful --fail-on-invalid-workload
```

The harness builds both variants unless `--skip-build` is passed. Other flags are `--strict`, `--screenshot`, `--cpu-profile`, `--quiet-window <ms>`, `--max-wait <ms>`, `--output <directory>`, `--scenario <id>`, `--fail-on-invalid-workload`, `--allow-invalid-workload`, the three `--minimum-*-badges/matches` overrides, `--cycles <n>`, and `--force-gc-between-cycles`. Expensive tracing, CPU profiling, and forced GC are off by default. Install Playwright's Chromium once with `npx playwright install chromium` if the browser executable is not already present.

## Workload validity

Every run records its workload contract, observed counters, status, failed conditions, and warnings. Generic pages require at least one scanned text node but do not require a price. Deterministic fixtures use fixture-specific contracts. Conversion scenarios require parser matches and active/rendered badges; translation additionally requires registry/DOM parity and zero orphan or competing hosts.

Invalid and partial measured runs remain in JSON but are excluded from aggregate statistics. Mode reports state measured, valid, invalid, unsupported, and excluded counts. Warm-ups record validity but never enter aggregates. `--strict` and `--fail-on-invalid-workload` fail required invalid contracts, while `--allow-invalid-workload` permits diagnostic-only runs. Without that override, a mode whose every measured run is invalid exits non-zero.

Scenarios live only under `performance-scenarios/` and are dynamically loaded by the Node audit harness. They are never imported into extension entry points. Each step records timestamps, duration, status, details, screenshot, and error. Failed steps save a screenshot plus a bounded, redacted role/label inventory. The Google Store scenario uses semantic controls to reveal and change a real price, checks badges through configuration updates, scrolls sticky states, and resizes. The Trendyol scenario is deliberately manual and headful, with timestamped checkpoints for enabling translation, changing language, and disabling translation.

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

The diagnostics build records bounded extension lifecycle measures, mutation classification, counters, scan batches, inferred long-task overlap, scenario markers, and memory/DOM snapshots. Parser calls/matches, canonical candidates, render-mode insertions, active badges, and registry census make workload validity observable. The page API is available only in that build as `window.__EUC_PERF_DIAGNOSTICS__`:

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

Timing records separate wall-clock duration, explicitly measured synchronous CPU, calculated/estimated async wait, scheduler delay, and maximum uninterrupted sync slice. Awaited rate preparation is never labeled CPU without an explicit sync measurement. Batch wall time no longer defaults into `longestSynchronousTask`; frame-budget classification uses measured sync slices. Browser long tasks, extension sync slices, and temporal overlaps are separate arrays, and overlap is only inferred—not causal.

Long-task overlap with extension work is explicitly marked inferred; browser APIs cannot prove exact script ownership. INP remains unavailable without a qualifying interaction. Cross-origin resource transfer sizes can be zero without Timing-Allow-Origin. `performance.memory` is Chromium-specific. CDP metric availability varies by Chromium version. Rate-provider internals that are not explicitly instrumented remain `unsupported` rather than being guessed. WeakMap sizes cannot be inspected, so diagnostics use the badge registry census and bounded mirrored counts. Automated Chrome page translation is deliberately not claimed; use the manual flow or fixture. External pages can vary due to experiments, authentication, geography, bot defenses, and network conditions, so local fixtures are the reproducibility anchor.
