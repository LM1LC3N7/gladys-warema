import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, reasonOf } from '../src/i18n.js';
import { WmsError, networkError } from '../src/wms.js';

test('the reasons of the errors in French, the HTTP statuses and codes kept as they are (M5)', () => {
  const fr = (err) => reasonOf(err).fr;
  assert.equal(fr(new WmsError('rate', 'x', { status: 429 })), 'trop de demandes (HTTP 429)');
  assert.equal(fr(new WmsError('server', 'x', { status: 503 })), 'erreur (HTTP 503)');
  assert.equal(fr(new WmsError('denied', 'x', { status: 403 })), 'accès refusé (HTTP 403)');
  assert.equal(fr(new WmsError('notfound', 'x', { status: 404 })), 'introuvable (HTTP 404)');
  assert.equal(fr(new WmsError('redirect', 'x', { status: 302 })), 'redirection (HTTP 302)');
  assert.equal(fr(new WmsError('refused', 'x', { codes: ['0x30007'] })), 'erreur 0x30007');
  assert.equal(fr(new WmsError('busy', 'x', { codes: ['0x50005'] })), 'occupée (0x50005)');
  assert.equal(fr(new WmsError('timeout', 'x', { seconds: 3 })), 'pas de réponse en 3 s');
  assert.equal(fr(new WmsError('size', 'x')), 'réponse trop grande');
  assert.equal(fr(networkError({ code: 'ECONNREFUSED' }, false)), 'connexion refusée');
  assert.equal(fr(networkError({ code: 'EWHATEVER' }, false)), 'erreur réseau');
  assert.equal(reasonOf(new WmsError('rate', 'x')).en, 'too many requests (HTTP 429)');
  assert.match(T.failure(new WmsError('server', 'x', { status: 500 })).fr, /erreur \(HTTP 500\)/);
});
