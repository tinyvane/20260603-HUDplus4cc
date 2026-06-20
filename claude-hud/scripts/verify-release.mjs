import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function walkFiles(dir, suffix, base = dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name);
    if (statSync(filePath).isDirectory()) {
      files.push(...walkFiles(filePath, suffix, base));
    } else if (name.endsWith(suffix)) {
      files.push(path.relative(base, filePath).slice(0, -suffix.length).replaceAll('\\', '/'));
    }
  }
  return files.sort();
}

const packageJson = readJson('package.json');
const expectedVersion = packageJson.version;
const packageLock = readJson('package-lock.json');
const versions = new Map([
  ['package-lock.json', packageLock.version],
  ['package-lock.json root package', packageLock.packages[''].version],
  ['.claude-plugin/plugin.json', readJson('.claude-plugin/plugin.json').version],
  ['.claude-plugin/marketplace.json', readJson('.claude-plugin/marketplace.json').metadata.version],
  ['../.claude-plugin/marketplace.json', readJson('../.claude-plugin/marketplace.json').metadata.version],
]);

const mismatches = [...versions].filter(([, version]) => version !== expectedVersion);
if (mismatches.length > 0) {
  throw new Error(`Version mismatch: expected ${expectedVersion}; ${mismatches.map(([file, version]) => `${file}=${version}`).join(', ')}`);
}

const sourceModules = walkFiles('src', '.ts');
const distModules = walkFiles('dist', '.js');
const stale = distModules.filter((module) => !sourceModules.includes(module));
const missing = sourceModules.filter((module) => !distModules.includes(module));
if (stale.length > 0 || missing.length > 0) {
  throw new Error(`dist module mismatch; stale=[${stale.join(', ')}], missing=[${missing.join(', ')}]`);
}

console.log(`release metadata and ${distModules.length} dist modules verified for ${expectedVersion}`);
