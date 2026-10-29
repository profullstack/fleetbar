// Drives <fleet-bar> in happy-dom against a fake /api/fleetbar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://w3bs.test/fleet' });
const saved = {};
const GLOBALS = ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'fetch'];

const KEYS = [
  { name: 'laptop', type: 'ssh-ed25519', public_key: 'ssh-ed25519 AAAA laptop', fingerprint: 'SHA256:laptopfingerprint000000000000000000000000000', comment: 'me@laptop' },
  { name: 'ci', type: 'ssh-ed25519', public_key: 'ssh-ed25519 BBBB ci', fingerprint: 'SHA256:cifingerprint', comment: 'ci@runner' },
];
let db;
let calls;
let mode;

function reset() {
  mode = 'ok';
  calls = [];
  db = {
    settings: { keys_url: 'https://app.logicsrc.com/k/lks_' + 'A'.repeat(43) + '.json', alert_email: 'ann@example.com', alert_phone: '+15555550123' },
    monitors: [
      { id: 'm1', name: 'web-1', type: 'ssh', target: 'web1.example.com', enabled: true, interval_s: 60, current_state: 'down', last_checked_at: new Date().toISOString(), last_error: 'key SHA256:x removed from keyring', last_response_ms: 81, ssh: { username: 'deploy', fingerprint: KEYS[0].fingerprint, key_comment: 'me@laptop', key_source: 'keyring' } },
      { id: 'm2', name: 'site', type: 'http', target: 'https://example.com', enabled: true, interval_s: 60, current_state: 'up', last_checked_at: null, last_error: null, last_response_ms: 1200 },
    ],
  };
}

const json = (status, body) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(url, init = {}) {
  const u = new URL(url, 'https://w3bs.test');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ path: u.pathname, method, body, credentials: init.credentials });
  if (mode === 'noaccount') return json(404, { error: 'no_crawlproof_account', signup_url: 'https://crawlproof.com/signup' });
  if (mode === 'anon') return json(401, { error: 'unauthorized', message: 'Sign in to manage your fleet.' });
  const p = u.pathname.replace('/api/fleetbar', '');
  if (p === '/settings' && method === 'GET') return json(200, db.settings);
  if (p === '/settings' && method === 'PUT') { db.settings = body; return json(200, body); }
  if (p === '/keys') return json(200, { keys: KEYS });
  if (p === '/monitors' && method === 'GET') return json(200, { monitors: db.monitors });
  if (p === '/monitors' && method === 'POST') {
    const m = { id: 'm' + (db.monitors.length + 1), enabled: true, current_state: null, ...body };
    db.monitors.push(m);
    return json(201, { monitor: m });
  }
  const m = /^\/monitors\/([^/]+)$/.exec(p);
  if (m && method === 'PATCH') {
    const mon = db.monitors.find((x) => x.id === m[1]);
    Object.assign(mon, body);
    return json(200, { monitor: mon });
  }
  if (m && method === 'DELETE') {
    db.monitors = db.monitors.filter((x) => x.id !== m[1]);
    return json(204, null);
  }
  return json(404, { error: 'not_found' });
}

before(async () => {
  for (const g of GLOBALS) saved[g] = globalThis[g];
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    fetch: fakeFetch,
  });
  await import('../src/index.js');
});

after(async () => {
  for (const g of GLOBALS) globalThis[g] = saved[g];
  await window.happyDOM.close();
});

const tick = () => new Promise((r) => setTimeout(r, 10));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

async function mount(attrs = '') {
  document.body.innerHTML = `<fleet-bar ${attrs}></fleet-bar>`;
  const el = document.querySelector('fleet-bar');
  await settle();
  return el;
}

const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];

function setField(el, form, name, value) {
  const input = form.querySelector(`[name="${name}"]:not([disabled])`);
  input.value = value;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('registers <fleet-bar> and loads settings, keys and checks', async () => {
  reset();
  const loads = [];
  document.addEventListener('fleetbar:load', (e) => loads.push(e.detail));
  const el = await mount('endpoint="/api/fleetbar/"');
  assert.ok(customElements.get('fleet-bar'));
  const paths = calls.map((c) => `${c.method} ${c.path}`).sort();
  assert.deepEqual(paths, ['GET /api/fleetbar/keys', 'GET /api/fleetbar/monitors', 'GET /api/fleetbar/settings']);
  assert.ok(calls.every((c) => c.credentials === 'same-origin'));
  assert.equal(loads.length, 1);
  assert.equal($$(el, '.keys li').length, 2);
  assert.match($(el, '.keys').textContent, /SHA256:laptopfingerprint/);
  assert.ok($(el, `a[href="https://app.logicsrc.com/keyring"]`));
  assert.equal($(el, 'input[name=keys_url]').value, db.settings.keys_url);
});

test('the type dropdown lists SSH login right under HTTP(S), with the no-login note', async () => {
  reset();
  const el = await mount();
  const opts = $$(el, 'select[name=type] option').map((o) => o.textContent);
  assert.equal(opts[0], 'HTTP(S)');
  assert.equal(opts[1], 'SSH login');
  assert.match($(el, '.ssh-note').textContent, /no private key, no login/);
  const keyOpts = $$(el, 'select[name=key] option').map((o) => o.value);
  assert.deepEqual(keyOpts, [KEYS[0].fingerprint, KEYS[1].fingerprint, '__paste']);
});

test('checks table: state, user@host, key, latency and the down error', async () => {
  reset();
  const el = await mount();
  const rows = $$(el, 'tbody tr');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.state, 'down');
  assert.ok(rows[0].querySelector('.dot.down'));
  assert.match(rows[0].textContent, /deploy@web1\.example\.com/);
  assert.match(rows[0].textContent, /me@laptop/);
  assert.match(rows[0].textContent, /81 ms/);
  assert.match(rows[0].querySelector('.down-error').textContent, /removed from keyring/);
  assert.equal(rows[1].dataset.state, 'up');
  assert.match(rows[1].textContent, /1\.2 s/);
  assert.match(rows[1].textContent, /never/);
  assert.equal(rows[1].querySelector('.down-error'), null);
});

