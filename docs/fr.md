# WAREMA WebControl pro

Cette intégration relie Gladys à **votre WAREMA WMS WebControl pro** par son
**API locale**, et propose les canaux de votre installation dans l'onglet
**Découverte** de Gladys : volets roulants, stores à lamelles, stores bannes,
toitures à lames, lumières et charges commutées, ainsi que vos **scènes
WAREMA**. Une fois un appareil ajouté, Gladys lit son état à l'intervalle que
vous choisissez et le pilote par la box. Tout reste sur votre réseau local :
pas de cloud. Non officiel, sans lien avec WAREMA.

> **Version de développement (0.1).** Écrite d'après la documentation de l'API
> WAREMA et la bibliothèque pywmspro, et testée contre une box simulée
> seulement : elle n'a **jamais été testée avec une vraie WebControl pro**
> pour l'instant. Vos retours sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

| Canal WAREMA                   | Dans Gladys                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Volet roulant / store          | un volet : ouverture, fermeture, arrêt, position, et la cause de son dernier mouvement                |
| Store à lamelles               | un volet : ouverture, fermeture, arrêt, position ; les **lamelles** en appareil séparé, sur demande   |
| Store banne                    | un rideau : ouverture (= rentrer), fermeture (= déployer), arrêt, position ; son **lambrequin** aussi |
| Toiture à lames (lames seules) | un volet, **en lecture seule** pour l'instant : position des lames, cause du dernier mouvement        |
| Variateur                      | une lumière : allumage et luminosité (0-100 %)                                                        |
| Interrupteur de lumière        | une lumière : allumage                                                                                |
| Charge commutée                | un état en lecture seule et des boutons « Allumer » / « Éteindre », **désactivés par défaut**         |
| Scène WAREMA                   | un bouton « Lancer » : la scène s'exécute comme depuis l'app WAREMA                                   |

Les stores et volets ne sont **jamais** des interrupteurs : une scène « tout
éteindre » ne les ferme pas. La position suit la convention de Gladys : 100 %
= ouvert, 0 % = fermé (WAREMA compte à l'envers : 0 % ouvert, 100 % fermé).
Ouvrir ou fermer complètement un store à lamelles ouvre ou ferme aussi ses
lamelles, comme l'app WAREMA.

**Stores bannes : Ouvrir = rentrer le store banne** (0 % pour WAREMA, comme
dans Home Assistant), Fermer = le déployer ; position 100 % = rentré. Gladys
n'a pas de type « store banne » : les stores bannes et leur lambrequin sont
des **rideaux**. Attention : un « ferme les rideaux » d'une scène, de Google,
d'Alexa, de HomeKit ou d'un assistant (MCP) **déploie les stores bannes**.
Vérifiez le sens chez vous, et dites-nous si c'est l'inverse.

Les **toitures à lames** sont en lecture seule pour l'instant (position des
lames et cause du dernier mouvement) : leur sens et leur plage ne sont pas
encore vérifiés sur une vraie box.

L'**arrêt** passe toujours en premier : il n'attend jamais derrière une autre
commande du même produit, ni derrière une lecture, et les mouvements de ce
produit encore en attente sont abandonnés. Un arrêt part sans attendre la
réponse détaillée de la box ; sans réponse en 1 s, il est annoncé « envoyée,
sans confirmation » et le produit est relu.

Les moteurs de fenêtre, les actionneurs libres de potentiel, les variateurs de
charge et la commande « identifier » ne sont pas encore proposés.

### Protections vent, pluie et gel

Les protections de la WebControl pro (vent, pluie, gel, température, sécurité)
**gardent toujours la main** : Gladys n'essaie jamais de les contourner. Une
commande refusée par la box est annoncée **telle que la box l'a dit** (son code
d'erreur), avec la dernière protection qu'elle a indiquée pour ce produit, et
Gladys ne la renvoie jamais d'elle-même. Chaque volet ou store a un texte en
lecture seule « Cause du dernier mouvement » (soleil, alarme vent, alarme
pluie, horaire, manuel…), utilisable dans vos scènes, et son badge passe à
l'orange tant qu'une protection est active, que la box indique le produit
comme bloqué, ou qu'elle ne le joint plus par radio.

