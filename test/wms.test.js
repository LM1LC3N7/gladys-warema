// -----------------------------------------------------------------------------
// The real HTTP client against the simulated WebControl pro on 127.0.0.1.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TIMINGS } from '../src/constants.js';
import { WmsError, codesOf, createClient, parseAnswer, retryAfterOf } from '../src/wms.js';
import { IDS } from './helpers/fixtures.js';
import { boxServer } from './helpers/boxServer.js';

async function withBox(t) {
  const sim = await boxServer();
  const client = createClient({ url: sim.url });
  t.after(async () => {
    client.close();
    await sim.close();
  });
  return { sim, client };
}

test('every command is a POST of JSON to /commonCommand, protocol 1.0, source 2', async (t) => {
  const { sim, client } = await withBox(t);
  assert.equal(await client.ping(), true);
  const config = await client.configuration();
  assert.equal(config.destinations.length, 9);
  const status = await client.status(IDS.shutter);
  assert.equal(status.details[0].data.productData[0].value.percentage, 30);
  await client.action([{ destinationId: IDS.shutter, actionId: 0, parameters: { percentage: 0 } }]);
  await client.scene(IDS.sceneOn);
  assert.deepEqual(
    sim.requests.map((r) => [
      r.method,
      r.path,
      r.body.protocolVersion,
      r.body.source,
      r.body.command,
    ]),
    [
      ['POST', '/commonCommand', '1.0', 2, 'ping'],
      ['POST', '/commonCommand', '1.0', 2, 'getConfiguration'],
      ['POST', '/commonCommand', '1.0', 2, 'getStatus'],
      ['POST', '/commonCommand', '1.0', 2, 'action'],
      ['POST', '/commonCommand', '1.0', 2, 'sceneActions'],
    ],
  );
  assert.deepEqual(sim.requests[2].body.destinations, [IDS.shutter]);
  assert.deepEqual(sim.requests[3].body.actions, [
    { destinationId: IDS.shutter, actionId: 0, parameters: { percentage: 0 } },
  ]);
  assert.equal(sim.requests[3].body.responseType, 1, 'actions ask for a detailed answer');
  // A scene is run, never relearnt (sceneActionType 0 would overwrite it).
  assert.equal(sim.requests[4].body.sceneActionType, 1);
  assert.equal(sim.requests[4].body.sceneId, IDS.sceneOn);
});

test('an answer with error codes is a refusal of the box, its codes kept as they are', async (t) => {
  const { sim, client } = await withBox(t);
  sim.handlers.set('action', (_body, res, answer) => {
    answer(res, 200, { command: 'action', protocolVersion: '1.0.0', errors: [0x30007] });
    return true;
  });
  await assert.rejects(
    client.action([{ destinationId: IDS.awning, actionId: 0, parameters: { percentage: 100 } }]),
    (err) =>
      err instanceof WmsError &&
      err.kind === 'refused' &&
      err.sent === true &&
      err.message === 'error 0x30007' &&
      err.codes[0] === '0x30007',
  );
});

test('a busy status (0x50005) is asked again after 1 s, 3 tries at most; statuses are 0.5 s apart', async (t) => {
  const { sim, client } = await withBox(t);
  let busy = 1;
  sim.handlers.set('getStatus', (_body, res, answer) => {
    if (busy > 0) {
      busy -= 1;
      answer(res, 200, { command: 'getStatus', protocolVersion: '1.0.0', errors: [0x50005] });
      return true;
    }
    return false;
  });
  const status = await client.status(IDS.shutter);
  assert.equal(status.details[0].destinationId, IDS.shutter);
  await client.status(IDS.blind);
  const times = sim.requests.filter((r) => r.body.command === 'getStatus').map((r) => r.at);
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= TIMINGS.busyRetry - 50, `${times[1] - times[0]} ms`);
  assert.ok(times[2] - times[1] >= TIMINGS.statusSpacing - 50, `${times[2] - times[1]} ms`);

  busy = 10;
  await assert.rejects(client.status(IDS.shutter), { kind: 'busy' });
});

