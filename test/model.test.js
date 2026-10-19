import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES as C } from '@gladysassistant/integration-sdk';
import {
  COVER_STATE,
  buildModel,
  inventoryOf,
  numberIn,
  positionOf,
  rotationOf,
  statusOf,
  tiltPercentOf,
  valuesOf,
} from '../src/model.js';
import * as F from './helpers/fixtures.js';

const idsOf = (type, id) => {
  const device = `ext:test:${type}:${id}`;
  return { device, feature: (key) => `${device}:${key}` };
};
const model = (options) => buildModel(idsOf, inventoryOf(F.configuration()), options);
const deviceOf = (m, id) => m.devices.find((d) => d.external_id === id);

test('each kind of channel becomes the right Gladys device; covers are never switches', () => {
  const m = model();
  assert.equal(m.counts.offered, F.OFFERED);
  assert.equal(m.devices.length, F.DISCOVERED);
  const cat = (id) => [...new Set(deviceOf(m, id).features.map((f) => f.category))];
  assert.deepEqual(cat(`ext:test:dest:${F.IDS.shutter}`), [C.SHUTTER, C.TEXT]);
  assert.deepEqual(cat(`ext:test:dest:${F.IDS.blind}`), [C.SHUTTER, C.TEXT]);
  assert.deepEqual(cat(`ext:test:dest:${F.IDS.awning}`), [C.CURTAIN, C.TEXT]);
  assert.deepEqual(cat(`ext:test:valance:${F.IDS.awning}`), [C.CURTAIN]);
  assert.deepEqual(cat(`ext:test:dest:${F.IDS.roof}`), [C.SHUTTER, C.TEXT]);
  assert.deepEqual(cat(`ext:test:dest:${F.IDS.dimmer}`), [C.LIGHT]);
  assert.deepEqual(cat(`ext:test:dest:${F.IDS.light}`), [C.LIGHT]);
  // A switched load: a read-only state and two buttons, never a switch.
  const heater = deviceOf(m, `ext:test:dest:${F.IDS.heater}`);
  assert.deepEqual(
    heater.features.map((f) => [f.external_id.split(':').pop(), f.category, f.type, f.read_only]),
    [
      ['state', C.UNKNOWN, 'binary', true],
      ['turn_on', C.BUTTON, 'push', false],
      ['turn_off', C.BUTTON, 'push', false],
    ],
  );
  for (const device of m.devices) {
    for (const f of device.features) {
      assert.notEqual(f.category, C.SWITCH, `${device.name}: ${f.external_id}`);
    }
  }
  assert.equal(deviceOf(m, `ext:test:dest:${F.IDS.window}`), undefined, 'windows are not offered');
  assert.equal(
    deviceOf(m, `ext:test:dest:${F.IDS.relay}`),
    undefined,
    'nor potential-free actuators',
  );
  assert.equal(deviceOf(m, `ext:test:slats:${F.IDS.blind}`), undefined, 'slats off by default');
  assert.ok(deviceOf(model({ publishTilt: true }), `ext:test:slats:${F.IDS.blind}`));
  assert.equal(deviceOf(m, `ext:test:dest:${F.IDS.shutter}`).name, 'Wohnzimmer (Wohnbereich)');
  assert.equal(
    deviceOf(m, `ext:test:scene:${F.IDS.sceneOn}`).name,
    'Scène WAREMA Licht an (Terrasse)',
  );
  assert.equal(
    deviceOf(model({ language: 'en' }), `ext:test:valance:${F.IDS.awning}`).name,
    'Markise (Terrasse) – Valance',
  );
});

test('the writes: position, open, close and stop of each cover', () => {
  const m = model({ publishTilt: true });
  const write = (id, value) => m.writers.get(id).write(value);
  const shutter = `ext:test:dest:${F.IDS.shutter}`;
  // Moves are flagged `move` (sent Instant), the STOP `stop` (head of the queue).
  assert.deepEqual(write(`${shutter}:state`, COVER_STATE.OPEN), {
    actions: [{ actionId: 0, parameters: { percentage: 0 } }],
    move: true,
  });
  assert.deepEqual(write(`${shutter}:state`, COVER_STATE.CLOSE), {
    actions: [{ actionId: 0, parameters: { percentage: 100 } }],
    move: true,
  });
  assert.deepEqual(write(`${shutter}:state`, COVER_STATE.STOP), {
    actions: [{ actionId: 16, parameters: {} }],
    stop: true,
  });
  assert.deepEqual(write(`${shutter}:position`, 70), {
    actions: [{ actionId: 0, parameters: { percentage: 30 } }],
    move: true,
  });
  // A venetian blind fully opened or closed moves its slats too.
  const blind = `ext:test:dest:${F.IDS.blind}`;
  assert.deepEqual(write(`${blind}:state`, COVER_STATE.OPEN), {
    actions: [
      { actionId: 0, parameters: { percentage: 0 } },
      { actionId: 6, parameters: { rotation: -127 } },
    ],
    move: true,
  });
  assert.deepEqual(write(`${blind}:position`, 0), {
    actions: [
      { actionId: 0, parameters: { percentage: 100 } },
      { actionId: 6, parameters: { rotation: 127 } },
    ],
    move: true,
  });
  assert.deepEqual(write(`${blind}:position`, 40), {
    actions: [{ actionId: 0, parameters: { percentage: 60 } }],
    move: true,
  });
  assert.deepEqual(write(`ext:test:slats:${F.IDS.blind}:tilt`, 50), {
    actions: [{ actionId: 6, parameters: { rotation: 0 } }],
    move: true,
  });
  assert.deepEqual(write(`ext:test:valance:${F.IDS.awning}:position`, 100), {
    actions: [{ actionId: 2, parameters: { percentage: 0 } }],
    move: true,
  });
  // A slat roof is read-only in v1: no command at all.
  const roof = `ext:test:dest:${F.IDS.roof}`;
  assert.equal([...m.writers.keys()].filter((k) => k.startsWith(`${roof}:`)).length, 0);
  assert.deepEqual(
    deviceOf(m, roof).features.map((f) => [f.external_id.split(':').pop(), f.read_only]),
    [
      ['position', true],
      ['cause', true],
    ],
  );
  assert.ok(!m.motors.has(F.IDS.roof));
  for (const bad of [null, '', ' ', true, 101, -1, 'abc', undefined]) {
    assert.throws(() => write(`${shutter}:position`, bad), { refusal: 'badValue' });
  }
  for (const bad of [null, '', true, 2, 0.5, 'abc', undefined]) {
    assert.throws(() => write(`${shutter}:state`, bad), { refusal: 'badValue' });
  }
  assert.equal(numberIn('0', 0, 1), 0);
});