## Prérequis

- Une WAREMA WMS WebControl pro (version de conteneur 11H ou plus, qui apporte
  l'API) configurée avec WMS studio pro, sur le même réseau local que Gladys.
- Son adresse IP, de préférence fixe (réservée dans votre box internet).

L'API de la WebControl pro n'a **pas de mot de passe** : n'importe qui sur
votre réseau peut s'en servir, avec ou sans Gladys. Gardez la box sur un réseau
de confiance.

## Installation

1. Dans Gladys, ouvrez l'intégration **WAREMA WebControl pro**, onglet
   **Configuration**.
2. Saisissez l'**adresse IP** de la box (par exemple `192.168.1.30`) et
   enregistrez.
3. Cliquez sur **Tester la connexion** : le nombre de canaux, de scènes et de
   pièces s'affiche.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

## Options

- **Intervalle de lecture** (30 s par défaut, 10 à 3600 s) : fréquence de
  lecture des états des appareils **ajoutés**. Seuls ceux-là sont lus : chaque
  lecture passe par la radio WMS, un canal toutes les demi-secondes. Après une
  commande, le canal est relu quelques fois pendant qu'il bouge.
- **Autoriser les charges commutées** (désactivé par défaut) : une charge
  commutée pilote souvent un chauffage de terrasse. Tant que l'option est
  désactivée, ses boutons sont refusés, et l'option est relue juste avant
  chaque envoi. Ce sont des boutons, jamais un interrupteur : un « tout
  éteindre » ne les atteint pas. **Une scène WAREMA s'exécute telle quelle**,
  même si elle contient une charge commutée (chauffage) ou une fenêtre : cette
  option ne la bloque pas.
- **Lamelles des stores en appareil séparé** (désactivé par défaut) : chaque
  store à lamelles propose aussi un appareil « <store> – Lamelles » (0-100 %).
  Attention : un « fermer tous les stores » de Google, Alexa, HomeKit ou d'un
  assistant (MCP) peut aussi viser cet appareil.
- **Langue des noms des fonctionnalités** : français ou anglais.

## Sécurité et vie privée

- Gladys ne parle qu'à l'adresse saisie, en HTTP simple sur votre réseau local ;
  les redirections ne sont jamais suivies. Il n'y a aucun secret à garder.
- Les commandes partent une à une par canal, en moins de 3,5 s, ou sont
  refusées. Une commande qui a pu partir sans réponse (délai dépassé une fois
  envoyée, réponse incomprise) est annoncée « envoyée, sans confirmation » et
  le canal est relu ; un refus de la box est annoncé « refusée » avec son code ;
  une box injoignable avant l'envoi donne « non envoyée ».
- Un « 429 » ou une erreur serveur de la box met tout en pause (1 minute à
  6 heures), et la pause survit à un redémarrage. Après un échec, Gladys
  n'interroge jamais la box plus souvent que l'intervalle de lecture.
- Les scènes ne sont jamais réenregistrées, et rien ne modifie la configuration
  de la box.

## Dépannage

- **« Injoignable »** : vérifiez l'adresse IP (pas de nom en `.local`, le
  conteneur ne les résout pas) et que la box est alimentée.
- **« Ne répond pas comme une WMS WebControl pro »** : l'adresse répond, mais
  pas avec l'API ; vérifiez l'adresse, et que la box a une version avec l'API.
- **Badge orange** : survolez-le : une protection est active, le produit est
  bloqué, hors de portée radio, ou une commande n'est pas encore confirmée.

## Crédits

Logique reprise de [pywmspro](https://github.com/mback2k/pywmspro) (Apache-2.0)
et de l'intégration `wmspro` de Home Assistant (Apache-2.0), d'après la
documentation de l'API publiée par WAREMA. WAREMA est une marque de WAREMA
Renkhoff SE ; ce projet est sans lien avec WAREMA.
