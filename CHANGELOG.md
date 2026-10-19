# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The channels of a WAREMA WMS WebControl pro, offered in the Discovery tab:
  roller shutters and venetian blinds (open, close, stop, position), awnings
  and their valance (as curtains: open = retract), slat roofs (read-only:
  position of the slats and cause), dimmers (on/off, brightness) and light
  switches. Blinds are never switches.
- A STOP always leaves within 3.5 s: it skips the chain of its channel, goes
  at the head of the queue of the box, and drops the moves of its channel
  still waiting; no other request holds the line more than 2.5 s, a STOP 1 s
  (then "sent, without confirmation"), so two STOPs at once both leave in time.
- Moves and STOPs are sent Instant (a refusal shows at the read back: cause,
  blocking); lights and loads Detailed, as Home Assistant.
- A failed periodic reload of the configuration keeps the inventory known;
  the configuration has 5 s when connecting; read backs within 500 ms merged;
  the Test button waits for a connection under way instead of asking twice.
- The slats of venetian blinds as their own device, with the "Slats of
  venetian blinds as their own device" option (off by default: a "close all
  blinds" of a voice assistant may target it too).
- Switched loads as a read-only state and "Turn on" / "Turn off" buttons,
  refused unless "Allow switched loads" is on (read again when the request
  leaves); never a switch.
- WAREMA scenes as "Run" buttons (run, never relearnt).
- The last movement cause of each cover (sun, wind, rain, ice alarm, timer,
  manual…) as a read-only text; badges for an active protection, a blocked
  product, a product out of radio reach and a command not confirmed.
- The protections of the box are never overridden: a refused command is
  reported with the codes of the box and the last protection it reported, and
  never sent again by the integration.
- Commands one at a time per channel, before the reads, sent within 3.5 s or
  refused; "sent, without confirmation" once a request may have left; read
  back after each command.
- Reads of the channels added only, 0.5 s apart over the WMS radio, at a
  configurable interval; busy answers asked again after 1 s, 3 tries at most.
- A 429 or a 5xx pauses every path (1 minute to 6 hours), kept in `/data`;
  reconnection never faster than the read interval.
- A "Test the connection" button (through the client of the integration while
  it runs), English and French texts, the HTTP reasons translated and the
  codes of the box kept as they are; a 429 on a command is "refused by the
  box (HTTP 429)"; one read back at most per channel and due time; a pause set
  by any path holds the reconnection back.

[Unreleased]: https://github.com/LM1LC3N7/gladys-warema/commits/main
