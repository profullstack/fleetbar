import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_TYPES,
  SSH_NOTE,
  buildMonitorBody,
  checkPublicKey,
  esc,
  normalizeKeysUrl,
  stateOf,
  targetLabel,
  timeAgo,
  formatLatency,
  safeHref,
} from '../src/logic.js';

const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0l9V0Tq3v6Yp6r3b3vX1o0m6m4qY8b4yq0Z9pXk1a me@laptop';
const TOKEN = 'lks_' + 'A'.repeat(43);

test('SSH login is listed right under HTTP(S)', () => {
  assert.equal(CHECK_TYPES[0].label, 'HTTP(S)');
  assert.equal(CHECK_TYPES[1].value, 'ssh');
  assert.equal(CHECK_TYPES[1].label, 'SSH login');
  assert.deepEqual(CHECK_TYPES.map((t) => t.value), ['http', 'ssh', 'keyword', 'ssl', 'tcp']);
});

test('the SSH note says no private key, no login', () => {
  assert.match(SSH_NOTE, /no private key, no login/);
});

test('normalizeKeysUrl accepts .json and .keys share links, clears on empty', () => {
  assert.deepEqual(normalizeKeysUrl(''), { ok: true, value: null });
  assert.deepEqual(normalizeKeysUrl(` https://app.logicsrc.com/k/${TOKEN}.json `), {
    ok: true,
    value: `https://app.logicsrc.com/k/${TOKEN}.json`,
  });
  assert.equal(
    normalizeKeysUrl(`https://app.logicsrc.com/k/${TOKEN}.keys`).value,
    `https://app.logicsrc.com/k/${TOKEN}.json`,
  );
  for (const bad of [
    `http://app.logicsrc.com/k/${TOKEN}.json`,
    `https://evil.com/k/${TOKEN}.json`,
    `https://app.logicsrc.com/k/${TOKEN}.json?x=1`,
    'https://app.logicsrc.com/k/nope.json',
  ]) {
    assert.equal(normalizeKeysUrl(bad).ok, false, bad);
  }
});

test('checkPublicKey refuses private keys and junk', () => {
  assert.equal(checkPublicKey(PUB).ok, true);
  const priv = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----';
  const r = checkPublicKey(priv);
  assert.equal(r.ok, false);
  assert.match(r.error, /private key/i);
  assert.equal(checkPublicKey('hello world').ok, false);
  assert.equal(checkPublicKey(`${PUB}\n${PUB}`).ok, false);
});

test('buildMonitorBody: ssh with a keyring fingerprint', () => {
  const r = buildMonitorBody({
    type: 'ssh',
    name: 'web-1',
    target: 'web1.example.com:2222',
    username: 'deploy',
    key: 'SHA256:abc',
    interval_s: '120',
    alert_email: 'ops@example.com',
    alert_phone: '',
  });
  assert.deepEqual(r, {
    ok: true,
    body: {
      type: 'ssh',
      name: 'web-1',
      target: 'web1.example.com:2222',
      interval_s: 120,
      alert_email: 'ops@example.com',
      ssh: { username: 'deploy', fingerprint: 'SHA256:abc' },
    },
  });
});

test('buildMonitorBody: ssh with a pasted public key', () => {
  const r = buildMonitorBody({ type: 'ssh', target: 'h', username: 'root', key: '__paste', public_key: PUB });
  assert.equal(r.ok, true);
  assert.deepEqual(r.body.ssh, { username: 'root', public_key: PUB });
  assert.equal(r.body.name, 'h');
  assert.equal(r.body.interval_s, 60);
});

test('buildMonitorBody: validation', () => {
  assert.equal(buildMonitorBody({ type: 'nope', target: 'x' }).field, 'type');
  assert.equal(buildMonitorBody({ type: 'http', target: '' }).field, 'target');
  assert.equal(buildMonitorBody({ type: 'http', target: 'example.com' }).field, 'target');
  assert.equal(buildMonitorBody({ type: 'tcp', target: 'db.example.com' }).field, 'target');
  assert.equal(buildMonitorBody({ type: 'http', target: 'https://x.y', interval_s: '30' }).field, 'interval_s');
  assert.equal(buildMonitorBody({ type: 'keyword', target: 'https://x.y' }).field, 'keyword');
  assert.equal(buildMonitorBody({ type: 'ssh', target: 'h', username: 'bad user' }).field, 'username');
  assert.equal(buildMonitorBody({ type: 'ssh', target: 'h', username: 'u', key: '__paste', public_key: '' }).field, 'public_key');
});

test('buildMonitorBody: keyword', () => {
  const r = buildMonitorBody({ type: 'keyword', target: 'https://x.y/', keyword: 'OK', match: 'absent' });
  assert.equal(r.body.keyword, 'OK');
  assert.equal(r.body.match, 'absent');
});

test('buildMonitorBody: editing omits type and keeps an inline key', () => {
  const editing = { id: 'm1', type: 'ssh', ssh: { username: 'deploy', key_source: 'inline' } };
  const r = buildMonitorBody({ target: 'h', username: 'deploy', key: '__paste', public_key: '' }, editing);
  assert.equal(r.ok, true);
  assert.equal(r.body.type, undefined);
  assert.equal(r.body.ssh, undefined);
  const r2 = buildMonitorBody({ target: 'h', username: 'other', key: '__paste', public_key: '' }, editing);
  assert.equal(r2.ok, false);
});

test('display helpers', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(stateOf({ enabled: false, current_state: 'up' }), 'paused');
  assert.equal(stateOf({ current_state: 'DOWN' }), 'down');
  assert.equal(stateOf({ current_state: null }), 'pending');
  assert.equal(targetLabel({ type: 'ssh', target: 'h:22', ssh: { username: 'u' } }), 'u@h:22');
  assert.equal(targetLabel({ type: 'http', target: 'https://x' }), 'https://x');
  const now = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(timeAgo('2026-10-29T11:59:30Z', now), '30s ago');
  assert.equal(timeAgo('2026-10-29T11:00:00Z', now), '1h ago');
  assert.equal(timeAgo(null, now), 'never');
  assert.equal(formatLatency(42.4), '42 ms');
  assert.equal(formatLatency(1500), '1.5 s');
  assert.equal(formatLatency(null), '');
  assert.equal(safeHref('javascript:alert(1)', 'https://f'), 'https://f');
  assert.equal(safeHref('https://crawlproof.com/signup', 'https://f'), 'https://crawlproof.com/signup');
});
