// -----------------------------------------------------------------------------
// An in-memory WMS WebControl pro for the app tests: a client with the methods
// of src/wms.js. Every call is recorded; failures, gates and the data of each
// channel (driving cause, blocking) can be injected.
// -----------------------------------------------------------------------------

import { WmsError } from '../../src/wms.js';
import * as F from './fixtures.js';

export const BOX_URL = 'http://192.168.1.30';
export const CONFIG = { box_address: '192.168.1.30' };

/** Lets the pending promises and their continuations run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

export function fakeBox() {
  const box = {
    configuration: F.configuration(),
    values: F.productValues(),
    /** destination id -> extra data of its status (drivingCause, blocking...) */
    data: new Map(),
    calls: [],
    clients: [],
    /** method -> WmsError (or a function returning one) thrown by the next calls */
    failures: new Map(),
    /** method -> promise awaited before the call (to hold it), or (args) => promise|undefined */
    gates: new Map(),
    /** whether an action changes the values (like a real box) */
    apply: true,
  };

  box.connect = ({ url }) => {
    const client = { url, closed: false };
    const call = async (name, args, options) => {
      const gate = box.gates.get(name);
      const held = typeof gate === 'function' ? gate(args) : gate;
      if (held) {
        await held;
      }
      // The moment the request leaves its socket.
      options?.guard?.();
      box.calls.push({
        name,
        args,
        instant: options?.instant,
        stop: options?.stop,
        timeout: options?.timeout,
        long: options?.long,
      });
      const failure = box.failures.get(name);
      if (failure) {
        throw typeof failure === 'function' ? failure() : failure;
      }
    };
    Object.assign(client, {
      async ping(options) {
        await call('ping', [], options);
        return true;
      },
      async configuration(options) {
        await call('configuration', [], options);
        return box.configuration;
      },
      async status(id, options) {
        await call('status', [id], options);
        return F.statusAnswer(id, box.values.get(id), box.data.get(id));
      },
      async action(actions, options) {
        await call('action', [actions], options);
        if (box.apply) {
          for (const { destinationId, actionId, parameters } of actions) {
            const values = box.values.get(destinationId) ?? new Map();
            if (Object.keys(parameters).length > 0) {
              values.set(actionId, { ...values.get(actionId), ...parameters });
            }
            box.values.set(destinationId, values);
          }
        }
        return { command: 'action', protocolVersion: '1.0.0' };
      },
      async scene(id, options) {
        await call('scene', [id], options);
        return { command: 'sceneActions', protocolVersion: '1.0.0' };
      },
      close() {
        client.closed = true;
      },
    });
    box.clients.push(client);
    return client;
  };

  box.callsOf = (name) => box.calls.filter((c) => c.name === name);
  box.refuse = (codes) =>
    new WmsError('refused', `error ${codes.join(', ')}`, { codes, sent: true });
  return box;
}

/** A logger that keeps every line. */
export function captureLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`,
      );
  const logger = {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: () => logger,
  };
  return logger;
}
