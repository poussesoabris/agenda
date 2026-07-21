/**
 * Tests de build-events / lib/openagenda.
 * 1. Unitaires : découpage journalier (cas synthétiques, dont 10→20 juillet = 11 jours).
 * 2. Intégration : invariants sur dist/events.json (généré par build-events.js).
 *
 * Usage : node build-events.js && node test-events.js
 * Sort en code 1 à la première assertion en échec (utilisé par le CI).
 */
const fs = require("fs");
const path = require("path");
const { splitByDay, dayKey, isPubliable } = require("./lib/openagenda");

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  ÉCHEC ${label}${detail ? " — " + detail : ""}`);
  }
}

/* ---------- 1. tests unitaires du découpage ---------- */

console.log("Unitaires — splitByDay");

{
  const segs = splitByDay("2026-07-10T14:00:00.000Z", "2026-07-20T17:00:00.000Z");
  check("10→20 juillet = 11 occurrences", segs.length === 11, `obtenu : ${segs.length}`);
  check("première position = start", segs[0].position === "start");
  check("dernière position = end", segs[segs.length - 1].position === "end");
  check("9 positions middle", segs.filter((s) => s.position === "middle").length === 9);
  check("dates consécutives sans trou", segs.every((s, i) => i === 0 || s.date > segs[i - 1].date));
  check("chaque segment reste dans son jour (Paris)",
    segs.every((s) => dayKey(s.start) === s.date && dayKey(s.end) === s.date));
}

{
  const segs = splitByDay("2026-06-16T13:00:00.000Z", "2026-06-16T16:00:00.000Z");
  check("séance d'un seul jour = 1 occurrence single", segs.length === 1 && segs[0].position === "single" && !segs[0].partial);
}

{
  // à cheval sur le changement d'heure d'octobre (fin du DST le 25/10/2026)
  const segs = splitByDay("2026-10-24T10:00:00.000Z", "2026-10-26T15:00:00.000Z");
  check("découpage traversant le changement d'heure : 3 jours", segs.length === 3, `obtenu : ${segs.length}`);
  check("bornes cohérentes malgré le DST",
    segs.every((s) => dayKey(s.start) === s.date && dayKey(s.end) === s.date));
}

console.log("Unitaires — isPubliable");

{
  const publie = { state: 2, draft: 0, private: 0, valid: true };
  check("événement publié accepté", isPubliable(publie));
  check("en modération (state 0) rejeté", !isPubliable({ ...publie, state: 0 }));
  check("prêt à publier (state 1) rejeté", !isPubliable({ ...publie, state: 1 }));
  check("brouillon rejeté", !isPubliable({ ...publie, draft: 1 }));
  check("événement privé rejeté", !isPubliable({ ...publie, private: 1 }));
  check("événement invalide rejeté", !isPubliable({ ...publie, valid: false }));
}

/* ---------- 2. invariants sur dist/events.json ---------- */

console.log("Intégration — dist/events.json");

const OUT = path.join(__dirname, "dist", "events.json");
if (!fs.existsSync(OUT)) {
  console.error("  ÉCHEC dist/events.json absent — lancer d'abord : node build-events.js");
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(OUT, "utf8"));
const occ = payload.occurrences;

check("total > 0", payload.total > 0);
check("total = occurrences.length", payload.total === occ.length);
check("generatedAt présent et ISO", !Number.isNaN(Date.parse(payload.generatedAt)));

const REQUIRED = ["id", "eventUid", "date", "start", "end", "startTimeLocal", "endTimeLocal", "partial", "position", "title", "type", "status", "location", "canonicalUrl"];
check("champs requis présents partout",
  occ.every((o) => REQUIRED.every((k) => o[k] !== undefined)));

check("date = jour Paris de start", occ.every((o) => dayKey(new Date(o.start)) === o.date));
check("end dans le même jour Paris", occ.every((o) => dayKey(new Date(o.end)) === o.date));
check("start < end", occ.every((o) => o.start < o.end));
check("tri par start croissant", occ.every((o, i) => i === 0 || occ[i - 1].start <= o.start));
check("ids uniques", new Set(occ.map((o) => o.id)).size === occ.length);
check("position cohérente avec partial",
  occ.every((o) => (o.partial ? ["start", "middle", "end"].includes(o.position) : o.position === "single")));
check("type dans l'énumération",
  occ.every((o) => ["chantier", "atelier", "animation", "evenement"].includes(o.type)));

console.log(failures === 0
  ? `\nTous les tests passent (${occ.length} occurrences validées).`
  : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
