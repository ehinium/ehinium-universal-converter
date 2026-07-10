# Privacy Policy

Effective date: TODO

Ehinium Universal Converter is designed to convert supported fiat currencies and units directly in your browser.

## Data We Do Not Collect

- We do not sell personal data.
- We do not use analytics or advertising trackers.
- We do not collect browsing history.
- We do not transmit webpage content to external servers.
- We do not send selected webpage text to exchange-rate providers.

## Data Stored Locally

The extension stores data needed to operate user-selected preferences:

- User settings, such as enabled state and target currency.
- Blocked and allowed domains for per-site controls.
- Cached exchange rates and related metadata.
- UI preferences, such as badge display mode, badge style, unit system, and target unit choices.

This data is stored using Chrome extension storage and/or in-memory browser state. It is used only to provide extension functionality.

## External Network Requests

The extension requests exchange-rate data from approved provider domains:

- `https://api.frankfurter.dev/*`
- `https://cdn.jsdelivr.net/*`

Requests include the selected base currency code needed to retrieve exchange rates, such as `USD` or `EUR`.

Requests do not include:

- Webpage content.
- Browsing history.
- Full page URLs.
- Selected text.
- Personal identifiers intentionally added by this extension.

Webpage scanning and conversion detection happen locally in the browser.

## Permissions

### `storage`

Used to save extension settings, per-site allow/block rules, cached rates, and UI preferences.

### `contextMenus`

Used to provide a right-click selected-text conversion action.

### `activeTab`

Used when the user interacts with the popup/settings UI to identify the current tab for per-site controls and to ask the active page to apply changed settings.

### Host Permissions

Host permissions are limited to exchange-rate provider domains. They are required to fetch current and fallback fiat exchange rates.

### Content Script Access

The extension runs a content script on normal webpages to detect supported currency and unit text locally and display conversions. Chrome blocks injection on restricted pages such as `chrome://`, extension pages, and Chrome Web Store pages.

## Data Retention

Settings and per-site preferences remain stored until the user changes them, clears extension data, or uninstalls the extension. Cached exchange rates are temporary and may be refreshed or replaced as the extension runs.

## Data Deletion

To delete locally stored extension data:

1. Open the extension settings and reset or remove saved preferences where available.
2. Remove the extension from Chrome to delete extension storage.
3. Alternatively, clear extension site/storage data through Chrome settings.

## Policy Changes

This privacy policy may be updated as the extension changes. Material changes should be reflected in the published privacy policy before or alongside a new release.

## Contact

Support email: TODO

