import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  backupChats,
  recoverChats,
  compareChats,
  formatComparison,
  parseArchiveArgs,
  mainArchive,
} from '../dist/chat-archive.js';
import { encodeProjectDir } from '../dist/chat-stats.js';

function restoreEnvVar(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function setup() {
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-arc-home-'));
  const archive = await mkdtemp(path.join(tmpdir(), 'claude-hud-arc-store-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR; // ensure projects root = <home>/.claude/projects
  return { home, archive, originalConfigDir };
}

async function teardown({ home, archive, originalConfigDir }) {
  restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
  await rm(home, { recursive: true, force: true });
  await rm(archive, { recursive: true, force: true });
}

function projectDir(home, cwd) {
  return path.join(home, '.claude', 'projects', encodeProjectDir(cwd));
}

async function seedProject(home, cwd, files) {
  const dir = projectDir(home, cwd);
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(dir, name), body, 'utf8');
  }
  return dir;
}

// --- parseArchiveArgs -------------------------------------------------------

test('parseArchiveArgs reads mode, path, flags', () => {
  const p = parseArchiveArgs(['node', 'x', 'backup', '--path', '/a/b', '--all', '--json']);
  assert.equal(p.mode, 'backup');
  assert.equal(p.archivePath, '/a/b');
  assert.equal(p.all, true);
  assert.equal(p.json, true);
});

test('parseArchiveArgs supports --path=value syntax', () => {
  const p = parseArchiveArgs(['node', 'x', 'recover', '--path=/c/d', '--cwd=/proj']);
  assert.equal(p.mode, 'recover');
  assert.equal(p.archivePath, '/c/d');
  assert.equal(p.cwd, '/proj');
});

// --- backup -----------------------------------------------------------------

test('backupChats copies the current project transcripts to the archive', async () => {
  const env = await setup();
  try {
    const cwd = '/work/app';
    await seedProject(env.home, cwd, { 'a.jsonl': '1\n', 'b.jsonl': '2\n', 'note.txt': 'x' });

    const result = backupChats({ mode: 'backup', archivePath: env.archive, cwd }, env.home);
    assert.equal(result.copied, 2);
    assert.equal(result.projects, 1);

    const archived = await readdir(path.join(env.archive, encodeProjectDir(cwd)));
    assert.deepEqual(archived.sort(), ['a.jsonl', 'b.jsonl']);
  } finally {
    await teardown(env);
  }
});

test('backupChats skips files already up to date on a second run', async () => {
  const env = await setup();
  try {
    const cwd = '/work/app';
    await seedProject(env.home, cwd, { 'a.jsonl': '1\n' });
    backupChats({ mode: 'backup', archivePath: env.archive, cwd }, env.home);
    const second = backupChats({ mode: 'backup', archivePath: env.archive, cwd }, env.home);
    assert.equal(second.copied, 0);
    assert.equal(second.skipped, 1);
  } finally {
    await teardown(env);
  }
});

test('backupChats never deletes archive-only files (lost session stays backed up)', async () => {
  const env = await setup();
  try {
    const cwd = '/work/app';
    await seedProject(env.home, cwd, { 'a.jsonl': '1\n', 'b.jsonl': '2\n' });
    backupChats({ mode: 'backup', archivePath: env.archive, cwd }, env.home);

    // Simulate local loss of b.jsonl, then back up again.
    await rm(path.join(projectDir(env.home, cwd), 'b.jsonl'));
    backupChats({ mode: 'backup', archivePath: env.archive, cwd }, env.home);

    const archived = await readdir(path.join(env.archive, encodeProjectDir(cwd)));
    assert.ok(archived.includes('b.jsonl'), 'archive must retain the lost session');
  } finally {
    await teardown(env);
  }
});

// --- recover ----------------------------------------------------------------

test('recoverChats restores only missing sessions and never overwrites local ones', async () => {
  const env = await setup();
  try {
    const cwd = '/work/app';
    // Archive has a,b,c; local has only a (with distinct content to detect overwrite).
    const archDir = path.join(env.archive, encodeProjectDir(cwd));
    await mkdir(archDir, { recursive: true });
    await writeFile(path.join(archDir, 'a.jsonl'), 'ARCHIVE-A\n');
    await writeFile(path.join(archDir, 'b.jsonl'), 'ARCHIVE-B\n');
    await writeFile(path.join(archDir, 'c.jsonl'), 'ARCHIVE-C\n');
    await seedProject(env.home, cwd, { 'a.jsonl': 'LOCAL-A\n' });

    const result = recoverChats({ mode: 'recover', archivePath: env.archive, cwd }, env.home);
    assert.equal(result.copied, 2); // b, c
    assert.equal(result.skipped, 1); // a

    const local = projectDir(env.home, cwd);
    assert.equal(await readFile(path.join(local, 'a.jsonl'), 'utf8'), 'LOCAL-A\n', 'must not overwrite local a');
    assert.equal(await readFile(path.join(local, 'b.jsonl'), 'utf8'), 'ARCHIVE-B\n');
    assert.equal(await readFile(path.join(local, 'c.jsonl'), 'utf8'), 'ARCHIVE-C\n');
  } finally {
    await teardown(env);
  }
});

// --- --all scope ------------------------------------------------------------

test('backupChats --all backs up every project', async () => {
  const env = await setup();
  try {
    await seedProject(env.home, '/work/one', { 'a.jsonl': '1\n' });
    await seedProject(env.home, '/work/two', { 'b.jsonl': '2\n', 'c.jsonl': '3\n' });

    const result = backupChats({ mode: 'backup', archivePath: env.archive, all: true }, env.home);
    assert.equal(result.projects, 2);
    assert.equal(result.copied, 3);
  } finally {
    await teardown(env);
  }
});

// --- comparison -------------------------------------------------------------

test('compareChats reports local-only, archive-only, and shared sessions', async () => {
  const env = await setup();
  try {
    const cwd = '/work/app';
    await seedProject(env.home, cwd, { 'a.jsonl': 'AAA\n', 'b.jsonl': 'BBBB\n' });
    const archDir = path.join(env.archive, encodeProjectDir(cwd));
    await mkdir(archDir, { recursive: true });
    await writeFile(path.join(archDir, 'b.jsonl'), 'BBBB\n');
    await writeFile(path.join(archDir, 'c.jsonl'), 'CC\n');

    const cmp = compareChats({ archivePath: env.archive, cwd, homeDir: env.home });
    assert.equal(cmp.localCount, 2);
    assert.equal(cmp.archiveCount, 2);
    assert.equal(cmp.onlyLocal, 1); // a
    assert.equal(cmp.onlyArchive, 1); // c
    assert.deepEqual(cmp.entries.map((e) => e.name), ['a.jsonl', 'b.jsonl', 'c.jsonl']);

    const a = cmp.entries.find((e) => e.name === 'a.jsonl');
    assert.ok(a.localBytes !== null && a.archiveBytes === null);
    const b = cmp.entries.find((e) => e.name === 'b.jsonl');
    assert.ok(b.localBytes !== null && b.archiveBytes !== null);
    const c = cmp.entries.find((e) => e.name === 'c.jsonl');
    assert.ok(c.localBytes === null && c.archiveBytes !== null);
  } finally {
    await teardown(env);
  }
});

test('formatComparison renders both columns and loss/backup warnings', async () => {
  const env = await setup();
  try {
    const cwd = '/work/app';
    await seedProject(env.home, cwd, { 'a.jsonl': 'AAA\n' });
    const out = formatComparison(compareChats({ archivePath: env.archive, cwd, homeDir: env.home }));
    assert.ok(out.includes('LOCAL'));
    assert.ok(out.includes('ARCHIVE'));
    assert.ok(out.includes('not backed up'));
    assert.ok(out.includes('not yet backed up'));
  } finally {
    await teardown(env);
  }
});

// --- CLI guardrails ---------------------------------------------------------

test('mainArchive rejects a missing mode', () => {
  assert.equal(mainArchive(['node', 'x']), 2);
});

test('mainArchive rejects a relative archive path', () => {
  assert.equal(mainArchive(['node', 'x', 'backup', '--path', 'relative/dir']), 2);
});
