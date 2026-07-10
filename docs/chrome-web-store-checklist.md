# Chrome Web Store Readiness Checklist

## Extension Identity

- [ ] Confirm name: **Ehinium Universal Converter**
- [ ] Finalize short description within Chrome Web Store limits
- [ ] Write detailed description covering supported conversions and privacy
- [ ] Select the most appropriate category
- [ ] Set the primary listing language
- [ ] Review spelling, branding, and support contact details

## Required Assets

- [ ] 128x128 extension/store icon
- [ ] 48x48 extension icon
- [ ] 16x16 extension icon
- [ ] Screenshots showing popup, settings, and page conversions
- [ ] Promo image, if needed for the listing or promotional placement
- [ ] Verify every asset meets current Chrome Web Store size and format rules

## Permissions Review

Document each permission in the store submission and keep permissions limited to
the extension's current behavior.

- [ ] `activeTab`: needed to identify and message the active page from the popup
- [ ] `storage`: needed to save settings, domain rules, and local preferences
- [ ] `contextMenus`: needed for the selected-text conversion context menu
- [ ] Host permission `https://api.frankfurter.dev/*`: needed to request fiat exchange rates
- [ ] Host permission `https://cdn.jsdelivr.net/*`: needed for the fallback fiat-rate provider
- [ ] Review the `<all_urls>` content-script scope and explain that it detects supported values on enabled websites
- [ ] Confirm no unused permissions or host permissions remain

## Privacy

- [ ] State that user data is not sold
- [ ] State that the extension does not track browsing activity or users
- [ ] Explain that settings and domain rules are stored locally through Chrome storage
- [ ] Explain that exchange-rate API requests send only the requested base currency to the configured providers
- [ ] Document recent exchange-rate metadata stored locally, including provider, date, fetch time, and cached rates
- [ ] Confirm webpage text is processed locally and is not sent to exchange-rate providers
- [ ] Prepare and publish a privacy policy if required by the Chrome Web Store

## MVP Feature List

- [ ] Fiat currency conversion
- [ ] Unit conversion
- [ ] Popup manual converter
- [ ] Per-site toggle
- [ ] Badge visibility and style controls
- [ ] Click converted badges/results to copy

## Pro Features Planned Later

- [ ] Crypto
- [ ] Metals
- [ ] Custom rates
- [ ] Fee percentage
- [ ] Yearly license

These planned features must not be described as currently available in the store
listing.

## Pre-Release QA Checklist

- [ ] Test Amazon product and listing pages
- [ ] Test eBay product and listing pages
- [ ] Test Trendyol product and listing pages
- [ ] Test List.am listing pages
- [ ] Test a normal article page
- [ ] Test a Google search results page
- [ ] Test settings migration from an older partial settings object
- [ ] Clear extension storage and test first-run defaults
- [ ] Test enabling and disabling conversions on the current site
- [ ] Test repeated settings changes for duplicate badges or listeners
- [ ] Test offline/provider-failure behavior with cached rates
- [ ] Verify popup, context-menu conversion, badges, tooltips, and copy actions
- [ ] Run `npm run check`
