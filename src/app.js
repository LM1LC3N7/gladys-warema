// -----------------------------------------------------------------------------
// The integration: one WMS WebControl pro, its channels (destinations) and
// scenes turned into Gladys devices, their states read at the configured pace,
// and the commands sent back. index.js only wires the SDK to it.
//
// Lifecycle: start -> open (ping, getConfiguration, the status of every
// channel added in Gladys) -> the states are read again at the configured
// interval (one status per channel, 0.5 s apart: they go over the WMS radio),
// the configuration every 30 minutes. On a failure, reconnect with a growing
// delay, never faster than the read interval; a 429 or a 5xx pauses every
// path, and the pause is kept in /data across restarts.
//
// Commands: one at a time per channel, sent within 3.5 s of their arrival or
// refused. A STOP skips the chain of its channel and goes at the head of the
// queue of the box (every other request holds the line 2.5 s at most), and
// the moves of that channel still waiting are dropped. Switched loads only when the user allowed them, the option read
// again at the moment the request leaves. A command the box refuses (wind,
// rain or ice alarm, blocking, any error code) is reported as the box said it,
// and never sent again by the integration: the protections of the box are
// never overridden. The ack of a command never waits for a publication.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { PROTECTIONS, TIMINGS } from './constants.js';
import { T, word } from './i18n.js';
import { buildModel, emptyModel, inventoryOf, roleOf, statusOf, valuesOf } from './model.js';
import { StatePublisher } from './publisher.js';
import { StateStore } from './store.js';
import { WmsError, createClient } from './wms.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The fields of a created feature kept when a device is published again. */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

/** Kinds of errors that mean "the box answered and refused" (a 4xx or an error code). */
const REFUSALS = new Set(['refused', 'busy', 'notfound', 'denied', 'http', 'redirect']);

