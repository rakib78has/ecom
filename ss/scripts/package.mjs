#!/usr/bin/env node
/**
 * Packages dist/ into the zip the Chrome Web Store accepts.
 *
 * Source maps are excluded: they are useful locally but roughly triple the
 * upload size and expose the full original source in the published package.
 */

import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('✖ dist/ does not exist. Run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const outputPath = join(root, `snapcapture-${manifest.version}.zip`);

async function collect(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collect(full)));
    } else if (!entry.name.endsWith('.map')) {
      found.push(full);
    }
  }
  return found;
}

// --- Minimal zip writer -----------------------------------------------------
// Node ships deflate but no archiver. A store package is a flat list of
// deflated files, so writing the container directly avoids a dependency whose
// only job is to run in CI.

const files = (await collect(dist)).sort();
const output = createWriteStream(outputPath);
const central = [];
let offset = 0;

function write(buffer) {
  output.write(buffer);
  offset += buffer.length;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

for (const file of files) {
  const name = relative(dist, file).split(sep).join('/');
  const raw = readFileSync(file);
  const compressed = deflateRawSync(raw, { level: 9 });
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(raw);
  const localOffset = offset;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10); // mod time
  local.writeUInt16LE(0x2821, 12); // mod date (fixed, for reproducibility)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  write(local);
  write(nameBytes);
  write(compressed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(0x2821, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(raw.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt32LE(localOffset, 42);
  central.push({ entry, nameBytes });
}

const centralStart = offset;
for (const { entry, nameBytes } of central) {
  write(entry);
  write(nameBytes);
}
const centralSize = offset - centralStart;

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length, 8);
end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(centralStart, 16);
write(end);

await new Promise((resolve) => output.end(resolve));

const { size } = await stat(outputPath);
console.log(`✔ Packaged ${files.length} files -> ${relative(root, outputPath)}`);
console.log(`  ${(size / 1024).toFixed(1)} KB, version ${manifest.version}`);