test('server data is escaped', async () => {
  reset();
  db.monitors[1].name = '<img src=x onerror=alert(1)>';
  const el = await mount();
  assert.equal($$(el, 'tbody img').length, 0);
  assert.match($$(el, 'tbody tr')[1].textContent, /<img src=x/);
});

test('add an SSH check with a keyring key', async () => {
  reset();
  const changes = [];
  const el = await mount();
  el.addEventListener('fleetbar:change', (e) => changes.push(e.detail));
  const form = $(el, 'form.monitor');
  setField(el, form, 'type', 'ssh');
  assert.equal(form.dataset.type, 'ssh');
  setField(el, form, 'name', 'db-1');
  setField(el, form, 'target', 'db1.example.com:2222');
  setField(el, form, 'username', 'root');
  setField(el, form, 'key', KEYS[1].fingerprint);
  submit($(el, 'form.monitor'));
  await settle();
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, {
    type: 'ssh',
    name: 'db-1',
    target: 'db1.example.com:2222',
    interval_s: 60,
    alert_email: 'ann@example.com',
    alert_phone: '+15555550123',
    ssh: { username: 'root', fingerprint: KEYS[1].fingerprint },
  });
  assert.equal(changes[0].action, 'create');
  assert.equal($$(el, 'tbody tr').length, 3);
});

test('a pasted private key is refused before anything is sent', async () => {
  reset();
  const el = await mount();
  const form = $(el, 'form.monitor');
  setField(el, form, 'type', 'ssh');
  setField(el, form, 'target', 'h.example.com');
  setField(el, form, 'username', 'root');
  setField(el, form, 'key', '__paste');
  assert.equal($(el, '.paste').hidden, false);
  setField(el, form, 'public_key', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----');
  submit($(el, 'form.monitor'));
  await settle();
  assert.match($(el, '.form-err').textContent, /private key/i);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('pause, edit and delete with confirm', async () => {
  reset();
  const el = await mount();
  $(el, 'button[data-action=toggle][data-id=m2]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { enabled: false });
  assert.equal($(el, 'tr[data-id=m2]').dataset.state, 'paused');
  assert.equal($(el, 'button[data-action=toggle][data-id=m2]').textContent, 'Resume');

  $(el, 'button[data-action=edit][data-id=m1]').click();
  await settle();
  const form = $(el, 'form.monitor');
  assert.equal(form.dataset.type, 'ssh');
  assert.equal(form.querySelector('select[name=type]').disabled, true);
  assert.equal(form.querySelector('input[name=target]:not([disabled])').value, 'web1.example.com');
  assert.equal(form.querySelector('select[name=key]').value, KEYS[0].fingerprint);
  setField(el, form, 'interval_s', '300');
  submit(form);
  await settle();
  const patch = calls.filter((c) => c.method === 'PATCH').at(-1);
  assert.equal(patch.path, '/api/fleetbar/monitors/m1');
  assert.deepEqual(patch.body, {
    name: 'web-1',
    target: 'web1.example.com',
    interval_s: 300,
    ssh: { username: 'deploy', fingerprint: KEYS[0].fingerprint },
  });
  assert.equal($(el, 'form.monitor select[name=type]').disabled, false, 'form resets after save');

  $(el, 'button[data-action=delete][data-id=m2]').click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'first click only asks');
  $(el, 'button[data-action=delete-yes][data-id=m2]').click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
  assert.equal($(el, 'tr[data-id=m2]'), null);
});

test('saving the keyring link normalises .keys and rejects other hosts', async () => {
  reset();
  const el = await mount();
  const form = $(el, 'form.settings');
  form.querySelector('[name=keys_url]').value = 'https://evil.test/k/lks_x.json';
  submit(form);
  await settle();
  assert.match($(el, '.settings-err').textContent, /app\.logicsrc\.com/);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);

  const tok = 'lks_' + 'B'.repeat(43);
  $(el, 'form.settings [name=keys_url]').value = `https://app.logicsrc.com/k/${tok}.keys`;
  submit($(el, 'form.settings'));
  await settle();
  const put = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, {
    keys_url: `https://app.logicsrc.com/k/${tok}.json`,
    alert_email: 'ann@example.com',
    alert_phone: '+15555550123',
  });
});

test('no crawlproof account shows a sign-up link', async () => {
  reset();
  mode = 'noaccount';
  const el = await mount();
  const a = $(el, '[part=signup] a');
  assert.equal(a.getAttribute('href'), 'https://crawlproof.com/signup');
  assert.equal($(el, 'form.monitor'), null);
});

test('signed out shows a sign-in message', async () => {
  reset();
  mode = 'anon';
  const el = await mount();
  assert.match($(el, '.notice.error').textContent, /Sign in/);
});

test('refreshes checks on the refresh interval and stops when removed', async () => {
  reset();
  const el = await mount('refresh="5"');
  const before = calls.length;
  await el.refreshMonitors();
  assert.equal(calls.length, before + 1);
  assert.ok(el._timer);
  el.remove();
  assert.equal(el._timer, null);
});
