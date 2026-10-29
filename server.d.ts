export interface FleetbarUser {
  /** Forwarded as X-Fleet-User-Email only when emailVerified is exactly `true`. */
  email?: string;
  /** Must be exactly `true`: the host asserts it verified this address. */
  emailVerified?: boolean;
  /**
   * The CoinPay `sub` the host has bound to this user (Sign in with CoinPay /
   * Connect CoinPay). Forwarded as X-Fleet-User-CoinPay-Sub; crawlproof maps it to
   * the crawlproof user linked to that CoinPay account and it wins over the email.
   * Never derive it from an email. Omit or null when the user has no CoinPay link.
   */
  coinpaySub?: string | null;
}

export interface FleetbarHandlerOptions {
  /** Default "https://crawlproof.com". */
  crawlproofUrl?: string;
  /** The crawlproof partner token (cpu_...). A function is read per request, so env vars set after import work. */
  token: string | undefined | (() => string | undefined | Promise<string | undefined>);
  /** The host's session lookup. Return null when signed out. */
  getUser(request: Request, ctx?: any): FleetbarUser | null | Promise<FleetbarUser | null>;
  /** Where the bar's API is mounted. Default "/api/fleetbar". */
  basePath?: string;
  /** Request body cap in bytes. Default 32768. */
  maxBodyBytes?: number;
  /** Extra origins treated as same-origin for writes, e.g. ["https://www.example.com"]. */
  allowedOrigins?: string[];
  /** Upstream timeout. Default 15000. */
  timeoutMs?: number;
  /** fetch override (tests). */
  fetch?: typeof fetch;
}

export type FleetbarHandler = (request: Request, ctx?: any) => Promise<Response>;

export const DEFAULT_CRAWLPROOF_URL: string;
export const DEFAULT_BASE_PATH: string;
export const DEFAULT_MAX_BODY_BYTES: number;
export const COINPAY_SUB_RE: RegExp;
export const ROUTES: ReadonlyArray<{ pattern: RegExp; methods: string[] }>;

export function createFleetbarHandler(opts: FleetbarHandlerOptions): FleetbarHandler;
export function isSameOrigin(request: Request, allowedOrigins?: string[]): boolean;

/** Express/Connect middleware. getUser receives (request, { req, res }). */
export function fleetbarExpress(
  opts: FleetbarHandlerOptions,
): (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
