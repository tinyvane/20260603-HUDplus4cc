import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSubmoduleConfig } from '../dist/git.js';
import { renderSubmoduleLine } from '../dist/render/lines/submodule.js';
import { DEFAULT_CONFIG } from '../dist/config.js';

// Generous timeout so slow-git machines (antivirus-scanned spawns) don't flake.
const GIT_OPTS = { timeoutMs: 15000 };

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function renderCtx({ showSubmodulePush, submoduleConfig }) {
  return {
    config: {
      ...DEFAULT_CONFIG,
      display: { ...DEFAULT_CONFIG.display, showSubmodulePush },
    },
    submoduleConfig,
  };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function initRepo(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

test('renderSubmoduleLine is hidden when showSubmodulePush is off', () => {
  const out = renderSubmoduleLine(renderCtx({
    showSubmodulePush: false,
    submoduleConfig: { count: 1, recurseValue: null, recurseOnDemand: false },
  }));
  assert.equal(out, null);
});

test('renderSubmoduleLine is hidden when there are no nested git repos', () => {
  const out = renderSubmoduleLine(renderCtx({
    showSubmodulePush: true,
    submoduleConfig: { count: 0, recurseValue: null, recurseOnDemand: false },
  }));
  assert.equal(out, null);
});

test('renderSubmoduleLine warns to run on-demand when not configured', () => {
  const out = renderSubmoduleLine(renderCtx({
    showSubmodulePush: true,
    submoduleConfig: { count: 1, recurseValue: null, recurseOnDemand: false },
  }));
  assert.equal(stripAnsi(out), 'Submodule ✗ run on-demand');
});

test('renderSubmoduleLine confirms with a check when on-demand is set', () => {
  const out = renderSubmoduleLine(renderCtx({
    showSubmodulePush: true,
    submoduleConfig: { count: 1, recurseValue: 'on-demand', recurseOnDemand: true },
  }));
  assert.equal(stripAnsi(out), 'Submodule ✓ on-demand');
});

test('renderSubmoduleLine shows a count when there is more than one nested repo', () => {
  const out = renderSubmoduleLine(renderCtx({
    showSubmodulePush: true,
    submoduleConfig: { count: 3, recurseValue: 'on-demand', recurseOnDemand: true },
  }));
  assert.equal(stripAnsi(out), 'Submodule ×3 ✓ on-demand');
});

test('getSubmoduleConfig returns null for a missing cwd', async () => {
  assert.equal(await getSubmoduleConfig(undefined), null);
});

test('getSubmoduleConfig reports count 0 for a plain repo', async () => {
  const dir = await initRepo('sm-plain-');
  try {
    await writeFile(path.join(dir, 'a.txt'), 'hi\n');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-m', 'init');
    const res = await getSubmoduleConfig(dir, GIT_OPTS);
    assert.deepEqual(res, { count: 0, recurseValue: null, recurseOnDemand: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getSubmoduleConfig detects a bare gitlink and reads push.recurseSubmodules', async () => {
  const parent = await initRepo('sm-parent-');
  const nested = await initRepo('sm-nested-');
  try {
    await writeFile(path.join(nested, 'n.txt'), 'n\n');
    git(nested, 'add', 'n.txt');
    git(nested, 'commit', '-m', 'nested init');

    await writeFile(path.join(parent, 'root.txt'), 'r\n');
    git(parent, 'add', 'root.txt');
    // Register the nested repo as a bare gitlink (mode 160000, no .gitmodules).
    const sha = git(nested, 'rev-parse', 'HEAD');
    git(parent, 'update-index', '--add', '--cacheinfo', `160000,${sha},nested`);

    // Unset → warn.
    const warn = await getSubmoduleConfig(parent, GIT_OPTS);
    assert.equal(warn.count >= 1, true);
    assert.equal(warn.recurseOnDemand, false);

    // Set on-demand → confirmed.
    git(parent, 'config', 'push.recurseSubmodules', 'on-demand');
    const ok = await getSubmoduleConfig(parent, GIT_OPTS);
    assert.equal(ok.recurseValue, 'on-demand');
    assert.equal(ok.recurseOnDemand, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(nested, { recursive: true, force: true });
  }
});
