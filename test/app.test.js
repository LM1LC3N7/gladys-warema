// -----------------------------------------------------------------------------
// The app through the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and an in-memory WebControl pro. Timers are mocked: the reads, the
// reconnections and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WaremaApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import { COVER_STATE } from '../src/model.js';
import { StateStore } from '../src/store.js';
import { WmsError } from '../src/wms.js';
import { BOX_URL, CONFIG, captureLogger, fakeBox, settle } from './helpers/fakeBox.js';
import { DISCOVERED, IDS, OFFERED } from './helpers/fixtures.js';

async function setup(t, { config = CONFIG, prepare = () => {}, store, devices } = {}) {
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.parse('2026-10-19T08:00:00.000Z'),
  });
  const gladys = createFakeGladys({ config, devices });
  const box = fakeBox();
  prepare(box);
  const logger = captureLogger();
  const app = new WaremaApp({
    gladys,
    connect: box.connect,
    logger,
    store: store ?? new StateStore({ dir: null }),
  });
  registerHandlers(gladys, app, logger);
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  await gladys.connect();
  await settle();
  return { gladys, app, box, tick, logger };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, tick, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  await tick(0); // its first read
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

const lastBadge = (gladys, device) =>
  gladys.fake.transports.filter((e) => e.device_external_id === device.external_id).at(-1);

test('the channels and scenes become Gladys devices; only the channels added are read', async (t) => {
  const { gladys, box, tick } = await setup(t);
  assert.equal(box.clients.at(-1).url, BOX_URL);
  assert.equal(gladys.fake.discoveredDevices.length, DISCOVERED);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    T.connected({ destinations: OFFERED, scenes: 2 }, 30).en,
  );
  assert.equal(box.callsOf('status').length, 0, 'nothing added yet: the radio stays quiet');
  const shutter = deviceNamed(gladys, 'Wohnzimmer (Wohnbereich)');
  assert.equal(shutter.external_id, `ext:test-integration:dest:${IDS.shutter}`);

  await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  const light = await created(gladys, tick, 'Licht (Terrasse)');
  await tick(TIMINGS.flushInterval);
  assert.deepEqual(
    box.callsOf('status').map((c) => c.args[0]),
    [IDS.shutter, IDS.dimmer],
  );
  assert.equal(gladys.fake.lastState(`${shutter.external_id}:position`), 70, '30 % closed');
  assert.equal(gladys.fake.lastState(`${shutter.external_id}:cause`), 'Aucune');
  assert.equal(gladys.fake.lastState(`${light.external_id}:on`), 1);
  assert.equal(gladys.fake.lastState(`${light.external_id}:brightness`), 40);
  assert.deepEqual(lastBadge(gladys, shutter), {
    device_external_id: shutter.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });

  // The next reads, at the interval: the added channels only.
  await tick(30_000);
  assert.deepEqual(
    box.callsOf('status').map((c) => c.args[0]),
    [IDS.shutter, IDS.dimmer, IDS.shutter, IDS.dimmer],
  );
});

