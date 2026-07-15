import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const distDir = join(rootDir, "dist");
const releaseDir = join(rootDir, "release");
const zipPath = join(
  releaseDir,
  `ehinium-universal-converter-${packageJson.version}.zip`
);
const allowedPermissions = ["storage", "activeTab", "contextMenus"];
const allowedHostPermissions = [
  "https://api.frankfurter.dev/*",
  "https://cdn.jsdelivr.net/*",
];
const requiredIconSizes = new Set(["16", "32", "48", "128"]);
const allowSourceMaps = process.env.ALLOW_RELEASE_SOURCEMAPS === "true";
const errors = [];

function addError(message) {
  errors.push(message);
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function getFiles(directory, baseDirectory = directory) {
  if (!existsSync(directory)) {
    return [];
  }

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

  return files.sort((left, right) => left.localeCompare(right));
}

function readJsonFile(path, label) {
  if (!existsSync(path)) {
    addError(`${label} is missing`);
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    addError(`${label} is invalid JSON: ${error.message}`);
    return null;
  }
}

function parseZip(path) {
  if (!existsSync(path)) {
    addError(`release ZIP is missing: ${relative(rootDir, path)}`);
    return new Map();
  }

  const zip = readFileSync(path);
  let endOffset = -1;

  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }

  if (endOffset < 0) {
    addError("release ZIP is missing an end-of-central-directory record");
    return new Map();
  }

  const entryCount = zip.readUInt16LE(endOffset + 10);
  const centralDirectoryOffset = zip.readUInt32LE(endOffset + 16);
  const entries = new Map();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      addError("release ZIP central directory is malformed");
      return entries;
    }

    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (method !== 0) {
      addError(`${name} uses unsupported ZIP compression method ${method}`);
    }

    if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
      addError(`${name} has a malformed local ZIP header`);
      cursor += 46 + nameLength + extraLength + commentLength;
      continue;
    }

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const content = zip.subarray(dataOffset, dataOffset + compressedSize);

    if (content.length !== uncompressedSize) {
      addError(`${name} ZIP size metadata is inconsistent`);
    }

    entries.set(name, Buffer.from(content));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipJson(entries, path) {
  const content = entries.get(path);

  if (!content) {
    addError(`release ZIP is missing ${path}`);
    return null;
  }

  try {
    return JSON.parse(content.toString("utf8"));
  } catch (error) {
    addError(`release ZIP ${path} is invalid JSON: ${error.message}`);
    return null;
  }
}

function hasDistFile(path) {
  return existsSync(join(distDir, path));
}

function hasZipFile(entries, path) {
  return entries.has(path);
}

function requireReferencedFile(entries, path, label) {
  if (!path || typeof path !== "string") {
    addError(`${label} is missing`);
    return;
  }

  if (path.startsWith("/") || path.includes("://")) {
    addError(`${label} must be a relative extension path: ${path}`);
    return;
  }

  if (!hasDistFile(path)) {
    addError(`dist is missing ${label}: ${path}`);
  }

  if (!hasZipFile(entries, path)) {
    addError(`release ZIP is missing ${label}: ${path}`);
  }
}

function readPngDimensionsFromBuffer(buffer, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    addError(`${label} is not a valid PNG`);
    return null;
  }

  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    addError(`${label} is missing a PNG IHDR header`);
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function validatePngDimensions(entries, iconPath, expectedSize) {
  if (iconPath.includes("store-assets")) {
    addError(`manifest runtime icon must not reference store-assets: ${iconPath}`);
  }

  const distPath = join(distDir, iconPath);

  if (existsSync(distPath)) {
    const dimensions = readPngDimensionsFromBuffer(
      readFileSync(distPath),
      `dist/${iconPath}`
    );

    if (
      dimensions &&
      (dimensions.width !== expectedSize || dimensions.height !== expectedSize)
    ) {
      addError(
        `dist/${iconPath} must be ${expectedSize}x${expectedSize}, received ${dimensions.width}x${dimensions.height}`
      );
    }
  }

  const zipIcon = entries.get(iconPath);

  if (zipIcon) {
    const dimensions = readPngDimensionsFromBuffer(zipIcon, `ZIP ${iconPath}`);

    if (
      dimensions &&
      (dimensions.width !== expectedSize || dimensions.height !== expectedSize)
    ) {
      addError(
        `ZIP ${iconPath} must be ${expectedSize}x${expectedSize}, received ${dimensions.width}x${dimensions.height}`
      );
    }
  }
}

function assertAllowedSet(actual, expected, label) {
  const actualValues = actual ?? [];
  const unexpected = actualValues.filter((value) => !expected.includes(value));

  if (unexpected.length > 0) {
    addError(`unexpected ${label}: ${unexpected.join(", ")}`);
  }
}

function validateForbiddenContents(files, label) {
  const forbiddenPatterns = [
    /^test-cases\.html$/u,
    /(^|\/)smokeTest(?:\.[^.]+)?\.(?:js|css)$/u,
    /(^|\/)testMatrix(?:\.[^.]+)?\.js$/u,
    /^src\//u,
    /^docs\//u,
    /^tests?\//u,
    /(^|\/)tests?\//u,
    /^node_modules\//u,
    /^\.git(\/|$)/u,
    /(^|\/)\.env($|\.)/u,
    /\.(ts|tsx)$/u,
  ];

  if (!allowSourceMaps) {
    forbiddenPatterns.push(/\.map$/u);
  }

  for (const file of files) {
    if (forbiddenPatterns.some((pattern) => pattern.test(file))) {
      addError(`${label} contains forbidden release file: ${file}`);
    }
  }
}

