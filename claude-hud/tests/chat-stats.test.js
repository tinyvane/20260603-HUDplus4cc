import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  encodeProjectDir,
  resolveChatDir,
  getChatStats,
} from '../dist/chat-stats.js';
import { formatBytes, formatAge, renderChatsLine } from '../dist/render/lines/chats.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { setLanguage } from '../dist/i18n/index.js';

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
}

async function makeProject(jsonlNames) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-chat-'));
  for (const name of jsonlNames) {
    await writeFile(path.join(dir, name), '{"x":1}\n', 'utf8');
  }
  return dir;
}

// --- encodeProjectDir -------------------------------------------------------

test('encodeProjectDir replaces separators and drive colon with dashes', () => {
  assert.equal(encodeProjectDir('C:\\Users\\me\\proj'), 'C--Users-me-proj');
  assert.equal(encodeProjectDir('/home/me/proj'), '-home-me-proj');
});

// --- resolveChatDir ---------------------------------------------------------

test('resolveChatDir prefers the transcript path parent directory', () => {
  const dir = resolveChatDir({ transcriptPath: path.join('/p', 'enc', 'sess.jsonl'), cwd: '/whatever' });
  assert.equal(dir, path.join('/p', 'enc'));
});

test('resolveChatDir falls back to cwd-derived projects path', () => {
  const homeDir = path.join('/tmp', 'fakehome');
  const dir = resolveChatDir({ cwd: '/work/app', homeDir });
  assert.equal(dir, path.join(homeDir, '.claude', 'projects', encodeProjectDir('/work/app')));
});

test('resolveChatDir returns null without transcript or cwd', () => {
  assert.equal(resolveChatDir({}), null);
});

// --- getChatStats counting --------------------------------------------------

