import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFleetbarHandler, fleetbarExpress } from '../src/server.js';

const TOKEN = 'cpu_test_token';
const VERIFIED = { email: 'ann@example.com', emailVerified: true };

/** A fetch stub standing in for crawlproof; records every call. */
function mockCrawlproof(respond = () => ({ status: 200, body: { ok: true } })) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, headers: new Headers(init.headers) });
    const r = await respond(url, init);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', 'set-cookie': 'cp=secret', ...(r.headers || {}) },
    });
  };
  return { fetch, calls };
}

function handlerWith(over = {}) {
  const cp = over.cp ?? mockCrawlproof();
  const handler = createFleetbarHandler({
    crawlproofUrl: 'https://crawlproof.test/',
    token: TOKEN,
    getUser: async () => VERIFIED,
    fetch: cp.fetch,
    ...over,
  });
  return { handler, cp };
}

const req = (path, init = {}) =>
  new Request(`https://w3bs.test${path}`, {
    ...init,
    headers: { host: 'w3bs.test', ...(init.headers || {}) },
  });

const sameOriginJson = (method, body) => ({
  method,
  headers: { origin: 'https://w3bs.test', 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('GET /settings proxies with the partner token and the user email', async () => {
  const cp = mockCrawlproof(() => ({ status: 200, body: { keys_url: null, alert_email: 'a@b.c', alert_phone: null } }));
  const { handler } = handlerWith({ cp });
  const res = await handler(req('/api/fleetbar/settings', { headers: { cookie: 'sid=1', authorization: 'Bearer user' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { keys_url: null, alert_email: 'a@b.c', alert_phone: null });
  assert.equal(cp.calls.length, 1);
  const c = cp.calls[0];
  assert.equal(c.url, 'https://crawlproof.test/api/uptime/v1/settings');
  assert.equal(c.method, 'GET');
  assert.equal(c.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(c.headers.get('x-fleet-user-email'), 'ann@example.com');
  assert.equal(c.headers.get('cookie'), null, 'browser cookies never reach crawlproof');
  assert.equal(res.headers.get('set-cookie'), null, 'upstream headers are not passed back');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('the partner token never appears in a response', async () => {
  const cp = mockCrawlproof(() => ({ status: 200, body: { monitors: [] } }));
  const { handler } = handlerWith({ cp });
  const res = await handler(req('/api/fleetbar/monitors'));
  const text = await res.text();
  assert.ok(!text.includes(TOKEN));
  for (const [, v] of res.headers) assert.ok(!v.includes(TOKEN));
});

test('every allowed route maps to the matching crawlproof path', async () => {
  const { handler, cp } = handlerWith();
  const cases = [
    ['GET', '/settings'],
    ['PUT', '/settings', { keys_url: null }],
    ['GET', '/keys'],
    ['GET', '/monitors'],
    ['POST', '/monitors', { name: 'x', type: 'http', target: 'https://x' }],
    ['PATCH', '/monitors/0f8b-ab_C', { enabled: false }],
    ['DELETE', '/monitors/0f8b-ab_C'],
    ['GET', '/monitors/0f8b-ab_C/incidents'],
  ];
  for (const [method, path, body] of cases) {
    const init = method === 'GET' ? { method } : sameOriginJson(method, body ?? {});
    if (method === 'DELETE') delete init.body;
    const res = await handler(req(`/api/fleetbar${path}?leak=1`, init));
    assert.equal(res.status, 200, `${method} ${path}`);
    const call = cp.calls.at(-1);
    assert.equal(call.url, `https://crawlproof.test/api/uptime/v1${path}`, 'query strings are dropped');
    assert.equal(call.method, method);
    if (body) assert.deepEqual(JSON.parse(call.body), body);
  }
});

test('unknown paths are 404 and wrong methods 405, without calling crawlproof', async () => {
  const { handler, cp } = handlerWith();
  for (const path of [
    '/api/fleetbar',
    '/api/fleetbar/',
    '/api/fleetbar/admin',
    '/api/fleetbar/monitors/..%2Fsettings',
    '/api/fleetbar/monitors/%2e%2e',
    '/api/fleetbar/monitors/a%2Fb',
    '/api/fleetbar/monitors/x/incidents/y',
    '/api/other/settings',
    '/api/fleetbar/keys/extra',
  ]) {
    const res = await handler(req(path));
    assert.equal(res.status, 404, path);
  }
  const r405 = await handler(req('/api/fleetbar/keys', sameOriginJson('POST', {})));
  assert.equal(r405.status, 405);
  assert.equal(r405.headers.get('allow'), 'GET');
  const del = await handler(req('/api/fleetbar/monitors', { method: 'DELETE', headers: { origin: 'https://w3bs.test' } }));
  assert.equal(del.status, 405);
  const get = await handler(req('/api/fleetbar/monitors/abc'));
  assert.equal(get.status, 405);
  assert.equal(cp.calls.length, 0);
});

test('401 without a session, 403 when the email is not verified', async () => {
  const none = handlerWith({ getUser: async () => null });
  const r1 = await none.handler(req('/api/fleetbar/monitors'));
  assert.equal(r1.status, 401);
  assert.equal((await r1.json()).error, 'unauthorized');

  const unverified = handlerWith({ getUser: async () => ({ email: 'a@b.c', emailVerified: false }) });
  const r2 = await unverified.handler(req('/api/fleetbar/monitors'));
  assert.equal(r2.status, 403);
  assert.equal((await r2.json()).error, 'email_unverified');

  const truthy = handlerWith({ getUser: async () => ({ email: 'a@b.c', emailVerified: 'yes' }) });
  assert.equal((await truthy.handler(req('/api/fleetbar/monitors'))).status, 403);
  assert.equal(none.cp.calls.length + unverified.cp.calls.length + truthy.cp.calls.length, 0);
});

test('getUser receives the request and the context', async () => {
  let seen;
  const { handler } = handlerWith({ getUser: (r, ctx) => ((seen = [r, ctx]), VERIFIED) });
  const r = req('/api/fleetbar/keys');
  await handler(r, { params: 1 });
  assert.equal(seen[0], r);
  assert.deepEqual(seen[1], { params: 1 });
});

test('cross-site writes are refused, same-origin writes pass', async () => {
  const { handler, cp } = handlerWith();
  const body = JSON.stringify({ enabled: true });
  const bad = [
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site', origin: 'https://w3bs.test' },
    { 'sec-fetch-site': 'same-site', origin: 'https://sub.w3bs.test' },
    {},
  ];
  for (const h of bad) {
    const res = await handler(
      req('/api/fleetbar/monitors/m1', { method: 'PATCH', headers: { 'content-type': 'application/json', ...h }, body }),
    );
    assert.equal(res.status, 403, JSON.stringify(h));
    assert.equal((await res.json()).error, 'cross_origin');
  }
  assert.equal(cp.calls.length, 0);

  const good = [
    { origin: 'https://w3bs.test' },
    { 'sec-fetch-site': 'same-origin' },
    { origin: 'https://w3bs.test', 'sec-fetch-site': 'same-origin' },
  ];
  for (const h of good) {
    const res = await handler(
      req('/api/fleetbar/monitors/m1', { method: 'PATCH', headers: { 'content-type': 'application/json', ...h }, body }),
    );
    assert.equal(res.status, 200, JSON.stringify(h));
  }
});

test('behind a proxy: X-Forwarded-Host and allowedOrigins count as same-origin', async () => {
  const { handler } = handlerWith({ allowedOrigins: ['https://www.w3bs.test/'] });
  const body = '{}';
  const internal = (h) =>
    new Request('http://127.0.0.1:3000/api/fleetbar/settings', {
      method: 'PUT',
      headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...h },
      body,
    });
  assert.equal((await handler(internal({ origin: 'https://w3bs.org', 'x-forwarded-host': 'w3bs.org' }))).status, 200);
  assert.equal((await handler(internal({ origin: 'https://www.w3bs.test' }))).status, 200);
  assert.equal((await handler(internal({ origin: 'https://w3bs.org' }))).status, 403);
});

test('bodies: JSON only, objects only, capped', async () => {
  const { handler, cp } = handlerWith({ maxBodyBytes: 1024 });
  const post = (body, ct = 'application/json') =>
    handler(req('/api/fleetbar/monitors', { method: 'POST', headers: { origin: 'https://w3bs.test', 'content-type': ct }, body }));
  assert.equal((await post('{"a":1}', 'text/plain')).status, 415);
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post('[1,2]')).status, 400);
  assert.equal((await post('null')).status, 400);
  const big = JSON.stringify({ name: 'x'.repeat(2000) });
  const r413 = await post(big);
  assert.equal(r413.status, 413);
  assert.equal((await r413.json()).error, 'payload_too_large');
  // A chunked body with no content-length is capped while reading.
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode('x'.repeat(200)));
      c.close();
    },
  });
  const r = await handler(
    new Request('https://w3bs.test/api/fleetbar/monitors', {
      method: 'POST',
      headers: { origin: 'https://w3bs.test', 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    }),
  );
  assert.equal(r.status, 413);
  assert.equal(cp.calls.length, 0);
  // The body is re-serialised: the upstream gets parsed-and-stringified JSON.
  assert.equal((await post('{ "name" : "a" }')).status, 200);
  assert.equal(cp.calls[0].body, '{"name":"a"}');
});

test('crawlproof errors: user-facing codes pass through, partner auth and 5xx become 502', async () => {
  const noAcct = { error: 'no_crawlproof_account', signup_url: 'https://crawlproof.com/signup' };
  const map = {
    '/settings': { status: 404, body: noAcct },
    '/keys': { status: 422, body: { error: 'invalid', message: 'bad' } },
    '/monitors': { status: 401, body: { error: 'bad_token' } },
    '/monitors/x/incidents': { status: 500, body: 'oops' },
  };
  const cp = mockCrawlproof((url) => map[new URL(url).pathname.replace('/api/uptime/v1', '')]);
  const { handler } = handlerWith({ cp });
  const r1 = await handler(req('/api/fleetbar/settings'));
  assert.equal(r1.status, 404);
  assert.deepEqual(await r1.json(), noAcct);
  assert.equal((await handler(req('/api/fleetbar/keys'))).status, 422);
  const r3 = await handler(req('/api/fleetbar/monitors'));
  assert.equal(r3.status, 502);
  assert.equal((await r3.json()).error, 'partner_auth_failed');
  assert.equal((await handler(req('/api/fleetbar/monitors/x/incidents'))).status, 502);
});

test('204 from DELETE, network failure is 502, missing token is 503', async () => {
  const cp = mockCrawlproof((url, init) => (init.method === 'DELETE' ? { status: 204 } : new Error('down')));
  const { handler } = handlerWith({ cp });
  const d = await handler(req('/api/fleetbar/monitors/m1', { method: 'DELETE', headers: { origin: 'https://w3bs.test' } }));
  assert.equal(d.status, 204);
  const g = await handler(req('/api/fleetbar/monitors'));
  assert.equal(g.status, 502);
  assert.equal((await g.json()).error, 'upstream_unavailable');

  const lazy = handlerWith({ token: () => undefined });
  const r = await lazy.handler(req('/api/fleetbar/monitors'));
  assert.equal(r.status, 503);
  assert.equal(lazy.cp.calls.length, 0);
  const fn = handlerWith({ token: async () => 'cpu_lazy' });
  await fn.handler(req('/api/fleetbar/keys'));
  assert.equal(fn.cp.calls[0].headers.get('authorization'), 'Bearer cpu_lazy');
});

test('a custom basePath', async () => {
  const { handler, cp } = handlerWith({ basePath: '/fleet/api/' });
  assert.equal((await handler(req('/fleet/api/keys'))).status, 200);
  assert.equal(cp.calls[0].url, 'https://crawlproof.test/api/uptime/v1/keys');
  assert.equal((await handler(req('/api/fleetbar/keys'))).status, 404);
});

test('options are validated', () => {
  assert.throws(() => createFleetbarHandler({ token: 'x' }), /getUser/);
  assert.throws(() => createFleetbarHandler({ token: 'x', getUser() {}, crawlproofUrl: 'ftp://x' }), /crawlproofUrl/);
});

// --- Express adapter, exercised through a real node:http server -------------

async function withServer(mw, fn, { preParse = false } = {}) {
  const server = createServer((req, res) => {
    req.originalUrl = req.url;
    const run = () =>
      mw(req, res, (err) => {
        res.statusCode = err ? 500 : 418;
        res.end(err ? String(err) : 'next');
      });
    if (!preParse) return run();
    // Mimic express.json(): consume the stream, set req.body and req._body.
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      if (raw) {
        req.body = JSON.parse(raw);
        req._body = true;
      }
      run();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

for (const preParse of [false, true]) {
  test(`fleetbarExpress (${preParse ? 'after express.json()' : 'raw stream'})`, async () => {
    const cp = mockCrawlproof((url, init) => ({ status: 200, body: { echo: init.body ? JSON.parse(init.body) : null } }));
    let ctxSeen;
    const mw = fleetbarExpress({
      crawlproofUrl: 'https://crawlproof.test',
      token: TOKEN,
      getUser: (request, ctx) => {
        ctxSeen = ctx;
        return request.headers.get('cookie') === 'sid=ok' ? VERIFIED : null;
      },
      fetch: cp.fetch,
      maxBodyBytes: 512,
    });
    await withServer(
      mw,
      async (base) => {
        const other = await fetch(`${base}/not-ours`);
        assert.equal(other.status, 418, 'other paths fall through to next()');

        const anon = await fetch(`${base}/api/fleetbar/monitors`);
        assert.equal(anon.status, 401);

        const ok = await fetch(`${base}/api/fleetbar/monitors`, {
          method: 'POST',
          headers: { cookie: 'sid=ok', origin: base, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'n', type: 'http', target: 'https://x' }),
        });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { echo: { name: 'n', type: 'http', target: 'https://x' } });
        assert.ok(ctxSeen.req && ctxSeen.res, 'getUser gets { req, res }');

        const cross = await fetch(`${base}/api/fleetbar/monitors`, {
          method: 'POST',
          headers: { cookie: 'sid=ok', origin: 'https://evil.test', 'content-type': 'application/json' },
          body: '{}',
        });
        assert.equal(cross.status, 403);

        if (!preParse) {
          const big = await fetch(`${base}/api/fleetbar/monitors`, {
            method: 'POST',
            headers: { cookie: 'sid=ok', origin: base, 'content-type': 'application/json' },
            body: JSON.stringify({ x: 'y'.repeat(5000) }),
          });
          assert.equal(big.status, 413);
        }
      },
      { preParse },
    );
  });
}
