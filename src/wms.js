// -----------------------------------------------------------------------------
// The WMS WebControl pro API over HTTP (local network only, no
// authentication), ported from pywmspro (webcontrol.py, destination.py;
// Apache-2.0) after the WAREMA documentation 2064534.
//
// Every command is a POST of JSON to http://<box>/commonCommand:
//   { "protocolVersion": "1.0", "command": <name>, "source": 2, ...parameters }
// The box answers HTTP 200 with a JSON body; a body with an `errors` list is a
// refusal of the box (its codes are reported as they are).
//
// One request at a time (pywmspro's common lock), commands before reads; two
// status requests at least 0.5 s apart (they go over the WMS radio channel); a
// status answered "busy" (0x50005) is asked again after 1 s, 3 tries at most.
// Redirections are never followed.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { API, ERROR_BUSY, LIMITS, RESPONSE_TYPE, SCENE_ACTION, TIMINGS } from './constants.js';

export class WmsError extends Error {
  /**
   * @param {'refused'|'busy'|'denied'|'notfound'|'rate'|'server'|'network'|'timeout'|'http'|'redirect'|'format'|'size'} kind
   * @param {string} message
   * @param {{ status?: number, retryAfter?: number, sent?: boolean, codes?: string[] }} [details]
   *   retryAfter in ms; sent false when the request never left (connection
   *   refused, no route, timed out before the connection); codes: the error
   *   codes of the box, as hexadecimal texts
   */
  constructor(kind, message, { status, retryAfter, sent, codes } = {}) {
    super(message);
    this.name = 'WmsError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.sent = sent;
    this.codes = codes;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> WmsError; `sent` tells whether the request had left. */
export function networkError(err, sent) {
  if (err instanceof WmsError || err?.refusal) {
    return err;
  }
  const reason = NETWORK_REASONS[err?.code] ?? 'network error';
  return new WmsError('network', reason, { sent });
}

/** Retry-After (seconds or an HTTP date) -> ms, or undefined. */
export function retryAfterOf(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** An error code of the box as a text: 327685 -> "0x50005". */
export const codeText = (code) => `0x${code.toString(16).toUpperCase()}`;

/** The error codes of an answer (integers only, a bounded number). */
export function codesOf(json) {
  const list = Array.isArray(json?.errors) ? json.errors : [];
  const codes = [];
  for (const code of list) {
    if (codes.length >= LIMITS.actions) {
      break;
    }
    if (Number.isSafeInteger(code) && code >= 0) {
      codes.push(code);
    }
  }
  // An `errors` list that holds something else than codes is still a refusal.
  return { codes, refused: list.length > 0 };
}

/**
 * The JSON body of an answer, or the WmsError it carries.
 * @param {{ status: number, headers?: object, body: string }} answer
 */
export function parseAnswer({ status, headers = {}, body }) {
  if (status >= 300 && status < 400) {
    throw new WmsError('redirect', `redirected (HTTP ${status})`, { status });
  }
  if (status === 401 || status === 403) {
    // The API has no authentication: something else answers at this address.
    throw new WmsError('denied', `access refused (HTTP ${status})`, { status });
  }
  if (status === 404) {
    throw new WmsError('notfound', 'not found (HTTP 404)', { status });
  }
  if (status === 429) {
    throw new WmsError('rate', 'too many requests (HTTP 429)', {
      status,
      retryAfter: retryAfterOf(headers['retry-after']),
    });
  }
  if (status >= 500) {
    throw new WmsError('server', `HTTP ${status}`, {
      status,
      retryAfter: retryAfterOf(headers['retry-after']),
    });
  }
  if (status < 200 || status >= 300) {
    throw new WmsError('http', `HTTP ${status}`, { status });
  }
  let json;
  try {
    json = body ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new WmsError('format', 'not an answer of a WMS WebControl pro', { status });
  }
  const { codes, refused } = codesOf(json);
  if (refused) {
    const texts = codes.map(codeText);
    if (codes.includes(ERROR_BUSY)) {
      throw new WmsError('busy', `busy (${codeText(ERROR_BUSY)})`, { status, codes: texts });
    }
    throw new WmsError(
      'refused',
      texts.length > 0 ? `error ${texts.join(', ')}` : 'error without a code',
      { status, codes: texts },
    );
  }
  return json;
}

/**
 * One HTTP request; resolves { status, headers, body }.
 * @param {string} url
 * @param {{ method: string, headers: object, body?: string, timeout: number, agent?: http.Agent, maxBytes?: number, guard?: Function }} options
 *   `guard` throws to cancel the request at the moment it would leave
 */
export function httpRequest(
  url,
  { method, headers, body, timeout, agent, maxBytes = LIMITS.responseBytes, guard },
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let timer;
    let settled = false;
    /** whether the request left (its body written to a connected socket) */
    let sent = false;
    /** The first outcome wins: a destroyed request may still end or fail after it. */
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = http.request(target, { method, agent, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new WmsError('size', 'answer too large', { sent: true }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', (err) => settle(reject, networkError(err, true)));
    });
    timer = setTimeout(() => {
      const seconds = Math.max(1, Math.round(timeout / 1000));
      settle(reject, new WmsError('timeout', `no answer within ${seconds} s`, { sent }));
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err, sent)));
    const send = () => {
      try {
        guard?.();
      } catch (err) {
        settle(reject, err);
        req.destroy();
        return;
      }
      sent = true;
      req.end(body);
    };
    // The request leaves once its socket is connected: a refused connection
    // is "not sent", and a command checks its deadline at that moment.
    req.once('socket', (socket) => {
      if (socket.connecting) {
        socket.once('connect', send);
      } else {
        send();
      }
    });
  });
}

/** Priorities of the queue: commands first. */
const PRIORITY = { command: 0, read: 1 };

/**
 * A client of one WebControl pro.
 * @param {{ url: string, request?: typeof httpRequest, timers?: object, now?: () => number }} options
 */
export function createClient({
  url,
  request = httpRequest,
  timers = globalThis,
  now = () => Date.now(),
}) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  let closed = false;
  const sleep = (ms) => new Promise((resolve) => timers.setTimeout(resolve, ms));

