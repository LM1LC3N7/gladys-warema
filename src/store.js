// -----------------------------------------------------------------------------
// What must outlive a restart of the container, kept in /data/state.json: the
// end of a pause after a 429 or a 5xx of the box (bounded when read back), so
// a restart never asks the box again sooner. Nothing secret: the API of the
// WebControl pro has no credentials. /data is the only writable place.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIMINGS } from './constants.js';

export class StateStore {
  /**
   * @param {{ dir?: string|null, now?: () => number, logger?: object }} options
   *   dir null: kept in memory only (tests)
   */
  constructor({ dir = process.env.WAREMA_DATA_DIR ?? '/data', now = Date.now, logger } = {}) {
    this.dir = dir;
    this.now = now;
    this.logger = logger;
    this.data = { pausedUntil: 0 };
    this.load();
  }

  load() {
    if (!this.dir) {
      return;
    }
    try {
      const json = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8'));
      const until = Number(json?.pausedUntil);
      if (Number.isFinite(until) && until > 0) {
        // A date far in the future (a clock that jumped) is bounded.
        this.data.pausedUntil = Math.min(until, this.now() + TIMINGS.rateLimitMax);
      }
    } catch {
      // No file yet, or unreadable: start empty.
    }
  }

  save() {
    if (!this.dir) {
      return;
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = join(this.dir, 'state.json');
      writeFileSync(`${file}.tmp`, JSON.stringify(this.data));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      this.logger?.warn(`Cannot write ${this.dir}/state.json: ${err.code ?? err.message}`);
    }
  }

  get pausedUntil() {
    return this.data.pausedUntil;
  }

  pauseUntil(until) {
    const bounded = Math.min(until, this.now() + TIMINGS.rateLimitMax);
    if (bounded > this.data.pausedUntil) {
      this.data.pausedUntil = bounded;
      this.save();
    }
  }
}
