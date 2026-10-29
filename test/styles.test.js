import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The theme hooks must be settable on any ancestor. Declaring a --fleetbar-*
// default on :host shadows the inherited value, so the component keeps its
// defaults in private --fb-* vars that read var(--fleetbar-*, <default>).
const source = readFileSync(new URL('../src/element.js', import.meta.url), 'utf8');
const css = source.slice(source.indexOf('export const STYLES = `'), source.indexOf('`;', source.indexOf('export const STYLES = `')));

test('no --fleetbar-* custom property is declared inside the component', () => {
  assert.deepEqual(css.match(/--fleetbar-[a-z-]+\s*:/g), null);
});

test('every private --fb-* default reads the public --fleetbar-* hook first', () => {
  const decls = css.match(/--fb-([a-z-]+):\s*([^;]+);/g) ?? [];
  assert.ok(decls.length >= 14);
  for (const decl of decls) {
    const [, name, value] = decl.match(/--fb-([a-z-]+):\s*([^;]+);/);
    assert.match(value, new RegExp(`^var\\(--fleetbar-${name}, `), decl);
  }
});
