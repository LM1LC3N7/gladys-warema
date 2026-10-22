// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. They also guard
// the text files against mojibake and a BOM (lesson of the first wave).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, LANGUAGES, POLL_INTERVAL } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-warema:${manifest.version}`);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.version, pkg.version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-warema/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`)
      .replace(/\*\*/g, '')
      .replace(/\s*\n>?\s*/g, ' ');
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+WAREMA|sans\s+lien\s+avec\s+WAREMA/);
    assert.match(
      docs,
      /never\s+been\s+tested\s+with\s+a\s+real\s+WebControl\s+pro|jamais\s+été\s+testée\s+avec\s+une\s+vraie\s+WebControl\s+pro/,
    );
  }
  assert.match(read('README.md'), /never been tested with a real WebControl pro/);
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('no mojibake (UTF-8 read as Latin-1) nor BOM in the text files', () => {
  // "Ã©" for "é", "Â " for a no-break space, "â€" for a dash or a quote…
  const mojibake = /[ÂÃ][\u0080-¿€]|â€|Âµ/;
  for (const path of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'THIRD_PARTY_NOTICES.md',
    'src/i18n.js',
  ]) {
    const text = read(path);
    assert.ok(!text.startsWith('﻿'), `${path} starts with a BOM`);
    const match = mojibake.exec(text);
    assert.equal(match, null, `${path}: mojibake "${match?.[0]}" at ${match?.index}`);
  }
});

test('the Apache-2.0 notices of pywmspro and of its Home Assistant integration ship with the code', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /mback2k\/pywmspro/);
  assert.match(notices, /0\.4\.2/);
  assert.match(notices, /home-assistant\/core/);
  assert.match(notices, /Apache License/);
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY .*LICENSE/);
  assert.match(dockerfile, /COPY .*THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License/);
  // Louis's rule: no name in the LICENSE (the appendix keeps its placeholders).
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.doesNotMatch(license, /Louis|Milcent|LM1LC3N7|mback2k|Hoersken|Gladys/i);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || value !== '') {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(field.key in DEFAULTS, `${field.key} has no default in the code`);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.box_address.required, true);
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max],
    [POLL_INTERVAL.min, POLL_INTERVAL.max],
  );
  assert.equal(fields.allow_load_switches.default, false, 'switched loads off by default');
  assert.equal(fields.publish_tilt.default, false, 'the slats device off by default');
  for (const lang of ['en', 'fr']) {
    assert.match(fields.publish_tilt.description[lang], /Google, Alexa, HomeKit/);
  }
  assert.equal(
    manifest.config_schema.filter((f) => f.type === 'secret').length,
    0,
    'the API has no credentials',
  );
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
  }
  assert.ok(intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.ok(handlers.includes('onSetValue'), 'the commands go through onSetValue');
  for (const item of manifest.actions) {
    assert.ok(item.timeout_seconds >= 5 && item.timeout_seconds <= 120, item.key);
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('nothing says "encrypted" (Gladys keeps its configuration in clear in its database)', () => {
  for (const path of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
  ]) {
    assert.doesNotMatch(read(path), /encrypt|chiffr/i, path);
  }
});

test('no code path relearns a scene nor changes the configuration of the box', () => {
  const client = `${read('src/wms.js')}\n${read('src/constants.js')}`;
  // Only these commands exist in the client: no relearn, no configuration change.
  const commands = [...read('src/constants.js').matchAll(/^\s{4}\w+: '(\w+)',$/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(commands, ['ping', 'getConfiguration', 'getStatus', 'action', 'sceneActions']);
  assert.match(client, /sceneActionType: SCENE_ACTION\.EXECUTE/);
  assert.doesNotMatch(read('src/wms.js'), /SCENE_ACTION\.RELEARN/);
  // The protections of the box are never overridden: no automatic resend of a refused command.
  assert.doesNotMatch(read('src/app.js'), /retry.*refused|resend/i);
});

test('the docs and the option say that a WAREMA scene runs as it is (I4)', () => {
  const field = manifest.config_schema.find((f) => f.key === 'allow_load_switches');
  assert.match(
    field.description.en,
    /A WAREMA scene runs as it is, even when it holds a switched load/,
  );
  assert.match(field.description.en, /does not block it/);
  assert.match(
    field.description.fr,
    /Une scène WAREMA s'exécute telle quelle, même si elle contient une charge commutée \(chauffage\) ou une fenêtre/,
  );
  assert.match(field.description.fr, /ne la bloque pas/);
  const en = read('docs/en.md').replace(/\*\*/g, '').replace(/\s+/g, ' ');
  const fr = read('docs/fr.md').replace(/\*\*/g, '').replace(/\s+/g, ' ');
  assert.match(
    en,
    /A WAREMA scene runs as it is, even when it holds a switched load \(a heater\) or a window/,
  );
  assert.match(
    fr,
    /Une scène WAREMA s'exécute telle quelle, même si elle contient une charge commutée \(chauffage\) ou une fenêtre/,
  );
});

test('the docs say Open = retract an awning, and that "close the curtains" extends them (M2)', () => {
  const en = read('docs/en.md').replace(/\*\*/g, '').replace(/\s+/g, ' ');
  const fr = read('docs/fr.md').replace(/\*\*/g, '').replace(/\s+/g, ' ');
  assert.match(en, /Open = retract the awning/);
  assert.match(en, /"close the curtains" .*extends the awnings/);
  assert.match(fr, /Ouvrir = rentrer le store banne/);
  assert.match(fr, /« ferme les rideaux » .*déploie les stores bannes/);
  assert.match(fr, /toitures à lames sont en lecture seule/);
  assert.match(read('TODO.md'), /Slat roofs read-only in v1/);
});