export class WaremaApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'warema' }),
    connect = createClient,
    now = Date.now,
    timers = globalThis,
    store,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.store = store ?? new StateStore({ now, logger });
    this.raw = {};
    this.config = normalizeConfig();
    this.client = null;
    this.inventory = { destinations: [], scenes: [], rooms: [] };
    this.inventoryAt = -Infinity;
    this.model = emptyModel();
    /** destination id -> last status read (replaced, never mutated) */
    this.statuses = new Map();
    this.online = false;
    this.running = false;
    this.timerAt = undefined;
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    this.createdIds = new Set();
    /** Gladys device id -> device published in this run (a publication never shrinks) */
    this.known = new Map();
    this.publishedDevices = undefined;
    /** device id -> last badge published (JSON) */
    this.transports = new Map();
    /** command chains, per destination (or scene) */
    this.chains = new Map();
    /** commands numbered on arrival; destination id -> number of its last STOP */
    this.commandSeq = 0;
    this.stopSeq = new Map();
    /** destination ids whose command was sent without confirmation */
    this.unconfirmed = new Set();
    this.readBackTimers = new Set();
    /** `<destination>@<due time>` of the read backs planned */
    this.readBackKeys = new Set();
    this.timer = undefined;
    this.reading = false;
    this.failures = 0;
    this.lastError = undefined;
    this.generation = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    const previousUrl = this.config.url;
    this.raw = { ...(raw ?? {}) };
    this.config = normalizeConfig(raw);
    if (previousUrl !== this.config.url) {
      // Another box (or none): nothing of the previous one stays published.
      this.known.clear();
      this.lastValues.clear();
      this.statuses.clear();
      this.unconfirmed.clear();
      this.model = emptyModel();
      this.inventory = { destinations: [], scenes: [], rooms: [] };
      this.inventoryAt = -Infinity;
    }
    this.refreshCreated();
    if (previousUrl !== this.config.url && previousUrl !== undefined) {
      // Drop the previous box's devices from the Discovery at once.
      await this.publishDevices({ force: true });
    }
    // Gladys may have restarted meanwhile (it keeps them in memory only).
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.transports.clear();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.running = true;
    this.publisher.start();
    const paused = this.store.pausedUntil - this.now();
    if (paused > 0) {
      // A pause after a 429 or a 5xx outlives a restart: wait for its end.
      await this.setStatus(false, T.failure({ kind: 'rate' }));
      this.schedule(generation, paused, () => this.open(generation));
      return;
    }
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  /**
   * Gladys (re)connected: the same configuration keeps everything (client,
   * pause) and publishes again what Gladys keeps in memory only (connection
   * status, Discovery, badges); another one starts again.
   */
  async resume(raw = {}) {
    if (!this.running || !sameConfig(normalizeConfig(raw), this.config)) {
      await this.start(raw);
      return;
    }
    this.raw = { ...(raw ?? {}) };
    this.refreshCreated();
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.transports.clear();
    await this.publishDevices();
    if (this.online) {
      await this.connectedStatus();
    } else {
      await this.setStatus(false, this.lastError ? T.failure(this.lastError) : T.connecting);
    }
    await this.publishAllTransports();
  }

  /** The configuration changed: start again with it. */
  async configUpdated(raw = {}) {
    this.logger.info('Configuration updated: reconnecting to the WebControl pro');
    await this.start(raw);
  }

  stop() {
    this.generation += 1;
    this.running = false;
    for (const timer of [this.timer, ...this.readBackTimers]) {
      this.timers.clearTimeout(timer);
    }
    this.readBackTimers.clear();
    this.readBackKeys.clear();
    this.timer = undefined;
    this.timerAt = undefined;
    this.publisher.stop();
    this.client?.close?.();
    this.client = null;
    this.online = false;
    this.reading = false;
    this.failures = 0;
  }

  current(generation) {
    return generation === this.generation;
  }

  paused() {
    return this.now() < this.store.pausedUntil;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async connectedStatus() {
    const { offered: destinations, scenes } = this.model.counts;
    await this.setStatus(true, T.connected({ destinations, scenes }, this.config.pollInterval));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms` on the main timer, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timerAt = this.now() + ms;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.timerAt = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`WAREMA loop: ${err.message}`));
      }
    }, ms);
  }

  /** A promise not awaited: its failure is logged. */
  background(promise) {
    promise?.catch?.((err) => this.logger.warn(err.message));
  }

  // --- Connection ----------------------------------------------------------------

  /** The time left of a pause (429 or 5xx), set by any path (reads, a command, the Test button). */
  pauseLeft() {
    return Math.max(0, this.store.pausedUntil - this.now());
  }

  async open(generation) {
    const left = this.pauseLeft();
    if (left > 0) {
      // A pause set meanwhile by another path: nothing is asked before its end.
      await this.setStatus(false, T.failure({ kind: 'rate' }));
      this.schedule(generation, left, () => this.open(generation));
      return;
    }
    try {
      this.client?.close?.();
      this.client = this.connect({ url: this.config.url, timers: this.timers, now: this.now });
      await this.client.ping();
      if (!this.current(generation)) {
        return;
      }
      await this.loadInventory(generation);
      if (!this.current(generation)) {
        return;
      }
      this.online = true;
      this.failures = 0;
      this.lastError = undefined;
      this.logger.info(
        `Connected to the WebControl pro at ${this.config.url}: ${this.model.counts.offered} channels offered, ${this.model.counts.scenes} scenes`,
      );
      await this.connectedStatus();
      await this.publishAllTransports();
      await this.readStates(generation);
      if (!this.current(generation)) {
        return;
      }
      this.scheduleRead(generation);
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  /** The growing delay of a reconnection, never faster than the read interval. */
  backoff() {
    const delay = Math.min(
      TIMINGS.retryMax,
      TIMINGS.retryMin * 2 ** Math.max(0, this.failures - 1),
    );
    return Math.max(delay, this.config.pollInterval * 1000);
  }

  /** The delay before the next try after `err`, and whether it is a pause (kept in /data). */
  retryDelay(err) {
    if (err?.kind === 'rate' || err?.kind === 'server') {
      const asked = err.retryAfter ?? (err.kind === 'rate' ? TIMINGS.rateLimitMin : this.backoff());
      return clamp(Math.max(asked, this.backoff()), TIMINGS.rateLimitMin, TIMINGS.rateLimitMax);
    }
    return this.backoff();
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.reading = false;
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.timerAt = undefined;
    this.lastError = err;
    this.failures += 1;
    const delay = this.retryDelay(err);
    if (err?.kind === 'rate' || err?.kind === 'server') {
      this.store.pauseUntil(this.now() + delay);
    }
    if (err instanceof WmsError) {
      this.logger.warn(
        `WebControl pro: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`,
      );
    } else {
      this.logger.error('WebControl pro: unexpected failure', err);
    }
    await this.setStatus(false, T.failure(err));
    await this.publishAllTransports();
    this.schedule(generation, Math.max(delay, this.pauseLeft()), () => this.open(generation));
  }

  /** An error on a side path (command, read back, scan): a 429 or a 5xx pauses everything. */
  sideError(generation, err) {
    if (err?.kind === 'rate' || err?.kind === 'server') {
      this.store.pauseUntil(this.now() + this.retryDelay(err));
      if (this.online) {
        this.background(this.fail(generation, err));
      }
    }
  }

  // --- Reading -------------------------------------------------------------------

  scheduleRead(generation, ms = this.config.pollInterval * 1000) {
    this.schedule(generation, ms, () => this.read(generation));
  }

  async read(generation) {
    const left = this.pauseLeft();
    if (left > 0) {
      // Paused by another path (a command, the Test button): read at its end.
      this.scheduleRead(generation, left);
      return;
    }
    this.reading = true;
    try {
      if (this.now() - this.inventoryAt >= TIMINGS.inventory) {
        await this.loadInventory(generation);
      }
      await this.readStates(generation);
    } catch (err) {
      // Any failure (a 429 included: its pause then covers every path) reconnects.
      await this.fail(generation, err);
      return;
    } finally {
      if (this.current(generation)) {
        this.reading = false;
      }
    }
    if (this.current(generation) && this.online) {
      await this.connectedStatus();
      this.scheduleRead(generation);
    }
  }

  /** getConfiguration: the channels, rooms and scenes. */
  async loadInventory(generation, { force = false } = {}) {
    const json = await this.client.configuration();
    if (!this.current(generation)) {
      return;
    }
    if (!Array.isArray(json?.destinations)) {
      throw new WmsError('format', 'the configuration has no list of destinations');
    }
    this.inventory = inventoryOf(json);
    this.inventoryAt = this.now();
    this.model = buildModel((type, id) => this.gladys.externalIds(type, id), this.inventory, {
      language: this.config.language,
      publishTilt: this.config.publishTilt,
    });
    for (const [deviceId] of this.transports) {
      if (!this.known.has(deviceId) && !this.model.deviceDests.has(deviceId)) {
        this.transports.delete(deviceId);
      }
    }
    await this.publishDevices({ force });
  }

  /** The destinations whose device exists in Gladys (only those are read: the radio is slow). */
  createdDestinations() {
    const ids = [];
    for (const [destId, devices] of this.model.destDevices) {
      if (devices.some((d) => this.createdIds.has(d))) {
        ids.push(destId);
      }
    }
    return ids;
  }

  /** The status of one destination, or undefined when the box refused to give it. */
  async readStatus(destId) {
    try {
      const json = await this.client.status(destId);
      const status = statusOf(json, destId);
      if (!status) {
        this.warnOnce(`status:${destId}`, `WebControl pro: no status for channel ${destId}`);
      }
      return status;
    } catch (err) {
      if (err?.kind === 'refused' || err?.kind === 'busy') {
        // One channel the box will not tell: the others go on.
        this.warnOnce(
          `status:${destId}`,
          `WebControl pro: status of channel ${destId} refused (${err.message})`,
        );
        return undefined;
      }
      throw err;
    }
  }

  async readStates(generation) {
    for (const destId of this.createdDestinations()) {
      if (!this.current(generation)) {
        return;
      }
      const status = await this.readStatus(destId);
      if (status && this.current(generation)) {
        this.applyStatus(destId, status);
      }
    }
  }

  /**
   * The devices of the model, merged so that nothing ever disappears: a
   * created device keeps its features as Gladys has them (types are fixed at
   * creation), plus any new one; a device seen earlier in this run stays.
   */
  async publishDevices({ force = false } = {}) {
    const created = new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
    for (const fresh of this.model.devices) {
      const previous = this.known.get(fresh.external_id);
      const mine = created.get(fresh.external_id);
      const features = new Map();
      for (const f of mine?.features ?? []) {
        features.set(
          f.external_id,
          Object.fromEntries(
            FEATURE_FIELDS.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
          ),
        );
      }
      for (const f of [...(previous?.features ?? []), ...fresh.features]) {
        if (!features.has(f.external_id)) {
          features.set(f.external_id, f);
        }
      }
      this.known.set(fresh.external_id, { ...fresh, features: [...features.values()] });
    }
    const list = [...this.known.values()];
    const json = JSON.stringify(list);
    if (!force && json === this.publishedDevices) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(list);
      this.publishedDevices = json;
    } catch (err) {
      this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The values of one destination to its features, and its badges. */
  applyStatus(destId, status) {
    this.statuses.set(destId, status);
    if (!this.chains.has(destId)) {
      this.unconfirmed.delete(destId);
    }
    for (const { featureId, value } of valuesOf(this.model, destId, status)) {
      this.record(featureId, value);
    }
    this.publishTransportOf(destId);
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  // --- Transport badges ----------------------------------------------------------

  transportOf(deviceId) {
    if (!this.online) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const destId = this.model.deviceDests.get(deviceId);
    if (destId === undefined) {
      return { transport: DEVICE_TRANSPORTS.LOCAL };
    }
    const degraded = (message) => ({ transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message });
    if (this.unconfirmed.has(destId)) {
      return degraded(T.badge.unconfirmed);
    }
    const status = this.statuses.get(destId);
    if (status?.heartbeatError) {
      return degraded(T.badge.radio);
    }
    if (status?.blocking) {
      return degraded(T.badge.blocking);
    }
    if (status && PROTECTIONS.has(status.cause)) {
      return degraded(T.badge.protection(status.cause));
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  publishTransportOf(destId) {
    for (const deviceId of this.model.destDevices.get(destId) ?? []) {
      this.background(this.publishTransport(deviceId));
    }
  }

  async publishTransport(deviceId) {
    if (!this.createdIds.has(deviceId)) {
      return;
    }
    const badge = this.transportOf(deviceId);
    const key = JSON.stringify(badge);
    if (this.transports.get(deviceId) === key) {
      return;
    }
    this.transports.set(deviceId, key);
    await this.gladys.publishTransports([{ external_id: deviceId, ...badge }]);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdIds) {
      if (!this.known.has(deviceId)) {
        continue;
      }
      const badge = this.transportOf(deviceId);
      const key = JSON.stringify(badge);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...badge });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------

  refreshCreated() {
    const devices = this.gladys.devices ?? [];
    this.createdIds = new Set(devices.map((d) => d.external_id));
    this.created = new Set(devices.flatMap((d) => (d.features ?? []).map((f) => f.external_id)));
  }

  async deviceCreated(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.createdIds.add(device.external_id);
    }
    for (const f of device?.features ?? []) {
      this.created.add(f.external_id);
    }
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    const destId = this.model.deviceDests.get(device?.external_id);
    if (destId !== undefined && !this.statuses.has(destId)) {
      // Not read yet (only the channels added in Gladys are read): read it now.
      this.readBack(destId, 0);
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.createdIds.delete(device.external_id);
      for (const f of device.features ?? []) {
        this.created.delete(f.external_id);
      }
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Scan button of the Discovery tab (never during a pause). */
  async rescan() {
    if (!this.online || !this.client || this.paused()) {
      this.publishedDevices = undefined;
      await this.publishDevices({ force: true });
      return;
    }
    const generation = this.generation;
    try {
      await this.loadInventory(generation, { force: true });
    } catch (err) {
      this.sideError(generation, err);
      throw err;
    }
  }

  // --- Commands ------------------------------------------------------------------

  denied(key, ...args) {
    const text = T.denied[key];
    const err = new Error(
      word(typeof text === 'function' ? text(...args) : text, this.config.language),
    );
    err.refusal = key;
    return err;
  }

  /** Runs `task` after the previous task of the same key (a promise chain per key). */
  serialized(key, task) {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    this.chains.set(key, tail);
    tail.then(() => {
      if (this.chains.get(key) === tail) {
        this.chains.delete(key);
      }
    });
    return run;
  }

  /** Refuses a switched load while its option is off (checked again when the request leaves). */
  checkAllowed(writer) {
    if (writer.safety === 'load' && !this.config.allowLoads) {
      throw this.denied('loadsOff');
    }
  }

  checkReady() {
    if (this.paused()) {
      throw this.denied('paused');
    }
    if (!this.client || !this.online) {
      throw this.denied('notConnected');
    }
  }

  /** The timeout and the guard of a command request, from what is left before `deadline`. */
  commandOptions(deadline, writer, seq) {
    const check = () => {
      if (this.now() > deadline) {
        throw this.denied('tooLate');
      }
      // A STOP of this channel arrived after this command: it never leaves.
      const stopped = this.stopSeq.get(writer.destinationId);
      if (seq !== undefined && stopped !== undefined && stopped > seq) {
        throw this.denied('stopped');
      }
      // The option is read once more at the moment the request leaves.
      this.checkAllowed(writer);
    };
    const timeout = () =>
      clamp(
        deadline + TIMINGS.commandSlack - this.now(),
        TIMINGS.commandTimeoutMin,
        TIMINGS.setValueDeadline + TIMINGS.commandSlack,
      );
    return { check, send: { timeout, guard: check } };
  }

  /** Gladys command (acked within 5 s): sent within 3.5 s of its arrival, or refused. */
  async setValue(_device, feature, value) {
    const deadline = this.now() + TIMINGS.setValueDeadline;
    const generation = this.generation;
    const featureId = feature?.external_id;
    try {
      const writer = featureId === undefined ? undefined : this.model.writers.get(featureId);
      if (!writer) {
        throw this.denied('notCommand');
      }
      this.checkAllowed(writer);
      this.checkReady();
      let call;
      try {
        // Pure: the value checked and turned into actions before any wait.
        call = writer.write(value);
      } catch (err) {
        throw err?.refusal ? this.denied(err.refusal) : err;
      }
      this.commandSeq += 1;
      const seq = this.commandSeq;
      if (call.stop) {
        // A STOP never waits behind the chain of its channel (a slow move,
        // a refused one): it goes at once, at the head of the queue of the
        // box, and the moves of the channel still waiting are dropped.
        this.stopSeq.set(writer.destinationId, seq);
        const options = this.commandOptions(deadline, writer);
        options.check();
        await this.send(this.client, writer, call, options, generation);
        return;
      }
      const key = writer.destinationId ?? `scene:${writer.sceneId}`;
      await this.serialized(key, async () => {
        // The option and the connection may have changed while the command waited.
        this.checkAllowed(writer);
        this.checkReady();
        if (!this.current(generation)) {
          throw this.denied('notConnected');
        }
        const client = this.client;
        const options = this.commandOptions(deadline, writer, seq);
        options.check();
        await this.send(client, writer, call, options, generation);
      });
    } catch (err) {
      // Gladys shows the value asked for: send the known one again.
      this.gladys.forgetPublishedStates?.(featureId);
      const known = this.lastValues.get(featureId);
      if (known && this.created.has(featureId)) {
        this.publisher.push(featureId, known);
      }
      throw err;
    }
  }

  /**
   * One request of a command, and what to tell of a failure:
   *   - refused at the socket, connection refused, no route, timed out before
   *     connecting: "not sent";
   *   - an error code of the box, or a 4xx: "refused", with the answer of the
   *     box as it is (a protection, a blocking...): never sent again;
   *   - anything after it left (5xx, an answer not understood or too large,
   *     a reset, a timeout once sent): "sent, without confirmation", the
   *     channel read back and its badge degraded.
   * Never awaits a publication to Gladys.
   */
  async send(client, writer, call, options, generation) {
    const destId = writer.destinationId;
    try {
      if (call.scene !== undefined) {
        await client.scene(call.scene, options.send);
      } else {
        await client.action(
          call.actions.map((a) => ({ destinationId: destId, ...a })),
          // Moves Instant (a refusal shows at the read back), the rest Detailed.
          { ...options.send, instant: Boolean(call.move), stop: Boolean(call.stop) },
        );
      }
    } catch (err) {
      if (err?.refusal) {
        // Refused before leaving (too late, option turned off).
        throw err;
      }
      if (err?.sent === false) {
        throw this.denied('notSent', err);
      }
      this.sideError(generation, err);
      if (err?.kind === 'rate') {
        // The box answered 429: it refused this command (and everything pauses).
        throw this.denied('refused', err);
      }
      if (REFUSALS.has(err?.kind)) {
        const status = destId === undefined ? undefined : this.statuses.get(destId);
        this.logger.warn(
          `WebControl pro refused a command for ${destId ?? `scene ${writer.sceneId}`}: ${err.message}`,
        );
        if (destId !== undefined) {
          this.readBack(destId, TIMINGS.lightEchoes[0]);
        }
        throw this.denied('refused', err, {
          cause: PROTECTIONS.has(status?.cause) ? status.cause : undefined,
          blocking: status?.blocking,
        });
      }
      // 5xx, format, size, reset, timeout once sent: it may have been done.
      if (destId !== undefined) {
        this.unconfirmed.add(destId);
        this.publishTransportOf(destId);
        this.readBack(destId, TIMINGS.lightEchoes[0]);
        throw this.denied('unconfirmed');
      }
      throw this.denied('unconfirmedScene');
    }
    if (destId !== undefined) {
      const delays = this.model.motors.has(destId) ? TIMINGS.motorEchoes : TIMINGS.lightEchoes;
      for (const delay of delays) {
        this.readBack(destId, delay);
      }
    } else if (!this.reading && this.timerAt !== undefined) {
      // A scene moves several channels: read them all a little sooner.
      const soon = TIMINGS.motorEchoes[1];
      if (this.timerAt - this.now() > soon) {
        this.scheduleRead(generation, soon);
      }
    }
    this.logger.debug(`WAREMA command sent for ${writer.role} ${destId ?? writer.sceneId}`);
  }

  /**
   * Reads one destination back later (after a command, or once created):
   * one read at most per channel and per due time (two commands in a row do
   * not double the radio traffic).
   */
  readBack(destId, delay) {
    const generation = this.generation;
    const key = `${destId}@${this.now() + delay}`;
    if (this.readBackKeys.has(key)) {
      return;
    }
    this.readBackKeys.add(key);
    const timer = this.timers.setTimeout(async () => {
      this.readBackTimers.delete(timer);
      this.readBackKeys.delete(key);
      if (!this.current(generation) || !this.online || !this.client || this.paused()) {
        return;
      }
      try {
        const status = await this.readStatus(destId);
        if (status && this.current(generation)) {
          this.applyStatus(destId, status);
        }
      } catch (err) {
        this.sideError(generation, err);
        this.logger.warn(`Read back of channel ${destId} failed: ${err.message}`);
      }
    }, delay);
    this.readBackTimers.add(timer);
  }

  // --- Configuration screen button ----------------------------------------------------

  /**
   * "Test the connection": ping and getConfiguration. While the integration
   * runs, through its own client (one request at a time at the box, a STOP
   * still first); offline, through a client of its own, closed before the
   * integration starts again.
   */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    if (this.paused()) {
      return T.failure({ kind: 'rate' });
    }
    const shared = this.online && this.client ? this.client : undefined;
    const client = shared ?? this.connect({ url: config.url, timers: this.timers, now: this.now });
    const options = shared ? {} : { timeout: TIMINGS.testTimeout, long: true };
    let result;
    let restart = false;
    try {
      await client.ping(options);
      const json = await client.configuration(options);
      if (!Array.isArray(json?.destinations)) {
        throw new WmsError('format', 'the configuration has no list of destinations');
      }
      const inventory = inventoryOf(json);
      restart = !this.online && this.running;
      result = T.test.ok({
        destinations: inventory.destinations.length,
        offered: inventory.destinations.filter((d) => roleOf(d)).length,
        scenes: inventory.scenes.length,
        rooms: inventory.rooms.length,
      });
    } catch (err) {
      if (err?.kind === 'rate' || err?.kind === 'server') {
        this.store.pauseUntil(this.now() + this.retryDelay(err));
      }
      if (!(err instanceof WmsError)) {
        this.logger.error('Connection test failed', err);
      }
      result = T.failure(err);
    } finally {
      if (!shared) {
        client.close?.();
      }
    }
    if (restart) {
      this.logger.info('The WebControl pro answers again (Test button): starting again');
      this.background(this.start(this.raw));
    }
    return result;
  }
}
