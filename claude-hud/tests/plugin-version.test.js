import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  compareVersions,
  getOwnVersion,
  getLatestMarketplaceVersion,
  getPluginVersionInfo,
} from '../dist/plugin-version.js';
import { renderVersionLine } from '../dist/render/lines/version.js';
import { DEFAULT_CONFIG } from '../dist/config.js';

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// ============================================================================
// compareVersions
// ============================================================================

test('compareVersions orders dotted numeric versions', () => {
  assert.ok(compareVersions('0.2.0', '0.3.0') < 0);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.2', '1.2.1') < 0);
  assert.ok(compareVersions('2', '1.9.9') > 0);
});

// ============================================================================
// getOwnVersion
// ============================================================================

test('getOwnVersion reads the version of the running plugin', () => {
  const version = getOwnVersion();
  assert.match(version, /^\d+(\.\d+)*$/, `expected a semver, got ${version}`);
});

// ============================================================================
// getLatestMarketplaceVersion
// ============================================================================

async function writeMarketplace(configDir, marketplaceName, pluginSource, version) {
  const marketplaceDir = path.join(configDir, 'plugins', 'marketplaces', marketplaceName);
  await mkdir(path.join(marketplaceDir, '.claude-plugin'), { recursive: true });
  await writeFile(
    path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: marketplaceName,
      plugins: [{ name: 'claude-hud', source: pluginSource }],
    }),
    'utf8'
  );
  const pluginRoot = path.resolve(marketplaceDir, pluginSource);
  await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  await writeFile(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'claude-hud', version }),
    'utf8'
  );
}

test('getLatestMarketplaceVersion returns null when no marketplaces exist', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'hud-ver-empty-'));
  try {
    assert.equal(getLatestMarketplaceVersion(configDir), null);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test('getLatestMarketplaceVersion reads a subdirectory plugin source', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'hud-ver-sub-'));
  try {
    await writeMarketplace(configDir, 'hudplus', './claude-hud', '0.9.0');
    assert.equal(getLatestMarketplaceVersion(configDir), '0.9.0');
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test('getLatestMarketplaceVersion takes the max across marketplaces', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'hud-ver-multi-'));
  try {
    await writeMarketplace(configDir, 'alpha', './', '0.4.0');
    await writeMarketplace(configDir, 'beta', './claude-hud', '0.12.0');
    assert.equal(getLatestMarketplaceVersion(configDir), '0.12.0');
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test('getLatestMarketplaceVersion ignores marketplaces without claude-hud', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'hud-ver-other-'));
  try {
    const marketplaceDir = path.join(configDir, 'plugins', 'marketplaces', 'other');
    await mkdir(path.join(marketplaceDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'other', plugins: [{ name: 'some-plugin', source: './' }] }),
      'utf8'
    );
    assert.equal(getLatestMarketplaceVersion(configDir), null);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

// ============================================================================
// getPluginVersionInfo
// ============================================================================

test('getPluginVersionInfo flags an update when the marketplace is newer', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'hud-ver-update-'));
  try {
    await writeMarketplace(configDir, 'hudplus', './claude-hud', '99.0.0');
    const info = getPluginVersionInfo({ configDir });
    assert.match(info.current, /^\d+(\.\d+)*$/);
    assert.equal(info.latest, '99.0.0');
    assert.equal(info.updateAvailable, true);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test('getPluginVersionInfo reports no update when versions match', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'hud-ver-same-'));
  try {
    const current = getOwnVersion();
    await writeMarketplace(configDir, 'hudplus', './claude-hud', current);
    const info = getPluginVersionInfo({ configDir });
    assert.equal(info.updateAvailable, false);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

// ============================================================================
// renderVersionLine
// ============================================================================

function renderCtx({ showVersion, pluginVersion }) {
  return {
    config: {
      ...DEFAULT_CONFIG,
      display: { ...DEFAULT_CONFIG.display, showVersion },
    },
    pluginVersion,
  };
}

test('renderVersionLine shows the current version by default', () => {
  const out = renderVersionLine(renderCtx({
    showVersion: true,
    pluginVersion: { current: '0.3.0', latest: null, updateAvailable: false },
  }));
  assert.equal(stripAnsi(out), 'claude-hud v0.3.0');
});

test('renderVersionLine appends the update hint when a newer version exists', () => {
  const out = renderVersionLine(renderCtx({
    showVersion: true,
    pluginVersion: { current: '0.3.0', latest: '0.4.0', updateAvailable: true },
  }));
  assert.equal(stripAnsi(out), 'claude-hud v0.3.0 (v0.4.0 update available)');
});

test('renderVersionLine is hidden when showVersion is false', () => {
  const out = renderVersionLine(renderCtx({
    showVersion: false,
    pluginVersion: { current: '0.3.0', latest: '0.4.0', updateAvailable: true },
  }));
  assert.equal(out, null);
});

test('renderVersionLine is hidden when the current version is unknown', () => {
  const out = renderVersionLine(renderCtx({
    showVersion: true,
    pluginVersion: { current: null, latest: '0.4.0', updateAvailable: false },
  }));
  assert.equal(out, null);
});
