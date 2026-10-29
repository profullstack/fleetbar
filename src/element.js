// <fleet-bar endpoint="/api/fleetbar">: the fleet panel w3bs.org and threatcrush.com
// both mount. Dependency-free custom element with Shadow DOM. All server data is
// escaped before it touches innerHTML.

import {
  CHECK_TYPES,
  KEYRING_URL,
  MIN_INTERVAL_S,
  SSH_NOTE,
  buildMonitorBody,
  errorMessage,
  esc,
  formatLatency,
  normalizeKeysUrl,
  safeHref,
  shortFingerprint,
  stateOf,
  targetLabel,
  timeAgo,
} from './logic.js';

const SIGNUP_URL = 'https://crawlproof.com/signup';

export const STYLES = `
:host {
  /* Defaults are plain values first; the modern bits below are enhancements. */
  --fb-bg: var(--fleetbar-bg, #ffffff);
  --fb-surface: var(--fleetbar-surface, #f6f7f9);
  --fb-fg: var(--fleetbar-fg, #16181d);
  --fb-muted: var(--fleetbar-muted, #5d6573);
  --fb-border: var(--fleetbar-border, #d9dde4);
  --fb-accent: var(--fleetbar-accent, #2156d9);
  --fb-accent-fg: var(--fleetbar-accent-fg, #ffffff);
  --fb-up: var(--fleetbar-up, #1f9d55);
  --fb-down: var(--fleetbar-down, #d93636);
  --fb-paused: var(--fleetbar-paused, #9aa1ad);
  --fb-pending: var(--fleetbar-pending, #d9a521);
  --fb-radius: var(--fleetbar-radius, 10px);
  --fb-gap: var(--fleetbar-gap, 12px);
  --fb-mono: var(--fleetbar-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  display: block;
  font: inherit;
  font-family: var(--fleetbar-font);
  color: var(--fb-fg);
  container-type: inline-size;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --fb-bg: var(--fleetbar-bg, #14161b);
    --fb-surface: var(--fleetbar-surface, #1c1f26);
    --fb-fg: var(--fleetbar-fg, #e8eaee);
    --fb-muted: var(--fleetbar-muted, #9aa1ad);
    --fb-border: var(--fleetbar-border, #2e333d);
    --fb-accent: var(--fleetbar-accent, #6d97ff);
    --fb-accent-fg: var(--fleetbar-accent-fg, #0b0d12);
    --fb-up: var(--fleetbar-up, #3fcf7f);
    --fb-down: var(--fleetbar-down, #ff6b6b);
  }
}
:host([theme="dark"]) {
  --fb-bg: var(--fleetbar-bg, #14161b);
  --fb-surface: var(--fleetbar-surface, #1c1f26);
  --fb-fg: var(--fleetbar-fg, #e8eaee);
  --fb-muted: var(--fleetbar-muted, #9aa1ad);
  --fb-border: var(--fleetbar-border, #2e333d);
  --fb-accent: var(--fleetbar-accent, #6d97ff);
  --fb-accent-fg: var(--fleetbar-accent-fg, #0b0d12);
  --fb-up: var(--fleetbar-up, #3fcf7f);
  --fb-down: var(--fleetbar-down, #ff6b6b);
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.fb {
  background: var(--fb-bg);
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  padding: 16px;
  display: grid;
  gap: 20px;
}
@supports (corner-shape: squircle) {
  .fb, .card { corner-shape: squircle; }
}
header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
h2 { font-size: 1.15em; margin: 0; }
h3 { font-size: 1em; margin: 0 0 8px; }
p { margin: 0 0 8px; }
.muted { color: var(--fb-muted); font-size: 0.9em; }
.mono { font-family: var(--fb-mono); font-size: 0.85em; word-break: break-all; }
a { color: var(--fb-accent); }
.card {
  background: var(--fb-surface);
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  padding: 14px;
}
.notice { padding: 10px 12px; border-radius: var(--fb-radius); border: 1px solid var(--fb-border); }
.notice.error { border-color: var(--fb-down); }
.notice:empty { display: none; }
.err { color: var(--fb-down); font-size: 0.9em; }
.err:empty { display: none; }
form { display: grid; gap: var(--fb-gap); }
.row { display: grid; gap: var(--fb-gap); grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
label { display: grid; gap: 4px; font-size: 0.9em; }
input, select, textarea, button { font: inherit; color: inherit; }
input, select, textarea {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--fb-border);
  border-radius: 6px;
  background: var(--fb-bg);
}
textarea { font-family: var(--fb-mono); font-size: 0.85em; min-height: 4.5em; resize: vertical; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 1px;
}
button {
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--fb-border);
  background: var(--fb-bg);
}
button.primary { background: var(--fb-accent); border-color: var(--fb-accent); color: var(--fb-accent-fg); }
button.danger { border-color: var(--fb-down); color: var(--fb-down); }
button[disabled] { opacity: 0.6; cursor: default; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
td .actions { flex-wrap: nowrap; }
.keys { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.keys li { display: grid; gap: 2px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--fb-border); vertical-align: top; }
th { font-weight: 600; color: var(--fb-muted); font-size: 0.85em; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--fb-pending); }
.dot.up { background: var(--fb-up); }
.dot.down { background: var(--fb-down); }
.dot.paused { background: var(--fb-paused); }
.down-error { color: var(--fb-down); font-size: 0.85em; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ssh-note { font-size: 0.88em; color: var(--fb-muted); }
[data-for] { display: none; }
form[data-type="http"] [data-for~="http"],
form[data-type="ssh"] [data-for~="ssh"],
form[data-type="keyword"] [data-for~="keyword"],
form[data-type="ssl"] [data-for~="ssl"],
form[data-type="tcp"] [data-for~="tcp"] { display: grid; }
.paste[hidden] { display: none; }
/* Narrow containers: rows become cards instead of a sideways-scrolling table. */
@container (max-width: 640px) {
  thead { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  tr { border-bottom: 1px solid var(--fb-border); padding: 6px 0; }
  td { border: 0; padding: 3px 0; }
  td[data-label]:empty { display: none; }
  td .actions { flex-wrap: wrap; }
  td[data-label]::before { content: attr(data-label) ": "; color: var(--fb-muted); font-size: 0.85em; }
}
`;

