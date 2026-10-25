# Changelog

## 0.3.1 - 2026-10-25

### Changed

- Updated React to 19.3.1, Radix UI to 1.8.1, Lucide to 1.61.0, Tailwind CSS to 4.3.3, and Vite to 8.3.5.
- Refreshed all installed shadcn/ui components from the Radix Nova registry and migrated class merging to the official `cn` package.
- Preserved the converter's existing control sizes, neutral switches, and restrained card surfaces while adopting updated component behavior.
- Updated development dependencies, including Happy DOM 21 and Chrome/Node type definitions. TypeScript remains at 6.0.3 because current lint tooling requires TypeScript below 6.1.

### Fixed

- Kept Radix state selectors compatible with the extension's existing Tailwind setup.
- Restored the React runtime import required by the component test runner.
- Made performance test environment checks respect Windows environment-variable casing.

## 0.3.0 - 2026-07-20

### Added

- Iranian Toman (`IRT`) as a selectable target, powered by the Ehinium rates bridge
- Automatic page conversion to IRT and popup conversion to and from Iranian currencies
- Input recognition for IRR, Rial, Rials, ریال, Toman, TMN, تومان, and supported decorated aliases
- Independent Iranian rate status and stale-cache fallback

### Changed

- IRT is the only user-facing Iranian output; saved IRR targets migrate to IRT
- Global and Iranian provider availability are reported independently
- The main test workflow now includes the Iranian integration suites

### Fixed

- Vite loads `EUC_IRANIAN_RATES_TOKEN` from `.env.local` and shell or CI environments
- TypeScript compatibility in Iranian rate tests and conversion scanning
- Global-only pages avoid unnecessary Iranian requests, while multiple page conversions reuse shared rate requests

## 0.2.1 - 2026-07-19

### Improved

- Updated the extension title and description to better communicate automatic currency and unit conversion

### Development

- Added performance-audit workload contracts, observations, validation states, run counts, minimum overrides, strict/fail/allow controls, and invalid-run exclusion from aggregates
- Added dynamically loaded scenarios with step-level artifacts for Google Store product configuration and manually translated Trendyol pages
- Added configurable audit cycles with optional forced garbage collection
- Added workload-validity and timing-attribution report tables that separate browser long tasks from measured extension synchronous work

## 0.2.0

### Added

- Redesigned popup and settings interfaces
- System, light, and dark appearance modes
- Unified segmented controls for conversion mode and theme
- Shadcn-aligned buttons, switches, fields, inputs, and select menus
- Single-page settings navigation with section scrolling

### Improved

- Popup spacing, hierarchy, and accessibility
- Settings organization and responsive behavior
- Exchange-rate status hydration
- Dark-mode control readability
- Keyboard navigation and focus states
- Currency and unit selection experience

### Fixed

- Popup height and clipping issues
- Incorrect rate status showing as not loaded
- Switch alignment and inconsistent sizing
- Native select readability problems in dark mode
- Inconsistent input and select dimensions
