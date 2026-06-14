import { refreshContentSettings } from "./settingsRefresh";

const events: string[] = [];

await refreshContentSettings({
  clear() {
    events.push("clear");
  },
  async load() {
    events.push("load");
    return { enabled: true };
  },
  apply() {
    events.push("apply");
  },
  rescan() {
    events.push("rescan");
  },
});

if (events.join(",") !== "clear,load,apply,rescan") {
  throw new Error(`settings refresh order: received ${events.join(",")}`);
}

events.length = 0;
let badgeCount = 0;

for (let index = 0; index < 2; index++) {
  await refreshContentSettings({
    clear() {
      events.push("clear");
      badgeCount = 0;
    },
    async load() {
      return {};
    },
    apply() {},
    rescan() {
      events.push("rescan");
      badgeCount++;
    },
  });
}

if (events.join(",") !== "clear,rescan,clear,rescan") {
  throw new Error(`repeated settings refresh: received ${events.join(",")}`);
}

if (badgeCount !== 1) {
  throw new Error(`repeated settings refresh badges: received ${badgeCount}`);
}
