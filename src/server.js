// @profullstack/fleetbar/server: a narrow proxy from the host app's session to the
// crawlproof partner uptime API (/api/uptime/v1). Web-standard Request/Response only,
// so the same handler runs in Next.js route handlers, Hono, Bun and Node. The Express
// adapter at the bottom wraps it without importing any node: module.
//
// What it guarantees:
// - only the listed paths and methods reach crawlproof; everything else is 404/405
// - the partner token and the user's email header are set here, never by the browser,
//   and nothing from the browser is forwarded except a re-serialised JSON body
// - 401 with no session, 403 when the email is not verified and there is no CoinPay sub
// - a CoinPay sub from getUser goes up as X-Fleet-User-CoinPay-Sub and wins upstream
// - non-GET requests from another origin are refused (403 cross_origin)
// - request bodies over maxBodyBytes are refused (413)

export const DEFAULT_CRAWLPROOF_URL = 'https://crawlproof.com';
export const DEFAULT_BASE_PATH = '/api/fleetbar';
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;
const UPSTREAM_PREFIX = '/api/uptime/v1';
const MAX_UPSTREAM_BYTES = 1024 * 1024;
const ID = '[A-Za-z0-9_-]{1,64}';
/** A CoinPay `sub`: a uuid today; anything header-safe and short is accepted. */
export const COINPAY_SUB_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Every route the bar may call, with its allowed methods. */
export const ROUTES = [
  { pattern: new RegExp('^/settings$'), methods: ['GET', 'PUT'] },
  { pattern: new RegExp('^/keys$'), methods: ['GET'] },
  { pattern: new RegExp('^/monitors$'), methods: ['GET', 'POST'] },
  { pattern: new RegExp(`^/monitors/${ID}$`), methods: ['PATCH', 'DELETE'] },
  { pattern: new RegExp(`^/monitors/${ID}/incidents$`), methods: ['GET'] },
];

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function json(status, body, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

function hostsOf(request) {
  const hosts = new Set();
  try {
    hosts.add(new URL(request.url).host.toLowerCase());
  } catch {
    /* relative URL: ignore */
  }
  const host = request.headers.get('host');
  if (host) hosts.add(host.trim().toLowerCase());
  const fwd = request.headers.get('x-forwarded-host');
  if (fwd) hosts.add(fwd.split(',')[0].trim().toLowerCase());
  return hosts;
}

/** True when a state-changing request plainly comes from this site. */
export function isSameOrigin(request, allowedOrigins = []) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return site === 'same-origin';
  if (origin === 'null') return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (allowedOrigins.some((o) => String(o).replace(/\/+$/, '') === parsed.origin)) return true;
  return hostsOf(request).has(parsed.host.toLowerCase());
}

async function readCapped(request, max) {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) return { tooLarge: true };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder().decode(all) };
}

