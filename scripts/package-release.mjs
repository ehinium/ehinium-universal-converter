import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = packageJson.version;
const distDir = join(rootDir, "dist");
const releaseDir = join(rootDir, "release");
const zipPath = join(
  releaseDir,
  `ehinium-universal-converter-${version}.zip`
);

const excludedFiles = new Set(["test-cases.html"]);

const crcTable = new Uint32Array(256);

for (let index = 0; index < crcTable.length; index++) {
  let value = index;

  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);

  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);

  buffer.writeUInt32LE(value);
  return buffer;
}

function getReleaseFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory).sort()) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...getReleaseFiles(absolutePath));
      continue;
    }

    const relativePath = relative(distDir, absolutePath).split(sep).join("/");

    if (
      excludedFiles.has(relativePath) ||
      relativePath.endsWith(".map")
    ) {
      continue;
    }

    files.push({
      absolutePath,
      relativePath,
    });
  }

  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const content = readFileSync(file.absolutePath);
    const name = Buffer.from(file.relativePath, "utf8");
    const crc = crc32(content);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(crc),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name,
    ]);

    localParts.push(localHeader, content);

    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0x0800),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(crc),
        writeUInt32(content.length),
        writeUInt32(content.length),
        writeUInt16(name.length),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        name,
      ])
    );

    offset += localHeader.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}

rmSync(distDir, { recursive: true, force: true });
rmSync(releaseDir, { recursive: true, force: true });

if (process.platform === "win32") {
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run build"], {
    cwd: rootDir,
    stdio: "inherit",
  });
} else {
  execFileSync("npm", ["run", "build"], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

const manifestPath = join(distDir, "manifest.json");

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.version !== version) {
    throw new Error(
      `manifest version ${manifest.version} does not match package version ${version}`
    );
  }
} catch (error) {
  throw new Error(
    `Release packaging failed: dist/manifest.json is missing or invalid. ${error.message}`
  );
}

const files = getReleaseFiles(distDir);

if (!files.some((file) => file.relativePath === "manifest.json")) {
  throw new Error("Release packaging failed: manifest.json is missing from dist.");
}

mkdirSync(releaseDir, { recursive: true });
writeFileSync(zipPath, createZip(files));

console.log(`Created ${relative(rootDir, zipPath)} with ${files.length} files.`);
