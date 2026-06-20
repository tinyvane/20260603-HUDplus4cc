import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, parseExtraCmdArg, runExtraCmd } from '../dist/extra-cmd.js';

// Cross-platform command that writes a fixed string to stdout. Using `echo`
// with single quotes is POSIX-shell specific — under cmd.exe (Windows) the
// quotes are emitted literally, breaking JSON parsing. Driving the runtime
// directly avoids any shell-quoting differences. The expression must contain
// no double quotes or backslashes so the outer "..." is safe in both sh and cmd.
function emitCmd(expr) {
  return `node -e "process.stdout.write(${expr})"`;
}

// Spawning a node child can exceed the production 3s default on machines with
// slow process startup (antivirus scanning); these tests verify output
// handling, not latency, so give them a generous timeout.
const SLOW_SPAWN_TIMEOUT_MS = 15000;

// ============================================================================
// sanitize() tests
// ============================================================================

test('sanitize strips ANSI CSI sequences', () => {
  const input = '\x1B[31mRed\x1B[0m Text';
  assert.equal(sanitize(input), 'Red Text');
});

test('sanitize strips OSC sequences', () => {
  const input = '\x1B]0;Window Title\x07Normal Text';
  assert.equal(sanitize(input), 'Normal Text');
});

test('sanitize strips C0 control characters', () => {
  const input = 'Hello\x00World\x1FTest';
  assert.equal(sanitize(input), 'HelloWorldTest');
});

test('sanitize strips C1 control characters', () => {
  const input = 'Hello\x80World\x9FTest';
  assert.equal(sanitize(input), 'HelloWorldTest');
});

test('sanitize strips bidi control characters', () => {
  const input = 'Hello\u200EWorld\u202ATest\u2069End';
  assert.equal(sanitize(input), 'HelloWorldTestEnd');
});

test('sanitize preserves normal text', () => {
  const input = 'Just normal text 123!';
  assert.equal(sanitize(input), 'Just normal text 123!');
});

test('sanitize handles empty string', () => {
  assert.equal(sanitize(''), '');
});

test('sanitize handles complex mixed escape sequences', () => {
  const input = '\x1B[1;32mBold Green\x1B[0m \x1B]0;Title\x07 \x00Hidden\x1F';
  assert.equal(sanitize(input), 'Bold Green  Hidden');
});

// ============================================================================
// parseExtraCmdArg() tests
// ============================================================================

test('parseExtraCmdArg returns null when no --extra-cmd present', () => {
  const argv = ['node', 'index.js', '--other', 'arg'];
  assert.equal(parseExtraCmdArg(argv), null);
});

test('parseExtraCmdArg parses --extra-cmd value syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'echo hello'];
  assert.equal(parseExtraCmdArg(argv), 'echo hello');
});

test('parseExtraCmdArg parses --extra-cmd=value syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd=echo hello'];
  assert.equal(parseExtraCmdArg(argv), 'echo hello');
});

test('parseExtraCmdArg returns null when --extra-cmd is last arg with space syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd'];
  assert.equal(parseExtraCmdArg(argv), null);
});

test('parseExtraCmdArg returns null for empty value with equals syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd='];
  assert.equal(parseExtraCmdArg(argv), null);
});

test('parseExtraCmdArg returns null for empty value with space syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd', ''];
  assert.equal(parseExtraCmdArg(argv), null);
});

test('parseExtraCmdArg handles command with equals sign in value', () => {
  const argv = ['node', 'index.js', '--extra-cmd=echo "key=value"'];
  assert.equal(parseExtraCmdArg(argv), 'echo "key=value"');
});

test('parseExtraCmdArg takes first occurrence when multiple present', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'first', '--extra-cmd', 'second'];
  assert.equal(parseExtraCmdArg(argv), 'first');
});

test('parseExtraCmdArg handles command with spaces and quotes', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'echo "hello world"'];
  assert.equal(parseExtraCmdArg(argv), 'echo "hello world"');
});

// ============================================================================
// runExtraCmd() tests
// ============================================================================

test('runExtraCmd returns label from valid JSON output', async () => {
  const result = await runExtraCmd(emitCmd("JSON.stringify({label:'test'})"), SLOW_SPAWN_TIMEOUT_MS);
  assert.equal(result, 'test');
});

test('runExtraCmd returns null for non-JSON output', async () => {
  const result = await runExtraCmd('echo "not json"');
  assert.equal(result, null);
});

test('runExtraCmd returns null for JSON without label field', async () => {
  const result = await runExtraCmd('echo \'{"other": "field"}\'');
  assert.equal(result, null);
});

test('runExtraCmd returns null for JSON with non-string label', async () => {
  const result = await runExtraCmd('echo \'{"label": 123}\'');
  assert.equal(result, null);
});

test('runExtraCmd truncates long labels with ellipsis', async () => {
  const result = await runExtraCmd(emitCmd("JSON.stringify({label:'a'.repeat(60)})"), SLOW_SPAWN_TIMEOUT_MS);
  assert.equal(result?.length, 50);
  assert.ok(result?.endsWith('…'));
});

test('runExtraCmd sanitizes output containing escape sequences', async () => {
  const result = await runExtraCmd(
    emitCmd("JSON.stringify({label:String.fromCharCode(27)+'[31mRed'+String.fromCharCode(27)+'[0m'})"),
    SLOW_SPAWN_TIMEOUT_MS
  );
  assert.equal(result, 'Red');
});

test('runExtraCmd returns null when command fails', async () => {
  const result = await runExtraCmd('exit 1');
  assert.equal(result, null);
});

test('runExtraCmd returns null when command does not exist', async () => {
  const result = await runExtraCmd('nonexistent-command-xyz123');
  assert.equal(result, null);
});

test('runExtraCmd handles timeout', async () => {
  const start = Date.now();
  const result = await runExtraCmd('sleep 10', 100);
  const elapsed = Date.now() - start;
  assert.equal(result, null);
  assert.ok(elapsed < 1000, `Expected timeout around 100ms, but took ${elapsed}ms`);
});

test('runExtraCmd handles empty stdout', async () => {
  const result = await runExtraCmd('echo ""');
  assert.equal(result, null);
});

test('runExtraCmd handles JSON array instead of object', async () => {
  const result = await runExtraCmd('echo \'[1,2,3]\'');
  assert.equal(result, null);
});

test('runExtraCmd handles null JSON', async () => {
  const result = await runExtraCmd('echo "null"');
  assert.equal(result, null);
});

test('runExtraCmd handles valid JSON with extra whitespace', async () => {
  const result = await runExtraCmd(emitCmd("'  '+JSON.stringify({label:'trimmed'})+'  '"), SLOW_SPAWN_TIMEOUT_MS);
  assert.equal(result, 'trimmed');
});
