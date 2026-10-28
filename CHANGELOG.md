# Changelog

## 1.0.1 - 2026-10-28

### Fixed

- Iranian (IRT) rates load again: the rates API moved to `https://api.euc.tools`, because the previous `workers.dev` address stopped working. The host permission changes to match.

## 1.0.0 - 2026-10-27

### Added

- Page currency context: shared signs ($, ¥, kr, R, ريال, درهم, جنيه) follow the page's own currency from structured data, the country domain, the store path, the page language, or a short list of national shops on generic domains.
- Currencies and formats: 원, 円, 元, ￥, the new Saudi riyal sign, Arabic currency words, Dhs, lei, Nordic and Czech `,-` prices (a currency written after the dash wins: `29,- €`), three-decimal dinars, Persian magnitude words (هزار، میلیون), CJK units between digits (`1万5000円`, `5만원`, `2억 5천만원`), price ranges whose bare bound shares the other bound's currency (`1 500 - 2 700 zł`, `$10 - 20`), signed differences (`−79.01€`, `-$5`), and cents drawn as raised numbers (`$399⁹⁹`).
- Prices whose currency is an icon or hidden label: toman icons (Digikala, Sheypoor, eMalls), currency labels (extra.com SAR), and screen-reader copies that state the currency of a bare visible number.
- Units: volume (ml, cl, L, fl oz, gal), ranges (`30 to 49 in`, `26"-65"`, `10kg-20kg`, `80吋至89吋`, `30cm至40cm`), fractions (`79 1/2"`, `31½"`), feet and inches (`5 ' 3 "`), W/L/H/D labels (`W55 x L82 Inch`), units written straight into Chinese, Japanese, Korean or Thai text (`125cm幅`, `25℃以下`, `30cm짜리`), and the word for inch in more than 20 languages.

### Changed

- Content revealed later (tabs, variant prices, faded-in bars), content inserted in bulk, and badges removed by the page's own framework are now scanned again.
- A badge whose text would be cut off, or that would push half a line or more of its box's own text out of view, moves after that box when it fits there; where no nearby place shows it (fixed-size swatch tiles, clamped offers in fixed-height cards), the conversion appears on hover. A box that trims only the badge's padding, or clips the badge no more than the price beside it, leaves it in place.
- `aria-hidden` is no longer treated as hidden; screen-reader-only copies are recognized by class and computed style.
- Rate requests time out after 8 seconds and fall back to cached rates up to 7 days old; the first scan waits briefly for loading stylesheets.
- `npm run build` warns when `EUC_IRANIAN_RATES_TOKEN` is not set.

### Fixed

- The English and German word "in" (`#487 in Fashion`, `5x8 in camel`), model names (`Redmi 15C`, `MK02`, `55UN711`), and cents (`99c`) are no longer converted as measurements or currencies.
- Split prices (IKEA's `249` `.` `00` `€`), Amazon's `$17⁹⁰` cents, dash ranges read as negative numbers, reversed range badges, and badges on screen-reader copies.
- Badge text keeps left-to-right order on right-to-left pages and no longer inherits the page's text transforms.
- Anchor checks no longer re-parse the full text of large containers, which made pages with many hidden prices slow.
- Faster page loads: the number formatter and the patterns for rarer price shapes (Iranian, CJK, dash and range prices, temperature words, diagnostics) are built on first use, so a page without prices no longer pays for them; joining split prices no longer rereads the whole container for every fragment.
- Badges are measured against one layout per render pass instead of forcing a layout for each badge, which halves the cost on very large pages.
- A grouped price whose badge could not stay (too far from it, or cut off) is no longer rescanned again and again: putting the price back from its badge group read as new page content and kept the page busy.

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
