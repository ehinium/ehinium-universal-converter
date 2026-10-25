# Release Process

1. Run `npm ci`.
2. Run `npm test`, `npm run test:rates`, `npm run test:perf`, and `npm run lint`.
3. Run `npm run release` (unit checks, production build, ZIP packaging, and archive validation).
4. Run `npm run build:privacy-docs` if dependencies or the published privacy page changed.
5. Load unpacked `dist` in Chrome for final QA.
6. Test using `docs/release-regression-checklist.md`.
7. Upload `release/ehinium-universal-converter-<package.json version>.zip` to the existing Chrome Web Store listing.
8. Submit for review with automatic publishing enabled. Record submission status separately from public availability.
