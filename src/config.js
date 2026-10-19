// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { LANGUAGES, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  box_address: '',
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
  publish_tilt: false,
  allow_load_switches: false,
};

/**
 * The base address of the WebControl pro from what the user typed:
 * "192.168.1.30", "webcontrol", "http://192.168.1.30/" or
 * "http://192.168.1.30/commonCommand".
 * @returns {{ url: string, host: string } | { error: 'empty'|'invalid'|'https'|'credentials'|'path'|'local-name' }}
 */
export function parseBoxAddress(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (url.protocol === 'https:') {
    // The API is served over plain HTTP on the local network only.
    return { error: 'https' };
  }
  if (url.protocol !== 'http:' || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    return { error: 'credentials' };
  }
  if (!/^\/(commonCommand\/?)?$/i.test(url.pathname) || url.search || url.hash) {
    return { error: 'path' };
  }
  if (/\.local\.?$/i.test(url.hostname)) {
    // mDNS names do not resolve in the container (bridge network).
    return { error: 'local-name' };
  }
  return { url: url.origin, host: url.host };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return raw !== '' && raw !== null && Number.isFinite(n)
    ? Math.max(min, Math.min(max, n))
    : fallback;
};

export const bool = (raw, fallback) => {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (raw === 'true' || raw === 1 || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  return fallback;
};

/**
 * @returns {{ url?: string, host?: string, error?: string, pollInterval: number,
 *   language: 'fr'|'en', publishTilt: boolean, allowLoads: boolean }}
 */
export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseBoxAddress(c.box_address);
  return {
    url: target.url,
    host: target.host,
    error: target.error,
    pollInterval: Math.round(bounded(c.poll_interval, POLL_INTERVAL)),
    language: LANGUAGES.includes(c.language) ? c.language : DEFAULTS.language,
    // The slats of venetian blinds as their own device, off by default: a
    // "close all blinds" of a voice assistant may target it too.
    publishTilt: bool(c.publish_tilt, false),
    // Switched loads (a patio heater is often wired to one): read-only unless
    // allowed; read again at the moment the request leaves.
    allowLoads: bool(c.allow_load_switches, false),
  };
}