test('covers: open, close, stop and position become actions of their channel', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const shutter = await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  const blind = await created(gladys, tick, 'Küche (Wohnbereich)');
  let ack = await gladys.fake.setValue(shutter, featureOf(shutter, 'state'), COVER_STATE.CLOSE);
  assert.equal(ack.success, true, ack.error);
  ack = await gladys.fake.setValue(blind, featureOf(blind, 'state'), COVER_STATE.OPEN);
  assert.equal(ack.success, true, ack.error);
  ack = await gladys.fake.setValue(blind, featureOf(blind, 'state'), COVER_STATE.STOP);
  assert.equal(ack.success, true, ack.error);
  ack = await gladys.fake.setValue(shutter, featureOf(shutter, 'position'), 25);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    box.callsOf('action').map((c) => c.args[0]),
    [
      [{ destinationId: IDS.shutter, actionId: 0, parameters: { percentage: 100 } }],
      [
        { destinationId: IDS.blind, actionId: 0, parameters: { percentage: 0 } },
        { destinationId: IDS.blind, actionId: 6, parameters: { rotation: -127 } },
      ],
      [{ destinationId: IDS.blind, actionId: 16, parameters: {} }],
      [{ destinationId: IDS.shutter, actionId: 0, parameters: { percentage: 75 } }],
    ],
  );
  // Read back after the motor moved.
  await tick(TIMINGS.motorEchoes[0]);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${shutter.external_id}:position`), 25);
});

test('a switched load is read-only by default; allowed, the option is read again when it leaves', async (t) => {
  const { gladys, app, box, tick } = await setup(t);
  const heater = await created(gladys, tick, 'Heizung links (Terrasse)');
  let ack = await gladys.fake.setValue(heater, featureOf(heater, 'turn_on'), 1);
  assert.equal(ack.success, false);
  assert.equal(ack.error, T.denied.loadsOff.fr);
  assert.equal(box.callsOf('action').length, 0, 'nothing sent');

  await gladys.fake.configUpdated({ ...CONFIG, allow_load_switches: true });
  await settle();
  await gladys.fake.deviceCreated(heater);
  ack = await gladys.fake.setValue(heater, featureOf(heater, 'turn_on'), 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(box.callsOf('action').at(-1).args[0], [
    { destinationId: IDS.heater, actionId: 20, parameters: { onOffState: true } },
  ]);

  // The option turned off while a command waited for its turn.
  let release;
  box.gates.set('action', new Promise((resolve) => (release = resolve)));
  const pending = gladys.fake.setValue(heater, featureOf(heater, 'turn_off'), 1);
  await settle();
  app.config = { ...app.config, allowLoads: false };
  release();
  ack = await pending;
  assert.equal(ack.success, false);
  assert.equal(ack.error, T.denied.loadsOff.fr);
  assert.equal(box.callsOf('action').length, 1, 'refused at the moment it would leave');
});

test('a command the box refuses is reported as the box said it, with its protection, and never sent again', async (t) => {
  const { gladys, box, tick, logger } = await setup(t, {
    prepare: (b) => b.data.set(IDS.awning, { drivingCause: 3 }),
  });
  const awning = await created(gladys, tick, 'Markise (Terrasse)');
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${awning.external_id}:cause`), 'Alarme vent');
  assert.deepEqual(lastBadge(gladys, awning), {
    device_external_id: awning.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
    degraded: true,
    message: T.badge.protection(3),
  });
  box.failures.set('action', () => box.refuse(['0x30007']));
  const ack = await gladys.fake.setValue(awning, featureOf(awning, 'state'), COVER_STATE.OPEN);
  assert.equal(ack.success, false);
  assert.equal(
    ack.error,
    'La WebControl pro a refusé la commande : erreur 0x30007. Dernière cause indiquée : Alarme vent.',
  );
  await tick(60_000);
  assert.equal(box.callsOf('action').length, 1, 'never sent again by the integration');
  assert.ok(logger.lines.some((l) => l.includes('refused a command')));
});

test('sent without an answer: "sent, without confirmation", read back; never sent: "not sent"', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const light = await created(gladys, tick, 'Wandlicht (Wohnbereich)');
  box.failures.set('action', new WmsError('timeout', 'no answer within 4 s', { sent: true }));
  let ack = await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  assert.equal(ack.success, false);
  assert.equal(ack.error, T.denied.unconfirmed.fr);
  await settle();
  assert.equal(lastBadge(gladys, light).degraded, true);
  box.failures.delete('action');
  await tick(TIMINGS.lightEchoes[0]);
  assert.equal(lastBadge(gladys, light).degraded, undefined, 'read back: confirmed again');

  box.failures.set(
    'action',
    new WmsError('network', 'connection refused', { sent: false, netCode: 'ECONNREFUSED' }),
  );
  ack = await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  assert.equal(
    ack.error,
    "La WebControl pro n'a pas pu être jointe (connexion refusée) : commande non envoyée.",
  );
});

test('a command that waited past 3.5 s is refused and never leaves', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const shutter = await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  let release;
  box.gates.set('action', new Promise((resolve) => (release = resolve)));
  const first = gladys.fake.setValue(shutter, featureOf(shutter, 'state'), COVER_STATE.OPEN);
  await settle();
  const second = gladys.fake.setValue(shutter, featureOf(shutter, 'position'), 50);
  await tick(TIMINGS.setValueDeadline + 100);
  box.gates.delete('action');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.success, false, 'the first one too: its deadline passed at its socket');
  assert.equal(b.success, false);
  assert.equal(b.error, T.denied.tooLate.fr);
  assert.equal(box.callsOf('action').length, 0);
});

