# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below, under their own licences.

## pywmspro

- Project: [mback2k/pywmspro](https://github.com/mback2k/pywmspro), version
  0.4.2 (commit 3bcde8d), by Marc Hoersken: the asynchronous Python library of
  the WMS WebControl pro API.
- What is ported (rewritten in JavaScript in `src/wms.js`, `src/model.js` and
  `src/constants.js`): the request envelope (`protocolVersion` 1.0,
  `command`, `source` 2) posted to `/commonCommand`; the commands `ping`,
  `getConfiguration`, `getStatus` (one destination at a time), `action` and
  `sceneActions`; the enumerations `animationType`, `actionType`,
  `actionDescription`, `responseType`, `sceneActionType` and `drivingCause`;
  the reading of `destinations`, `rooms`, `scenes`, `details`, `productData`,
  `heartbeatError` and `blocking`; one request at a time, the 0.5 s spacing
  of the status requests (WMS radio channel), the 3 tries 1 s apart on the
  busy code `0x50005`, and the 5 s request timeout.
- Changes: rewritten in JavaScript for Node.js, without its classes, aiohttp
  and aiofiles dependencies; commands are queued before reads; the overrides
  of the slat range kept on disk by pywmspro are not ported.
- Licence: Apache License 2.0 (the full text is the one of `LICENSE`).

## Home Assistant `wmspro` integration

- Project: [home-assistant/core](https://github.com/home-assistant/core),
  `homeassistant/components/wmspro` (branch `dev`, read on 2026-10-19), the
  Home Assistant integration built on pywmspro.
- What is reused (rewritten in JavaScript in `src/model.js` and `src/app.js`):
  the choice of entity per destination (awning and its valance, roller
  shutter, venetian blind with or without slat rotation, dimmer, light switch,
  load switch, scenes), the position conversion (`100 - percentage`), the stop
  through the "manual command" stop action, opening and closing a venetian
  blind with its slats in one request, the slat position over the
  `minValue`..`maxValue` range, the light switched through its switch action
  when it has one. The shapes of `test/helpers/fixtures.js` follow its test
  fixtures and the WAREMA documentation.
- Changes: rewritten in JavaScript for the Gladys device model; load switches
  are a read-only state and buttons behind an option instead of a switch.
- Licence: Apache License 2.0 (the full text is the one of `LICENSE`).

## WAREMA documentation

- "WMS WebControl pro API" documentation (warema_2064534_alhb_de_v0,
  2024-07-01) by WAREMA Renkhoff SE: the protocol, the parameters and the
  driving causes. No code of it; the API is described as freely accessible on
  the local network. WAREMA is a trademark of WAREMA Renkhoff SE.
