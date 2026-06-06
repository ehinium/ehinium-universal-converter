import type { UserSettings as Settings } from "../types/settings";

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function matchesDomain(hostname: string, domain: string): boolean {
  const normalizedDomain = normalizeHostname(domain).replace(/^\.+/, "");

  return (
    normalizedDomain.length > 0 &&
    (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`))
  );
}

export function isDomainAllowed(
  hostname: string,
  settings: Settings
): boolean {
  const normalizedHostname = normalizeHostname(hostname);

  if (settings.blacklist.some((domain) => matchesDomain(normalizedHostname, domain))) {
    return false;
  }

  if (settings.whitelist.length === 0) {
    return true;
  }

  return settings.whitelist.some((domain) =>
    matchesDomain(normalizedHostname, domain)
  );
}
