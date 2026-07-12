/**
 * Outil de DEV LOCAL — sert les occurrences journalières en live, avec filtres.
 * La prod n'utilise PAS ce serveur : elle publie dist/events.json en statique
 * via GitHub Actions (voir build-events.js + .github/workflows/build-events.yml).
 * Même logique métier que le build : lib/openagenda.js.
 *
 * Usage : node api-agenda.js  →  http://localhost:8787/events
 *   GET /events            → occurrences à venir, triées par date
 *     ?from=YYYY-MM-DD     → à partir de cette date (défaut : aujourd'hui)
 *     ?to=YYYY-MM-DD       → jusqu'à cette date incluse
 *     ?includePast=1       → inclure aussi le passé
 *     ?limit=N             → limiter le nombre de résultats
 *   GET /health            → état + âge du cache
 */
const http = require("http");
const { AGENDA_UID, dayKey, fetchAllEvents, buildOccurrences } = require("./lib/openagenda");

const PORT = process.env.PORT || 8787;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { data: null, ts: 0 };
async function cachedEvents() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  const events = await fetchAllEvents();
  cache = { data: events, ts: Date.now() };
  return events;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (url.pathname === "/health") {
      res.end(JSON.stringify({ ok: true, agenda: AGENDA_UID, cacheAgeS: cache.data ? Math.round((Date.now() - cache.ts) / 1000) : null }));
      return;
    }

    if (url.pathname === "/events") {
      let occ = buildOccurrences(await cachedEvents());

      const includePast = url.searchParams.get("includePast") === "1";
      const from = url.searchParams.get("from") || (includePast ? null : dayKey(new Date()));
      const to = url.searchParams.get("to");
      if (from) occ = occ.filter((o) => o.date >= from);
      if (to) occ = occ.filter((o) => o.date <= to);

      const limit = Number(url.searchParams.get("limit")) || null;
      const total = occ.length;
      if (limit) occ = occ.slice(0, limit);

      res.end(JSON.stringify({ total, returned: occ.length, from, to: to || null, generatedAt: new Date().toISOString(), occurrences: occ }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found. Try /events or /health" }));
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`API dev locale sur http://localhost:${PORT}/events`));
