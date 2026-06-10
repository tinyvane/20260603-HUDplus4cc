import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RenderContext } from '../../types.js';
import { label, warning } from '../colors.js';
import { t } from '../../i18n/index.js';

const CHAT_ICON = '💬';

function hyperlink(uri: string, text: string): string {
  const esc = '\x1b';
  const st = '\\';
  return `${esc}]8;;${uri}${esc}${st}${text}${esc}]8;;${esc}${st}`;
}

function dirHref(dirPath: string): string | null {
  try {
    return pathToFileURL(path.resolve(dirPath)).toString();
  } catch {
    return null;
  }
}

/** Compact human-readable byte size, e.g. 1.4MB / 920KB / 12B. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted}${units[unitIndex]}`;
}

/** Compact relative age token, e.g. <1m / 5m / 2h / 3d. */
export function formatAge(timestampMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - timestampMs);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function renderChatsLine(ctx: RenderContext, nowMs: number = Date.now()): string | null {
  const display = ctx.config?.display;
  if (display?.showChats !== true) {
    return null;
  }

  const stats = ctx.chatStats;
  if (!stats || stats.chatDir === null) {
    return null;
  }

  const colors = ctx.config?.colors;

  // Base: icon + count, optionally a click-to-open hyperlink to the folder.
  let countSegment = `${CHAT_ICON} ${stats.count}`;
  if (display?.chatClickable !== false) {
    const href = dirHref(stats.chatDir);
    if (href) {
      countSegment = hyperlink(href, countSegment);
    }
  }

  let line = label(countSegment, colors);

  // Loss sentinel: flag drops below the recorded high-water mark.
  if (display?.chatShowPeakAlert !== false && stats.belowPeak) {
    line += ' ' + warning(`⚠ (${t('label.chatsPeak')} ${stats.peak})`, colors);
  }

  const extras: string[] = [];
  if (display?.chatShowSize === true && stats.totalBytes > 0) {
    extras.push(formatBytes(stats.totalBytes));
  }
  if (display?.chatShowLastActive === true && stats.lastActiveMs !== null) {
    extras.push(`${formatAge(stats.lastActiveMs, nowMs)} ${t('format.ago')}`);
  }

  if (extras.length > 0) {
    line += label(` · ${extras.join(' · ')}`, colors);
  }

  return line;
}
