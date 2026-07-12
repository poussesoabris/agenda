# Agenda API — Pousses Ô Abris

Expose l'agenda [OpenAgenda de Pousses Ô Abris](https://openagenda.com/fr/pousses-o-abris)
sous forme d'**occurrences journalières** en JSON statique, régénéré automatiquement
et publié sur GitHub Pages. Consommé par le front (webapp Angular).

📄 **Le contrat de données pour le front : [docs/CONTRAT-API.md](docs/CONTRAT-API.md)**

## Comment ça marche

```
OpenAgenda (saisie par les bénévoles)
        │  lecture toutes les 15 min (GitHub Actions, cron)
        ▼
build-events.js  →  dist/events.json  →  publié sur GitHub Pages
        ▲                                        │
   test-events.js (bloque le déploiement         ▼
   si les invariants cassent)              front Angular (GET)
```

Particularité métier : un événement couvrant une période (ex. 10 → 20 juillet)
est **découpé en une occurrence par jour** (11 occurrences), bornées à minuit
heure de Paris. Les événements récurrents sont dépliés séance par séance.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/openagenda.js` | Logique partagée : lecture OpenAgenda, découpage journalier, fuseau Paris |
| `build-events.js` | Génère `dist/events.json` (exécuté par le CI) |
| `test-events.js` | Tests unitaires (découpage, DST) + invariants sur le JSON généré |
| `.github/workflows/build-events.yml` | Cron 15 min + bouton manuel + push → build, tests, déploiement Pages |
| `api-agenda.js` | Outil de dev local : même logique servie en live sur `http://localhost:8787/events` avec filtres |
| `agenda.html`, `agenda-officiel.html`, `_serve.js` | Démos front historiques (rendu maison / iframe officielle) — `node _serve.js` pour les voir |

## Développement local

```bash
node build-events.js   # génère dist/events.json
node test-events.js    # vérifie tout
node api-agenda.js     # API live de dev sur :8787 (optionnel)
```

Aucune dépendance npm — Node ≥ 18 suffit.

## Rafraîchir manuellement (ex. annulation de dernière minute)

Onglet **Actions** du dépôt → workflow « Build agenda events » → **Run workflow**.
Sinon, le cron passe toutes les 15 minutes.

## À savoir / dette assumée

- Source actuelle : **export legacy** OpenAgenda (public, sans clé), officiellement déprécié.
  Migration prévue vers l'API v2 + clé (secret GitHub Actions) — seul `lib/openagenda.js`
  (`fetchAllEvents`) est à adapter, le contrat front ne change pas.
- Le champ `type` est déduit du titre tant que les catégories ne sont pas renseignées
  dans OpenAgenda.
