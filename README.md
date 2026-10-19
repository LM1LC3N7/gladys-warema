# gladys-warema

[Gladys Assistant](https://gladysassistant.com) external integration for
**WAREMA** installations through the **WMS WebControl pro**: its channels
(roller shutters, venetian blinds, awnings and their valance, slat roofs read-only,
dimmers, light switches, switched loads) and its **scenes** become Gladys
devices of the Discovery tab. Gladys reads their states and controls them
through the free local API of the box, on the local network only (plain HTTP,
no authentication). Unofficial, not affiliated with WAREMA.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Development version.** Tested against a simulated WebControl pro only: it
> has never been tested with a real WebControl pro yet. Feedback and bug
> reports are welcome in the [GitHub issues](https://github.com/LM1LC3N7/gladys-warema/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (WaremaApp) ⇄ src/wms.js ⇄ POST http://<box>/commonCommand
                                   ├─ src/model.js      answers -> Gladys devices, readers, writers (pure)
                                   ├─ src/publisher.js  states within 300/min
                                   └─ src/store.js      /data/state.json: pause after a 429 or a 5xx
```

- **Protocol**: every command is `POST /commonCommand` with
  `{"protocolVersion": "1.0", "command": …, "source": 2, …}`: `ping`,
  `getConfiguration` (destinations, rooms, scenes), `getStatus` (one
  destination at a time), `action` (several actions of a same channel in one
  request; moves and stops with `responseType` 0, Instant, their effect or
  refusal seen at the read back; lights and loads with `responseType` 1,
  Detailed, as Home Assistant) and `sceneActions` (`sceneActionType` 1: run, never relearn). An answer with an `errors` list is a refusal of the box,
  reported with its codes as they are.
- **Radio**: one request at a time: a STOP at the head, then the other
  commands, the reads, the configuration last (it never leaves while a command
  waits); no request holds the line more than 2.5 s (reads time out after
  2.5 s, the configuration 5 s while connecting), a STOP 1 s, so a STOP always
  leaves within 3.5 s, even behind another STOP; status requests at
  least 0.5 s apart; a status answered busy (`0x50005`) is asked again after
  1 s, 3 tries at most (as pywmspro). Only the channels added in Gladys are
  read, at the configured interval (30 s by default), the configuration every
  30 minutes. After a command, the channel is read back (2 s, 15 s, 45 s for a
  motor; 1.5 s for a light).
- **Devices**: chosen by the actions of each destination, as the Home
  Assistant integration does. External ids
  `ext:<selector>:dest:<destination id>`, `…:valance:<id>`, `…:slats:<id>`,
  `…:scene:<scene id>`. Covers are `shutter` or `curtain`, never `switch`;
  switched loads are a read-only state and `button/push` features behind
  `allow_load_switches` (read again when the request leaves). The last
  `drivingCause` of a cover is a read-only `text` feature.
- **Protections**: wind, rain, ice, frost and safety are handled by the box and
  never overridden: a refused command is reported as the box said it (with
  the last protection it reported) and never sent again; badges show an active
  protection, `blocking` and `heartbeatError`.
- **Commands**: one at a time per channel, sent within 3.5 s or refused; a
  STOP skips that chain, and the moves of its channel still waiting are
  dropped; the Test button shares the client of the integration while it
  runs; the
  ack never waits for a publication to Gladys; "sent, without confirmation"
  once a request may have left without an answer.
- **Failures**: box unreachable → status message and `unreachable` badges,
  reconnection after 5 s doubling up to 5 min, never sooner than the read
  interval; a 429 or a 5xx pauses every path (1 min to 6 h, kept in `/data`).
  A reconnection to Gladys publishes the status, the Discovery and the badges
  again, without touching the client or the pause.

## Reused work

- [mback2k/pywmspro](https://github.com/mback2k/pywmspro) 0.4.2 (Apache-2.0),
  the Python library of the WMS WebControl pro API: its commands,
  enumerations, status reading, request lock, status spacing and busy retries
  are **ported** to JavaScript (it cannot run in this Node container).
- The Home Assistant `wmspro` integration
  ([home-assistant/core](https://github.com/home-assistant/core), Apache-2.0):
  the entity choices, the position and slat conversions, opening a venetian
  blind with its slats.
- The WAREMA "WMS WebControl pro API" documentation (2064534).
- [LM1LC3N7/gladys-wiser-feller](https://github.com/LM1LC3N7/gladys-wiser-feller),
  a local bridge of the same author: the app structure, the state publisher
  and the test helpers.

Notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), copied into the
image. The only runtime dependency is the Gladys SDK.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/helpers/fixtures.js` holds a small installation written from the WAREMA
documentation (not captured on a real box). `test/helpers/fakeBox.js` serves it
to the app tests (mocked timers); `test/helpers/boxServer.js` is a simulated
WebControl pro on 127.0.0.1, against which `test/e2e.test.js` and
`test/wms.test.js` run the real client. See TODO.md, "To check on a real
WebControl pro".

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0 (see [LICENSE](LICENSE)); ported logic under Apache-2.0, see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). WAREMA is a trademark of
WAREMA Renkhoff SE; this project is not affiliated with WAREMA.