test('scenes are buttons; a scene makes the next read come sooner', async (t) => {
  const { gladys, box, tick } = await setup(t, { config: { ...CONFIG, poll_interval: 600 } });
  const scene = await created(gladys, tick, 'Scène WAREMA Gute Nacht (Wohnbereich)');
  await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  const before = box.callsOf('status').length;
  const ack = await gladys.fake.setValue(scene, featureOf(scene, 'run'), 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(box.callsOf('scene').at(-1).args, [IDS.sceneNight]);
  await tick(TIMINGS.motorEchoes[1]);
  assert.equal(box.callsOf('status').length, before + 1);
});

test('a 429 pauses everything, kept in /data across a restart; never read faster than the interval', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'warema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { app, box, tick, gladys } = await setup(t, {
    prepare: (b) =>
      b.failures.set('ping', new WmsError('rate', 'too many', { retryAfter: 120_000 })),
    store: new StateStore({ dir, now: () => Date.now() }),
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(gladys.fake.connectionStatus.message.fr, T.failure({ kind: 'rate' }).fr);
  const saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(saved.pausedUntil, Date.now() + 120_000);
  await tick(60_000);
  assert.equal(box.callsOf('ping').length, 1, 'nothing during the pause');

  // A restart keeps the pause.
  app.stop();
  const again = new WaremaApp({
    gladys,
    connect: box.connect,
    logger: captureLogger(),
    store: new StateStore({ dir, now: () => Date.now() }),
  });
  t.after(() => again.stop());
  await again.start(CONFIG);
  assert.equal(box.callsOf('ping').length, 1);
  box.failures.delete('ping');
  await tick(60_000);
  assert.equal(box.callsOf('ping').length, 2, 'asked again at the end of the pause');
  assert.equal(again.online, true);

  // A network failure: tried again, never sooner than the read interval.
  await again.deviceCreated(deviceNamed(gladys, 'Wohnzimmer (Wohnbereich)'));
  box.failures.set('status', new WmsError('network', 'connection reset', { sent: true }));
  await tick(30_000);
  assert.equal(again.online, false);
  const pings = box.callsOf('ping').length;
  await tick(29_000);
  assert.equal(box.callsOf('ping').length, pings);
  await tick(1000);
  assert.equal(box.callsOf('ping').length, pings + 1);
});

test('a reconnection to Gladys publishes the status and the Discovery again, and keeps a pause', async (t) => {
  const { gladys, app, box } = await setup(t);
  const published = gladys.fake.discoveredDevices.length;
  const statuses = gladys.fake.connectionStatuses.length;
  await app.resume(CONFIG);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.discoveredDevices.length, published);
  assert.equal(box.callsOf('ping').length, 1, 'the same client');

  app.store.pauseUntil(Date.now() + 120_000);
  await app.resume(CONFIG);
  assert.ok(app.paused(), 'the pause stays');
});