test('the writes of lights and loads', () => {
  const m = model();
  const write = (id, value) => m.writers.get(id).write(value);
  const dimmer = `ext:test:dest:${F.IDS.dimmer}`;
  assert.deepEqual(write(`${dimmer}:on`, 1), {
    actions: [{ actionId: 20, parameters: { onOffState: true } }],
  });
  assert.deepEqual(write(`${dimmer}:brightness`, 55.4), {
    actions: [{ actionId: 0, parameters: { percentage: 55 } }],
  });
  const heater = `ext:test:dest:${F.IDS.heater}`;
  assert.equal(m.writers.get(`${heater}:turn_on`).safety, 'load');
  assert.deepEqual(write(`${heater}:turn_off`, 1), {
    actions: [{ actionId: 20, parameters: { onOffState: false } }],
  });
  assert.throws(() => write(`${heater}:turn_on`, 0), { refusal: 'badValue' });
  assert.equal(m.writers.get(`${heater}:state`), undefined, 'the state is read-only');
  assert.deepEqual(write(`ext:test:scene:${F.IDS.sceneNight}:run`, 1), { scene: F.IDS.sceneNight });
});

test('the reads, and a status that does not tell a value', () => {
  const m = model({ publishTilt: true });
  const status = statusOf(
    F.statusAnswer(F.IDS.blind, F.productValues().get(F.IDS.blind), { drivingCause: 3 }),
    F.IDS.blind,
  );
  const values = Object.fromEntries(
    valuesOf(m, F.IDS.blind, status).map(({ featureId, value }) => [
      featureId.split(':').slice(2).join(':'),
      value,
    ]),
  );
  assert.deepEqual(values, {
    [`dest:${F.IDS.blind}:position`]: { state: 0 },
    [`dest:${F.IDS.blind}:cause`]: { text: 'Alarme vent' },
    [`slats:${F.IDS.blind}:tilt`]: { state: 50 },
  });
  // Out of range (127.5 in the WAREMA documentation): unknown, never sent.
  const unknown = statusOf(
    F.statusAnswer(F.IDS.shutter, new Map([[0, { percentage: 127.5 }]])),
    F.IDS.shutter,
  );
  assert.deepEqual(
    valuesOf(m, F.IDS.shutter, unknown).map((v) => v.value),
    [{ text: 'Aucune' }],
  );
  assert.equal(statusOf({ details: [] }, 1), undefined);
  assert.equal(statusOf(F.statusAnswer(2, new Map()), 1), undefined, 'another channel');
  assert.equal(positionOf(30), 70);
  assert.equal(tiltPercentOf(-127, { min: -127, max: 127 }), 100);
  assert.equal(rotationOf(0, { min: -127, max: 127 }), 127);
});

test('external ids follow the ids of the box, never a name', () => {
  const config = F.configuration();
  config.destinations[0].names = ['Renamed', '', '', ''];
  const renamed = buildModel(idsOf, inventoryOf(config));
  assert.deepEqual(
    renamed.devices.map((d) => d.external_id),
    model().devices.map((d) => d.external_id),
  );
});

test('hostile answers: bounded lists, plain data, no pollution', () => {
  const json = JSON.parse(
    `{"destinations":[{"id":1,"names":["\\u0000Evil\\u0007"],"animationType":2,"actions":[{"id":0,"actionType":0,"actionDescription":4},{"__proto__":{"x":1}}]},{"id":-3},{"id":"2"},null],"rooms":[{"id":5,"name":"R","destinations":[1,"x",-1]}],"scenes":[{"id":9,"names":[]}],"__proto__":{"polluted":true}}`,
  );
  const inventory = inventoryOf(json);
  assert.equal(inventory.destinations.length, 1);
  assert.equal(inventory.destinations[0].name, 'Evil');
  assert.equal(inventory.destinations[0].actions.length, 1);
  assert.deepEqual([...inventory.rooms[0].destinations], [1]);
  assert.equal({}.polluted, undefined);
  assert.equal({}.x, undefined);
  const many = { destinations: Array.from({ length: 5000 }, (_, i) => ({ id: i, actions: [] })) };
  assert.equal(inventoryOf(many).destinations.length, 1000);
});
