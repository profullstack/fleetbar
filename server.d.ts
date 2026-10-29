export interface FleetbarUser {
  email: string;
  /** Must be exactly `true`: the host asserts it verified this address. */
  emailVerified: boolean;
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
export const ROUTES: ReadonlyArray<{ pattern: RegExp; methods: string[] }>;

export function createFleetbarHandler(opts: FleetbarHandlerOptions): FleetbarHandler;
export function isSameOrigin(request: Request, allowedOrigins?: string[]): boolean;

/** Express/Connect middleware. getUser receives (request, { req, res }). */
export function fleetbarExpress(
  opts: FleetbarHandlerOptions,
): (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
