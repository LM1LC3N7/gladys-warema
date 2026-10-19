// -----------------------------------------------------------------------------
// The whole integration, real HTTP client, against the simulated WebControl
// pro of test/helpers/boxServer.js on 127.0.0.1 (never the network), with the
// SDK's fake Gladys. Real time: a few seconds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WaremaApp } from '../src/app.js';
import { ACTIONS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { COVER_STATE } from '../src/model.js';
import { StateStore } from '../src/store.js';
import { captureLogger } from './helpers/fakeBox.js';
import { DISCOVERED, IDS, statusAnswer } from './helpers/fixtures.js';
import { boxServer, waitFor } from './helpers/boxServer.js';

test('a WebControl pro, end to end: devices, states, commands, refusal, test', async (t) => {
  const sim = await boxServer();
  const gladys = createFakeGladys({ config: { box_address: sim.address } });
  const logger = captureLogger();
  const app = new WaremaApp({ gladys, logger, store: new StateStore({ dir: null }) });
  registerHandlers(gladys, app, logger);
  t.after(async () => {
    app.stop();
    await sim.close();
  });
  await gladys.connect();
  await waitFor(() => app.online);
  assert.equal(gladys.fake.discoveredDevices.length, DISCOVERED);

  const named = (name) => gladys.fake.discoveredDevices.find((d) => d.name === name);
  const shutter = named('Wohnzimmer (Wohnbereich)');
  await gladys.fake.deviceCreated(shutter);
  const position = shutter.features.find((f) => f.external_id.endsWith(':position'));
  await waitFor(async () => {
    await app.publisher.flush();
    return gladys.fake.lastState(position.external_id) === 70;
  });

  const state = shutter.features.find((f) => f.external_id.endsWith(':state'));
  const ack = await gladys.fake.setValue(shutter, state, COVER_STATE.CLOSE);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(sim.requests.findLast((r) => r.body.command === 'action').body, {
    protocolVersion: '1.0',
    command: 'action',
    source: 2,
    responseType: 0,
    actions: [{ destinationId: IDS.shutter, actionId: 0, parameters: { percentage: 100 } }],
  });
  await waitFor(async () => {
    await app.publisher.flush();
    return gladys.fake.lastState(position.external_id) === 0;
  }, 6000);

  // The box refuses (a wind alarm, say): its answer is reported as it is.
  sim.handlers.set('action', (_b, res, answer) => {
    answer(res, 200, { command: 'action', protocolVersion: '1.0.0', errors: [0x30007] });
    return true;
  });
  const refused = await gladys.fake.setValue(shutter, state, COVER_STATE.OPEN);
  assert.equal(refused.success, false);
  assert.match(refused.error, /refusé la commande : erreur 0x30007/);

  const tested = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(tested.data.message.en, /^Connection OK: WMS WebControl pro with 9 channels/);
});

async function live(t) {
  const sim = await boxServer();
  const gladys = createFakeGladys({ config: { box_address: sim.address } });
  const logger = captureLogger();
  const app = new WaremaApp({ gladys, logger, store: new StateStore({ dir: null }) });
  registerHandlers(gladys, app, logger);
  t.after(async () => {
    app.stop();
    await sim.close();
  });
  await gladys.connect();
  await waitFor(() => app.online);
  const named = (name) => gladys.fake.discoveredDevices.find((d) => d.name === name);
  const feat = (d, key) => d.features.find((f) => f.external_id === `${d.external_id}:${key}`);
  return { sim, gladys, app, named, feat };
}

const stopsOf = (sim) =>
  sim.requests.filter((r) => r.body?.command === 'action' && r.body.actions[0].actionId === 16);

test('B1, scenario A: a STOP right after a slow close of an awning is sent and acked', async (t) => {
  const { sim, gladys, named, feat } = await live(t);
  const awning = named('Markise (Terrasse)');
  await gladys.fake.deviceCreated(awning);
  await new Promise((resolve) => setTimeout(resolve, 600));
  sim.handlers.set('action', (body, res, answer) => {
    const moving = body.actions.some((a) => a.parameters.percentage !== undefined);
    setTimeout(
      () => answer(res, 200, { command: 'action', protocolVersion: '1.0.0' }),
      moving ? 4000 : 0,
    );
    return true;
  });
  const t0 = Date.now();
  const close = gladys.fake.setValue(awning, feat(awning, 'state'), COVER_STATE.CLOSE);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stop = await gladys.fake.setValue(awning, feat(awning, 'state'), COVER_STATE.STOP);
  assert.equal(stop.success, true, stop.error);
  const left = stopsOf(sim)[0].at - t0;
  assert.ok(left < 3500, `the STOP left after ${left} ms`);
  assert.equal(stopsOf(sim)[0].body.responseType, 0, 'a STOP is Instant');
  const closed = await close;
  assert.equal(closed.success, false, 'the slow close: sent, without confirmation');
});

test('B1: a STOP behind a status read that hangs (a channel out of radio reach) still leaves', async (t) => {
  const { sim, gladys, named, feat } = await live(t);
  const awning = named('Markise (Terrasse)');
  await gladys.fake.deviceCreated(awning);
  await new Promise((resolve) => setTimeout(resolve, 600));
  sim.handlers.set('getStatus', (b, res, answer) => {
    if (b.destinations[0] === IDS.light) {
      return true; // never answers
    }
    answer(res, 200, statusAnswer(b.destinations[0], sim.values.get(b.destinations[0])));
    return true;
  });
  await gladys.fake.deviceCreated(named('Wandlicht (Wohnbereich)'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const t0 = Date.now();
  const ack = await gladys.fake.setValue(awning, feat(awning, 'state'), COVER_STATE.STOP);
  assert.equal(ack.success, true, ack.error);
  assert.ok(stopsOf(sim)[0].at - t0 < 3500);
});

test('F: two STOPs at once on two channels both leave within 3.5 s, even with a slow box', async (t) => {
  const { sim, gladys, named, feat } = await live(t);
  const a = named('Markise (Terrasse)');
  const b = named('Wohnzimmer (Wohnbereich)');
  // The box slow on every action (3.8 s): each STOP holds the line 1 s at most.
  sim.handlers.set('action', (_body, res, answer) => {
    setTimeout(() => answer(res, 200, { command: 'action', protocolVersion: '1.0.0' }), 3800);
    return true;
  });
  const t0 = Date.now();
  const acks = await Promise.all([
    gladys.fake.setValue(a, feat(a, 'state'), COVER_STATE.STOP),
    gladys.fake.setValue(b, feat(b, 'state'), COVER_STATE.STOP),
  ]);
  const left = stopsOf(sim).map((r) => r.at - t0);
  assert.equal(left.length, 2, 'both STOPs left');
  assert.ok(Math.max(...left) < 3500, `left at ${left} ms`);
  for (const ack of acks) {
    assert.match(ack.error, /envoyée à la WebControl pro, sans confirmation/);
  }
  assert.ok(Date.now() - t0 < 4500, 'acked within the 5 s of Gladys');

  // A box quick on Instant answers: both acked.
  sim.handlers.delete('action');
  const quick = await Promise.all([
    gladys.fake.setValue(a, feat(a, 'state'), COVER_STATE.STOP),
    gladys.fake.setValue(b, feat(b, 'state'), COVER_STATE.STOP),
  ]);
  assert.deepEqual(
    quick.map((x) => x.success),
    [true, true],
  );
});
