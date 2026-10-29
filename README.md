# @profullstack/fleetbar

One fleet monitoring panel for every Profullstack site. w3bs.org/fleet and threatcrush.com/fleet mount the same `<fleet-bar>` and see the same checks, because both read one place: the user's "Fleet" project on [crawlproof](https://crawlproof.com), which runs the checks 24/7 and calls or emails on down and up.

Two halves:

- **`@profullstack/fleetbar`** (browser): a dependency-free `<fleet-bar>` web component. Shadow DOM, themable with `--fleetbar-*` custom properties, inherits your font. Also shipped prebuilt as `dist/fleetbar.js` (IIFE for a plain `<script>`) and `dist/fleetbar.mjs` (one-file ESM).
- **`@profullstack/fleetbar/server`**: a narrow proxy from your session to the crawlproof partner uptime API. A fetch handler for Next.js, Hono and Bun, plus an Express adapter.

The browser never sees the crawlproof partner token. The server half adds it, along with the signed-in user's verified email, and forwards only the routes the bar needs.

## What the panel does

- **Keys.** Paste your logicsrc keyring share link (make it on [app.logicsrc.com/keyring](https://app.logicsrc.com/keyring), "Share public keys"). The link exposes public keys only. The panel lists each key with its fingerprint and comment. Default alert email and phone live here too.
- **Checks.** A table of every check in your Fleet project: state dot, name, `user@host` for SSH, key fingerprint and comment, last check, latency, and the error when it is down. Pause or resume, edit, delete (with a confirm step). Refreshes every 30 seconds while the tab is visible.
- **Add check.** Types, in order: HTTP(S), SSH login, keyword on a page, SSL certificate, TCP port. An SSH check takes `host[:port]`, a username and a key picked from your keyring (or a pasted public key). It never needs a private key: crawlproof asks the server whether it would accept that key and hangs up. No private key, no login. Pasting a private key is refused in the browser before anything is sent.
- No crawlproof account with the same email yet? The panel shows a sign-up link.

## Install

```sh
pnpm add @profullstack/fleetbar
```

You need a crawlproof partner token (`cpu_...`) for your site. Keep it in the site's logicsrc team vault as `CRAWLPROOF_UPTIME_TOKEN` and set it on the service.

## Express (w3bs.org)

Server: mount the middleware at the app root. It answers under `/api/fleetbar` and calls `next()` for everything else. Put it before or after `express.json()`, both work.

```js
// server.mjs
import express from 'express';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetbarExpress } from '@profullstack/fleetbar/server';

const app = express();

app.use(
  fleetbarExpress({
    token: () => process.env.CRAWLPROOF_UPTIME_TOKEN,
    // Your session lookup. Return null when signed out.
    // emailVerified must be true: you are vouching for this address.
    getUser: async (request, { req }) => {
      const user = await sessionUser(req); // your app's helper
      return user ? { email: user.email, emailVerified: Boolean(user.email_verified) } : null;
    },
  }),
);

// Serve the prebuilt component from the package.
const fleetbarDist = dirname(fileURLToPath(import.meta.resolve('@profullstack/fleetbar/dist/fleetbar.js')));
app.use('/vendor/fleetbar', express.static(fleetbarDist, { maxAge: '1h' }));
```

Page (`/fleet`):

```html
<script src="/vendor/fleetbar/fleetbar.js" defer></script>
<fleet-bar endpoint="/api/fleetbar"></fleet-bar>
```

Or as a module: `<script type="module">import '/vendor/fleetbar/fleetbar.mjs';</script>`.

## Next.js App Router (threatcrush.com)

Server: one catch-all route that hands every method to the fetch handler.

```ts
// app/api/fleetbar/[...path]/route.ts
import { createFleetbarHandler } from '@profullstack/fleetbar/server';
import { getSession } from '@/lib/auth'; // your app's helper

const handler = createFleetbarHandler({
  // Read at request time through a non-literal key: Next inlines process.env.NAME at build.
  token: () => process.env['CRAWLPROOF_UPTIME_TOKEN'],
  getUser: async () => {
    const session = await getSession();
    return session ? { email: session.user.email, emailVerified: session.user.emailVerified === true } : null;
  },
});

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
```

Page: a small client component that registers the element.

```tsx
// app/fleet/fleet-bar.tsx
'use client';
import { useEffect } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'fleet-bar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        endpoint?: string;
        refresh?: string;
        theme?: 'light' | 'dark';
      };
    }
  }
}

export function FleetBar() {
  useEffect(() => {
    import('@profullstack/fleetbar');
  }, []);
  return <fleet-bar endpoint="/api/fleetbar" />;
}
```

```tsx
// app/fleet/page.tsx
import { FleetBar } from './fleet-bar';
export default function Page() {
  return <FleetBar />;
}
```

## Server API

`createFleetbarHandler(options) => (request: Request, ctx?) => Promise<Response>`

| Option | Default | |
| --- | --- | --- |
| `token` | required | Partner token string, or a function (sync or async) read per request. Missing at request time gives 503 `fleetbar_not_configured`. |
| `getUser(request, ctx)` | required | Returns `{ email, emailVerified, coinpaySub? }` or `null`. `ctx` is `{ req, res }` under Express and Next's route context under Next. See [CoinPay identity](#coinpay-identity). |
| `crawlproofUrl` | `https://crawlproof.com` | |
| `basePath` | `/api/fleetbar` | Where the routes are mounted. |
| `maxBodyBytes` | `32768` | Bigger bodies get 413. |
| `allowedOrigins` | `[]` | Extra origins allowed to write, e.g. `https://www.example.com`. |
| `timeoutMs` | `15000` | Upstream timeout. |
| `fetch` | `globalThis.fetch` | For tests. |

`fleetbarExpress(options)` takes the same options and returns `(req, res, next)` middleware.

Routes, each mapped to `crawlproof /api/uptime/v1/...`:

| Method | Path |
| --- | --- |
| GET, PUT | `/api/fleetbar/settings` |
| GET | `/api/fleetbar/keys` |
| GET, POST | `/api/fleetbar/monitors` |
| PATCH, DELETE | `/api/fleetbar/monitors/:id` |
| GET | `/api/fleetbar/monitors/:id/incidents` |

What the handler enforces:

- Any other path is 404, any other method 405 (with `Allow`). Query strings are dropped. Ids are `[A-Za-z0-9_-]{1,64}`.
- No session: 401 `unauthorized`. Email not verified (`emailVerified !== true`) and no `coinpaySub`: 403 `email_unverified`. A malformed `coinpaySub` (not `[A-Za-z0-9._:-]{1,128}`): 403 `invalid_coinpay_sub`.
- Writes (PUT, POST, PATCH, DELETE) must be same-origin: the `Origin` host must match the request host (or `X-Forwarded-Host`, or `allowedOrigins`); with no `Origin`, `Sec-Fetch-Site: same-origin` is required. Otherwise 403 `cross_origin`.
- Bodies must be `application/json` (415), a JSON object (400 `invalid_json`), and at most `maxBodyBytes` (413). They are parsed and re-serialised before forwarding.
- Only `Authorization: Bearer <token>`, `X-Fleet-User-Email` (verified emails only), `X-Fleet-User-CoinPay-Sub` (when given), `Accept` and `Content-Type` go upstream. Cookies and browser auth headers do not. Only the JSON body and status come back, with `Cache-Control: no-store`.
- crawlproof's own 4xx answers pass through, so `404 { error: "no_crawlproof_account", signup_url }` reaches the panel. A 401 or 403 from crawlproof means the partner token is wrong, so it becomes 502 `partner_auth_failed`. 5xx, redirects and timeouts become 502.

## CoinPay identity

Since 0.2.0 `getUser` may also return `coinpaySub`: the CoinPay account id (`sub`) your app has bound to this user through Sign in with CoinPay or Connect CoinPay. It goes upstream as `X-Fleet-User-CoinPay-Sub`, and crawlproof uses it ahead of the email: the fleet is the one belonging to the crawlproof user linked to that CoinPay account (404 `no_crawlproof_account` when none is). A sub on its own is enough, so a user who signed up with CoinPay and has no verified email can still use the panel.

```js
getUser: async (request) => {
  const user = await sessionUser(request);
  if (!user) return null;
  return {
    email: user.email,
    emailVerified: user.emailVerified === true,
    // From YOUR identities table, bound by sub. Never look it up by email:
    // CoinPay emails are unverified.
    coinpaySub: user.coinpaySub ?? null,
  };
};
```

Return `coinpaySub` only from a binding you made by `sub`. An unverified email is never forwarded, with or without a sub.

## Element API

```html
<fleet-bar endpoint="/api/fleetbar" refresh="30" theme="dark"></fleet-bar>
```

| Attribute | Default | |
| --- | --- | --- |
| `endpoint` | `/api/fleetbar` | Base URL of the server half. Requests use `credentials: "same-origin"`. |
| `refresh` | `30` | Seconds between check refreshes (minimum 5). Paused while the tab is hidden. |
| `theme` | follows `prefers-color-scheme` | `light` or `dark` to force one. |

Events (bubble, composed):

| Event | `detail` |
| --- | --- |
| `fleetbar:load` | `{ settings, keys, monitors }` after a full load |
| `fleetbar:change` | `{ action: "create" \| "update" \| "delete" \| "settings", id?, monitor?, settings? }` |
| `fleetbar:error` | the error: `{ status, error, message, signup_url? }` |

Custom properties, set on `fleet-bar` or any ancestor (`:root`, a wrapper; since 0.1.1 an ancestor works too):

`--fleetbar-bg`, `--fleetbar-surface`, `--fleetbar-fg`, `--fleetbar-muted`, `--fleetbar-border`, `--fleetbar-accent`, `--fleetbar-accent-fg`, `--fleetbar-up`, `--fleetbar-down`, `--fleetbar-paused`, `--fleetbar-pending`, `--fleetbar-radius`, `--fleetbar-gap`, `--fleetbar-font` (default `inherit`), `--fleetbar-mono`.

Shadow parts: `panel`, `keys`, `checks`, `add`, `signup`.

The styles are plain CSS first. Squircle corners (`corner-shape`) and the narrow-width card layout (container queries) are enhancements; browsers without them get rounded corners and a scrolling table.

JavaScript: importing `@profullstack/fleetbar` registers the element. `@profullstack/fleetbar/element` exports `FleetBar` and `defineFleetBar(tag)` without registering. The IIFE also sets `window.FleetBar`.

## Develop

```sh
pnpm install
pnpm test   # builds dist/ then runs node --test (server, element in happy-dom, dist)
```

Releases: bump `version`, merge, then `gh release create vX.Y.Z`. The publish workflow puts it on npm.

## License

MIT
