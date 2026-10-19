// -----------------------------------------------------------------------------
// The answers of the WebControl pro -> Gladys devices and routing tables (pure).
//
// Ported from pywmspro (destination.py, action.py, scene.py, room.py;
// Apache-2.0) and the entity choices of its Home Assistant integration
// `wmspro` (cover, light, switch, scene; Apache-2.0). What a destination
// becomes depends on its actions (actionDescription + actionType):
//   awning drive (percentage)          curtain: open/close/stop, position;
//                                      its valance drive as a second curtain
//   roller shutter drive (percentage)  shutter: open/close/stop, position
//   slat drive (percentage)            shutter (venetian blind); its slat
//                                      rotation as its own device on request
//   slat rotation alone (slat roof)    shutter: open/close/stop, position of
//                                      the slats
//   light dimming (percentage)         light: on/off and brightness
//   light switch                       light: on/off
//   load switch                        a read-only state and "Turn on" /
//                                      "Turn off" buttons, refused unless
//                                      allowed (a patio heater is often one)
//   scene                              button "Run"
// Window drives, potential-free actuators (enumeration), load dimmers,
// toggles and impulses are not offered.
//
// Blinds are never `switch`/`binary`. The last driving cause of a cover
// (sun, wind, rain, ice, manual...) is a read-only text: the protections of
// the box are shown, never overridden.
//
// External ids (frozen: never change one):
//   destination  ext:<selector>:dest:<destination id>
//   slats        ext:<selector>:slats:<destination id>
//   valance      ext:<selector>:valance:<destination id>
//   scene        ext:<selector>:scene:<scene id>
//   feature      <device>:<key>
// Ids that come from the network are only used as Map keys, never as keys
// of plain objects.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { ACTION_DESC, ACTION_TYPE, ANIMATION, LIMITS, ROTATION } from './constants.js';
import { causeText, label } from './i18n.js';

/** Gladys COVER_STATE values (shutter and curtain `state`). */
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

/** Gladys BUTTON_PUSH.PRESSED: the one value of a `button/push` command. */
export const PRESSED = 1;

// --- Answers -> plain records (only known keys are copied) ----------------------

const isId = (v) => Number.isSafeInteger(v) && v >= 0;
const isInt = (v) => Number.isSafeInteger(v);
const text = (v) =>
  typeof v === 'string'
    ? [...v.slice(0, LIMITS.name * 2)]
        .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
        .join('')
        .trim()
        .slice(0, LIMITS.name)
    : '';
const firstName = (names) => {
  for (const name of Array.isArray(names) ? names.slice(0, 4) : []) {
    const t = text(name);
    if (t) {
      return t;
    }
  }
  return '';
};
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** An action of a destination of getConfiguration. */
function actionOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  if (!isInt(raw.actionType) || !isInt(raw.actionDescription)) {
    return undefined;
  }
  return {
    id: raw.id,
    type: raw.actionType,
    description: raw.actionDescription,
    min: finite(raw.minValue),
    max: finite(raw.maxValue),
  };
}

/** A destination (channel) of getConfiguration, or undefined when not usable. */
export function destinationOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  const actions = (Array.isArray(raw.actions) ? raw.actions.slice(0, LIMITS.actions) : [])
    .map(actionOf)
    .filter(Boolean);
  return {
    id: raw.id,
    name: firstName(raw.names),
    animation: isInt(raw.animationType) ? raw.animationType : ANIMATION.UNKNOWN,
    actions,
  };
}

/** A scene of getConfiguration. */
export function sceneOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  return { id: raw.id, name: firstName(raw.names) };
}

/** A room of getConfiguration: its name, and the ids of its destinations and scenes. */
export function roomOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  const ids = (list) =>
    new Set((Array.isArray(list) ? list.slice(0, LIMITS.devices) : []).filter(isId));
  return {
    id: raw.id,
    name: text(raw.name),
    destinations: ids(raw.destinations),
    scenes: ids(raw.scenes),
  };
}

