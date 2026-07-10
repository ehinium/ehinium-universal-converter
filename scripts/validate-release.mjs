import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const sourceManifestPath = join(rootDir, "public", "manifest.json");
const distManifestPath = join(rootDir, "dist", "manifest.json");
const allowedPermissions = ["storage", "activeTab", "contextMenus"];
const allowedHostPermissions = [
  "https://api.frankfurter.dev/*",
  "https://cdn.jsdelivr.net/*",
];
const requiredDistFiles = [
  "manifest.json",
  "index.html",
  "settings.html",
  "assets/background.js",
  "assets/content.js",
  "assets/options.js",
  "assets/popup.js",
  "favicon.svg",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons.svg",
];
const forbiddenManifestKeys = [
  "commands",
  "externally_connectable",
  "web_accessible_resources",
];

function fail(message) {
  throw new Error(`Release validation failed: ${message}`);
}

function readJson(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing`);
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

function assertSameSet(actual, expected, label) {
  const sortedActual = [...(actual ?? [])].sort();
  const sortedExpected = [...expected].sort();

  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(
      `${label} changed. Expected ${JSON.stringify(sortedExpected)}, received ${JSON.stringify(sortedActual)}`
    );
  }
}

function assertSameObject(actual, expected, label) {
  const sortedActual = Object.fromEntries(
    Object.entries(actual ?? {}).sort(([left], [right]) => left.localeCompare(right))
  );
  const sortedExpected = Object.fromEntries(
    Object.entries(expected).sort(([left], [right]) => left.localeCompare(right))
  );

  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(
      `${label} changed. Expected ${JSON.stringify(sortedExpected)}, received ${JSON.stringify(sortedActual)}`
    );
  }
}

function readPngDimensions(path) {
  const png = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) {
    fail(`${path} is not a valid PNG`);
  }

  const chunkType = png.subarray(12, 16).toString("ascii");

  if (chunkType !== "IHDR") {
    fail(`${path} is missing a PNG IHDR header`);
  }

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function assertPngDimensions(path, expectedSize) {
  const dimensions = readPngDimensions(path);

  if (dimensions.width !== expectedSize || dimensions.height !== expectedSize) {
    fail(
      `${path} must be ${expectedSize}x${expectedSize}, received ${dimensions.width}x${dimensions.height}`
    );
  }
}

function getFiles(directory, baseDirectory = directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...getFiles(absolutePath, baseDirectory));
      continue;
    }

    files.push(relative(baseDirectory, absolutePath).split(sep).join("/"));
  }

  return files;
}

const sourceManifest = readJson(sourceManifestPath, "public/manifest.json");
const distManifest = readJson(distManifestPath, "dist/manifest.json");

if (sourceManifest.version !== packageJson.version) {
  fail(
    `public manifest version ${sourceManifest.version} does not match package version ${packageJson.version}`
  );
}

if (distManifest.version !== packageJson.version) {
  fail(
    `dist manifest version ${distManifest.version} does not match package version ${packageJson.version}`
  );
}

assertSameSet(sourceManifest.permissions, allowedPermissions, "permissions");
assertSameSet(
  sourceManifest.host_permissions,
  allowedHostPermissions,
  "host_permissions"
);

const runtimeIcons = {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
};

assertSameObject(sourceManifest.icons, runtimeIcons, "manifest icons");
assertSameObject(sourceManifest.action?.default_icon, runtimeIcons, "action.default_icon");

if (sourceManifest.permissions?.includes("scripting")) {
  fail("scripting permission is not expected for the MVP");
}

if (sourceManifest.action?.default_popup !== "index.html") {
  fail("action.default_popup must remain index.html");
}

if (
  sourceManifest.options_ui?.page !== "settings.html" ||
  sourceManifest.options_ui?.open_in_tab !== true
) {
  fail("options_ui must open settings.html in a tab");
}

for (const key of forbiddenManifestKeys) {
  if (key in sourceManifest) {
    fail(`unexpected manifest key "${key}"`);
  }
}

const matches = sourceManifest.content_scripts?.flatMap(
  (contentScript) => contentScript.matches ?? []
) ?? [];

if (!matches.includes("<all_urls>")) {
  fail("content script <all_urls> match is missing");
}

for (const requiredFile of requiredDistFiles) {
  if (!existsSync(join(rootDir, "dist", requiredFile))) {
    fail(`required dist file missing: ${requiredFile}`);
  }
}

for (const [size, iconPath] of Object.entries(runtimeIcons)) {
  const expectedSize = Number(size);

  if (iconPath.includes("store-assets")) {
    fail(`manifest runtime icon must not reference store-assets: ${iconPath}`);
  }

  assertPngDimensions(join(rootDir, "public", iconPath), expectedSize);
  assertPngDimensions(join(rootDir, "dist", iconPath), expectedSize);
}

const distFiles = getFiles(join(rootDir, "dist"));
const forbiddenDistPatterns = [
  /^src\//u,
  /^docs\//u,
  /^node_modules\//u,
  /\.test\./u,
  /\.map$/u,
];

for (const file of distFiles) {
  if (forbiddenDistPatterns.some((pattern) => pattern.test(file))) {
    fail(`unexpected file in dist: ${file}`);
  }
}

console.log("Release manifest validation passed.");
