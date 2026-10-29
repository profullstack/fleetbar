// Pure helpers for <fleet-bar>: no DOM, no imports, so they run in node:test and
// in the browser unchanged. The build concatenates this file into dist/.

/** Check types in the order the add form lists them. SSH login sits right under HTTP(S). */
export const CHECK_TYPES = [
  { value: 'http', label: 'HTTP(S)' },
  { value: 'ssh', label: 'SSH login' },
  { value: 'keyword', label: 'Keyword on a page' },
  { value: 'ssl', label: 'SSL certificate' },
  { value: 'tcp', label: 'TCP port' },
];

export const MIN_INTERVAL_S = 60;

export const SSH_NOTE =
  'We ask the server whether it would accept this key and hang up; no private key, no login.';

export const KEYRING_URL = 'https://app.logicsrc.com/keyring';

const KEYS_URL_RE = /^https:\/\/app\.logicsrc\.com\/k\/(lks_[A-Za-z0-9_-]{16,128})\.(json|keys)$/;
const USERNAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,31}$/;
const PUBKEY_RE =
  /^(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?$/;

/** HTML-escape anything that came from the server or the user. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalise a pasted keyring share link. The .keys (authorized_keys) form is
 * accepted and turned into the .json form crawlproof reads. Empty clears it.
 * @returns {{ ok: true, value: string | null } | { ok: false, error: string }}
 */
export function normalizeKeysUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, value: null };
  const m = KEYS_URL_RE.exec(raw);
  if (!m) {
    return {
      ok: false,
      error:
        'Paste the share link from app.logicsrc.com/keyring (https://app.logicsrc.com/k/lks_….json).',
    };
  }
  return { ok: true, value: `https://app.logicsrc.com/k/${m[1]}.json` };
}

/**
 * Check a pasted public key. Private keys are refused outright.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function checkPublicKey(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Paste a public key, or pick one from your keyring.' };
  if (/PRIVATE KEY|^-----BEGIN/.test(raw)) {
    return {
      ok: false,
      error: 'That is a private key. Never paste it anywhere. Paste the .pub line instead.',
    };
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1 || !PUBKEY_RE.test(lines[0])) {
    return { ok: false, error: 'Not an OpenSSH public key line (ssh-ed25519 AAAA… comment).' };
  }
  return { ok: true, value: lines[0] };
}

export function isValidUsername(name) {
  return USERNAME_RE.test(String(name ?? '').trim());
}

/** "SHA256:abcdefgh…" for tight table cells. */
export function shortFingerprint(fp) {
  const s = String(fp ?? '');
  return s.length > 19 ? `${s.slice(0, 18)}…` : s;
}

/** up | down | paused | pending, for the state dot. */
export function stateOf(monitor) {
  if (!monitor) return 'pending';
  if (monitor.enabled === false) return 'paused';
  const s = String(monitor.current_state ?? '').toLowerCase();
  if (s === 'up' || s === 'down') return s;
  return 'pending';
}

/** What the target column shows: user@host for SSH. */
export function targetLabel(monitor) {
  if (monitor?.type === 'ssh' && monitor.ssh?.username) {
    return `${monitor.ssh.username}@${monitor.target}`;
  }
  return String(monitor?.target ?? '');
}

/** "12s ago", "4m ago", "3h ago", "2d ago", or "never". */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatLatency(ms) {
  if (ms == null || ms === '' || Number.isNaN(Number(ms))) return '';
  const n = Number(ms);
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

/**
 * Turn the add/edit form's fields into the crawlproof POST/PATCH body.
 * `fields` is a plain object of the form's string values.
 * `editing` is the monitor being edited, or null when adding.
 * @returns {{ ok: true, body: object } | { ok: false, error: string, field?: string }}
 */
export function buildMonitorBody(fields, editing = null) {
  const f = (k) => String(fields?.[k] ?? '').trim();
  const type = editing?.type ?? f('type');
  if (!CHECK_TYPES.some((t) => t.value === type)) {
    return { ok: false, error: 'Pick a check type.', field: 'type' };
  }
  const target = f('target');
  if (!target) return { ok: false, error: 'Target is required.', field: 'target' };
  if (/[\s<>"']/.test(target)) {
    return { ok: false, error: 'Target has spaces or quotes.', field: 'target' };
  }
  if ((type === 'http' || type === 'keyword') && !/^https?:\/\/[^/]+/i.test(target)) {
    return { ok: false, error: 'Target must be a full http(s):// URL.', field: 'target' };
  }
  if (type === 'tcp' && !/:\d{1,5}$/.test(target)) {
    return { ok: false, error: 'TCP targets are host:port.', field: 'target' };
  }

  const interval = Number(f('interval_s') || MIN_INTERVAL_S);
  if (!Number.isFinite(interval) || interval < MIN_INTERVAL_S) {
    return {
      ok: false,
      error: `Interval is at least ${MIN_INTERVAL_S} seconds.`,
      field: 'interval_s',
    };
  }

  const body = { name: f('name') || target, target, interval_s: Math.round(interval) };
  if (!editing) body.type = type;
  if (f('alert_email')) body.alert_email = f('alert_email');
  if (f('alert_phone')) body.alert_phone = f('alert_phone');

  if (type === 'keyword') {
    // When editing, an empty keyword means "keep the stored one".
    if (!f('keyword') && !editing) {
      return { ok: false, error: 'Keyword is required.', field: 'keyword' };
    }
    if (f('keyword')) body.keyword = f('keyword');
    body.match = f('match') === 'absent' ? 'absent' : 'present';
  }

  if (type === 'ssh') {
    const username = f('username');
    if (!isValidUsername(username)) {
      return { ok: false, error: 'A valid SSH username is required.', field: 'username' };
    }
    const key = f('key');
    if (key && key !== '__paste') {
      body.ssh = { username, fingerprint: key };
    } else {
      const pasted = f('public_key');
      if (!pasted && editing && editing.ssh?.key_source === 'inline') {
        // Keep the stored inline key; only a username change needs it again.
        if (username !== editing.ssh?.username) {
          return {
            ok: false,
            error: 'Paste the public key again to change the username.',
            field: 'public_key',
          };
        }
      } else {
        const pk = checkPublicKey(pasted);
        if (!pk.ok) return { ok: false, error: pk.error, field: 'public_key' };
        body.ssh = { username, public_key: pk.value };
      }
    }
  }
  return { ok: true, body };
}

/** Message to show for an API error `{ status, error, message }`. */
export function errorMessage(err) {
  if (!err) return 'Something went wrong.';
  if (err.status === 401) return 'Sign in to manage your fleet.';
  if (err.status === 403 && err.error === 'email_unverified') {
    return 'Verify your email address to manage your fleet.';
  }
  return err.message || err.error || `Request failed (${err.status ?? 'network'}).`;
}

/** Only https links from the server become hrefs. */
export function safeHref(url, fallback) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u.href : fallback;
  } catch {
    return fallback;
  }
}
