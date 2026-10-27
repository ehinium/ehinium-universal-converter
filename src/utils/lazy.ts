/**
 * A value built on first use. The content script loads on every page, and a
 * large regular expression or the first Intl formatter costs milliseconds to
 * build even on the many pages that never use it.
 */
export function lazy<T>(create: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= create());
}
