# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It bridges a WAREMA WMS WebControl pro through its local HTTP API (logic
ported from pywmspro, Apache-2.0, and the Home Assistant `wmspro`
integration, Apache-2.0).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "refuses" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers before connect())
src/app.js                        WaremaApp: lifecycle, reads, commands, badges, test
src/wms.js                        POST /commonCommand client: queue, status spacing, errors by kind
src/model.js                      answers -> Gladys devices, readers, writers (pure)
src/publisher.js                  states within 300/min
src/store.js                      /data/state.json: pause after a 429 or a 5xx
src/config.js                     DEFAULTS (mirrors the manifest defaults) + normalization
src/i18n.js                       texts in English and French
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys, an in-memory
                                  box and a simulated box on 127.0.0.1 (never the network)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Safety rules of this integration

- Blinds, shutters, awnings and slat roofs are never `switch`/`binary`.
  Switched loads are never a switch: a read-only state and buttons, refused
  unless `allow_load_switches`, read again when the request leaves.
- The wind, rain, ice and safety protections of the box are never
  overridden: a command refused by the box is reported with its codes as they
  are, and never sent again by the integration. Never add a "force",
  "override" or automatic resend.
- Never send `sceneActionType` 0 (relearn: it overwrites a scene), and never
  add a call that changes the configuration of the box.
- Commands are serialized per channel, go before the reads, and are sent
  within 3.5 s or refused; their ack never waits for a publication to Gladys.
  A request that may have left is never told "not sent".
- Status requests stay 0.5 s apart (the WMS radio); only the channels added in
  Gladys are read; after an error, never read faster than the interval.
- A reconnection to Gladys (`connected`) must not clear a pause nor the client
  (`app.resume`), and publishes the status, the Discovery and the badges again.
- Ids from the network are only Map keys; answers are copied key by key and
  their lists bounded.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the destination
  id (or the scene id) of the box; never a name. Gladys keys devices, their
  history, scenes and dashboards on them: changing one creates a new device
  and orphans the old one. The same goes for every key users store: manifest
  `config_schema`, `actions`, feature keys.
- **A device published again never loses a feature** (`app.publishDevices`
  merges the features of `gladys.devices`).
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code (defaults, actions):
  change both sides together. Gladys does not encrypt its configuration:
  never write that it does.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
