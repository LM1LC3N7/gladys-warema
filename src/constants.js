// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration), the vocabulary of the WMS WebControl pro API and the tuning
// of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Languages of the feature names (manifest `language` options). */
export const LANGUAGES = ['fr', 'en'];

/** Bounds of the number fields (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 10, max: 3600, default: 30 };

/**
 * The WMS WebControl pro API (WAREMA documentation 2064534, and pywmspro
 * const.py / webcontrol.py): every command is a POST of JSON to
 * http://<box>/commonCommand, without any authentication.
 */
export const API = {
  path: '/commonCommand',
  protocolVersion: '1.0',
  /** "source" must always be 2 for the API (WAREMA documentation). */
  source: 2,
  commands: {
    ping: 'ping',
    configuration: 'getConfiguration',
    status: 'getStatus',
    action: 'action',
    scene: 'sceneActions',
  },
};

/** animationType (what the destination is, for the WAREMA app). */
export const ANIMATION = {
  VENETIAN_BLIND: 0,
  AWNING: 1,
  ROLLER_SHUTTER: 2,
  SLAT_ROOF: 3,
  WINDOW: 4,
  SWITCH: 5,
  DIMMER: 6,
  UNKNOWN: 999,
};

/** actionType (the parameters of an action). */
export const ACTION_TYPE = {
  PERCENTAGE: 0,
  PERCENTAGE_DELTA: 1,
  ROTATION: 2,
  ROTATION_DELTA: 3,
  SWITCH: 4,
  TOGGLE: 5,
  STOP: 6,
  IMPULSE: 7,
  IDENTIFY: 8,
  ENUMERATION: 9,
};

/** actionDescription (what an action drives). */
export const ACTION_DESC = {
  AWNING_DRIVE: 0,
  VALANCE_DRIVE: 1,
  SLAT_DRIVE: 2,
  SLAT_ROTATE: 3,
  ROLLER_SHUTTER_DRIVE: 4,
  WINDOW_DRIVE: 5,
  LIGHT_SWITCH: 6,
  LOAD_SWITCH: 7,
  LIGHT_DIMMING: 8,
  LOAD_DIMMING: 9,
  LIGHT_TOGGLE: 10,
  LAST_TOGGLE: 11,
  MANUAL_COMMAND: 12,
  IDENTIFY: 13,
};

/** responseType: Instant answers on reception, Detailed once the box knows more. */
export const RESPONSE_TYPE = { INSTANT: 0, DETAILED: 1 };

/** sceneActionType: 0 relearns the scene (never used here), 1 runs it. */
export const SCENE_ACTION = { RELEARN: 0, EXECUTE: 1 };

/**
 * drivingCause of getStatus: why the product last moved. The weather and
 * safety causes are protections of the box: the integration shows them and
 * never tries to override them.
 */
export const DRIVING_CAUSE = {
  NONE: 0,
  SUN: 1,
  DUSK_DAWN: 2,
  WIND: 3,
  RAIN: 4,
  ICE: 5,
  TEMPERATURE: 6,
  SWITCHING_TIME: 7,
  SCENE: 8,
  CONTROL_MODE: 9,
  MANUAL: 10,
  SAFETY: 11,
  CONTACT: 12,
  CENTRAL_COMMAND: 13,
  UNKNOWN: 999,
};

/** The causes that are a protection of the box (wind, rain, ice, frost, safety). */
export const PROTECTIONS = new Set([
  DRIVING_CAUSE.WIND,
  DRIVING_CAUSE.RAIN,
  DRIVING_CAUSE.ICE,
  DRIVING_CAUSE.TEMPERATURE,
  DRIVING_CAUSE.SAFETY,
]);

/** The error of getStatus that means "busy, ask again" (pywmspro destination.py). */
export const ERROR_BUSY = 0x50005;

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of the configuration answer (a big installation: a few hundred channels). */
  configurationBytes: 1024 * 1024,
  /** Size of any other answer (status, action, ping). */
  responseBytes: 64 * 1024,
  /** Destinations and scenes published at once. */
  devices: 1000,
  /** Actions of one destination, product values of one status, error codes kept. */
  actions: 64,
  /** Characters of a transport badge message (SDK limit). */
  badgeMessage: 200,
  /** Characters of a name from the box kept in Gladys. */
  name: 80,
};

/** Rotation bounds of the API (WAREMA documentation, "Rotation"). */
export const ROTATION = { min: -360, max: 360 };

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /**
   * One read (ping, getStatus, getConfiguration). pywmspro waits 5 s; here
   * 2.5 s, so a STOP arriving behind a read still leaves within 3.5 s.
   */
  readTimeout: 2500,
  /** No request but a STOP holds the line of the box longer than this. */
  lineHold: 2500,
  /** One request of the connection test (the button waits 60 s). */
  testTimeout: 10_000,
  /**
   * Two status requests are at least this far apart: each one goes over the
   * WMS radio channel (pywmspro "status throttling").
   */
  statusSpacing: 500,
  /** A status answered "busy" is asked again after this delay, 3 tries at most. */
  busyRetry: 1000,
  busyTries: 3,
  /** The configuration (channels, rooms, scenes) is read again this often. */
  inventory: 30 * 60_000,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 5 * 60_000,
  /** Bounds of the pause after a 429 or a 5xx (Retry-After, or the delay without it). */
  rateLimitMin: 60_000,
  rateLimitMax: 6 * 60 * 60_000,
  /**
   * Gladys acks a set_value within 5 s: a command not sent within 3.5 s of
   * its arrival is refused, never sent late.
   */
  setValueDeadline: 3500,
  /** The command request may run this long past the deadline (the ack still fits in 5 s). */
  commandSlack: 1000,
  /** Shortest timeout of a request of a command. */
  commandTimeoutMin: 300,
  /** A light is read back this soon after a command. */
  lightEchoes: [1500],
  /** A motor is read back at these delays after a command (it moves for up to a minute). */
  motorEchoes: [2000, 15_000, 45_000],
};