test('a device published again never loses a feature', async (t) => {
  const id = `ext:test-integration:dest:${IDS.shutter}`;
  const devices = [
    {
      name: 'Volet',
      external_id: id,
      features: [
        {
          name: 'Ancienne',
          external_id: `${id}:legacy`,
          category: 'shutter',
          type: 'position',
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
      ],
    },
  ];
  const { gladys, box } = await setup(t, { devices });
  box.configuration.destinations[0].names = ['Salon', '', '', ''];
  await gladys.fake.scanRequest();
  await settle();
  const again = gladys.fake.discoveredDevices.find((d) => d.external_id === id);
  assert.deepEqual(again.features.map((f) => f.external_id.split(':').at(-1)).sort(), [
    'cause',
    'legacy',
    'position',
    'state',
  ]);
  assert.equal(again.name, 'Salon (Wohnbereich)');
});

test('the badges tell a product out of radio reach, or blocked', async (t) => {
  const { gladys, box, tick } = await setup(t, {
    prepare: (b) => {
      b.data.set(IDS.shutter, { heartbeatError: true });
      b.data.set(IDS.blind, { blocking: true });
    },
  });
  const shutter = await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  const blind = await created(gladys, tick, 'Küche (Wohnbereich)');
  assert.deepEqual(lastBadge(gladys, shutter).message, T.badge.radio);
  assert.deepEqual(lastBadge(gladys, blind).message, T.badge.blocking);
  box.data.clear();
  await tick(30_000);
  assert.equal(lastBadge(gladys, shutter).degraded, undefined);
});

test('the Test button', async (t) => {
  const { gladys, box, app } = await setup(t);
  let ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(
    ack.data.message.en,
    'Connection OK: WMS WebControl pro with 9 channels (7 offered in Gladys), 2 scenes, 2 rooms.',
  );
  // Running: the Test button goes through the client of the integration (I2).
  assert.equal(box.clients.length, 1);
  assert.equal(box.clients[0].closed, false);
  box.failures.set(
    'ping',
    new WmsError('network', 'host unreachable', { sent: false, netCode: 'EHOSTUNREACH' }),
  );
  ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(ack.data.message.en, /unreachable: host unreachable/);
  assert.match(ack.data.message.fr, /injoignable : hôte injoignable/);
  assert.equal(app.online, true, 'a failed test does not stop the integration');
});

test('offline, the Test button uses a client of its own, closed before starting again', async (t) => {
  const { gladys, box, app, tick } = await setup(t, {
    prepare: (b) =>
      b.failures.set('ping', new WmsError('network', 'connection refused', { sent: false })),
  });
  assert.equal(app.online, false);
  box.failures.delete('ping');
  const before = box.clients.length;
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(ack.data.message.en, /^Connection OK/);
  const testClient = box.clients[before];
  assert.equal(testClient.closed, true, 'closed');
  await tick(0);
  assert.equal(app.online, true, 'started again');
  assert.ok(box.clients.length > before + 1);
  assert.ok(box.clients.at(-1) !== testClient);
});

test('a pause set by the Test button holds the reconnection back (I3)', async (t) => {
  const { gladys, box, app, tick } = await setup(t, {
    prepare: (b) =>
      b.failures.set('ping', new WmsError('network', 'connection refused', { sent: false })),
  });
  box.failures.delete('ping');
  box.failures.set(
    'configuration',
    new WmsError('server', 'HTTP 503', { status: 503, sent: true }),
  );
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(ack.data.message.fr, /erreur \(HTTP 503\)/);
  const left = app.store.pausedUntil - Date.now();
  assert.ok(left >= 60_000);
  const pings = box.callsOf('ping').length;
  await tick(30_000); // the reconnection delay (read interval) falls inside the pause
  assert.equal(box.callsOf('ping').length, pings, 'nothing asked during the pause');
  box.failures.delete('configuration');
  await tick(left - 30_000);
  assert.equal(box.callsOf('ping').length, pings + 1, 'asked again at its end');
});

test('a STOP skips the chain of its channel, and the moves still waiting are dropped (B1)', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const awning = await created(gladys, tick, 'Markise (Terrasse)');
  let release;
  const held = new Promise((resolve) => (release = resolve));
  // Hold the moves only (they wait at the box, not yet sent).
  box.gates.set('action', ([actions]) => (actions[0].actionId === 16 ? undefined : held));
  const close = gladys.fake.setValue(awning, featureOf(awning, 'state'), COVER_STATE.CLOSE);
  const position = gladys.fake.setValue(awning, featureOf(awning, 'position'), 50);
  await settle();
  const stop = await gladys.fake.setValue(awning, featureOf(awning, 'state'), COVER_STATE.STOP);
  assert.equal(stop.success, true, stop.error);
  release();
  const [a, b] = await Promise.all([close, position]);
  assert.equal(a.error, T.denied.stopped.fr);
  assert.equal(b.error, T.denied.stopped.fr);
  const sent = box.callsOf('action');
  assert.equal(sent.length, 1, 'only the STOP left');
  assert.equal(sent[0].stop, true);
  assert.equal(sent[0].instant, true, 'a STOP is Instant (its effect shows at the read back)');
});

