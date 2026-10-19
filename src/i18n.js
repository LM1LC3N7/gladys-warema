// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges, refusals, feature
// names), in English and French.
// -----------------------------------------------------------------------------

import { DRIVING_CAUSE as D, LIMITS } from './constants.js';

/** Feature and device names, by key. */
const LABELS = {
  on: { en: 'On/off', fr: 'Allumage' },
  brightness: { en: 'Brightness', fr: 'Luminosité' },
  state: { en: 'State', fr: 'État' },
  position: { en: 'Position', fr: 'Position' },
  tilt: { en: 'Slats', fr: 'Lamelles' },
  valance: { en: 'Valance', fr: 'Lambrequin' },
  cause: { en: 'Last movement cause', fr: 'Cause du dernier mouvement' },
  turn_on: { en: 'Turn on', fr: 'Allumer' },
  turn_off: { en: 'Turn off', fr: 'Éteindre' },
  run: { en: 'Run', fr: 'Lancer' },
  scene: { en: 'WAREMA scene', fr: 'Scène WAREMA' },
};

/** The label of a key in a language. */
export function label(key, language = 'fr') {
  return LABELS[key]?.[language] ?? LABELS[key]?.en ?? key;
}

/** One text of a { en, fr } pair, in a language. */
export const word = (pair, language = 'fr') => pair?.[language] ?? pair?.en ?? '';

/** The driving causes of getStatus (WAREMA documentation, "DrivingCause"). */
const CAUSES = new Map([
  [D.NONE, { en: 'None', fr: 'Aucune' }],
  [D.SUN, { en: 'Sun', fr: 'Soleil' }],
  [D.DUSK_DAWN, { en: 'Dusk/dawn', fr: 'Crépuscule/aube' }],
  [D.WIND, { en: 'Wind alarm', fr: 'Alarme vent' }],
  [D.RAIN, { en: 'Rain alarm', fr: 'Alarme pluie' }],
  [D.ICE, { en: 'Ice alarm', fr: 'Alarme gel' }],
  [D.TEMPERATURE, { en: 'Temperature', fr: 'Température' }],
  [D.SWITCHING_TIME, { en: 'Timer', fr: 'Horaire' }],
  [D.SCENE, { en: 'Scene', fr: 'Scène' }],
  [D.CONTROL_MODE, { en: 'Control mode', fr: 'Mode de commande' }],
  [D.MANUAL, { en: 'Manual', fr: 'Manuel' }],
  [D.SAFETY, { en: 'Safety', fr: 'Sécurité' }],
  [D.CONTACT, { en: 'Contact', fr: 'Contact' }],
  [D.CENTRAL_COMMAND, { en: 'Central command', fr: 'Commande centrale' }],
]);

/** A driving cause as a text ("Unknown (n)" for a code not in the documentation). */
export function causeText(cause, language = 'fr') {
  const pair = CAUSES.get(cause);
  if (pair) {
    return word(pair, language);
  }
  return language === 'fr' ? `Inconnue (${cause})` : `Unknown (${cause})`;
}

const trim = (text) =>
  text.length > LIMITS.badgeMessage ? `${text.slice(0, LIMITS.badgeMessage - 1)}…` : text;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const NETWORK = {
  ECONNREFUSED: { en: 'connection refused', fr: 'connexion refusée' },
  ECONNRESET: { en: 'connection reset', fr: 'connexion interrompue' },
  EHOSTUNREACH: { en: 'host unreachable', fr: 'hôte injoignable' },
  ENETUNREACH: { en: 'network unreachable', fr: 'réseau injoignable' },
  ENOTFOUND: { en: 'unknown host name', fr: "nom d'hôte inconnu" },
  EAI_AGAIN: { en: 'host name not resolved', fr: "nom d'hôte non résolu" },
  ETIMEDOUT: { en: 'connection timed out', fr: 'délai de connexion dépassé' },
  EPIPE: { en: 'connection closed', fr: 'connexion fermée' },
};

/**
 * The reason of an error in English and French. The HTTP statuses and the
 * error codes of the box are kept as they are.
 */
