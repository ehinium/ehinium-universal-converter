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
  "assets/background.js",
  "assets/content.js",
  "assets/popup.js",
  "assets/settings.js",
  "favicon.svg",
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

if (sourceManifest.permissions?.includes("scripting")) {
  fail("scripting permission is not expected for the MVP");
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
