# Changelog

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
