# Permissions

## Summary

Ehinium Universal Converter does not use analytics, telemetry, remote code execution, `eval`, or dynamic script injection. Exchange-rate requests are limited to the declared provider domains.

The content script uses `<all_urls>` matches so automatic conversions can run on normal webpages without requiring the user to click the extension first. Chrome does not inject content scripts into `chrome://`, `edge://`, extension pages, or blocked Chrome Web Store pages. The manifest also excludes Chrome Web Store URL patterns explicitly.

## Extension Permissions

### `storage`

- **Where used:** `src/services/settings.ts`
- **Why required:** Saves user settings such as enabled state, target currency, badge preferences, unit preferences, and site allow/block rules.
- **User data accessed:** Extension settings only.
- **Data leaves browser:** No. Settings are stored with Chrome storage APIs.

### `activeTab`

- **Where used:** Popup/settings flows in `src/services/siteControls.ts` and `src/services/settingsApply.ts`.
- **Why required:** Reads the active tab URL for the per-site toggle and sends `settings:changed` to the active tab so changes can apply without a reload.
- **User data accessed:** Active tab URL/hostname when the user opens or interacts with the extension UI.
- **Data leaves browser:** No.

### `contextMenus`

- **Where used:** `src/background/index.ts`
- **Why required:** Adds the selected-text conversion menu item.
- **User data accessed:** The selected text when the user chooses the context-menu action.
- **Data leaves browser:** Currency conversion may request exchange rates from the approved provider domains. Selected text is not sent to providers.

## Host Permissions

### `https://api.frankfurter.dev/*`

- **Where used:** `src/services/frankfurter.ts`
- **Why required:** Primary fiat exchange-rate provider.
- **User data accessed:** Target/base currency code for rate lookup.
- **Data leaves browser:** Yes. The requested base currency is sent to Frankfurter.

### `https://cdn.jsdelivr.net/*`

- **Where used:** `src/services/fawaz.ts`
- **Why required:** Fallback fiat exchange-rate provider.
- **User data accessed:** Target/base currency code for rate lookup.
- **Data leaves browser:** Yes. The requested base currency is included in the fallback rates URL.

## Content Script Matches

### `<all_urls>`

- **Where used:** `public/manifest.json`
- **Why required:** Enables automatic inline conversion on arbitrary webpages, including dynamically loaded content.
- **User data accessed:** Visible page text is scanned locally for supported currency/unit patterns.
- **Data leaves browser:** No page text is sent externally.

## Not Used

- `scripting`
- `tabs`
- `commands`
- `externally_connectable`
- `web_accessible_resources`
- Analytics or telemetry endpoints
- Remote code execution or `eval`
