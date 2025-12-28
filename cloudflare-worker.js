/**
 * Cloudflare Worker: Topstep Bank Mode - FMP Economic Calendar
 *
 * Endpoint:
 *   GET /today   -> { dateET:"YYYY-MM-DD", events:[{timeET,title,impact:"high"}] }
 *
 * Data source:
 *   Financial Modeling Prep (FMP) Economic Calendar API
 *   Stable endpoint: https://financialmodelingprep.com/stable/economic-calendar (requires apikey)
 *   Legacy endpoint:  https://financialmodelingprep.com/api/v3/economic_calendar?from=...&to=... (also requires apikey)
 *
 * Docs:
 * - Stable endpoint: https://site.financialmodelingprep.com/developer/docs/stable/economics-calendar
 * - Legacy endpoint: https://site.financialmodelingprep.com/developer/docs/economic-calendar-api
 *
 * Setup:
 * 1) Create a Worker on Cloudflare.
 * 2) Add a secret:
 *      FMP_API_KEY = your FMP API key
 * 3) Deploy.
 * 4) Paste your Worker URL ending with /today into the app (News → API).
 *
 * Notes:
 * - We filter to HIGH impact only (best safety for your rule-set).
 * - Time is converted to America/New_York (ET).
 */

const TZ = "America/New_York";
const FMP_STABLE_URL = "https://financialmodelingprep.com/stable/economic-calendar";
const FMP_LEGACY_URL = "https://financialmodelingprep.com/api/v3/economic_calendar";

function etDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(now);
}
function etTimeHHMM(dateObj){
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour:"2-digit", minute:"2-digit", hour12:false }).format(dateObj);
}
function jsonResponse(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}
function isHighImpact(v){
  if(v == null) return false;
  const s = String(v).trim().toLowerCase();
  if(["high","3","high impact","high-impact","red"].includes(s)) return true;
  const n = Number(s);
  if(Number.isFinite(n) && n >= 3) return true;
  return false;
}

async function fetchFmpCalendar(env, dateET){
  const key = env.FMP_API_KEY;
  if(!key) throw new Error("Missing Worker secret: FMP_API_KEY");

  const qs = new URLSearchParams({ from: dateET, to: dateET, apikey: key });

  // Try stable endpoint first
  try{
    const u = `${FMP_STABLE_URL}?${qs.toString()}`;
    const r = await fetch(u, { headers: { "accept":"application/json" } });
    if(!r.ok) throw new Error("Stable HTTP " + r.status);
    const data = await r.json();
    if(Array.isArray(data)) return data;
    if(Array.isArray(data?.data)) return data.data;
  }catch(e){
    // fall back to legacy
  }

  const legacyQs = new URLSearchParams({ from: dateET, to: dateET, apikey: key });
  const u2 = `${FMP_LEGACY_URL}?${legacyQs.toString()}`;
  const r2 = await fetch(u2, { headers: { "accept":"application/json" } });
  if(!r2.ok) throw new Error("Legacy HTTP " + r2.status);
  const data2 = await r2.json();
  if(Array.isArray(data2)) return data2;
  if(Array.isArray(data2?.data)) return data2.data;
  return [];
}

function normalizeTitle(item){
  return String(item.event || item.name || item.title || "High impact").trim().slice(0,60);
}
function extractImpact(item){
  return item.impact ?? item.importance ?? item.impactLevel ?? item.impact_level;
}
function extractDateTime(item){
  const cand = item.date || item.datetime || item.time || item.timestamp || item.publishedDate;
  if(!cand) return null;
  if(typeof cand === "number") return new Date(cand * (cand > 1e12 ? 1 : 1000));
  const d = new Date(String(cand));
  if(isNaN(d.getTime())) return null;
  return d;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response("", {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    if (url.pathname !== "/today") {
      return jsonResponse({ ok:false, error:"Use /today" }, 404);
    }

    try{
      const dateET = etDateString();
      const raw = await fetchFmpCalendar(env, dateET);

      const events = [];
      for(const item of raw){
        const imp = extractImpact(item);
        if(!isHighImpact(imp)) continue;

        const dt = extractDateTime(item);
        if(!dt) continue;

        events.push({
          timeET: etTimeHHMM(dt),
          title: normalizeTitle(item),
          impact: "high"
        });
      }

      // dedupe and sort
      const seen = new Set();
      const uniq = [];
      for(const e of events.sort((a,b)=>a.timeET.localeCompare(b.timeET))){
        const k = e.timeET + "|" + e.title;
        if(seen.has(k)) continue;
        seen.add(k);
        uniq.push(e);
      }

      return jsonResponse({ dateET, events: uniq }, 200);
    }catch(err){
      return jsonResponse({ ok:false, error: String(err.message || err) }, 500);
    }
  }
};
