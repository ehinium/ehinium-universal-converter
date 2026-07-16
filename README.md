# Ehinium Universal Converter

<p align="center">
  <img src="https://imgur.com/SF6JmXK.png" alt="Preview" width="60%">
</p>

<p align="center">
  <strong>Automatic currency and unit conversion, directly inside the web.</strong>
</p>

<p align="center">
  Convert prices and measurements as you browse, without copying values into a separate calculator.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ehinium-universal-convert/feafalbcngocmfihiophdhjneclnjncd">View on Chrome Web Store</a>
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/License-Elastic%202.0-6B7280">
</p>

---

## Overview

Ehinium Universal Converter is a browser extension that detects supported currencies and measurement units on websites and displays their converted values inline.

It is designed to stay lightweight, readable, and unobtrusive while supporting real-world pages with dynamic content, complex price layouts, and light or dark themes.

## Highlights

- **Automatic inline conversion** for supported fiat currencies
- **Measurement conversion** for common units
- **Manual converter** inside the extension popup
- **Currency, Units, and Everything modes**
- **Per-site controls** for enabling or disabling conversion
- **Website whitelist and blacklist**
- **System, light, and dark themes**
- **Keyboard-accessible controls**
- **Cached exchange rates** with provider fallback
- **Manifest V3 architecture**
- **No remote UI code or runtime CDN dependencies**

## Interface

The extension includes two dedicated surfaces:

### Popup

A compact browser popup for frequent actions:

- Enable or disable conversion
- Select the target currency
- Change the conversion mode
- Convert a value manually
- Control conversion for the current website
- Review exchange-rate status

### Settings

A full settings page with sections for:

- General preferences
- Currency configuration
- Unit configuration
- Website rules
- Appearance
- About and project information

## How it works

1. The content script scans visible page text for supported values.
2. Detected currencies and units are parsed and normalized.
3. Valid values are converted using cached exchange rates or local conversion rules.
4. Converted values are rendered inline without replacing the original content.
5. Dynamic page updates are observed and processed automatically.

The renderer includes safeguards for:

- dynamically loaded content
- repeated page rerenders
- dark and light page backgrounds
- overlays, dialogs, and fullscreen media
- translated pages
- grouped and nested price layouts
- duplicate conversion prevention

## Exchange-rate providers

Ehinium Universal Converter uses a fallback strategy:

1. **Frankfurter API** as the primary provider
2. **Fawaz Ahmed Currency API** as the fallback provider

Rates are cached locally to reduce unnecessary requests and keep conversions responsive.

## Privacy

The extension does not require an account and does not sell user data.

Settings are stored through Chrome extension storage. Exchange-rate requests are made only to the configured rate providers.

Read the full privacy policy:

[Privacy Policy](https://ehinium.github.io/ehinium-universal-converter/privacy.html)

## Installation

### Chrome Web Store

[View on Chrome Web Store](https://chromewebstore.google.com/detail/ehinium-universal-convert/feafalbcngocmfihiophdhjneclnjncd)

### Load unpacked

1. Clone the repository:

```bash
git clone https://github.com/ehinium/ehinium-universal-converter.git
cd ehinium-universal-converter
```

2. Install dependencies:

```bash
npm install
```

3. Build the extension:

```bash
npm run build
```

4. Open `chrome://extensions`.
5. Enable **Developer mode**.
6. Select **Load unpacked**.
7. Choose the generated `dist` directory.

## Development

### Requirements

- Node.js
- npm
- Chrome or another Chromium-based browser

### Commands

```bash
npm run dev
npm test
npm run lint
npm run build
npm run build:release
npm run validate:release
```

### Architecture

```text
src/
├── background/       # Service worker
├── components/       # Shared UI components
├── content/          # Detection, scanning, and inline rendering
├── options/          # Settings application
├── popup/            # Extension popup
├── services/         # Settings, rates, site controls, and persistence
├── settings/         # Shared settings behavior and product components
├── styles/           # Global theme and design tokens
├── types/            # Shared TypeScript types
└── utils/            # Parsing, normalization, and conversion utilities
```

## Tech stack

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui-style source components
- Radix UI
- Lucide icons
- Chrome Extension APIs
- Manifest V3

## Testing

The project includes regression coverage for:

- currency parsing and conversion
- unit parsing and conversion
- rate-provider fallback
- settings persistence
- popup and settings behavior
- content scanning and mutation handling
- badge rendering and visibility
- dynamic page rerenders
- theme behavior
- keyboard interaction
- release packaging

Run the complete suite:

```bash
npm test
```

## Roadmap

Potential future additions include:

- cryptocurrency conversion
- gold and precious-metal conversion
- custom exchange rates
- configurable fee percentages
- multiple conversion profiles
- cloud synchronization

Roadmap items are exploratory and are not guaranteed release commitments.

## Contributing

Issues and focused pull requests are welcome.

Before submitting a change:

```bash
npm test
npm run lint
npm run build
```

For bug reports, include:

- the affected website
- the original text or value
- expected conversion
- actual behavior
- browser version
- relevant diagnostics when available

## License

This project is licensed under the [Elastic License 2.0](LICENSE).

You may use, copy, modify, and redistribute the software under the license terms. You may not provide the software to third parties as a hosted or managed service, and you may not remove or bypass protected licensing functionality.

This project is **source-available**, not OSI-approved open-source software.

Development-only browser performance comparison and extension instrumentation are documented in [docs/performance-audit.md](docs/performance-audit.md).

## Creator

Designed and built by **Ehsan Rabipour**.

- [Email](mailto:hello@ehsanrp.com)
- [Telegram](https://t.me/ehinium)
- [X](https://x.com/ehinium)
- [Instagram](https://instagram.com/ehinium)
- [GitHub](https://github.com/ehinium)

---

<p align="center">
  <a href="https://github.com/ehinium/ehinium-universal-converter">Repository</a>
  ·
  <a href="https://ehinium.github.io/ehinium-universal-converter/privacy.html">Privacy Policy</a>
</p>