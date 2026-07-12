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
 * Ex. 25/10/2026 (fin de l'heure d'été à 3h) : offset à midi = +1 → estimation
 * 23:00 UTC la veille, qui vaut 01:00 locale (+2 encore actif à minuit) →
 * correction de -1 h → 22:00 UTC, le vrai minuit de Paris.
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

/* ---------- lecture OpenAgenda (API v2, paginée) ---------- */
/*
 * Source unique : l'API v2 officielle. Clé obligatoire via la variable
 * d'environnement OPENAGENDA_KEY (secret GitHub Actions en CI).
 * Décision projet (2026-07-12) : pas de repli sur l'export legacy déprécié —
 * sans clé, on échoue explicitement plutôt que de dépendre d'une source
 * en fin de vie.
 */

function sourceUrl(uid = AGENDA_UID) {
  return `https://api.openagenda.com/v2/agendas/${uid}/events`;
}

async function fetchAllEvents(uid = AGENDA_UID) {
  const key = process.env.OPENAGENDA_KEY;
  if (!key) {
    throw new Error(
      "OPENAGENDA_KEY manquante — l'API v2 est la seule source supportée. " +
      "En CI : créer le secret de dépôt OPENAGENDA_KEY. " +
      "En local : OPENAGENDA_KEY=xxx node build-events.js"
    );
  }
  return fetchAllEventsV2(uid, key);
}

// Sans timeout, un OpenAgenda muet suspendrait le build CI jusqu'au timeout du job.
const FETCH_TIMEOUT_MS = 30_000;
const fetchJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`OpenAgenda HTTP ${r.status}`);
  return r.json();
};

async function fetchAllEventsV2(uid, key) {
  const base = `https://api.openagenda.com/v2/agendas/${uid}/events?key=${encodeURIComponent(key)}&size=100&detailed=1`;
  let events = [], after = null;
  for (let guard = 0; guard < 50; guard++) {
    const url = after ? base + after.map((v) => `&after[]=${encodeURIComponent(v)}`).join("") : base;
    const d = await fetchJson(url);
    events = events.concat((d.events || []).map((e) => normalizeV2Event(e, uid)));
    after = Array.isArray(d.after) && d.after.length > 0 ? d.after : null;
    if (!after || !d.events || d.events.length === 0) break;
  }
  return events;
}

/**
 * Aplati un événement API v2 vers le format interne (celui de l'export legacy,
 * consommé par buildOccurrences). Écrit de façon défensive : begin|start,
 * location objet ou champs aplatis, registration tableau ou registrationUrl.
 * ⚠️ À valider à la première exécution avec une clé réelle — les tests
 * d'invariants (test-events.js) couvrent la validation.
 */
function normalizeV2Event(e, uid) {
  const loc = e.location || {};
  const registrationLink = Array.isArray(e.registration)
    ? (e.registration.find((r) => r && r.type === "link") || {}).value || null
    : null;
  return {
    uid: e.uid,
    title: e.title,
    description: e.description,
    // Un timing sans bornes ferait planter tout le build en aval : on l'écarte
    // en le signalant (visible dans les logs CI) plutôt que de tout bloquer.
    timings: (e.timings || [])
      .map((t) => ({ start: t.begin || t.start, end: t.end }))
      .filter((t) => {
        if (t.start && t.end) return true;
        console.warn(`timing sans bornes ignoré — événement ${e.uid}`);
        return false;
      }),
    locationName: loc.name ?? e.locationName ?? null,
    address: loc.address ?? e.address ?? null,
    city: loc.city ?? e.city ?? null,
    latitude: loc.latitude ?? e.latitude ?? null,
    longitude: loc.longitude ?? e.longitude ?? null,
    image: typeof e.image === "string"
      ? e.image
      : e.image && e.image.base && e.image.filename
        ? e.image.base + e.image.filename
        : null,
    registrationUrl: e.registrationUrl || registrationLink,
    canonicalUrl: e.canonicalUrl || e.permalink || `https://openagenda.com/agendas/${uid}/events/${e.uid}`,
  };
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
        const startUtcHHMM = seg.start.toISOString().slice(11, 16);
        out.push({
          id: `${e.uid}_${seg.date}_${startUtcHHMM}`,
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
