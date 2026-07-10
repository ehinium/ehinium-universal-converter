# Chrome Web Store Listing

## Product Name

Ehinium Universal Converter

## Short Description

Automatically convert fiat currencies and common units on webpages, with a popup manual converter and per-site controls.

## Detailed Description

Ehinium Universal Converter helps you understand prices and measurements while browsing. It detects supported fiat currencies and common units on webpages and shows converted values inline or on hover, based on your settings.

The extension also includes a popup manual converter, selected-text context-menu conversion, click-to-copy badges, and per-site controls so you can enable or disable conversion behavior where you need it.

Preferences are stored locally in your browser. Webpage content is scanned locally and is not sent to external servers.

## Feature List

- Automatic fiat currency conversion on webpages.
- Unit conversion for common length, weight, and temperature units.
- Manual popup converter for typed values.
- Context-menu conversion for selected text.
- Per-site controls for allowing or blocking conversion.
- Inline or hover display modes.
- Badge style and visibility settings.
- Click-to-copy converted values.
- Keyboard-accessible conversion badges.
- Local preference storage.

## Supported Conversion Types

- Fiat currencies supported by the extension currency data.
- Length units, including examples such as `cm`, `m`, `km`, `in`, `ft`, and `mi`.
- Weight units, including examples such as `g`, `kg`, `oz`, and `lb`.
- Temperature units: `°C` and `°F`.

## Current Limitations

- Crypto, metals, custom rates, and fee-adjusted conversions are not part of the current MVP.
- Exchange-rate conversion depends on availability of the configured exchange-rate providers.
- Automatic page conversion may not run on browser-restricted pages such as Chrome Web Store pages, extension pages, or internal browser pages.
- Parsing is intentionally conservative to reduce false positives in model numbers, product names, ratings, and percentages.

## Privacy Summary

- The extension does not sell personal data.
- The extension does not use analytics or advertising trackers.
- The extension does not collect browsing history.
- Webpage content is not transmitted to external servers.
- Exchange-rate requests are limited to approved provider domains and include only the base currency needed for rate lookup.
- Settings, per-site preferences, cached exchange rates, and UI preferences are stored locally.

## Permissions Explanation

### `storage`

Stores settings, per-site allow/block rules, cached rates, and UI preferences.

### `activeTab`

Used by the popup/settings UI to read the active tab hostname for per-site controls and notify the active page when settings change.

### `contextMenus`

Adds the selected-text conversion action to the browser context menu.

### Host Permissions

Limited to exchange-rate provider domains used to fetch fiat exchange rates:

- `https://api.frankfurter.dev/*`
- `https://cdn.jsdelivr.net/*`

### Content Script Matches

The extension uses content scripts on normal webpages so it can automatically detect and display conversions. Webpage text is processed locally in the browser.

## Future Roadmap

Potential future features may include crypto, metals, custom rates, and fee percentage tools. These are not included in the current MVP feature set.

## Listing Placeholders

- Support email: TODO
- Website: TODO
- Privacy policy URL: TODO
