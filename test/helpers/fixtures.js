// -----------------------------------------------------------------------------
// A small WMS WebControl pro installation, written after the examples of the
// WAREMA API documentation (2064534) and the shapes pywmspro reads (not
// captured on a real box): one channel of each kind.
// -----------------------------------------------------------------------------

/** actionType / actionDescription pairs, as the box lists them. */
const drive = (id, description) => ({
  id,
  actionType: 0,
  actionDescription: description,
  minValue: 0,
  maxValue: 100,
});
const rotate = (id) => ({ id, actionType: 2, actionDescription: 3, minValue: -127, maxValue: 127 });
const stop = (id = 16) => ({ id, actionType: 6, actionDescription: 12 });
const identify = { id: 22, actionType: 8, actionDescription: 13 };
const impulse = { id: 23, actionType: 7, actionDescription: 12 };
const names = (name) => [name, '', '', ''];

export const IDS = {
  shutter: 18894,
  blind: 17776,
  awning: 58717,
  roof: 65355,
  dimmer: 97358,
  light: 110431,
  heater: 499120,
  relay: 200951,
  window: 301122,
  sceneOn: 687471,
  sceneNight: 688966,
};

export function configuration() {
  return {
    command: 'getConfiguration',
    protocolVersion: '1.0.0',
    destinations: [
      {
        id: IDS.shutter,
        animationType: 2,
        names: names('Wohnzimmer'),
        actions: [drive(0, 4), stop(), identify],
      },
      {
        id: IDS.blind,
        animationType: 0,
        names: names('Küche'),
        actions: [drive(0, 2), rotate(6), stop(), identify, impulse],
      },
      {
        id: IDS.awning,
        animationType: 1,
        names: names('Markise'),
        actions: [drive(0, 0), drive(2, 1), stop(), identify],
      },
      {
        id: IDS.roof,
        animationType: 3,
        names: names('Dach'),
        actions: [rotate(6), stop(), identify, impulse],
      },
      {
        id: IDS.dimmer,
        animationType: 6,
        names: names('Licht'),
        actions: [drive(0, 8), stop(17), { id: 20, actionType: 4, actionDescription: 6 }, identify],
      },
      {
        id: IDS.light,
        animationType: 5,
        names: names('Wandlicht'),
        actions: [{ id: 20, actionType: 4, actionDescription: 6 }, identify],
      },
      {
        id: IDS.heater,
        animationType: 5,
        names: names('Heizung links'),
        actions: [
          { id: 20, actionType: 4, actionDescription: 7 },
          { id: 21, actionType: 5, actionDescription: 10 },
          identify,
        ],
      },
      {
        id: IDS.relay,
        animationType: 999,
        names: names('Aktor Potentialfrei'),
        actions: [
          identify,
          { id: 26, actionType: 9, actionDescription: 999, minValue: 0, maxValue: 16 },
        ],
      },
      {
        id: IDS.window,
        animationType: 4,
        names: names('Dachfenster'),
        actions: [drive(0, 5), stop()],
      },
    ],
    rooms: [
      {
        id: 15175,
        name: 'Wohnbereich',
        destinations: [IDS.shutter, IDS.blind, IDS.light],
        scenes: [IDS.sceneNight],
      },
      {
        id: 19239,
        name: 'Terrasse',
        destinations: [IDS.awning, IDS.roof, IDS.dimmer, IDS.heater, IDS.relay],
        scenes: [IDS.sceneOn],
      },
    ],
    scenes: [
      { id: IDS.sceneOn, names: names('Licht an') },
      { id: IDS.sceneNight, names: names('Gute Nacht') },
    ],
  };
}

/** Channels offered in Gladys (the window and the potential-free actuator are not). */
export const OFFERED = 7;
/** Devices in the Discovery: the 7 channels, the valance of the awning, 2 scenes. */
export const DISCOVERED = 10;

/** The product values of each channel: actionId -> value. */
export function productValues() {
  return new Map([
    [IDS.shutter, new Map([[0, { percentage: 30 }]])],
    [
      IDS.blind,
      new Map([
        [0, { percentage: 100 }],
        [6, { rotation: 0 }],
        [23, { rotation: 0 }],
      ]),
    ],
    [
      IDS.awning,
      new Map([
        [0, { percentage: 100 }],
        [2, { percentage: 50 }],
      ]),
    ],
    [IDS.roof, new Map([[6, { rotation: -127 }]])],
    [
      IDS.dimmer,
      new Map([
        [0, { percentage: 40 }],
        [20, { onOffState: true }],
      ]),
    ],
    [IDS.light, new Map([[20, { onOffState: false }]])],
    [
      IDS.heater,
      new Map([
        [20, { onOffState: false }],
        [21, { onOffState: false }],
      ]),
    ],
    [IDS.window, new Map([[0, { percentage: 0 }]])],
  ]);
}

/** A getStatus answer for one channel. */
export function statusAnswer(destinationId, values, data = {}) {
  return {
    command: 'getStatus',
    protocolVersion: '1.0.0',
    details: [
      {
        destinationId,
        data: {
          drivingCause: 0,
          heartbeatError: false,
          blocking: false,
          ...data,
          productData: [...(values ?? new Map())].map(([actionId, value]) => ({
            actionId,
            value: { ...value },
          })),
        },
      },
    ],
  };
}