function validateNoDevelopmentDiagnostics(files, readContent, label) {
  const markers = [
    "ehinium-page-diagnostics/",
    "diagnostics:start-picker",
    "data-ehinium-diagnostics-picker",
    "Capture current page",
    "Development diagnostics",
  ];

  for (const file of files) {
    if (!/\.(?:html|js|css)$/u.test(file)) {
      continue;
    }

    const content = readContent(file);
    if (markers.some((marker) => content.includes(marker))) {
      addError(`${label} contains development page diagnostics: ${file}`);
    }
  }
}

function collectManifestReferences(manifest) {
  const references = [];

  references.push(["manifest.json", "manifest"]);

  if (manifest.background?.service_worker) {
    references.push([
      manifest.background.service_worker,
      "background service worker",
    ]);
  } else {
    addError("manifest background.service_worker is missing");
  }

  if (manifest.action?.default_popup) {
    references.push([manifest.action.default_popup, "action popup HTML"]);
  } else {
    addError("manifest action.default_popup is missing");
  }

  if (manifest.options_ui?.page) {
    references.push([manifest.options_ui.page, "options/settings HTML"]);
  }

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    references.push([iconPath, `manifest icon ${size}`]);
  }

  for (const [size, iconPath] of Object.entries(manifest.action?.default_icon ?? {})) {
    references.push([iconPath, `action default icon ${size}`]);
  }

  for (const [index, contentScript] of (manifest.content_scripts ?? []).entries()) {
    for (const file of contentScript.js ?? []) {
      references.push([file, `content script ${index} js`]);
    }

    for (const file of contentScript.css ?? []) {
      references.push([file, `content script ${index} css`]);
    }
  }

  for (const [index, resourceGroup] of (manifest.web_accessible_resources ?? []).entries()) {
    for (const file of resourceGroup.resources ?? []) {
      references.push([file, `web accessible resource ${index}`]);
    }
  }

  return references;
}

function validateManifest(manifest, entries, label) {
  if (!manifest) {
    return;
  }

  if (manifest.manifest_version !== 3) {
    addError(`${label} manifest_version must be 3`);
  }

  if (manifest.version !== packageJson.version) {
    addError(
      `${label} manifest version ${manifest.version} does not match package version ${packageJson.version}`
    );
  }

  if (!manifest.name) {
    addError(`${label} manifest name is missing`);
  }

  if (!manifest.description) {
    addError(`${label} manifest description is missing`);
  }

  assertAllowedSet(manifest.permissions, allowedPermissions, `${label} permissions`);
  assertAllowedSet(
    manifest.host_permissions,
    allowedHostPermissions,
    `${label} host permissions`
  );

  for (const [path, referenceLabel] of collectManifestReferences(manifest)) {
    requireReferencedFile(entries, path, referenceLabel);
  }

  for (const size of requiredIconSizes) {
    const manifestIcon = manifest.icons?.[size];
    const actionIcon = manifest.action?.default_icon?.[size];

    if (!manifestIcon) {
      addError(`${label} manifest icons.${size} is missing`);
    } else {
      validatePngDimensions(entries, manifestIcon, Number(size));
    }

    if (!actionIcon) {
      addError(`${label} action.default_icon.${size} is missing`);
    } else {
      validatePngDimensions(entries, actionIcon, Number(size));
    }
  }
}

const distManifest = readJsonFile(join(distDir, "manifest.json"), "dist/manifest.json");
const zipEntries = parseZip(zipPath);
const zipManifest = readZipJson(zipEntries, "manifest.json");
const distFiles = getFiles(distDir);
const zipFiles = [...zipEntries.keys()].sort((left, right) => left.localeCompare(right));

validateManifest(distManifest, zipEntries, "dist");

if (zipManifest) {
  validateManifest(zipManifest, zipEntries, "ZIP");
}

validateForbiddenContents(distFiles, "dist");
validateForbiddenContents(zipFiles, "release ZIP");
validateNoDevelopmentDiagnostics(
  distFiles,
  (file) => readFileSync(join(distDir, file), "utf8"),
  "dist"
);
validateNoDevelopmentDiagnostics(
  zipFiles,
  (file) => zipEntries.get(file)?.toString("utf8") ?? "",
  "release ZIP"
);

if (distManifest && zipManifest) {
  const distManifestText = JSON.stringify(distManifest);
  const zipManifestText = JSON.stringify(zipManifest);

  if (distManifestText !== zipManifestText) {
    addError("release ZIP manifest.json does not match dist/manifest.json");
  }
}

const zipSize = existsSync(zipPath) ? statSync(zipPath).size : 0;
const permissions = distManifest?.permissions ?? [];
const hostPermissions = distManifest?.host_permissions ?? [];

console.log("Release validation summary");
console.log(`version: ${packageJson.version}`);
console.log(`ZIP path: ${relative(rootDir, zipPath)}`);
console.log(`file count: ${zipFiles.length}`);
console.log(`ZIP size: ${zipSize} bytes`);
console.log(`permissions: ${formatList(permissions)}`);
console.log(`host permissions: ${formatList(hostPermissions)}`);

if (errors.length > 0) {
  console.error("validation result: failed");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log("validation result: passed");
