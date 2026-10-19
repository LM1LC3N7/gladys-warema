// -----------------------------------------------------------------------------
// A simulated WMS WebControl pro on 127.0.0.1 (never the network), like the
// simulator of pywmspro: POST /commonCommand answers ping, getConfiguration,
// getStatus, action and sceneActions from the fixtures. A handler per command
// can replace the answer (errors, delays, status codes).
// -----------------------------------------------------------------------------

import http from 'node:http';
import * as F from './fixtures.js';

export async function boxServer() {
  const sim = {
    configuration: F.configuration(),
    values: F.productValues(),
    requests: [],
    /** command -> (body, res) => true when it answered itself */
    handlers: new Map(),
  };
  const answer = (res, status, json, headers = {}) => {
    const body = JSON.stringify(json);
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body);
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = undefined;
      }
      sim.requests.push({ method: req.method, path: req.url, body, at: Date.now() });
      if (req.method !== 'POST' || req.url !== '/commonCommand') {
        answer(res, 404, {});
        return;
      }
      if (body?.protocolVersion !== '1.0' || body?.source !== 2) {
        answer(res, 400, {});
        return;
      }
      const handler = sim.handlers.get(body.command);
      if (handler && handler(body, res, answer)) {
        return;
      }
      const base = { command: body.command, protocolVersion: '1.0.0' };
      switch (body.command) {
        case 'ping':
          answer(res, 200, { ...base, status: 0 });
          return;
        case 'getConfiguration':
          answer(res, 200, sim.configuration);
          return;
        case 'getStatus': {
          const id = body.destinations?.[0];
          answer(res, 200, F.statusAnswer(id, sim.values.get(id)));
          return;
        }
        case 'action':
          for (const action of body.actions ?? []) {
            const values = sim.values.get(action.destinationId) ?? new Map();
            values.set(action.actionId, { ...values.get(action.actionId), ...action.parameters });
            sim.values.set(action.destinationId, values);
          }
          answer(res, 200, base);
          return;
        case 'sceneActions':
          answer(res, 200, base);
          return;
        default:
          answer(res, 200, { ...base, errors: [0x10001] });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  sim.address = `127.0.0.1:${server.address().port}`;
  sim.url = `http://${sim.address}`;
  sim.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  sim.port = server.address().port;
  return sim;
}

/** Waits (real time) until `check` holds. */
export async function waitFor(check, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) {
      return;
    }
    if (Date.now() > end) {
      throw new Error('timed out waiting');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
