/**
 * Lib partagée — lecture OpenAgenda + découpage en occurrences journalières.
 * Utilisée par build-events.js (génération statique) et api-agenda.js (dev local).
 *
 * Source actuelle : export public legacy (sans clé). Pour migrer vers l'API v2
 * (clé requise), seul fetchAllEvents() est à adapter — le reste du contrat
 * (occurrences journalières) ne change pas.
 */

const AGENDA_UID = 85936282;
const TZ = "Europe/Paris";

/* ---------- utilitaires fuseau Europe/Paris ---------- */

const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHour = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Clé jour "AAAA-MM-JJ" en heure de Paris. */
const dayKey = (d) => fmtKey.format(d);

/** Heure locale "HH:MM" (Paris). */
const localTime = (d) => fmtHour.format(d);

const fmtHourOnly = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });

/** Décalage Paris/UTC (en heures) pour un jour donné, mesuré à midi — gère été/hiver. */
function parisOffsetHours(key) {
  const noonUtc = new Date(`${key}T12:00:00Z`);
  return Number(fmtHourOnly.format(noonUtc)) - 12;
}

/**
 * Minuit (heure de Paris) du jour `key`, en Date UTC.
 * Les nuits de changement d'heure, le décalage à minuit diffère de celui à midi :
 * on part d'une estimation (offset à midi) puis on corrige d'après l'heure
 * locale réellement obtenue.
 */
function parisMidnightUtc(key) {
  let guess = Date.parse(`${key}T00:00:00Z`) - parisOffsetHours(key) * 3600e3;
  const d = new Date(guess);
  const localHour = Number(fmtHourOnly.format(d));
  if (dayKey(d) === key) {
    guess -= localHour * 3600e3;        // estimation en retard (ex. 01:00 local au lieu de 00:00)
  } else {
    guess += (24 - localHour) * 3600e3; // estimation la veille (ex. 23:00 local du jour d'avant)
  }
  return new Date(guess);
}

function nextDayKey(key) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------- découpage journalier ---------- */

/**
 * Découpe un intervalle [start, end] en segments journaliers (heure de Paris).
 * Un intervalle contenu dans un seul jour → 1 segment intact (position "single").
 * "10 juil. 14:00 → 20 juil. 17:00" → 11 segments (start / middle×9 / end).
 */
function splitByDay(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startKey = dayKey(start);
  const endKey = dayKey(end);

  if (startKey === endKey) {
    return [{ date: startKey, start, end, partial: false, position: "single" }];
  }

  const segments = [];
  let key = startKey;
  while (true) {
    const isFirst = key === startKey;
    const isLast = key === endKey;
    segments.push({
      date: key,
      start: isFirst ? start : parisMidnightUtc(key),
      end: isLast ? end : new Date(parisMidnightUtc(nextDayKey(key)).getTime() - 1000),
      partial: true,
      position: isFirst ? "start" : isLast ? "end" : "middle",
    });
    if (isLast) break;
    key = nextDayKey(key);
  }
  return segments;
}

/* ---------- lecture OpenAgenda (paginée) ---------- */

function sourceUrl(uid = AGENDA_UID) {
  return `https://openagenda.com/agendas/${uid}/events.json`;
}

async function fetchAllEvents(uid = AGENDA_UID) {
  const src = sourceUrl(uid);
  let events = [], offset = 0, total = Infinity;
  for (let guard = 0; guard < 20 && events.length < total; guard++) {
    const r = await fetch(`${src}?offset=${offset}&limit=20`);
    if (!r.ok) throw new Error(`OpenAgenda HTTP ${r.status}`);
    const d = await r.json();
    total = d.total;
    events = events.concat(d.events || []);
    offset += (d.events || []).length;
    if (!d.events || d.events.length === 0) break;
  }
  return events;
}

/* ---------- transformation en occurrences ---------- */

const txt = (v, lang = "fr") =>
  v && typeof v === "object" ? v[lang] || Object.values(v)[0] || "" : v || "";

/**
 * Type déduit du titre — heuristique temporaire tant que l'asso ne renseigne
 * pas de catégories dans OpenAgenda.
 */
function eventType(title) {
  const t = title.toLowerCase();
  if (t.includes("chantier")) return "chantier";
  if (t.includes("atelier")) return "atelier";
  if (t.includes("jardin") || t.includes("square") || t.includes("animation")) return "animation";
  return "evenement";
}

/**
 * events OpenAgenda → occurrences journalières triées par date/heure.
 * 1 timing = 1 occurrence ; un timing multi-jours est découpé (cf. splitByDay).
 */
function buildOccurrences(events) {
  const out = [];
  for (const e of events) {
    const title = txt(e.title);
    for (const tm of e.timings || []) {
      for (const seg of splitByDay(tm.start, tm.end)) {
        out.push({
          id: `${e.uid}_${seg.date}_${seg.start.toISOString().slice(11, 16)}`,
          eventUid: e.uid,
          date: seg.date,
          start: seg.start.toISOString(),
          end: seg.end.toISOString(),
          startTimeLocal: localTime(seg.start),
          endTimeLocal: localTime(seg.end),
          partial: seg.partial,
          position: seg.position,
          title,
          type: eventType(title),
          description: txt(e.description),
          location: {
            name: e.locationName || null,
            address: e.address || null,
            city: e.city || null,
            latitude: e.latitude ?? null,
            longitude: e.longitude ?? null,
          },
          image: typeof e.image === "string" ? e.image : null,
          registrationUrl: e.registrationUrl || null,
          canonicalUrl: e.canonicalUrl,
        });
      }
    }
  }
  out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return out;
}

module.exports = {
  AGENDA_UID,
  TZ,
  dayKey,
  localTime,
  parisOffsetHours,
  parisMidnightUtc,
  nextDayKey,
  splitByDay,
  sourceUrl,
  fetchAllEvents,
  eventType,
  buildOccurrences,
};
