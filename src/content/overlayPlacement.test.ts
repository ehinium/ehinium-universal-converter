import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("./domRenderer.ts", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("./badgeLifecycle.ts", import.meta.url), "utf8");

for (const forbidden of [
  "data-euc-overlay-root",
  "data-euc-overlay-badge",
  "translate3d(",
  "visualViewport",
  "scheduleOverlay",
  "registerOverlayBadgeLifecycle",
]) {
  if (renderer.includes(forbidden) || lifecycle.includes(forbidden)) {
    throw new Error(`Viewport overlay renderer code must remain removed: ${forbidden}`);
  }
}

console.log("viewport overlay renderer removal guard passed");
