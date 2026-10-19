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
import { DISCOVERED, IDS } from './helpers/fixtures.js';
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
    responseType: 1,
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
  assert.match(refused.error, /refusé la commande : error 0x30007/);

  const tested = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(tested.data.message.en, /^Connection OK: WMS WebControl pro with 9 channels/);
});
