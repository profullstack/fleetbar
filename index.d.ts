export interface FleetbarKey {
  name: string;
  type: string;
  public_key: string;
  fingerprint: string;
  comment?: string;
}

export interface FleetbarMonitor {
  id: string;
  name: string;
  type: 'ssh' | 'http' | 'keyword' | 'ssl' | 'tcp';
  target: string;
  enabled: boolean;
  interval_s: number;
  current_state: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  last_response_ms: number | null;
  ssh?: { username: string; fingerprint: string; key_comment?: string; key_source: 'keyring' | 'inline' };
}

export const CHECK_TYPES: ReadonlyArray<{ value: FleetbarMonitor['type']; label: string }>;
export const SSH_NOTE: string;
export const MIN_INTERVAL_S: number;
export const KEYRING_URL: string;
export const STYLES: string;

export function esc(value: unknown): string;
export function normalizeKeysUrl(input: string): { ok: true; value: string | null } | { ok: false; error: string };
export function checkPublicKey(input: string): { ok: true; value: string } | { ok: false; error: string };
export function isValidUsername(name: string): boolean;
export function shortFingerprint(fp: string): string;
export function stateOf(monitor: Partial<FleetbarMonitor>): 'up' | 'down' | 'paused' | 'pending';
export function targetLabel(monitor: Partial<FleetbarMonitor>): string;
export function timeAgo(iso: string | null, now?: number): string;
export function formatLatency(ms: number | null): string;
export function buildMonitorBody(
  fields: Record<string, string>,
  editing?: FleetbarMonitor | null,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string; field?: string };
export function errorMessage(err: { status?: number; error?: string; message?: string } | null): string;
export function safeHref(url: unknown, fallback: string): string;

/** The <fleet-bar> element class. Attributes: endpoint, refresh, theme. */
export class FleetBar extends HTMLElement {
  readonly endpoint: string;
  readonly refreshSeconds: number;
  load(): Promise<void>;
  refreshMonitors(): Promise<void>;
}

/** Register the element (default tag "fleet-bar"). Importing the package root already does this. */
export function defineFleetBar(tag?: string): void;

declare global {
  interface HTMLElementTagNameMap {
    'fleet-bar': FleetBar;
  }
}