/** The whole configuration: { destinations, scenes, rooms } of records. */
export function inventoryOf(json) {
  const list = (value) => (Array.isArray(value) ? value.slice(0, LIMITS.devices) : []);
  return {
    destinations: list(json?.destinations).map(destinationOf).filter(Boolean),
    scenes: list(json?.scenes).map(sceneOf).filter(Boolean),
    rooms: list(json?.rooms).map(roomOf).filter(Boolean),
  };
}

/**
 * The status of one destination from getStatus:
 * { cause, heartbeatError, blocking, values: Map<actionId, { percentage?, rotation?, on? }> },
 * or undefined when the answer says nothing of it.
 */
export function statusOf(json, destinationId) {
  const details = Array.isArray(json?.details) ? json.details.slice(0, LIMITS.actions) : [];
  const detail = details.find((d) => d?.destinationId === destinationId && d?.data);
  const data = detail?.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const values = new Map();
  for (const product of Array.isArray(data.productData)
    ? data.productData.slice(0, LIMITS.actions)
    : []) {
    const value = product?.value;
    if (!isId(product?.actionId) || !value || typeof value !== 'object') {
      continue;
    }
    const entry = {};
    const percentage = finite(value.percentage);
    // Only a real position: the box may answer out of range (127.5 in the
    // WAREMA documentation) for a position it does not know.
    if (percentage !== undefined && percentage >= 0 && percentage <= 100) {
      entry.percentage = percentage;
    }
    const rotation = finite(value.rotation);
    if (rotation !== undefined && rotation >= ROTATION.min && rotation <= ROTATION.max) {
      entry.rotation = rotation;
    }
    if (typeof value.onOffState === 'boolean') {
      entry.on = value.onOffState;
    }
    values.set(product.actionId, entry);
  }
  return {
    cause: isInt(data.drivingCause) ? data.drivingCause : undefined,
    heartbeatError: data.heartbeatError === true,
    blocking: data.blocking === true,
    values,
  };
}

// --- What each destination becomes ----------------------------------------------

const findAction = (dest, description, type) =>
  dest.actions.find(
    (a) => a.description === description && (type === undefined || a.type === type),
  );

/**
 * The role of a destination and the actions it uses, or undefined when it is
 * not offered.
 */
export function roleOf(dest) {
  const pct = ACTION_TYPE.PERCENTAGE;
  const stop = findAction(dest, ACTION_DESC.MANUAL_COMMAND, ACTION_TYPE.STOP);
  const rotate = findAction(dest, ACTION_DESC.SLAT_ROTATE, ACTION_TYPE.ROTATION);
  const awning = findAction(dest, ACTION_DESC.AWNING_DRIVE, pct);
  if (awning) {
    return {
      role: 'awning',
      drive: awning,
      valance: findAction(dest, ACTION_DESC.VALANCE_DRIVE, pct),
      stop,
    };
  }
  const roller = findAction(dest, ACTION_DESC.ROLLER_SHUTTER_DRIVE, pct);
  if (roller) {
    return { role: 'shutter', drive: roller, stop };
  }
  const slat = findAction(dest, ACTION_DESC.SLAT_DRIVE, pct);
  if (slat) {
    return { role: 'blind', drive: slat, rotate, stop };
  }
  if (rotate) {
    return { role: 'slatRoof', rotate, stop };
  }
  const dimming = findAction(dest, ACTION_DESC.LIGHT_DIMMING, pct);
  const lightSwitch = findAction(dest, ACTION_DESC.LIGHT_SWITCH, ACTION_TYPE.SWITCH);
  if (dimming) {
    return { role: 'dimmer', dimming, lightSwitch };
  }
  if (lightSwitch) {
    return { role: 'light', lightSwitch };
  }
  const load = findAction(dest, ACTION_DESC.LOAD_SWITCH, ACTION_TYPE.SWITCH);
  if (load) {
    return { role: 'load', load };
  }
  return undefined;
}