  // One request at a time (the box handles one), commands before reads.
  const waiting = [];
  let running = false;
  const pump = () => {
    if (running || waiting.length === 0) {
      return;
    }
    const next = waiting.shift();
    running = true;
    Promise.resolve()
      .then(next.run)
      .then(next.resolve, next.reject)
      .finally(() => {
        running = false;
        pump();
      });
  };
  const enqueue = (priority, run) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new WmsError('network', 'client closed', { sent: false }));
        return;
      }
      const entry = { priority, run, resolve, reject };
      const at = waiting.findIndex((w) => w.priority > priority);
      if (at === -1) {
        waiting.push(entry);
      } else {
        waiting.splice(at, 0, entry);
      }
      pump();
    });

  const send = (command, parameters, options = {}, priority = PRIORITY.read) =>
    enqueue(priority, async () => {
      const { timeout = TIMINGS.requestTimeout, guard, maxBytes } = options;
      // A command must not leave once its deadline is past (guard throws).
      guard?.();
      const ms = typeof timeout === 'function' ? timeout() : timeout;
      const body = JSON.stringify({
        protocolVersion: API.protocolVersion,
        command,
        source: API.source,
        ...parameters,
      });
      const answer = await request(`${url}${API.path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        body,
        agent,
        timeout: ms,
        guard,
        maxBytes,
      });
      try {
        return parseAnswer(answer);
      } catch (err) {
        // An answer was received: the request did leave.
        err.sent = true;
        throw err;
      }
    });

  // Status requests among themselves: spaced by 0.5 s (pywmspro _status_lock).
  let statusChain = Promise.resolve();
  let lastStatusAt = -Infinity;
  const spaced = (task) => {
    const run = statusChain
      .catch(() => {})
      .then(async () => {
        const wait = lastStatusAt + TIMINGS.statusSpacing - now();
        if (wait > 0) {
          await sleep(wait);
        }
        try {
          return await task();
        } finally {
          lastStatusAt = now();
        }
      });
    statusChain = run.catch(() => {});
    return run;
  };

  return {
    url,
    /** The box answers `{ "status": 0 }`. */
    async ping(options) {
      const json = await send(API.commands.ping, {}, options);
      if (json.status !== 0) {
        throw new WmsError('format', 'the ping was not answered with status 0');
      }
      return true;
    },
    /** Destinations (channels), rooms and scenes. */
    configuration(options) {
      return send(
        API.commands.configuration,
        {},
        { maxBytes: LIMITS.configurationBytes, ...options },
      );
    },
    /** The status of ONE destination (the API reads one at a time). */
    async status(destinationId, options) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await spaced(() =>
            send(API.commands.status, { destinations: [destinationId] }, options),
          );
        } catch (err) {
          if (err?.kind !== 'busy' || attempt >= TIMINGS.busyTries) {
            throw err;
          }
          await sleep(TIMINGS.busyRetry);
        }
      }
    },
    /**
     * The actions of ONE destination (the box accepts several actions of a
     * same channel in one request).
     * @param {{ destinationId: number, actionId: number, parameters: object }[]} actions
     */
    action(actions, options) {
      return send(
        API.commands.action,
        { responseType: RESPONSE_TYPE.DETAILED, actions },
        options,
        PRIORITY.command,
      );
    },
    /** Runs a scene of the box (never relearns it). */
    scene(sceneId, options) {
      return send(
        API.commands.scene,
        {
          responseType: RESPONSE_TYPE.INSTANT,
          sceneId,
          sceneActionType: SCENE_ACTION.EXECUTE,
        },
        options,
        PRIORITY.command,
      );
    },
    close() {
      closed = true;
      for (const entry of waiting.splice(0)) {
        entry.reject(new WmsError('network', 'client closed', { sent: false }));
      }
      agent.destroy();
    },
  };
}
