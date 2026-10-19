import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseBoxAddress } from '../src/config.js';

test('the address of the WebControl pro', () => {
  assert.deepEqual(parseBoxAddress('192.168.1.30'), {
    url: 'http://192.168.1.30',
    host: '192.168.1.30',
  });
  assert.equal(parseBoxAddress(' http://192.168.1.30/ ').url, 'http://192.168.1.30');
  assert.equal(parseBoxAddress('http://192.168.1.30/commonCommand').url, 'http://192.168.1.30');
  assert.equal(parseBoxAddress('webcontrol').url, 'http://webcontrol');
  assert.equal(parseBoxAddress('192.168.1.30:8080').url, 'http://192.168.1.30:8080');
  assert.equal(parseBoxAddress('[fd00::30]').url, 'http://[fd00::30]');
  assert.equal(parseBoxAddress('').error, 'empty');
  assert.equal(parseBoxAddress('https://192.168.1.30').error, 'https');
  assert.equal(parseBoxAddress('ftp://192.168.1.30').error, 'invalid');
  assert.equal(parseBoxAddress('http://u:p@192.168.1.30').error, 'credentials');
  assert.equal(parseBoxAddress('http://192.168.1.30/system').error, 'path');
  assert.equal(parseBoxAddress('http://192.168.1.30/?x=1').error, 'path');
  assert.equal(parseBoxAddress('webcontrol.local').error, 'local-name');
  assert.equal(parseBoxAddress('http://[::1').error, 'invalid');
});

test('the configuration, normalized', () => {
  const c = normalizeConfig({ box_address: '192.168.1.30' });
  assert.equal(c.error, undefined);
  assert.equal(c.url, 'http://192.168.1.30');
  assert.equal(c.pollInterval, 30);
  assert.equal(c.language, 'fr');
  assert.equal(c.publishTilt, false, 'the slats device off by default');
  assert.equal(c.allowLoads, false, 'switched loads read-only by default');
  assert.equal(normalizeConfig({}).error, 'empty');
  const bounded = normalizeConfig({
    ...DEFAULTS,
    box_address: '1.2.3.4',
    poll_interval: 1,
    language: 'de',
    allow_load_switches: 'true',
    publish_tilt: '1',
  });
  assert.equal(bounded.pollInterval, 10);
  assert.equal(bounded.language, 'fr');
  assert.equal(bounded.allowLoads, true);
  assert.equal(bounded.publishTilt, true);
  assert.equal(normalizeConfig({ box_address: 'x', poll_interval: 99999 }).pollInterval, 3600);
  assert.equal(normalizeConfig({ box_address: 'x', allow_load_switches: 'yes' }).allowLoads, false);
});
