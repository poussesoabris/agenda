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

## Source des données : API v2 (clé) avec repli legacy

Le code supporte **deux sources**, choisies automatiquement :

- **API v2 officielle** dès que la variable d'environnement `OPENAGENDA_KEY` est définie.
  En CI : créer le secret de dépôt `OPENAGENDA_KEY` (Settings → Secrets and variables →
  Actions) avec la clé API du compte OpenAgenda de l'asso — rien d'autre à changer.
  En local : `OPENAGENDA_KEY=xxx node build-events.js`.
- **Export legacy public** (déprécié par OpenAgenda) en repli tant que la clé n'est pas posée.

⚠️ Le mapping v2 (`normalizeV2Event` dans `lib/openagenda.js`) est écrit de façon
défensive mais n'a **pas encore tourné avec une clé réelle** : à la première exécution
avec la clé, vérifier que `node test-events.js` passe — les invariants valident le mapping.

## À savoir / dette assumée

- Le champ `type` est déduit du titre tant que les catégories ne sont pas renseignées
  dans OpenAgenda.
- Le CI déploie toutes les 15 min même si les données n'ont pas changé (`generatedAt`
  rend chaque JSON unique). Simple et sans état ; si GitHub venait à limiter les
  déploiements, comparer le contenu hors `generatedAt` et sauter le déploiement.
