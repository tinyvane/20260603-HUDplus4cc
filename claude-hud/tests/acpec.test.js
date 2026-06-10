import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAcpec, formatAcpecResult } from '../dist/acpec.js';
import { renderAcpecLine } from '../dist/render/lines/acpec.js';
import { DEFAULT_CONFIG } from '../dist/config.js';

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function renderCtx({ showAcpec, enabled }) {
  return {
    config: {
      ...DEFAULT_CONFIG,
      display: { ...DEFAULT_CONFIG.display, showAcpec },
      acpec: { ...DEFAULT_CONFIG.acpec, enabled },
    },
  };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cfg(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    acpec: { ...DEFAULT_CONFIG.acpec, enabled: true, ...overrides },
  };
}

async function setupRepo() {
  const remote = await mkdtemp(path.join(tmpdir(), 'acpec-remote-'));
  const work = await mkdtemp(path.join(tmpdir(), 'acpec-work-'));
  git(remote, 'init', '--bare');
  git(work, 'init', '-b', 'main');
  git(work, 'config', 'user.email', 't@t.com');
  git(work, 'config', 'user.name', 'T');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'remote', 'add', 'origin', remote);
  await writeFile(path.join(work, 'tracked.txt'), 'v1\n');
  git(work, 'add', 'tracked.txt');
  git(work, 'commit', '-m', 'init');
  git(work, 'push', '-u', 'origin', 'main');
  return { remote, work };
}

async function cleanup({ remote, work }) {
  await rm(remote, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
}

test('runAcpec is a no-op when disabled', async () => {
  const repo = await setupRepo();
  try {
    const res = runAcpec({ cwd: repo.work, config: cfg({ enabled: false }) });
    assert.equal(res.action, 'skipped');
    assert.equal(res.reason, 'disabled');
  } finally {
    await cleanup(repo);
  }
});

test('runAcpec skips a non-git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'acpec-plain-'));
  // On some machines a parent of tmpdir (even $HOME) is itself a git repo;
  // cap discovery at the temp parent so the test stays hermetic.
  const ceilingGit = (args, cwd) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    }).trim();
  try {
    const res = runAcpec({ cwd: dir, config: cfg(), git: ceilingGit });
    assert.equal(res.action, 'skipped');
    assert.equal(res.reason, 'not-a-git-repo');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runAcpec refuses a repo rooted at the home directory', async () => {
  const { homedir } = await import('node:os');
  const fakeGit = (args) => {
    const cmd = args.join(' ');
    if (cmd === 'rev-parse --is-inside-work-tree') return 'true';
    if (cmd === 'rev-parse --show-toplevel') return homedir().replace(/\\/g, '/');
    if (cmd === 'rev-parse --abbrev-ref HEAD') return 'main';
    throw new Error(`unexpected git call: ${cmd}`);
  };
  const res = runAcpec({ cwd: homedir(), config: cfg(), git: fakeGit });
  assert.equal(res.action, 'skipped');
  assert.equal(res.reason, 'home-dir-repo');
  assert.match(formatAcpecResult(res), /home directory/);
});

test('runAcpec commits tracked changes and pushes to the remote', async () => {
  const repo = await setupRepo();
  try {
    await writeFile(path.join(repo.work, 'tracked.txt'), 'v2\n');
    const res = runAcpec({ cwd: repo.work, config: cfg(), now: new Date('2026-06-04T12:00:00.000Z') });

    assert.equal(res.action, 'committed');
    assert.equal(res.branch, 'main');
    assert.equal(res.filesChanged, 1);
    assert.equal(res.pushed, true);

    // Remote received the commit.
    assert.equal(git(repo.work, 'rev-parse', 'HEAD'), git(repo.remote, 'rev-parse', 'main'));
    // Commit message uses the configured prefix + ISO timestamp.
    const msg = git(repo.work, 'log', '-1', '--pretty=%s');
    assert.ok(msg.startsWith('chore(acpec): auto-sync 2026-06-04T12:00:00.000Z'), `got: ${msg}`);
  } finally {
    await cleanup(repo);
  }
});

test('runAcpec ignores untracked files (never auto-commits new files)', async () => {
  const repo = await setupRepo();
  try {
    // A brand-new untracked file (e.g. a secret) must NOT be committed.
    await writeFile(path.join(repo.work, 'secret.env'), 'API_KEY=leak\n');
    const res = runAcpec({ cwd: repo.work, config: cfg() });
    assert.equal(res.action, 'skipped');
    assert.equal(res.reason, 'no-changes');
    // And it is still untracked afterwards.
    const status = git(repo.work, 'status', '--porcelain');
    assert.ok(status.includes('?? secret.env'), `expected untracked secret, got: ${status}`);
  } finally {
    await cleanup(repo);
  }
});

test('runAcpec commits tracked deletions', async () => {
  const repo = await setupRepo();
  try {
    await rm(path.join(repo.work, 'tracked.txt'));
    const res = runAcpec({ cwd: repo.work, config: cfg() });
    assert.equal(res.action, 'committed');
    assert.equal(res.filesChanged, 1);
  } finally {
    await cleanup(repo);
  }
});

test('runAcpec skips a protected branch', async () => {
  const repo = await setupRepo();
  try {
    await writeFile(path.join(repo.work, 'tracked.txt'), 'v2\n');
    const res = runAcpec({ cwd: repo.work, config: cfg({ protectedBranches: ['main'] }) });
    assert.equal(res.action, 'skipped');
    assert.equal(res.reason, 'protected-branch');
    assert.equal(res.branch, 'main');
  } finally {
    await cleanup(repo);
  }
});

test('runAcpec commits even when no remote exists, reporting push as not done', async () => {
  const repo = await setupRepo();
  try {
    git(repo.work, 'remote', 'remove', 'origin');
    await writeFile(path.join(repo.work, 'tracked.txt'), 'v2\n');
    const res = runAcpec({ cwd: repo.work, config: cfg() });
    assert.equal(res.action, 'committed');
    assert.equal(res.pushed, false);
  } finally {
    await cleanup(repo);
  }
});

test('renderAcpecLine is hidden when showAcpec is off', () => {
  assert.equal(renderAcpecLine(renderCtx({ showAcpec: false, enabled: true })), null);
});

test('renderAcpecLine shows a green check when enabled', () => {
  const out = renderAcpecLine(renderCtx({ showAcpec: true, enabled: true }));
  assert.equal(stripAnsi(out), 'ACPEC ✓');
});

test('renderAcpecLine shows a red cross when disabled', () => {
  const out = renderAcpecLine(renderCtx({ showAcpec: true, enabled: false }));
  assert.equal(stripAnsi(out), 'ACPEC ✗');
});

test('formatAcpecResult produces readable summaries', () => {
  assert.ok(formatAcpecResult({ action: 'committed', branch: 'main', filesChanged: 2, pushed: true }).includes('committed 2 file(s) on main and pushed'));
  assert.ok(formatAcpecResult({ action: 'skipped', reason: 'no-changes' }).includes('no tracked changes'));
  assert.ok(formatAcpecResult({ action: 'skipped', reason: 'protected-branch', branch: 'main' }).includes('protected branch main'));
});
