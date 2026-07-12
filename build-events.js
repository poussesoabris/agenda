/**
 * Génère dist/events.json : les événements OpenAgenda de Pousses Ô Abris
 * exposés en occurrences journalières (contrat : docs/CONTRAT-API.md).
 *
 * Usage : node build-events.js
 * Exécuté par GitHub Actions (cron horaire + manuel) puis publié sur Pages.
 */
const fs = require("fs");
const path = require("path");
const { AGENDA_UID, sourceUrl, fetchAllEvents, buildOccurrences } = require("./lib/openagenda");

const OUT_DIR = path.join(__dirname, "dist");
const OUT_FILE = path.join(OUT_DIR, "events.json");

async function main() {
  const events = await fetchAllEvents();
  const occurrences = buildOccurrences(events);

  const payload = {
    generatedAt: new Date().toISOString(),
    agendaUid: AGENDA_UID,
    source: sourceUrl(),
    eventCount: events.length,
    total: occurrences.length,
    occurrences,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`OK — ${events.length} événements → ${occurrences.length} occurrences journalières`);
  console.log(`Écrit : ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("ÉCHEC :", err.message || err);
  process.exit(1);
});
