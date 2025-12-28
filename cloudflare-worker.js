/**
 * Cloudflare Worker: Topstep Bank Mode - Economic News Proxy
 *
 * Goal: return today's high-impact events in ET without exposing API keys in the browser.
 *
 * Response format:
 *   { "dateET": "YYYY-MM-DD", "events": [ { "timeET":"08:30", "title":"CPI", "impact":"high" }, ... ] }
 *
 * IMPORTANT:
 * - You must plug in a calendar provider.
 * - This template supports a generic upstream URL that returns JSON.
 * - Keep your provider API key as a Worker secret (never in the web app).
 *
 * Setup (recommended):
 * 1) Create a Cloudflare Worker.
 * 2) Add a secret: UPSTREAM_URL  (or PROVIDER_KEY depending on your provider)
 * 3) Edit fetchUpstream() to match your provider's API.
 * 4) Deploy, then paste your Worker URL into the app (News → API).
 */

const TZ = "America/New_York";

function etDateString(now = new Date()) {
  // YYYY-MM-DD in ET
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(now);
  return d;
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

// --------- EDIT THIS ---------
// Implement a provider here. Keep keys in env vars.
// Must return array of { timeET:"HH:MM", title:"...", impact:"high"|"medium"|"low" } for today (ET).
async function fetchUpstream(env) {
  // Generic pattern: your upstream returns {events:[...]} already in ET
  // env.UPSTREAM_URL could be a server you control or a provider endpoint (with key embedded server-side).
  if (!env.UPSTREAM_URL) {
    return { dateET: etDateString(), events: [] };
  }

  const r = await fetch(env.UPSTREAM_URL, { headers: { "accept": "application/json" } });
  if (!r.ok) throw new Error("Upstream HTTP " + r.status);
  const data = await r.json();

  // Expect either data.events or data itself is an array of events
  const events = Array.isArray(data?.events) ? data.events : (Array.isArray(data) ? data : []);

  // Normalize minimal fields
  const out = events.map(e => ({
    timeET: (e.timeET || e.time || "").toString().slice(0,5),
    title: (e.title || e.name || "High impact").toString().slice(0,60),
    impact: (e.impact || e.importance || "high").toString().toLowerCase()
  })).filter(e => /^\d\d:\d\d$/.test(e.timeET));

  return { dateET: etDateString(), events: out };
}
// ----------------------------

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

    // endpoint: /today
    if (url.pathname !== "/today") {
      return jsonResponse({ ok:false, error:"Use /today" }, 404);
    }

    try{
      const payload = await fetchUpstream(env);
      return jsonResponse(payload, 200);
    }catch(err){
      return jsonResponse({ ok:false, error: String(err.message || err) }, 500);
    }
  }
};
