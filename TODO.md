# TODO — WAREMA WebControl pro v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test` (Node
  22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session (lot 9:
  one post per wave in /t/10385).

## Status

- [x] **Milestone 1 — core** (2026-10-19): HTTP client of the WMS WebControl
      pro API (ping, getConfiguration, getStatus, action, sceneActions), one
      request at a time with commands first, status spacing and busy retries,
      roller shutters, venetian blinds (slats on request), awnings and their
      valance, slat roofs, dimmers, light switches, switched loads behind an
      option, scenes as buttons, last movement cause, protection badges,
      3.5 s command deadline, 429/5xx pause kept in /data, test button, en/fr,
      docs, cover. Tested against simulated answers and a simulated box only.
- [ ] **Milestone 2 — real WebControl pro**: run against a real box and compare
      with the WAREMA app (see "To check"); turn the answers (anonymized) into
      fixtures.
- [ ] **Milestone 3 — more**: window drives (read-only first, then commands
      behind an option: an open window is an entry), the "identify" command as
      a button, load dimmers, an override of the slat range (pywmspro keeps
      one), potential-free actuators (enumeration) behind an option.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real WebControl pro

- The answer of `action` with `responseType` 1 (Detailed): its shape, how long
  it takes (the request has at most 4.5 s), and how a wind or rain alarm
  refuses a command (an `errors` list as for `getStatus`? accepted then
  ignored?). The integration reports any `errors` list as a refusal, with its
  codes as they are.
- The answer of `sceneActions` (the WAREMA documentation spells it
  `sceneAction`; pywmspro and Home Assistant send `sceneActions`).
- The direction of an awning: Home Assistant opens it with percentage 0; is
  0 % retracted or extended?
- The direction and range of the slats (`minValue`/`maxValue` -127..127 in the
  configuration; the community uses -75..75), and of a slat roof.
- `percentage` out of 0..100 (127.5 in the WAREMA example): taken as unknown.
- The names: one fixture of Home Assistant holds "Küche" written as UTF-8 read
  as Latin-1 (maybe by the box). Names are kept as the box sends them.
- How long a status takes over the radio with 20+ channels added, and whether
  the read interval of 30 s is enough.
- `heartbeatError` and `blocking`: when the box sets them.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-warema:0.1.0`):
  the first patch release gives 0.1.1.
- **pywmspro 0.4.2 (Apache-2.0)** is ported, not run (Python); the Home
  Assistant `wmspro` integration (Apache-2.0) gives the entity choices. Both
  credited in THIRD_PARTY_NOTICES.md, copied into the image.
- **No credentials**: the API has none (plain HTTP, local network). The docs
  say it, and to keep the box on a trusted network. 401/403 mean "not a
  WebControl pro" (another device answers), retried with the usual delay.
- **Covers in `shutter`** (roller shutters, venetian blinds, slat roofs) and
  **`curtain`** (awnings and their valance, as in gladys-wiser-feller), never
  `switch`/`binary`. Position: Gladys 100 = open = WAREMA 0 %.
- **Protections never overridden**: a command is always a plain action; the
  integration never sends again a refused command, never sends a "manual
  override", and reports the refusal with the codes of the box plus the last
  protection it reported (`drivingCause` wind, rain, ice, temperature,
  safety) or `blocking`. A command is still sent while a protection is
  reported: the box decides, not Gladys.
- **Switched loads** (`LoadSwitch`) are sensitive (a patio heater, "HEIZUNG"
  in a Home Assistant fixture): a read-only `unknown/binary` state and two
  `button/push` features (on, off), refused unless `allow_load_switches`, the
  option read again at the moment the request leaves. They are explicit
  commands, never a toggle: no decision is taken on a state.
- **Scenes** are `button/push` (never a switch: no "turn everything off"
  reaches them) and always allowed: the user built them in WMS studio pro and
  runs them by a click or a Gladys scene. The configuration does not tell what
  a scene drives, so a scene with a switched load is not guarded (noted in the
  docs).
- **Only the channels added in Gladys are read** (each status goes over the
  WMS radio, 0.5 s apart); a channel is read once when it is added.
- **Actions with `responseType` 1** (Detailed, as Home Assistant for stop and
  lights) so a refusal of the box comes back in the answer; scenes with
  `responseType` 0. A Detailed answer slower than the budget gives "sent,
  without confirmation" and a read back.
- **Not offered in v1**: window drives (opening a window is an entry, and a
  "close all" may target it), potential-free actuators (enumeration: anything
  can be wired), load dimmers, toggles, impulses, identify.
- **Pause after a 429 or a 5xx** kept in `/data/state.json` (bounded to 6 h
  when read back); no other state is kept.