export function reasonOf(err) {
  const http = err?.status !== undefined ? ` (HTTP ${err.status})` : '';
  const codes = Array.isArray(err?.codes) ? err.codes.join(', ') : '';
  switch (err?.kind) {
    case 'refused':
      return codes
        ? { en: `error ${codes}`, fr: `erreur ${codes}` }
        : { en: 'error without a code', fr: 'erreur sans code' };
    case 'busy':
      return { en: `busy (${codes || '0x50005'})`, fr: `occupée (${codes || '0x50005'})` };
    case 'rate':
      return { en: 'too many requests (HTTP 429)', fr: 'trop de demandes (HTTP 429)' };
    case 'denied':
      return { en: `access refused${http}`, fr: `accès refusé${http}` };
    case 'notfound':
      return { en: 'not found (HTTP 404)', fr: 'introuvable (HTTP 404)' };
    case 'redirect':
      return { en: `redirected${http}`, fr: `redirection${http}` };
    case 'server':
    case 'http':
      return { en: `error${http}`, fr: `erreur${http}` };
    case 'size':
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case 'format':
      return {
        en: 'not an answer of a WMS WebControl pro',
        fr: "pas une réponse d'une WMS WebControl pro",
      };
    case 'timeout': {
      const s = err.seconds ?? '?';
      return { en: `no answer within ${s} s`, fr: `pas de réponse en ${s} s` };
    }
    case 'network':
      return NETWORK[err.netCode] ?? { en: 'network error', fr: 'erreur réseau' };
    default:
      return { en: err?.message ?? 'unknown error', fr: err?.message ?? 'erreur inconnue' };
  }
}

/** Why the box is unreachable or refuses, with the hint that fits. */
function failure(err) {
  const reason = reasonOf(err);
  switch (err?.kind) {
    case 'rate':
      return {
        en: 'The WebControl pro asked to slow down (HTTP 429): everything is paused for a while.',
        fr: 'La WebControl pro demande de ralentir (HTTP 429) : tout est en pause pour un moment.',
      };
    case 'server':
      return {
        en: `The WebControl pro answers with an error (${reason.en}): paused for a while, then tried again.`,
        fr: `La WebControl pro répond par une erreur (${reason.fr}) : pause d'un moment, puis nouvel essai.`,
      };
    case 'notfound':
    case 'format':
    case 'redirect':
    case 'denied':
    case 'http':
      return {
        en: `This address does not answer like a WMS WebControl pro (${reason.en}). Type its IP address, like 192.168.1.30.`,
        fr: `Cette adresse ne répond pas comme une WMS WebControl pro (${reason.fr}). Saisissez son adresse IP, par exemple 192.168.1.30.`,
      };
    case 'refused':
    case 'busy':
      return {
        en: `The WebControl pro refused the request (${reason.en}). Tried again in a moment.`,
        fr: `La WebControl pro a refusé la demande (${reason.fr}). Nouvel essai dans un moment.`,
      };
    default:
      return {
        en: `The WebControl pro is unreachable: ${reason.en}. Check its IP address and that it is on. Retrying in a moment.`,
        fr: `La WebControl pro est injoignable : ${reason.fr}. Vérifiez son adresse IP et qu'elle est allumée. Nouvel essai dans un moment.`,
      };
  }
}
const CONFIG_ERRORS = {
  empty: {
    en: 'Type the IP address of your WMS WebControl pro in the configuration, like 192.168.1.30.',
    fr: "Saisissez l'adresse IP de votre WMS WebControl pro dans la configuration, par exemple 192.168.1.30.",
  },
  invalid: {
    en: 'The address of the WebControl pro is not valid: type its IP address, like 192.168.1.30.',
    fr: "L'adresse de la WebControl pro n'est pas valide : saisissez son adresse IP, par exemple 192.168.1.30.",
  },
  https: {
    en: 'The API of the WebControl pro answers in plain http:// on your network: type its IP address alone, like 192.168.1.30.',
    fr: "L'API de la WebControl pro répond en http:// simple sur votre réseau : saisissez seulement son adresse IP, par exemple 192.168.1.30.",
  },
  credentials: {
    en: 'The address must not contain a user name nor a password.',
    fr: "L'adresse ne doit contenir ni nom d'utilisateur ni mot de passe.",
  },
  path: {
    en: 'Type the address of the WebControl pro alone, like 192.168.1.30 (no path, no ?…).',
    fr: "Saisissez l'adresse de la WebControl pro seule, par exemple 192.168.1.30 (sans chemin ni ?…).",
  },
  'local-name': {
    en: 'Names ending in .local do not resolve in the integration container: type the IP address of the WebControl pro.',
    fr: "Les noms en .local ne sont pas résolus dans le conteneur de l'intégration : saisissez l'adresse IP de la WebControl pro.",
  },
};

