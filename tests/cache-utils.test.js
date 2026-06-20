import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWriteFileSync, sweepCacheDirSync } from '../dist/utils/cache.js';

test('atomicWriteFileSync replaces content without leaving temp files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cache-'));
  try {
    const filePath = path.join(dir, 'entry.json');
    await writeFile(filePath, 'old', 'utf8');
    atomicWriteFileSync(filePath, 'new');
    assert.equal(await readFile(filePath, 'utf8'), 'new');
    assert.deepEqual(await readdir(dir), ['entry.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sweepCacheDirSync removes stale and excess entries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cache-'));
  try {
    const now = Date.now();
    for (let index = 0; index < 4; index += 1) {
      const filePath = path.join(dir, `${index}.json`);
      await writeFile(filePath, '{}', 'utf8');
      const time = new Date(now - (4 - index) * 1000);
      await utimes(filePath, time, time);
    }
    sweepCacheDirSync(dir, { now, maxAgeMs: 3500, maxEntries: 2 });
    assert.deepEqual(await readdir(dir), ['2.json', '3.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
