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
- [x] **Milestone 1 fixes — review** (2026-10-19): STOP first (B1), moves
      Instant (I1), Test button through the main client (I2), pauses held by
      open() (I3), scenes documented as run as they are (I4), slat roofs
      read-only (I5), 429 on a command, one read back per due time, French
      HTTP reasons, awning direction documented.
- [ ] **Milestone 2 — real WebControl pro**: run against a real box and compare
      with the WAREMA app (see "To check"); turn the answers (anonymized) into
      fixtures.
- [ ] **Milestone 3 — more**: slat roofs commanded (open, close, stop,
      position) once their direction and range are checked on a real box,
      window drives (read-only first, then commands
      behind an option: an open window is an entry), the "identify" command as
      a button, load dimmers, an override of the slat range (pywmspro keeps
      one), potential-free actuators (enumeration) behind an option.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real WebControl pro

- The answer of `action` with `responseType` 1 (Detailed, stop, lights,
  loads): its shape and how long it takes (2.5 s at most here, then "sent,
  without confirmation"); with `responseType` 0 (moves), whether a wind or
  rain alarm still answers with an `errors` list, or accepts and ignores (the
  read back then shows the cause). The integration reports any `errors` list
  as a refusal, with its codes as they are.
- Whether 2.5 s is enough for a `getStatus` over the radio of a far product.
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
- **Moves and STOPs with `responseType` 0** (Instant): the box answers at once,
  and a refusal (wind, rain) shows at the read back (cause, blocking badge).
  Lights and loads with `responseType` 1 (Detailed, as Home Assistant); scenes
  with 0. A STOP holds the line 1 s at most (approval round 1, scenario F: two
  STOPs at once), then "sent, without confirmation" and a read back. A Detailed answer slower than 2.5 s gives "sent, without
  confirmation" and a read back.
- **STOP first** (review B1): a STOP skips the chain of its channel, goes at
  the head of the queue of the box, and drops the moves of its channel still
  waiting (refused "a stop arrived meanwhile"). Every other request holds the
  line 2.5 s at most (reads time out after 2.5 s, pywmspro waits 5 s), and the
  configuration never leaves while a command waits: a STOP leaves within
  3.5 s whatever was in flight.
- **Test button**: through the client of the integration while it runs (one
  request at a time at the box); a client of its own only offline, closed
  first; a connection under way is awaited, and a success brings the planned
  reconnection forward (never two at once).
- **Inventory**: getConfiguration has 5 s when connecting (nothing can wait
  behind it then), 2.5 s afterwards; a failed periodic reload keeps the known
  inventory and is tried again at the next read (a 429 or a 5xx still pauses).
- **Read backs** due within 500 ms of each other are merged.
- **Pauses**: open() and the reads check the pause before asking anything, so
  a pause set by the Test button or a command holds the reconnection back.
- **Slat roofs read-only in v1** (review I5): position of the slats and cause
  only, until their direction and range are checked on a real box.
- **Awnings**: Open = retract (WAREMA 0 %, as Home Assistant); being curtains,
  a "close the curtains" extends them: said in the docs.
- **Error texts**: the English message stays in the logs; the statuses and
  acks give the reason in French or English (`reasonOf`), HTTP statuses and
  codes of the box kept as they are.
- **Not offered in v1**: window drives (opening a window is an entry, and a
  "close all" may target it), potential-free actuators (enumeration: anything
  can be wired), load dimmers, toggles, impulses, identify.
- **Pause after a 429 or a 5xx** kept in `/data/state.json` (bounded to 6 h
  when read back); no other state is kept.
