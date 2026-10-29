// The prebuilt IIFE must register <fleet-bar> from a plain <script>, with no imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const iife = readFileSync(new URL('../dist/fleetbar.js', import.meta.url), 'utf8');

test('dist/fleetbar.js has no module syntax', () => {
  assert.doesNotMatch(iife, /^\s*(import|export)\b/m);
  assert.match(iife, new RegExp(`v${pkg.version.replace(/\./g, '\\.')}`));
});

test('dist/fleetbar.js registers <fleet-bar> and window.FleetBar', async () => {
  const window = new Window({ url: 'https://example.test/' });
  const ctx = vm.createContext({
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    setInterval,
    clearInterval,
    URL,
    fetch: async () => new Response('{}', { status: 200 }),
  });
  vm.runInContext(iife, ctx);
  assert.ok(window.customElements.get('fleet-bar'));
  assert.equal(window.FleetBar.version, pkg.version);
  assert.equal(window.FleetBar.CHECK_TYPES[1].label, 'SSH login');
  await window.happyDOM.close();
});

test('dist/fleetbar.mjs exports the same API as src/index.js', async () => {
  const dist = await import('../dist/fleetbar.mjs');
  const src = await import('../src/logic.js');
  for (const k of Object.keys(src)) assert.ok(k in dist, `dist missing ${k}`);
  assert.equal(typeof dist.FleetBar, 'function');
  assert.equal(typeof dist.defineFleetBar, 'function');
});
