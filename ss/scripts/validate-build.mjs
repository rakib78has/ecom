#!/usr/bin/env node
/**
 * Validates the built extension before it can be packaged or released.
 *
 * A successful `vite build` only proves the TypeScript compiled. It does not
 * prove the manifest is loadable, that every path the manifest names actually
 * exists, or that the permission set has not quietly grown. Those are the
 * failures that reach the Chrome Web Store, so they get their own gate.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Permissions the extension is allowed to request. Any addition must be a
 *  deliberate edit here *and* a justification in docs/security.md. */
const ALLOWED_PERMISSIONS = new Set(['activeTab', 'downloads', 'scripting', 'storage']);

const errors = [];
const warnings = [];

const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

function requireFile(relativePath, reason) {
  const full = join(dist, relativePath);
  if (!existsSync(full)) {
    fail(`Missing ${relativePath} (${reason})`);
    return false;
  }
  if (statSync(full).size === 0) {
    fail(`${relativePath} is empty (${reason})`);
    return false;
  }
  return true;
}

if (!existsSync(dist)) {
  console.error('✖ dist/ does not exist. Run `npm run build` first.');
  process.exit(1);
}

// --- Manifest ---------------------------------------------------------------

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
} catch (error) {
  console.error(`✖ dist/manifest.json is missing or not valid JSON: ${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  fail(`manifest_version must be 3, found ${manifest.manifest_version}`);
}

if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
  fail(`version "${manifest.version}" is not a valid Chrome extension version`);
}

if (!manifest.name || manifest.name.length > 75) {
  fail('name must be present and at most 75 characters');
}

if (!manifest.description || manifest.description.length > 132) {
  fail('description must be present and at most 132 characters (Web Store limit)');
}

// --- Permissions ------------------------------------------------------------

for (const permission of manifest.permissions ?? []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    fail(
      `Permission "${permission}" is not in the approved set. ` +
        `Add it to ALLOWED_PERMISSIONS and justify it in docs/security.md.`
    );
  }
}

if (manifest.host_permissions?.length) {
  fail(
    `host_permissions must stay empty — activeTab covers every capture path. ` +
      `Found: ${manifest.host_permissions.join(', ')}`
  );
}

if (!manifest.content_security_policy?.extension_pages) {
  warn('No explicit content_security_policy; MV3 defaults are safe but being explicit is better.');
}

// --- Referenced files -------------------------------------------------------

requireFile(manifest.background.service_worker, 'background.service_worker');
requireFile(manifest.action.default_popup, 'action.default_popup');

for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  requireFile(path, `icons.${size}`);
}
for (const [size, path] of Object.entries(manifest.action?.default_icon ?? {})) {
  requireFile(path, `action.default_icon.${size}`);
}

// Pages and scripts that are not named in the manifest but are opened at
// runtime, so a build that drops them fails only in the user's browser.
requireFile('editor/editor.html', 'opened by the service worker after a capture');
requireFile('recorder/recorder.html', 'opened by the popup');
requireFile('selection-overlay.js', 'injected by chrome.scripting for area selection');

// --- Module type ------------------------------------------------------------

if (manifest.background.type !== 'module') {
  fail('background.type must be "module" — the built worker uses ES import syntax.');
}

const workerSource = readFileSync(join(dist, manifest.background.service_worker), 'utf8');
for (const match of workerSource.matchAll(/^import\s.*?from\s+["'](\.[^"']+)["']/gm)) {
  const target = join(dist, match[1]);
  if (!existsSync(target)) {
    fail(`Service worker imports "${match[1]}" which was not emitted.`);
  }
}

// The overlay is injected as a classic script, so top-level module syntax
// there would fail silently at runtime rather than at build time.
const overlaySource = readFileSync(join(dist, 'selection-overlay.js'), 'utf8');
if (/^\s*(import|export)\s/m.test(overlaySource)) {
  fail('selection-overlay.js contains module syntax but is injected as a classic script.');
}

// --- Report -----------------------------------------------------------------

for (const warning of warnings) console.warn(`⚠ ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`✖ ${error}`);
  console.error(`\nBuild validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`✔ Build valid — ${manifest.name} v${manifest.version}`);
console.log(`  Permissions: ${(manifest.permissions ?? []).join(', ') || 'none'}`);
console.log(`  Host permissions: ${(manifest.host_permissions ?? []).join(', ') || 'none'}`);