test('HTTP errors by kind; 429 and 5xx carry Retry-After; redirections are never followed', async (t) => {
  const { sim, client } = await withBox(t);
  const reply = (status, headers = {}) =>
    sim.handlers.set('ping', (_b, res, answer) => {
      answer(res, status, {}, headers);
      return true;
    });
  reply(429, { 'Retry-After': '120' });
  await assert.rejects(client.ping(), { kind: 'rate', retryAfter: 120_000 });
  reply(503);
  await assert.rejects(client.ping(), { kind: 'server' });
  reply(302, { Location: 'http://example.com/' });
  await assert.rejects(client.ping(), { kind: 'redirect' });
  reply(403);
  await assert.rejects(client.ping(), { kind: 'denied' });
  sim.handlers.set('ping', (_b, res) => {
    res.writeHead(200);
    res.end('<html>router</html>');
    return true;
  });
  await assert.rejects(client.ping(), { kind: 'format' });
  assert.ok(sim.requests.every((r) => r.path === '/commonCommand'));
});

test('a status answer is read up to 64 KB, the configuration up to 1 MB', async (t) => {
  const { sim, client } = await withBox(t);
  sim.handlers.set('getStatus', (_b, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(`{"pad":"${'x'.repeat(70 * 1024)}"}`);
    return true;
  });
  await assert.rejects(client.status(IDS.shutter), { kind: 'size' });
  sim.handlers.set('getConfiguration', (_b, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(`{"destinations":[],"pad":"${'x'.repeat(200 * 1024)}"}`);
    return true;
  });
  const config = await client.configuration();
  assert.deepEqual(config.destinations, []);
});

test('a command past its deadline never leaves; a refused connection is "not sent"', async (t) => {
  const { sim, client } = await withBox(t);
  const late = new Error('too late');
  late.refusal = 'tooLate';
  await assert.rejects(
    client.action([{ destinationId: 1, actionId: 0, parameters: {} }], {
      guard: () => {
        throw late;
      },
    }),
    (err) => err === late,
  );
  assert.equal(sim.requests.length, 0, 'nothing reached the box');

  const port = await new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const dead = createClient({ url: `http://127.0.0.1:${port}` });
  await assert.rejects(dead.ping(), (err) => err.kind === 'network' && err.sent === false);
  dead.close();
});

test('commands go before the reads waiting in the queue', async (t) => {
  const { sim, client } = await withBox(t);
  let release;
  const held = new Promise((resolve) => (release = resolve));
  sim.handlers.set('ping', (_b, res, answer) => {
    held.then(() => answer(res, 200, { status: 0 }));
    return true;
  });
  const first = client.ping();
  const read = client.configuration();
  const command = client.scene(IDS.sceneNight);
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await Promise.all([first, read, command]);
  assert.deepEqual(
    sim.requests.map((r) => r.body.command),
    ['ping', 'sceneActions', 'getConfiguration'],
  );
});

test('the parsing helpers', () => {
  assert.equal(retryAfterOf('30'), 30_000);
  assert.equal(retryAfterOf(''), undefined);
  assert.equal(retryAfterOf('soon'), undefined);
  assert.deepEqual(codesOf({ errors: [1, 'x', -1, 2.5, 3] }), { codes: [1, 3], refused: true });
  assert.deepEqual(codesOf({}), { codes: [], refused: false });
  assert.throws(() => parseAnswer({ status: 200, body: '[1]' }), { kind: 'format' });
  assert.throws(() => parseAnswer({ status: 200, body: '{"errors":["?"]}' }), {
    kind: 'refused',
    message: 'error without a code',
  });
  // A key named __proto__ in the answer stays plain data.
  const json = parseAnswer({ status: 200, body: '{"__proto__":{"polluted":1},"status":0}' });
  assert.equal({}.polluted, undefined);
  assert.equal(json.status, 0);
});
