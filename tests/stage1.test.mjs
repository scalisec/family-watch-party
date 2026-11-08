import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));

// ---------- extension security guard rails ----------
test('manifest: Manifest V3 with only the permissions we documented', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['downloads']);
  assert.deepEqual(manifest.host_permissions, ['https://watch.livebarn.com/*']);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test('manifest: only the Family Watch Party site can talk to the helper', () => {
  assert.deepEqual(manifest.externally_connectable, { matches: ['https://scalisec.github.io/*'] });
});

test('manifest: page script runs only on LiveBarn', () => {
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://watch.livebarn.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['lib/plan.js', 'livebarn.js']);
});

test('manifest: every file it names exists', () => {
  const files = [manifest.background.service_worker, ...manifest.content_scripts[0].js];
  for (const f of files) assert.ok(existsSync(path.join(root, 'extension', f)), `${f} missing`);
});

test('manifest key gives the ID the app uses', () => {
  const der = Buffer.from(manifest.key, 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  assert.match(read('js/helper-client.js'), new RegExp(`HELPER_ID = '${id}'`));
});

test('background checks the sender origin before acting', () => {
  const bg = read('extension/background.js');
  assert.match(bg, /const APP_ORIGIN = 'https:\/\/scalisec\.github\.io';/);
  assert.match(bg, /if \(origin !== APP_ORIGIN\) \{ port\.disconnect\(\); return; \}/);
});

test('extension code has no remote code or eval', () => {
  for (const f of ['extension/background.js', 'extension/livebarn.js', 'extension/lib/plan.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\beval\(|new Function\(|importScripts\(['"]https?:/, `${f} loads code it shouldn't`);
    assert.doesNotMatch(src, /fetch\(/, `${f} makes network requests`);
  }
});

test('page script only renames LiveBarn media and never downloads by URL itself', () => {
  const bg = read('extension/background.js');
  assert.match(bg, /if \(!P\.isLiveBarnMedia\(item\.finalUrl \|\| item\.url\) \|\| pending\.length === 0\) return;/);
  assert.doesNotMatch(bg, /chrome\.downloads\.download\(/, 'downloads must come from LiveBarn\'s own button');
});

test('extension scripts parse', () => {
  for (const f of ['extension/background.js', 'extension/livebarn.js', 'extension/lib/plan.js']) {
    assert.doesNotThrow(() => new vm.Script(read(f)), `${f} has a syntax error`);
  }
});

// ---------- helper test page ----------
test('helper-test.html: header, nav and allowed hosts', () => {
  const html = read('helper-test.html');
  assert.match(html, /class="app-name">Family Watch Party</);
  assert.match(html, /BY BENCH BOSS LABS · V\d+\.\d+\.\d+/);
  const hosts = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host);
  for (const h of hosts) assert.equal(h, 'fonts.googleapis.com');
});

test('helper-test.html: every id the script uses exists, labels point at fields', () => {
  const html = read('helper-test.html');
  const js = read('js/helper-test.js');
  for (const id of new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} missing`);
  }
  for (const m of html.matchAll(/<label for="([^"]+)">/g)) assert.match(html, new RegExp(`id="${m[1]}"`));
});

test('helper-test.html: dry run is on by default and real runs ask first', () => {
  assert.match(read('helper-test.html'), /<input id="dryRun" type="checkbox" checked>/);
  assert.match(read('js/helper-test.js'), /confirm\('This downloads the game for real/);
});

test('version matches across the app and package.json', () => {
  const v = JSON.parse(read('package.json')).version;
  for (const page of ['index.html', 'pano-check.html', 'helper-test.html']) {
    assert.match(read(page), new RegExp(`V${v.replace(/\./g, '\\.')}<`), `${page} shows another version`);
  }
});

test('README lists every extension permission and the install steps', () => {
  const readme = read('README.md');
  for (const word of ['downloads', 'watch.livebarn.com', 'scalisec.github.io', 'Developer mode', 'Load unpacked']) {
    assert.ok(readme.includes(word), `README should mention ${word}`);
  }
});