function fieldsOf(form) {
  const out = {};
  for (const el of form.querySelectorAll('input, select, textarea')) {
    if (el.name && !el.disabled) out[el.name] = el.value;
  }
  return out;
}

class ApiError extends Error {
  constructor(status, data) {
    super((data && (data.message || data.error)) || `HTTP ${status}`);
    this.status = status;
    this.error = data?.error;
    this.message = data?.message || this.message;
    this.signup_url = data?.signup_url;
  }
}

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

export class FleetBar extends Base {
  static get observedAttributes() {
    return ['endpoint', 'refresh'];
  }

  constructor() {
    super();
    this.state = {
      settings: null,
      keys: [],
      keysError: null,
      monitors: [],
      loaded: false,
      fatal: null,
      noAccount: null,
      editing: null,
      confirmDelete: null,
      formType: 'http',
      keyChoice: '',
    };
    this._timer = null;
    this._onVisible = () => {
      if (!document.hidden) this.refreshMonitors();
    };
    this.attachShadow({ mode: 'open' });
  }

  get endpoint() {
    return (this.getAttribute('endpoint') || '/api/fleetbar').replace(/\/+$/, '');
  }

  get refreshSeconds() {
    const n = Number(this.getAttribute('refresh'));
    return Number.isFinite(n) && n >= 5 ? n : 30;
  }