test('moves and STOPs are sent Instant; lights and loads Detailed (I1)', async (t) => {
  const { gladys, box, tick } = await setup(t, {
    config: { ...CONFIG, allow_load_switches: true },
  });
  const shutter = await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  const light = await created(gladys, tick, 'Wandlicht (Wohnbereich)');
  const heater = await created(gladys, tick, 'Heizung links (Terrasse)');
  await gladys.fake.setValue(shutter, featureOf(shutter, 'position'), 20);
  await gladys.fake.setValue(shutter, featureOf(shutter, 'state'), COVER_STATE.STOP);
  await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  await gladys.fake.setValue(heater, featureOf(heater, 'turn_on'), 1);
  assert.deepEqual(
    box.callsOf('action').map((c) => c.instant),
    [true, true, false, false],
  );
});

test('a 429 on a command is "refused by the box (HTTP 429)" (M1)', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const light = await created(gladys, tick, 'Wandlicht (Wohnbereich)');
  box.failures.set(
    'action',
    new WmsError('rate', 'too many requests (HTTP 429)', { status: 429, sent: true }),
  );
  const ack = await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  assert.equal(ack.error, 'La WebControl pro a refusé la commande : trop de demandes (HTTP 429).');
});

test('one read back at most per channel and per due time (M3)', async (t) => {
  const { gladys, box, tick } = await setup(t, { config: { ...CONFIG, poll_interval: 600 } });
  const light = await created(gladys, tick, 'Wandlicht (Wohnbereich)');
  const before = box.callsOf('status').length;
  await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  await gladys.fake.setValue(light, featureOf(light, 'on'), 0);
  await tick(TIMINGS.lightEchoes[0]);
  assert.equal(box.callsOf('status').length, before + 1);
});

test('an invalid address is said in the status, nothing is sent', async (t) => {
  const { gladys, box } = await setup(t, { config: { box_address: 'webcontrol.local' } });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(gladys.fake.connectionStatus.message.en, T.configError('local-name').en);
  assert.equal(box.calls.length, 0);
});

test('read backs due within 500 ms of each other are merged', async (t) => {
  const { gladys, box, tick } = await setup(t, { config: { ...CONFIG, poll_interval: 600 } });
  const light = await created(gladys, tick, 'Wandlicht (Wohnbereich)');
  const before = box.callsOf('status').length;
  await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  await tick(100);
  await gladys.fake.setValue(light, featureOf(light, 'on'), 0);
  await tick(TIMINGS.lightEchoes[0] + 500);
  assert.equal(box.callsOf('status').length, before + 1);
});

test('a periodic reload of the configuration that fails keeps the inventory and the connection', async (t) => {
  const { gladys, box, app, tick } = await setup(t);
  await created(gladys, tick, 'Wohnzimmer (Wohnbereich)');
  const devices = gladys.fake.discoveredDevices.length;
  box.failures.set('configuration', new WmsError('format', 'not an answer', { sent: true }));
  app.inventoryAt = -Infinity;
  await tick(30_000);
  assert.equal(app.online, true, 'still connected');
  assert.equal(app.model.counts.offered, OFFERED, 'the inventory known is kept');
  assert.equal(gladys.fake.discoveredDevices.length, devices);
  const configs = box.callsOf('configuration').length;
  await tick(30_000);
  assert.equal(box.callsOf('configuration').length, configs + 1, 'tried again at the next read');
});

test('when connecting, getConfiguration has 5 s (no command can wait behind it)', async (t) => {
  const { box } = await setup(t);
  assert.deepEqual(
    box.callsOf('configuration').map((c) => [c.timeout, c.long]),
    [[TIMINGS.openTimeout, true]],
  );
});

test('the Test button offline waits for a connection under way: never two at once', async (t) => {
  const { gladys, box, app, tick } = await setup(t, {
    prepare: (b) =>
      b.failures.set('ping', new WmsError('network', 'connection refused', { sent: false })),
  });
  box.failures.delete('ping');
  let release;
  box.gates.set('ping', new Promise((resolve) => (release = resolve)));
  await tick(30_000); // the planned reconnection starts, its ping held
  assert.ok(app.opening, 'a connection is under way');
  const clients = box.clients.length;
  const pending = gladys.fake.action(ACTIONS.TEST, {});
  await settle();
  box.gates.delete('ping');
  release();
  const ack = await pending;
  await tick(0);
  assert.match(ack.data.message.en, /^Connection OK/);
  assert.equal(box.clients.length, clients, 'no client of its own: the one just connected');
  assert.equal(app.online, true);
  assert.equal(box.callsOf('ping').length, 3, 'the first try, the reconnection, the test');
});