async function readUpstream(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPSTREAM_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('upstream response too large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * @param {object} opts
 * @param {string} [opts.crawlproofUrl]
 * @param {string | (() => string | undefined | Promise<string | undefined>)} opts.token
 * @param {(request: Request, ctx?: any) => Promise<{ email?: string, emailVerified?: boolean, coinpaySub?: string | null } | null> | { email?: string, emailVerified?: boolean, coinpaySub?: string | null } | null} opts.getUser
 * @param {string} [opts.basePath]
 * @param {number} [opts.maxBodyBytes]
 * @param {string[]} [opts.allowedOrigins]
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetch]
 * @returns {(request: Request, ctx?: any) => Promise<Response>}
 */
export function createFleetbarHandler(opts = {}) {
  const {
    crawlproofUrl = DEFAULT_CRAWLPROOF_URL,
    token,
    getUser,
    basePath = DEFAULT_BASE_PATH,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    allowedOrigins = [],
    timeoutMs = 15000,
  } = opts;
  if (typeof getUser !== 'function') throw new TypeError('fleetbar: getUser is required');
  const upstreamBase = String(crawlproofUrl).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(upstreamBase)) {
    throw new TypeError('fleetbar: crawlproofUrl must be an http(s) URL');
  }
  const base = String(basePath).replace(/\/+$/, '');

  return async function fleetbarHandler(request, ctx) {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      return json(400, { error: 'bad_request', message: 'Bad URL.' });
    }
    if (!pathname.startsWith(base + '/')) {
      return json(404, { error: 'not_found', message: 'No such fleetbar route.' });
    }
    const sub = pathname.slice(base.length);
    const route = ROUTES.find((r) => r.pattern.test(sub));
    if (!route) return json(404, { error: 'not_found', message: 'No such fleetbar route.' });
    const method = request.method.toUpperCase();
    if (!route.methods.includes(method)) {
      return json(
        405,
        { error: 'method_not_allowed', message: `${method} is not allowed here.` },
        { allow: route.methods.join(', ') },
      );
    }

    if (method !== 'GET' && !isSameOrigin(request, allowedOrigins)) {
      return json(403, { error: 'cross_origin', message: 'Cross-site request refused.' });
    }

    let user;
    try {
      user = await getUser(request, ctx);
    } catch {
      return json(500, { error: 'session_error', message: 'Could not read the session.' });
    }
    if (!user || typeof user !== 'object') {
      return json(401, { error: 'unauthorized', message: 'Sign in to manage your fleet.' });
    }
    // A CoinPay sub (the user's CoinPay account id, bound by the host to this user)
    // identifies the user on its own: crawlproof maps it through its CoinPay
    // identities, and it wins over the email. A host returns it only when its
    // user has CoinPay linked, never derived from an email.
    let coinpaySub = null;
    if (user.coinpaySub !== undefined && user.coinpaySub !== null && user.coinpaySub !== '') {
      if (typeof user.coinpaySub !== 'string' || !COINPAY_SUB_RE.test(user.coinpaySub)) {
        return json(403, { error: 'invalid_coinpay_sub', message: 'That CoinPay account id cannot be used.' });
      }
      coinpaySub = user.coinpaySub;
    }
    const hasEmail = typeof user.email === 'string' && user.email.includes('@');
    if (!hasEmail && !coinpaySub) {
      return json(401, { error: 'unauthorized', message: 'Sign in to manage your fleet.' });
    }
    let email = null;
    if (hasEmail && user.emailVerified === true) {
      email = user.email.trim();
      if (/[\r\n,\s]/.test(email) || email.length > 320) {
        if (!coinpaySub) return json(403, { error: 'email_unverified', message: 'That email cannot be used.' });
        email = null;
      }
    }
    if (!email && !coinpaySub) {
      return json(403, {
        error: 'email_unverified',
        message: 'Verify your email address to manage your fleet.',
      });
    }

    const partnerToken = typeof token === 'function' ? await token() : token;
    if (!partnerToken) {
      return json(503, {
        error: 'fleetbar_not_configured',
        message: 'This site has no crawlproof uptime token yet.',
      });
    }

    let body;
    if (BODY_METHODS.has(method)) {
      const ct = (request.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('application/json')) {
        return json(415, { error: 'unsupported_media_type', message: 'Send JSON.' });
      }
      const read = await readCapped(request, maxBodyBytes);
      if (read.tooLarge) {
        return json(413, {
          error: 'payload_too_large',
          message: `Request bodies are capped at ${maxBodyBytes} bytes.`,
        });
      }
      let parsed;
      try {
        parsed = JSON.parse(read.text);
      } catch {
        return json(400, { error: 'invalid_json', message: 'Body is not valid JSON.' });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json(400, { error: 'invalid_json', message: 'Body must be a JSON object.' });
      }
      body = JSON.stringify(parsed);
    }

    const doFetch = opts.fetch ?? globalThis.fetch;
    let upstream;
    try {
      upstream = await doFetch(upstreamBase + UPSTREAM_PREFIX + sub, {
        method,
        headers: {
          authorization: `Bearer ${partnerToken}`,
          ...(email ? { 'x-fleet-user-email': email } : {}),
          ...(coinpaySub ? { 'x-fleet-user-coinpay-sub': coinpaySub } : {}),
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return json(502, { error: 'upstream_unavailable', message: 'crawlproof did not answer.' });
    }

    // A 401/403 from crawlproof is about OUR partner token, not the visitor.
    if (upstream.status === 401 || upstream.status === 403) {
      await upstream.body?.cancel().catch(() => {});
      return json(502, {
        error: 'partner_auth_failed',
        message: 'This site could not authenticate to crawlproof.',
      });
    }
    if (upstream.status >= 500 || (upstream.status >= 300 && upstream.status < 400)) {
      await upstream.body?.cancel().catch(() => {});
      return json(502, { error: 'upstream_error', message: 'crawlproof had a problem.' });
    }
    if (upstream.status === 204) return json(204, null);

    let text;
    try {
      text = await readUpstream(upstream);
    } catch {
      return json(502, { error: 'upstream_error', message: 'crawlproof answer was too large.' });
    }
    if (!text) return json(upstream.status, {});
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json(502, { error: 'upstream_error', message: 'crawlproof did not answer JSON.' });
    }
    return json(upstream.status, data);
  };
}

function nodeRequestToFetch(req, maxBodyBytes) {
  const host = req.headers.host || 'localhost';
  const proto = req.protocol || (req.socket?.encrypted ? 'https' : 'http');
  const url = `${proto}://${host}${req.originalUrl || req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    try {
      headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    } catch {
      /* skip header names Headers rejects */
    }
  }
  const method = String(req.method || 'GET').toUpperCase();
  const init = { method, headers };
  if (BODY_METHODS.has(method)) {
    if (req.body !== undefined && (req._body === true || req.readableEnded)) {
      // A body parser (express.json) already consumed the stream.
      const text =
        typeof req.body === 'string'
          ? req.body
          : req.body instanceof Uint8Array
            ? new TextDecoder().decode(req.body)
            : JSON.stringify(req.body);
      headers.delete('content-length');
      init.body = text;
    } else {
      let stopped = false;
      init.body = new ReadableStream({
        start(controller) {
          let size = 0;
          req.on('data', (chunk) => {
            if (stopped) return;
            size += chunk.length;
            controller.enqueue(new Uint8Array(chunk));
            if (size > maxBodyBytes) {
              stopped = true;
              req.pause?.();
            }
          });
          req.on('end', () => {
            if (!stopped) controller.close();
          });
          req.on('error', (e) => {
            if (!stopped) controller.error(e);
          });
        },
        cancel() {
          stopped = true;
          req.resume?.();
        },
      });
      init.duplex = 'half';
    }
  }
  return new Request(url, init);
}

/**
 * Express/Connect middleware around createFleetbarHandler. Mount it at the app
 * root (app.use(fleetbarExpress(opts))); it only answers under basePath and calls
 * next() for everything else. getUser receives (request, { req, res }).
 */
export function fleetbarExpress(opts = {}) {
  const handler = createFleetbarHandler(opts);
  const base = String(opts.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, '');
  const max = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return async function fleetbarMiddleware(req, res, next) {
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    if (path !== base && !path.startsWith(base + '/')) return next();
    try {
      const response = await handler(nodeRequestToFetch(req, max), { req, res });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      const buf = new Uint8Array(await response.arrayBuffer());
      res.end(buf);
    } catch (err) {
      next(err);
    }
  };
}