  connectedCallback() {
    this.renderShell();
    this.load();
    this._startTimer();
    document.addEventListener('visibilitychange', this._onVisible);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
    document.removeEventListener('visibilitychange', this._onVisible);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === 'endpoint') this.load();
    if (name === 'refresh') this._startTimer();
  }

  _startTimer() {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.refreshMonitors();
    }, this.refreshSeconds * 1000);
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  async api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(this.endpoint + path, {
        method,
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, { error: 'network', message: 'Could not reach the server.' });
    }
    if (res.status === 204) return {};
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  /** Full load: settings, keys and checks. */
  async load() {
    const [settings, keys, monitors] = await Promise.allSettled([
      this.api('/settings'),
      this.api('/keys'),
      this.api('/monitors'),
    ]);
    const all = [settings, keys, monitors];
    const noAcct = all.find(
      (r) => r.status === 'rejected' && r.reason?.error === 'no_crawlproof_account',
    );
    const blocking = all.find(
      (r) => r.status === 'rejected' && [0, 401, 403, 502, 503].includes(r.reason?.status),
    );
    this.state.noAccount = noAcct ? noAcct.reason : null;
    this.state.fatal = !noAcct && blocking ? blocking.reason : null;
    if (settings.status === 'fulfilled') this.state.settings = settings.value || {};
    if (keys.status === 'fulfilled') {
      this.state.keys = Array.isArray(keys.value?.keys) ? keys.value.keys : [];
      this.state.keysError = null;
    } else {
      this.state.keys = [];
      this.state.keysError = keys.reason;
    }
    if (monitors.status === 'fulfilled') {
      this.state.monitors = Array.isArray(monitors.value?.monitors) ? monitors.value.monitors : [];
    }
    this.state.loaded = true;
    if (this.state.noAccount || this.state.fatal) {
      this._emit('fleetbar:error', this.state.noAccount || this.state.fatal);
    } else {
      this._emit('fleetbar:load', {
        settings: this.state.settings,
        keys: this.state.keys,
        monitors: this.state.monitors,
      });
    }
    this.renderShell();
  }

  /** The 30s poll: only the checks table changes, so forms keep what you typed. */
  async refreshMonitors() {
    if (!this.state.loaded || this.state.noAccount || this.state.fatal) return;
    try {
      const data = await this.api('/monitors');
      this.state.monitors = Array.isArray(data?.monitors) ? data.monitors : [];
      this.renderChecks();
    } catch (err) {
      this._emit('fleetbar:error', err);
    }
  }

  $(sel) {
    return this.shadowRoot.querySelector(sel);
  }

  renderShell() {
    const s = this.state;
    const root = this.shadowRoot;
    let body;
    if (!s.loaded) {
      body = `<p class="muted">Loading your fleet…</p>`;
    } else if (s.noAccount) {
      const href = safeHref(s.noAccount.signup_url, SIGNUP_URL);
      body = `<div class="card" part="signup">
        <h3>Connect crawlproof</h3>
        <p>Fleet checks run on crawlproof, which watches your servers around the clock and
        calls or emails you when one goes down. You need a crawlproof account with the same
        email address you use here.</p>
        <p><a href="${esc(href)}" target="_blank" rel="noopener">Sign up for crawlproof</a>,
        then <button type="button" data-action="reload">try again</button>.</p>
      </div>`;
    } else if (s.fatal) {
      body = `<div class="notice error" role="alert">${esc(errorMessage(s.fatal))}</div>
        <p><button type="button" data-action="reload">Try again</button></p>`;
    } else {
      body = `${this.keysHtml()}
        <section class="checks" part="checks" aria-label="Checks"></section>
        <section class="card add" part="add">${this.formHtml()}</section>`;
    }
    root.innerHTML = `<style>${STYLES}</style>
      <div class="fb" part="panel">
        <header>
          <h2>Fleet</h2>
          <span class="muted">Checks run 24/7 on <a href="https://crawlproof.com" target="_blank" rel="noopener">crawlproof</a></span>
        </header>
        <div class="notice" role="status" aria-live="polite"></div>
        ${body}
      </div>`;
    if (s.loaded && !s.noAccount && !s.fatal) {
      this.renderChecks();
      this.syncForm();
    }
    this._wire();
  }

  keysHtml() {
    const s = this.state.settings || {};
    const keys = this.state.keys;
    let list;
    if (this.state.keysError && s.keys_url) {
      list = `<p class="err">${esc(errorMessage(this.state.keysError))}</p>`;
    } else if (!s.keys_url) {
      list = `<p class="muted">No share link yet. Make one on
        <a href="${KEYRING_URL}" target="_blank" rel="noopener">app.logicsrc.com/keyring</a>
        ("Share public keys"), then paste it here.</p>`;
    } else if (!keys.length) {
      list = `<p class="muted">Your keyring has no SSH public keys yet.
        Add one on <a href="${KEYRING_URL}" target="_blank" rel="noopener">app.logicsrc.com/keyring</a>.</p>`;
    } else {
      list = `<ul class="keys">${keys
        .map(
          (k) => `<li><strong>${esc(k.name || k.comment || k.type)}</strong>
            <span class="mono">${esc(k.fingerprint)}</span>
            <span class="muted">${esc(k.type)}${k.comment ? ` · ${esc(k.comment)}` : ''}</span></li>`,
        )
        .join('')}</ul>`;
    }
    return `<section class="card keys-card" part="keys">
      <h3>Keys</h3>
      <p class="muted">SSH checks use the public keys in your
        <a href="${KEYRING_URL}" target="_blank" rel="noopener">logicsrc keyring</a>.
        The share link exposes public keys only; private keys never leave your device.</p>
      <form class="settings" novalidate>
        <label>Keyring share link
          <input name="keys_url" type="url" inputmode="url" autocomplete="off" spellcheck="false"
            placeholder="https://app.logicsrc.com/k/lks_….json" value="${esc(s.keys_url || '')}">
        </label>
        <div class="row">
          <label>Default alert email
            <input name="alert_email" type="email" autocomplete="email" value="${esc(s.alert_email || '')}">
          </label>
          <label>Default alert phone (call on down)
            <input name="alert_phone" type="tel" autocomplete="tel" placeholder="+15555550123" value="${esc(s.alert_phone || '')}">
          </label>
        </div>
        <p class="err settings-err" role="alert"></p>
        <div class="actions"><button class="primary" type="submit">Save</button></div>
      </form>
      ${list}
    </section>`;
  }

  checksHtml() {
    const ms = this.state.monitors;
    if (!ms.length) {
      return `<h3>Checks</h3><p class="muted">No checks yet. Add one below.</p>`;
    }
    const rows = ms
      .map((m) => {
        const st = stateOf(m);
        const id = esc(m.id);
        const key = m.ssh
          ? `<span class="mono" title="${esc(m.ssh.fingerprint)}">${esc(shortFingerprint(m.ssh.fingerprint))}</span>${
              m.ssh.key_comment ? `<br><span class="muted">${esc(m.ssh.key_comment)}</span>` : ''
            }`
          : '';
        const confirming = this.state.confirmDelete === m.id;
        const actions = confirming
          ? `<button type="button" class="danger" data-action="delete-yes" data-id="${id}">Delete for good</button>
             <button type="button" data-action="delete-no">Cancel</button>`
          : `<button type="button" data-action="toggle" data-id="${id}">${m.enabled === false ? 'Resume' : 'Pause'}</button>
             <button type="button" data-action="edit" data-id="${id}">Edit</button>
             <button type="button" class="danger" data-action="delete" data-id="${id}">Delete</button>`;
        return `<tr data-id="${id}" data-state="${st}">
          <td data-label="State"><span class="dot ${st}" title="${st}" aria-label="${st}"></span></td>
          <td data-label="Name">${esc(m.name)}<br><span class="muted">${esc(
            (CHECK_TYPES.find((t) => t.value === m.type) || {}).label || m.type,
          )}</span></td>
          <td data-label="Target" class="mono">${esc(targetLabel(m))}</td>
          <td data-label="Key">${key}</td>
          <td data-label="Last check">${esc(timeAgo(m.last_checked_at))}</td>
          <td data-label="Latency">${esc(formatLatency(m.last_response_ms))}</td>
          <td data-label="Error">${st === 'down' && m.last_error ? `<span class="down-error">${esc(m.last_error)}</span>` : ''}</td>
          <td><div class="actions">${actions}</div></td>
        </tr>`;
      })
      .join('');
    return `<h3>Checks</h3>
      <div class="table-wrap"><table>
        <thead><tr><th><span class="visually-hidden">State</span></th><th>Name</th><th>Target</th><th>Key</th><th>Last check</th><th>Latency</th><th>Error</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  renderChecks() {
    const el = this.$('.checks');
    if (el) el.innerHTML = this.checksHtml();
  }

  formHtml() {
    const s = this.state.settings || {};
    const editing = this.state.editing;
    const types = CHECK_TYPES.map(
      (t) => `<option value="${t.value}">${esc(t.label)}</option>`,
    ).join('');
    const keyOptions = this.state.keys
      .map(
        (k) =>
          `<option value="${esc(k.fingerprint)}">${esc(k.name || k.comment || k.type)} · ${esc(
            shortFingerprint(k.fingerprint),
          )}</option>`,
      )
      .join('');
    const v = (x) => esc(x ?? '');
    return `<h3>${editing ? `Edit check: ${esc(editing.name)}` : 'Add check'}</h3>
      <form class="monitor" novalidate data-type="${esc(this.state.formType)}">
        <div class="row">
          <label>Type
            <select name="type" ${editing ? 'disabled' : ''}>${types}</select>
          </label>
          <label>Name
            <input name="name" autocomplete="off" placeholder="web-1" value="${v(editing?.name)}">
          </label>
        </div>
        <label data-for="http keyword">URL
          <input name="target" data-target="http keyword" type="url" placeholder="https://example.com/health">
        </label>
        <label data-for="ssh">Host
          <input name="target" data-target="ssh" placeholder="server.example.com or 203.0.113.7:2222" autocomplete="off" spellcheck="false">
        </label>
        <label data-for="ssl">Host
          <input name="target" data-target="ssl" placeholder="example.com" autocomplete="off" spellcheck="false">
        </label>
        <label data-for="tcp">Host and port
          <input name="target" data-target="tcp" placeholder="db.example.com:5432" autocomplete="off" spellcheck="false">
        </label>
        <div class="row" data-for="keyword">
          <label>Keyword
            <input name="keyword" autocomplete="off" value="${v(editing?.keyword)}">
          </label>
          <label>Alert when the keyword is
            <select name="match"><option value="present">missing (expect present)</option><option value="absent"${editing?.match === 'absent' ? ' selected' : ''}>present (expect absent)</option></select>
          </label>
        </div>
        <div data-for="ssh" style="gap: var(--fleetbar-gap)">
          <p class="ssh-note">${esc(SSH_NOTE)}</p>
          <div class="row">
            <label>Username
              <input name="username" autocomplete="off" spellcheck="false" placeholder="deploy" value="${v(editing?.ssh?.username)}">
            </label>
            <label>Key
              <select name="key">
                ${keyOptions}
                <option value="__paste">Paste a public key instead</option>
              </select>
            </label>
          </div>
          <label class="paste">Public key (the .pub line)
            <textarea name="public_key" spellcheck="false" placeholder="ssh-ed25519 AAAAC3Nz… you@laptop"></textarea>
          </label>
          ${
            this.state.keys.length
              ? ''
              : `<p class="muted">No keyring keys loaded. Add your share link under Keys, or paste a public key.</p>`
          }
        </div>
        <div class="row">
          <label>Alert email
            <input name="alert_email" type="email" placeholder="${v(s.alert_email)}" value="${editing ? '' : v(s.alert_email)}">
          </label>
          <label>Alert phone
            <input name="alert_phone" type="tel" placeholder="${v(s.alert_phone || '+15555550123')}" value="${editing ? '' : v(s.alert_phone)}">
          </label>
          <label>Every (seconds)
            <input name="interval_s" type="number" min="${MIN_INTERVAL_S}" step="30" value="${v(editing?.interval_s ?? MIN_INTERVAL_S)}">
          </label>
        </div>
        <p class="err form-err" role="alert"></p>
        <div class="actions">
          <button class="primary" type="submit">${editing ? 'Save check' : 'Add check'}</button>
          ${editing ? `<button type="button" data-action="cancel-edit">Cancel</button>` : ''}
        </div>
      </form>`;
  }

  /** Show only the fields for the chosen type, keep one live `target` input. */
  syncForm() {
    const form = this.$('form.monitor');
    if (!form) return;
    const type = this.state.editing?.type || this.state.formType || 'http';
    this.state.formType = type;
    form.dataset.type = type;
    form.querySelector('select[name=type]').value = type;
    for (const input of form.querySelectorAll('[data-target]')) {
      const live = input.dataset.target.split(' ').includes(type);
      input.disabled = !live;
    }
    const keySel = form.querySelector('select[name=key]');
    if (keySel) {
      if (this.state.keyChoice) keySel.value = this.state.keyChoice;
      if (!keySel.value) keySel.value = keySel.options[0]?.value ?? '__paste';
      const paste = form.querySelector('.paste');
      paste.hidden = keySel.value !== '__paste';
    }
  }

  _wire() {
    const root = this.shadowRoot;
    if (this._wired) return;
    this._wired = true;
    root.addEventListener('click', (e) => this._onClick(e));
    root.addEventListener('submit', (e) => this._onSubmit(e));
    root.addEventListener('change', (e) => this._onChange(e));
  }

  _notice(text, isError = false) {
    const n = this.$('.notice');
    if (!n) return;
    n.textContent = text || '';
    n.classList.toggle('error', !!isError);
  }

  _onChange(e) {
    const t = e.target;
    const form = t.closest?.('form.monitor');
    if (!form) return;
    if (t.name === 'type') {
      this.state.formType = t.value;
      this.syncForm();
    } else if (t.name === 'key') {
      this.state.keyChoice = t.value;
      this.syncForm();
    }
  }

  async _onClick(e) {
    const btn = e.target.closest?.('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const m = this.state.monitors.find((x) => String(x.id) === id);
    switch (btn.dataset.action) {
      case 'reload':
        this.state.loaded = false;
        this.renderShell();
        await this.load();
        break;
      case 'delete':
        this.state.confirmDelete = m?.id ?? null;
        this.renderChecks();
        break;
      case 'delete-no':
        this.state.confirmDelete = null;
        this.renderChecks();
        break;
      case 'delete-yes':
        await this._mutate(btn, async () => {
          await this.api(`/monitors/${encodeURIComponent(id)}`, { method: 'DELETE' });
          this.state.monitors = this.state.monitors.filter((x) => String(x.id) !== id);
          this.state.confirmDelete = null;
          if (String(this.state.editing?.id) === id) this._resetForm();
          this._emit('fleetbar:change', { action: 'delete', id });
          this._notice(`Deleted ${m?.name ?? 'check'}.`);
        });
        this.renderChecks();
        break;
      case 'toggle':
        if (!m) return;
        await this._mutate(btn, async () => {
          const updated = await this.api(`/monitors/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: { enabled: m.enabled === false },
          });
          this._replace(updated?.monitor ?? { ...m, enabled: m.enabled === false });
          this._emit('fleetbar:change', { action: 'update', id, monitor: this._find(id) });
        });
        this.renderChecks();
        break;
      case 'edit':
        if (!m) return;
        this.state.editing = m;
        this.state.formType = m.type;
        this.state.keyChoice =
          m.type === 'ssh' ? (m.ssh?.key_source === 'inline' ? '__paste' : m.ssh?.fingerprint || '') : '';
        this._renderForm();
        this._fillTarget(m.target);
        this.$('form.monitor input[name=name]')?.focus();
        break;
      case 'cancel-edit':
        this._resetForm();
        break;
    }
  }

  _find(id) {
    return this.state.monitors.find((x) => String(x.id) === String(id));
  }

  _replace(monitor) {
    if (!monitor || monitor.id == null) return;
    const i = this.state.monitors.findIndex((x) => String(x.id) === String(monitor.id));
    if (i === -1) this.state.monitors.push(monitor);
    else this.state.monitors[i] = { ...this.state.monitors[i], ...monitor };
  }

  _renderForm() {
    const el = this.$('.add');
    if (!el) return;
    el.innerHTML = this.formHtml();
    this.syncForm();
  }

  _fillTarget(value) {
    const form = this.$('form.monitor');
    for (const input of form.querySelectorAll('[data-target]')) {
      if (!input.disabled) input.value = value ?? '';
    }
  }

  _resetForm() {
    this.state.editing = null;
    this.state.keyChoice = '';
    this._renderForm();
  }

  async _mutate(btn, fn) {
    btn.disabled = true;
    try {
      await fn();
      return true;
    } catch (err) {
      this._notice(errorMessage(err), true);
      this._emit('fleetbar:error', err);
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  async _onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submit = form.querySelector('button[type=submit]');
    if (form.classList.contains('settings')) {
      const err = form.querySelector('.settings-err');
      const fields = fieldsOf(form);
      const url = normalizeKeysUrl(fields.keys_url);
      if (!url.ok) {
        err.textContent = url.error;
        return;
      }
      err.textContent = '';
      const ok = await this._mutate(submit, async () => {
        const body = {
          keys_url: url.value,
          alert_email: fields.alert_email.trim() || null,
          alert_phone: fields.alert_phone.trim() || null,
        };
        const saved = await this.api('/settings', { method: 'PUT', body });
        this.state.settings = { ...body, ...(saved && typeof saved === 'object' ? saved : {}) };
        this._emit('fleetbar:change', { action: 'settings', settings: this.state.settings });
      });
      if (ok) {
        await this.load();
        this._notice('Saved.');
      }
      return;
    }
    if (form.classList.contains('monitor')) {
      const err = form.querySelector('.form-err');
      const editing = this.state.editing;
      const built = buildMonitorBody(fieldsOf(form), editing);
      if (!built.ok) {
        err.textContent = built.error;
        form.querySelector(`[name="${built.field}"]:not([disabled])`)?.focus?.();
        return;
      }
      err.textContent = '';
      submit.disabled = true;
      try {
        if (editing) {
          const res = await this.api(`/monitors/${encodeURIComponent(editing.id)}`, {
            method: 'PATCH',
            body: built.body,
          });
          this._replace(res?.monitor ?? { ...editing, ...built.body });
          this._emit('fleetbar:change', { action: 'update', id: editing.id, monitor: this._find(editing.id) });
          this._notice(`Saved ${built.body.name}.`);
        } else {
          const res = await this.api('/monitors', { method: 'POST', body: built.body });
          if (res?.monitor) this._replace(res.monitor);
          this._emit('fleetbar:change', { action: 'create', monitor: res?.monitor ?? null });
          this._notice(`Added ${built.body.name}.`);
        }
        this._resetForm();
        await this.refreshMonitors();
        this.renderChecks();
      } catch (ex) {
        err.textContent = errorMessage(ex);
        this._emit('fleetbar:error', ex);
      } finally {
        submit.disabled = false;
      }
    }
  }
}

/** Register <fleet-bar> (or another tag) once. Safe to call repeatedly. */
export function defineFleetBar(tag = 'fleet-bar') {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(tag)) customElements.define(tag, class extends FleetBar {});
}