/** The rotation range of a slat action (the configuration, -127..127 by default). */
function rangeOf(rotate) {
  let min = rotate.min ?? -127;
  let max = rotate.max ?? 127;
  min = Math.max(ROTATION.min, Math.min(ROTATION.max, min));
  max = Math.max(ROTATION.min, Math.min(ROTATION.max, max));
  return min < max ? { min, max } : { min: -127, max: 127 };
}

/** WAREMA percentage (0 open .. 100 closed) -> Gladys position (0 closed .. 100 open). */
export const positionOf = (percentage) => Math.round(100 - percentage);
/** Gladys position -> WAREMA percentage. */
export const percentageOf = (position) => 100 - Math.round(position);
/** Rotation -> percent of opening: the minimum is open (100 %), the maximum closed (0 %). */
export const tiltPercentOf = (rotation, { min, max }) =>
  Math.max(0, Math.min(100, Math.round(((max - rotation) / (max - min)) * 100)));
/** Percent of opening -> rotation. */
export const rotationOf = (percent, { min, max }) =>
  Math.round(max - (percent / 100) * (max - min));

/** A value of a command: a finite number, never null nor '' (they are not 0). */
export function numberIn(value, min, max) {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  if (value === null || value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

const refuse = (refusal) => {
  const err = new Error(refusal);
  err.refusal = refusal;
  throw err;
};

const act = (action, parameters) => ({ actionId: action.id, parameters });

const feature = (key, language, category, type, { min = 0, max = 1, write, read, feedback }) => ({
  key,
  name: label(key, language),
  category,
  type,
  min,
  max,
  read_only: !write,
  has_feedback: feedback ?? Boolean(write && read),
  keep_history: true,
  write,
  read,
});

/** The features of a cover moved by a percentage drive (+ optional slats on open/close). */
function coverFeatures(category, language, { drive, rotate, stop }) {
  const range = rotate ? rangeOf(rotate) : undefined;
  const open = () =>
    rotate
      ? [act(drive, { percentage: 0 }), act(rotate, { rotation: range.min })]
      : [act(drive, { percentage: 0 })];
  const close = () =>
    rotate
      ? [act(drive, { percentage: 100 }), act(rotate, { rotation: range.max })]
      : [act(drive, { percentage: 100 })];
  return [
    feature('state', language, category, T.SHUTTER.STATE, {
      min: -1,
      max: 1,
      write(value) {
        const v = numberIn(value, -1, 1);
        if (v === COVER_STATE.OPEN) {
          return { actions: open() };
        }
        if (v === COVER_STATE.CLOSE) {
          return { actions: close() };
        }
        if (v === COVER_STATE.STOP) {
          return stop ? { actions: [act(stop, {})] } : refuse('noStop');
        }
        return refuse('badValue');
      },
      feedback: false,
    }),
    feature('position', language, category, T.SHUTTER.POSITION, {
      max: 100,
      write(value) {
        const v = numberIn(value, 0, 100);
        if (v === undefined) {
          refuse('badValue');
        }
        // Fully open or closed: the slats too, as the WAREMA app does.
        if (rotate && Math.round(v) === 100) {
          return { actions: open() };
        }
        if (rotate && Math.round(v) === 0) {
          return { actions: close() };
        }
        return { actions: [act(drive, { percentage: percentageOf(v) })] };
      },
      read(status) {
        const p = status.values.get(drive.id)?.percentage;
        return p === undefined ? undefined : { state: positionOf(p) };
      },
    }),
  ];
}

/** The features of the slats of a blind or a slat roof (a position of the slats). */
function slatFeatures(language, { rotate, stop }, { withState }) {
  const range = rangeOf(rotate);
  const position = feature(
    withState ? 'position' : 'tilt',
    language,
    C.SHUTTER,
    T.SHUTTER.POSITION,
    {
      max: 100,
      write(value) {
        const v = numberIn(value, 0, 100);
        if (v === undefined) {
          refuse('badValue');
        }
        return { actions: [act(rotate, { rotation: rotationOf(v, range) })] };
      },
      read(status) {
        const r = status.values.get(rotate.id)?.rotation;
        return r === undefined ? undefined : { state: tiltPercentOf(r, range) };
      },
    },
  );
  if (!withState) {
    return [position];
  }
  return [
    feature('state', language, C.SHUTTER, T.SHUTTER.STATE, {
      min: -1,
      max: 1,
      write(value) {
        const v = numberIn(value, -1, 1);
        if (v === COVER_STATE.OPEN) {
          return { actions: [act(rotate, { rotation: range.min })] };
        }
        if (v === COVER_STATE.CLOSE) {
          return { actions: [act(rotate, { rotation: range.max })] };
        }
        if (v === COVER_STATE.STOP) {
          return stop ? { actions: [act(stop, {})] } : refuse('noStop');
        }
        return refuse('badValue');
      },
      feedback: false,
    }),
    position,
  ];
}

/** The last driving cause, as a read-only text in the language of the features. */
const causeFeature = (language) =>
  feature('cause', language, C.TEXT, T.TEXT.TEXT, {
    min: 0,
    max: 0,
    read: (status) =>
      status.cause === undefined ? undefined : { text: causeText(status.cause, language) },
    feedback: false,
  });

function lightFeatures(language, { dimming, lightSwitch }) {
  const on = feature('on', language, C.LIGHT, T.LIGHT.BINARY, {
    write(value) {
      const v = numberIn(value, 0, 1);
      if (v !== 0 && v !== 1) {
        refuse('badValue');
      }
      // The switch action when there is one (pywmspro / Home Assistant), so
      // the dimmer keeps its last brightness; the dimming action otherwise.
      return {
        actions: [
          lightSwitch
            ? act(lightSwitch, { onOffState: v === 1 })
            : act(dimming, { percentage: v === 1 ? 100 : 0 }),
        ],
      };
    },
    read(status) {
      if (lightSwitch) {
        const state = status.values.get(lightSwitch.id)?.on;
        return state === undefined ? undefined : { state: state ? 1 : 0 };
      }
      const p = status.values.get(dimming.id)?.percentage;
      return p === undefined ? undefined : { state: p > 0 ? 1 : 0 };
    },
  });
  if (!dimming) {
    return [on];
  }
  return [
    on,
    feature('brightness', language, C.LIGHT, T.LIGHT.BRIGHTNESS, {
      max: 100,
      write(value) {
        const v = numberIn(value, 0, 100);
        if (v === undefined) {
          refuse('badValue');
        }
        return { actions: [act(dimming, { percentage: Math.round(v) })] };
      },
      read(status) {
        const p = status.values.get(dimming.id)?.percentage;
        return p === undefined ? undefined : { state: Math.round(p) };
      },
    }),
  ];
}

function loadFeatures(language, { load }) {
  const push = (key, on) =>
    feature(key, language, C.BUTTON, T.BUTTON.PUSH, {
      min: PRESSED,
      max: PRESSED,
      write(value) {
        if (numberIn(value, PRESSED, PRESSED) !== PRESSED) {
          refuse('badValue');
        }
        return { actions: [act(load, { onOffState: on })] };
      },
      feedback: false,
    });
  return [
    // Never a switch: an "everything on/off" must not start a heater.
    feature('state', language, C.UNKNOWN, T.SENSOR.BINARY, {
      read(status) {
        const state = status.values.get(load.id)?.on;
        return state === undefined ? undefined : { state: state ? 1 : 0 };
      },
    }),
    push('turn_on', true),
    push('turn_off', false),
  ];
}

const withRoom = (name, room) => (room && !name.includes(room) ? `${name} (${room})` : name);

const params = (list) =>
  list
    .filter((p) => p.value !== undefined && p.value !== null && String(p.value) !== '')
    .map((p) => ({ name: p.name, value: String(p.value).slice(0, 255) }));

const ANIMATION_NAMES = new Map([
  [ANIMATION.VENETIAN_BLIND, 'venetian-blind'],
  [ANIMATION.AWNING, 'awning'],
  [ANIMATION.ROLLER_SHUTTER, 'roller-shutter'],
  [ANIMATION.SLAT_ROOF, 'slat-roof'],
  [ANIMATION.WINDOW, 'window'],
  [ANIMATION.SWITCH, 'switch'],
  [ANIMATION.DIMMER, 'dimmer'],
]);

const strip = ({ key, write: _w, read: _r, ...rest }, ids) => ({
  ...rest,
  external_id: ids.feature(key),
});

export function emptyModel() {
  return {
    devices: [],
    /** destination id -> [{ featureId, read }] */
    readers: new Map(),
    /** feature id -> { write, destinationId?, sceneId?, role, safety? } */
    writers: new Map(),
    /** destination id -> [Gladys device ids] */
    destDevices: new Map(),
    /** Gladys device id -> destination id */
    deviceDests: new Map(),
    /** destination ids of motors (read back longer after a command) */
    motors: new Set(),
    counts: { destinations: 0, offered: 0, skipped: 0, scenes: 0, overflow: 0 },
  };
}

/**
 * @param {(type: string, id: string) => { device: string, feature: (key: string) => string }} idsOf
 *   gladys.externalIds
 * @param {{ destinations: object[], scenes: object[], rooms: object[] }} inventory records of inventoryOf
 * @param {{ language?: 'fr'|'en', publishTilt?: boolean }} [options]
 */
export function buildModel(idsOf, inventory, { language = 'fr', publishTilt = false } = {}) {
  const model = emptyModel();
  /** destination id / scene id -> room name */
  const destRooms = new Map();
  const sceneRooms = new Map();
  for (const room of inventory.rooms ?? []) {
    for (const id of room.destinations) {
      if (!destRooms.has(id) && room.name) {
        destRooms.set(id, room.name);
      }
    }
    for (const id of room.scenes) {
      if (!sceneRooms.has(id) && room.name) {
        sceneRooms.set(id, room.name);
      }
    }
  }
  const full = () => {
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      return true;
    }
    return false;
  };
  const add = (destId, ids, device, features) => {
    model.devices.push({ ...device, features: features.map((f) => strip(f, ids)) });
    if (!model.destDevices.has(destId)) {
      model.destDevices.set(destId, []);
    }
    model.destDevices.get(destId).push(ids.device);
    model.deviceDests.set(ids.device, destId);
    const readers = model.readers.get(destId) ?? [];
    for (const f of features) {
      if (f.read) {
        readers.push({ featureId: ids.feature(f.key), read: f.read });
      }
    }
    model.readers.set(destId, readers);
  };

  const seen = new Set();
  for (const dest of inventory.destinations ?? []) {
    model.counts.destinations += 1;
    const found = roleOf(dest);
    if (!found || seen.has(dest.id)) {
      model.counts.skipped += 1;
      continue;
    }
    seen.add(dest.id);
    if (full()) {
      continue;
    }
    const { role } = found;
    const room = destRooms.get(dest.id);
    const name = withRoom(dest.name || `WAREMA ${dest.id}`, room).slice(0, 100);
    const base = {
      should_poll: false,
      params: params([
        { name: 'WAREMA_DESTINATION_ID', value: dest.id },
        { name: 'WAREMA_TYPE', value: ANIMATION_NAMES.get(dest.animation) ?? 'unknown' },
        { name: 'WAREMA_ROOM', value: room },
      ]),
    };
    let features;
    switch (role) {
      case 'awning':
        features = [...coverFeatures(C.CURTAIN, language, found), causeFeature(language)];
        break;
      case 'shutter':
        features = [...coverFeatures(C.SHUTTER, language, found), causeFeature(language)];
        break;
      case 'blind':
        features = [...coverFeatures(C.SHUTTER, language, found), causeFeature(language)];
        break;
      case 'slatRoof':
        features = [...slatFeatures(language, found, { withState: true }), causeFeature(language)];
        break;
      case 'dimmer':
      case 'light':
        features = lightFeatures(language, found);
        break;
      default:
        features = loadFeatures(language, found);
    }
    const ids = idsOf('dest', String(dest.id));
    add(dest.id, ids, { name, external_id: ids.device, ...base }, features);
    model.counts.offered += 1;
    const cover = ['awning', 'shutter', 'blind', 'slatRoof'].includes(role);
    if (cover) {
      model.motors.add(dest.id);
    }
    const writer = (f, deviceRole) => ({
      write: f.write,
      destinationId: dest.id,
      role: deviceRole,
      safety: role === 'load' && f.category === C.BUTTON ? 'load' : undefined,
    });
    for (const f of features.filter((x) => x.write)) {
      model.writers.set(ids.feature(f.key), writer(f, role));
    }

    if (role === 'awning' && found.valance && !full()) {
      // The valance (the front blind of an awning) as its own curtain.
      const vIds = idsOf('valance', String(dest.id));
      const vFeatures = coverFeatures(C.CURTAIN, language, {
        drive: found.valance,
        stop: found.stop,
      });
      add(
        dest.id,
        vIds,
        {
          name: `${name} – ${label('valance', language)}`.slice(0, 100),
          external_id: vIds.device,
          ...base,
        },
        vFeatures,
      );
      for (const f of vFeatures.filter((x) => x.write)) {
        model.writers.set(vIds.feature(f.key), writer(f, 'valance'));
      }
    }
    if (role === 'blind' && found.rotate && publishTilt && !full()) {
      // The slats as their own device: a "close all blinds" of a voice
      // assistant may target it too, so it is published on request only.
      const sIds = idsOf('slats', String(dest.id));
      const sFeatures = slatFeatures(language, found, { withState: false });
      add(
        dest.id,
        sIds,
        {
          name: `${name} – ${label('tilt', language)}`.slice(0, 100),
          external_id: sIds.device,
          ...base,
        },
        sFeatures,
      );
      for (const f of sFeatures) {
        model.writers.set(sIds.feature(f.key), writer(f, 'slats'));
      }
    }
  }

  const scenesSeen = new Set();
  for (const scene of inventory.scenes ?? []) {
    if (scenesSeen.has(scene.id)) {
      continue;
    }
    scenesSeen.add(scene.id);
    if (full()) {
      continue;
    }
    const ids = idsOf('scene', String(scene.id));
    const run = feature('run', language, C.BUTTON, T.BUTTON.PUSH, {
      min: PRESSED,
      max: PRESSED,
      write(value) {
        if (numberIn(value, PRESSED, PRESSED) !== PRESSED) {
          refuse('badValue');
        }
        return { scene: scene.id };
      },
      feedback: false,
    });
    const name = withRoom(
      `${label('scene', language)} ${scene.name || scene.id}`,
      sceneRooms.get(scene.id),
    );
    model.devices.push({
      name: name.slice(0, 100),
      external_id: ids.device,
      should_poll: false,
      params: params([
        { name: 'WAREMA_SCENE_ID', value: scene.id },
        { name: 'WAREMA_ROOM', value: sceneRooms.get(scene.id) },
      ]),
      features: [strip(run, ids)],
    });
    model.counts.scenes += 1;
    model.writers.set(ids.feature('run'), { write: run.write, sceneId: scene.id, role: 'scene' });
  }
  return model;
}

/** The values of one destination's status: [{ featureId, value: { state } | { text } }]. */
export function valuesOf(model, destinationId, status) {
  const out = [];
  for (const reader of model.readers.get(destinationId) ?? []) {
    const value = reader.read(status);
    if (value !== undefined) {
      out.push({ featureId: reader.featureId, value });
    }
  }
  return out;
}
