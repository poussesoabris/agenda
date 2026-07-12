# Contrat API — Agenda Pousses Ô Abris

Document de référence pour l'équipe front (webapp Angular).
Contact : Nicolas (nicolas@sov-dev.fr).

## Endpoint

```
GET https://<compte>.github.io/<repo>/events.json
```

> ⚠️ URL définitive à compléter à la création du dépôt GitHub (section « À venir » en bas).

- **Méthode** : GET uniquement. Pas d'authentification.
- **CORS** : ouvert (`Access-Control-Allow-Origin: *`, servi par GitHub Pages) — appelable depuis n'importe quelle origine.
- **Format** : JSON UTF-8.

## Principe fondamental : des occurrences journalières

L'API n'expose **pas** des « événements » mais des **occurrences d'un jour**.

- Un événement récurrent (ex. chantier tous les mardis) → une occurrence par séance.
- Un événement continu sur une période (ex. du 10 au 20 juillet) → **une occurrence par jour couvert** (11 occurrences), découpée à minuit **heure de Paris**.

Le front n'a donc **jamais** à gérer de plage multi-jours : chaque élément reçu tient dans une seule journée.

## Fraîcheur des données

Le fichier est régénéré depuis OpenAgenda par GitHub Actions **toutes les 15 minutes**
(cron `*/15 * * * *`, la minute exacte peut glisser légèrement selon la charge GitHub).
Une modification faite dans OpenAgenda apparaît donc dans l'API sous ~15 minutes.
Le champ `generatedAt` donne l'heure exacte de génération.

## Schéma de la réponse

```jsonc
{
  "generatedAt": "2026-07-12T09:41:23.512Z", // date de génération (ISO 8601 UTC)
  "agendaUid": 85936282,                      // uid de l'agenda OpenAgenda source
  "source": "https://api.openagenda.com/v2/agendas/85936282/events",
  "eventCount": 7,                            // nb d'événements OpenAgenda source
  "total": 87,                                // nb d'occurrences journalières exposées
  "occurrences": [ /* voir ci-dessous, triées par start croissant */ ]
}
```

### Une occurrence

```json
{
  "id": "17993156_2026-07-21_08:00",
  "eventUid": 17993156,
  "date": "2026-07-21",
  "start": "2026-07-21T08:00:00.000Z",
  "end": "2026-07-21T10:00:00.000Z",
  "startTimeLocal": "10:00",
  "endTimeLocal": "12:00",
  "partial": false,
  "position": "single",
  "title": "Atelier papier recyclé",
  "type": "atelier",
  "description": "Venez apprendre à fabriquer des cartes postales et du papier recyclé !…",
  "location": {
    "name": "Pousses Ô Abris - La Pépinière 192 route de Launaguet",
    "address": "192 route de Launaguet Toulouse",
    "city": "Toulouse",
    "latitude": 43.64465,
    "longitude": 1.439279
  },
  "image": "https://storage.openagenda.com/main/ceb2e021….base.image.jpg",
  "registrationUrl": "https://framaforms.org/inscription-atelier-papier-recycle-1781875583",
  "canonicalUrl": "https://openagenda.com/pousses-o-abris/events/17993156_atelier-papier-recycle-1419254"
}
```

### Champ par champ

| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique de l'occurrence (`eventUid_date_heureUTC`). Stable tant que l'horaire ne change pas. |
| `eventUid` | number | Uid de l'événement OpenAgenda parent — commun à toutes les occurrences d'un même événement (utile pour regrouper/dédupliquer). |
| `date` | string | Jour de l'occurrence, `AAAA-MM-JJ` **en heure de Paris**. Clé de regroupement pour un affichage calendrier. |
| `start` / `end` | string | Bornes exactes, ISO 8601 **UTC** (suffixe `Z`). Toujours contenues dans `date` (heure de Paris). `start < end`. |
| `startTimeLocal` / `endTimeLocal` | string | Heures locales Paris pré-formatées `HH:MM` — affichables telles quelles, aucun calcul de fuseau à faire côté front. |
| `partial` | boolean | `true` si l'occurrence est un segment d'un événement multi-jours découpé. |
| `position` | string | `single` (événement d'un jour) \| `start` / `middle` / `end` (position du segment dans un multi-jours). Permet d'afficher p. ex. « (suite) » ou « (dernier jour) ». |
| `title` | string | Titre (français). |
| `type` | string | `chantier` \| `atelier` \| `animation` \| `evenement`. ⚠️ Déduit du titre (heuristique) tant que l'asso ne renseigne pas de catégories dans OpenAgenda — à traiter comme indicatif. |
| `description` | string | Description courte (français). Peut être vide. |
| `location.name/address/city` | string\|null | Lieu. |
| `location.latitude/longitude` | number\|null | Coordonnées GPS (présentes sur tous les lieux actuels) — pour une carte. |
| `image` | string\|null | URL de l'affiche (hébergée par OpenAgenda). |
| `registrationUrl` | string\|null | Lien d'inscription (souvent Framaforms) — si `null`, pas d'inscription requise. |
| `canonicalUrl` | string | Fiche publique OpenAgenda de l'événement — lien « détails » de repli. |

## Conventions & recommandations front

- **Filtrage temporel côté client** : l'API renvoie **toutes** les occurrences (passées comprises). Volume minuscule (< 200/an). Filtrer sur `date >= aujourd'hui` (à calculer en heure de Paris) pour l'affichage standard.
- **Tri** : déjà trié par `start` croissant.
- **Regroupement calendrier** : grouper par `date`.
- **Bouton d'action** : `registrationUrl` si non-null (« S'inscrire »), sinon `canonicalUrl` (« Détails »).
- **Gestion d'erreur** : si le fetch échoue, afficher un lien de repli vers
  `https://openagenda.com/fr/pousses-o-abris`.
- **Cache navigateur** : GitHub Pages sert avec un `Cache-Control` court (~10 min). Un simple fetch au chargement suffit ; pas la peine de poller.

## Évolutions prévues (n'impactent pas ce contrat)

- Fiabilisation de `type` quand les catégories seront renseignées dans OpenAgenda (les valeurs pourront s'enrichir — prévoir un fallback d'affichage pour toute valeur inconnue).

## À venir / à compléter

- [ ] URL définitive de l'endpoint (après création du dépôt GitHub + activation de Pages).
- [ ] Éventuel domaine personnalisé (ex. `agenda-api.poussesoabris.fr`) si l'asso le souhaite.