test('getChatStats counts .jsonl files and sums size', async () => {
  const dir = await makeProject(['a.jsonl', 'b.jsonl', 'notes.txt', 'c.jsonl']);
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  try {
    const stats = getChatStats({ transcriptPath: path.join(dir, 'a.jsonl'), homeDir: home });
    assert.equal(stats.count, 3);
    assert.ok(stats.totalBytes > 0);
    assert.ok(stats.lastActiveMs !== null);
    assert.equal(stats.belowPeak, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('getChatStats reports lastActiveMs from the newest session', async () => {
  const dir = await makeProject(['old.jsonl', 'new.jsonl']);
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  try {
    const newest = 1_900_000_000; // seconds
    await utimes(path.join(dir, 'old.jsonl'), newest - 10000, newest - 10000);
    await utimes(path.join(dir, 'new.jsonl'), newest, newest);
    const stats = getChatStats({ transcriptPath: path.join(dir, 'new.jsonl'), homeDir: home });
    assert.equal(Math.round(stats.lastActiveMs), newest * 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('getChatStats returns empty stats when directory is missing', () => {
  const stats = getChatStats({ transcriptPath: path.join(tmpdir(), 'does-not-exist-xyz', 's.jsonl'), homeDir: tmpdir() });
  assert.equal(stats.count, 0);
  assert.equal(stats.totalBytes, 0);
  assert.equal(stats.lastActiveMs, null);
});

// --- peak / loss sentinel ---------------------------------------------------

test('getChatStats tracks a persisted peak and flags drops below it', async () => {
  const dir = await makeProject(['a.jsonl', 'b.jsonl', 'c.jsonl']);
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const tp = path.join(dir, 'a.jsonl');
  try {
    // First observation establishes peak = 3.
    let stats = getChatStats({ transcriptPath: tp, homeDir: home });
    assert.equal(stats.count, 3);
    assert.equal(stats.peak, 3);
    assert.equal(stats.belowPeak, false);

    // Grow to 4 -> peak rises.
    await writeFile(path.join(dir, 'd.jsonl'), '{}\n', 'utf8');
    stats = getChatStats({ transcriptPath: tp, homeDir: home });
    assert.equal(stats.count, 4);
    assert.equal(stats.peak, 4);
    assert.equal(stats.belowPeak, false);

    // Drop to 2 -> peak holds at 4, belowPeak flips.
    await rm(path.join(dir, 'c.jsonl'));
    await rm(path.join(dir, 'd.jsonl'));
    stats = getChatStats({ transcriptPath: tp, homeDir: home });
    assert.equal(stats.count, 2);
    assert.equal(stats.peak, 4);
    assert.equal(stats.belowPeak, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('getChatStats with trackPeak:false does not flag drops', async () => {
  const dir = await makeProject(['a.jsonl']);
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  try {
    const stats = getChatStats({ transcriptPath: path.join(dir, 'a.jsonl'), homeDir: home, trackPeak: false });
    assert.equal(stats.peak, stats.count);
    assert.equal(stats.belowPeak, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// --- formatBytes / formatAge ------------------------------------------------

test('formatBytes renders compact units', () => {
  assert.equal(formatBytes(0), '0B');
  assert.equal(formatBytes(512), '512B');
  assert.equal(formatBytes(1536), '1.5KB');
  assert.equal(formatBytes(1.4 * 1024 * 1024), '1.4MB');
  assert.equal(formatBytes(25 * 1024 * 1024), '25MB');
});

test('formatAge renders compact relative tokens', () => {
  const now = 10_000_000_000;
  assert.equal(formatAge(now, now), '<1m');
  assert.equal(formatAge(now - 5 * 60000, now), '5m');
  assert.equal(formatAge(now - 2 * 3600_000, now), '2h');
  assert.equal(formatAge(now - 3 * 86400_000, now), '3d');
});

// --- renderChatsLine --------------------------------------------------------

function ctxWith(display, chatStats, lang = 'en') {
  setLanguage(lang);
  return {
    config: { ...DEFAULT_CONFIG, display: { ...DEFAULT_CONFIG.display, ...display } },
    chatStats,
  };
}

const BASE_STATS = { chatDir: 'C:/x/proj', count: 3, peak: 3, belowPeak: false, totalBytes: 1.4 * 1024 * 1024, lastActiveMs: 1_000_000 };

test('renderChatsLine returns null when showChats is off', () => {
  assert.equal(renderChatsLine(ctxWith({ showChats: false }, BASE_STATS)), null);
});

test('renderChatsLine returns null when chat dir is unknown', () => {
  assert.equal(renderChatsLine(ctxWith({ showChats: true }, { ...BASE_STATS, chatDir: null })), null);
});

test('renderChatsLine shows the icon and count by default', () => {
  const out = stripAnsi(renderChatsLine(ctxWith({ showChats: true }, BASE_STATS)));
  assert.equal(out, '💬 3');
});

test('renderChatsLine wraps the count in an OSC 8 hyperlink when clickable', () => {
  const out = renderChatsLine(ctxWith({ showChats: true, chatClickable: true }, BASE_STATS));
  assert.ok(out.includes('\x1b]8;;file:'), 'expected an OSC 8 file hyperlink');
});

test('renderChatsLine omits the hyperlink when chatClickable is false', () => {
  const out = renderChatsLine(ctxWith({ showChats: true, chatClickable: false }, BASE_STATS));
  assert.ok(!out.includes('\x1b]8;;'), 'expected no hyperlink');
});

test('renderChatsLine shows a peak-drop alert when below peak', () => {
  const out = stripAnsi(renderChatsLine(ctxWith({ showChats: true }, { ...BASE_STATS, count: 3, peak: 5, belowPeak: true })));
  assert.equal(out, '💬 3 ⚠ (peak 5)');
});

test('renderChatsLine localizes the peak label', () => {
  const out = stripAnsi(renderChatsLine(ctxWith({ showChats: true }, { ...BASE_STATS, peak: 5, belowPeak: true }, 'zh-Hans')));
  assert.ok(out.includes('峰值 5'), `got: ${out}`);
});

test('renderChatsLine appends size and last-active when enabled', () => {
  const now = BASE_STATS.lastActiveMs + 2 * 3600_000;
  const out = stripAnsi(renderChatsLine(ctxWith({ showChats: true, chatShowSize: true, chatShowLastActive: true }, BASE_STATS), now));
  assert.equal(out, '💬 3 · 1.4MB · 2h ago');
});

test('renderChatsLine hides the alert when chatShowPeakAlert is false', () => {
  const out = stripAnsi(renderChatsLine(ctxWith({ showChats: true, chatShowPeakAlert: false }, { ...BASE_STATS, peak: 9, belowPeak: true })));
  assert.equal(out, '💬 3');
});