export const T = {
  configError: (error) => CONFIG_ERRORS[error] ?? CONFIG_ERRORS.invalid,
  connecting: {
    en: 'Connecting to the WMS WebControl pro…',
    fr: 'Connexion à la WMS WebControl pro…',
  },
  failure,
  /** Connected: what is offered, and how the states follow. */
  connected({ destinations, scenes }, pollInterval) {
    return {
      en: `Connected to the WebControl pro: ${plural(destinations, 'channel', 'channels')}, ${plural(scenes, 'scene', 'scenes')} offered in Discovery. The states of the devices added are read every ${pollInterval} s.`,
      fr: `Connecté à la WebControl pro : ${plural(destinations, 'canal', 'canaux')}, ${plural(scenes, 'scène', 'scènes')} proposés dans l'onglet Découverte. Les états des appareils ajoutés sont lus toutes les ${pollInterval} s.`,
    };
  },
  badge: {
    unconfirmed: {
      en: 'Command sent, not confirmed by the WebControl pro yet.',
      fr: 'Commande envoyée, pas encore confirmée par la WebControl pro.',
    },
    radio: {
      en: 'The product does not answer the WebControl pro over the radio.',
      fr: 'Le produit ne répond plus à la WebControl pro par radio.',
    },
    blocking: {
      en: 'Blocked by the WebControl pro (a protection, a manual command or a fault).',
      fr: 'Bloqué par la WebControl pro (une protection, une commande manuelle ou un défaut).',
    },
    protection: (cause) => ({
      en: trim(`Protection of the WebControl pro: ${causeText(cause, 'en')}.`),
      fr: trim(`Protection de la WebControl pro : ${causeText(cause, 'fr')}.`),
    }),
  },
  denied: {
    notCommand: {
      en: 'This feature cannot be controlled.',
      fr: 'Cette fonctionnalité ne peut pas être pilotée.',
    },
    notConnected: {
      en: 'The WebControl pro is not connected: command not sent.',
      fr: "La WebControl pro n'est pas connectée : commande non envoyée.",
    },
    paused: {
      en: 'The WebControl pro asked to slow down: command not sent, try again in a moment.',
      fr: 'La WebControl pro demande de ralentir : commande non envoyée, réessayez dans un moment.',
    },
    tooLate: {
      en: 'The command waited too long behind another request to the WebControl pro: not sent.',
      fr: 'La commande a attendu trop longtemps derrière une autre demande à la WebControl pro : non envoyée.',
    },
    stopped: {
      en: 'A stop of this product arrived meanwhile: this command is dropped, not sent.',
      fr: 'Un arrêt de ce produit est arrivé entre-temps : cette commande est abandonnée, non envoyée.',
    },
    notSent: (err) => ({
      en: `The WebControl pro could not be reached (${reasonOf(err).en}): command not sent.`,
      fr: `La WebControl pro n'a pas pu être jointe (${reasonOf(err).fr}) : commande non envoyée.`,
    }),
    badValue: {
      en: 'Value not accepted for this feature: command not sent.',
      fr: 'Valeur non acceptée pour cette fonctionnalité : commande non envoyée.',
    },
    noStop: {
      en: 'This product has no stop command in the WebControl pro: not sent.',
      fr: "Ce produit n'a pas de commande d'arrêt dans la WebControl pro : non envoyée.",
    },
    loadsOff: {
      en: 'Switched loads are read-only: allow them in the configuration first.',
      fr: "Les charges commutées sont en lecture seule : autorisez-les d'abord dans la configuration.",
    },
    unconfirmed: {
      en: 'Command sent to the WebControl pro, without confirmation: its state is read again.',
      fr: 'Commande envoyée à la WebControl pro, sans confirmation : son état est relu.',
    },
    unconfirmedScene: {
      en: 'Scene sent to the WebControl pro, without confirmation.',
      fr: 'Scène envoyée à la WebControl pro, sans confirmation.',
    },
    /**
     * The box refused the command: its answer as it is, and the protection or
     * blocking it last reported for this product, if any.
     */
    refused: (err, context) => {
      const reason = reasonOf(err);
      const en = [`The WebControl pro refused the command: ${reason.en}.`];
      const fr = [`La WebControl pro a refusé la commande : ${reason.fr}.`];
      if (context?.cause !== undefined) {
        en.push(`Last cause it reported: ${causeText(context.cause, 'en')}.`);
        fr.push(`Dernière cause indiquée : ${causeText(context.cause, 'fr')}.`);
      }
      if (context?.blocking) {
        en.push('It reports the product as blocked.');
        fr.push('Elle indique le produit comme bloqué.');
      }
      return { en: en.join(' '), fr: fr.join(' ') };
    },
  },
  test: {
    ok({ destinations, offered, scenes, rooms }) {
      return {
        en: `Connection OK: WMS WebControl pro with ${plural(destinations, 'channel', 'channels')} (${offered} offered in Gladys), ${plural(scenes, 'scene', 'scenes')}, ${plural(rooms, 'room', 'rooms')}.`,
        fr: `Connexion OK : WMS WebControl pro avec ${plural(destinations, 'canal', 'canaux')} (${offered} proposés dans Gladys), ${plural(scenes, 'scène', 'scènes')}, ${plural(rooms, 'pièce', 'pièces')}.`,
      };
    },
  },
};
