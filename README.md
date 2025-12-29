## Auto-sync high-impact news (Cloudflare Worker)

Because this app is static (GitHub Pages) and TradingView PineScript cannot fetch economic calendars, the safe way to auto-load news is:

**App → Cloudflare Worker → Calendar Provider**

### Quick setup (Cloudflare Worker)
1. Create a Worker in Cloudflare Dashboard.
2. Paste `cloudflare-worker.js` as the Worker code.
3. Add Worker secret(s) in Settings → Variables:
   - `UPSTREAM_URL` : your calendar JSON endpoint (server-side, can include key)
4. Deploy.
5. In the app: **News → API** paste your Worker URL ending with `/today`.
   - Example: `https://your-worker.your-subdomain.workers.dev/today`

### Provider note
This template is provider-agnostic. You can:
- Point `UPSTREAM_URL` at your own small script/service that returns events in the required JSON format, OR
- Edit `fetchUpstream()` to call a specific provider API and transform results.

Required response shape:
```json
{ "dateET": "YYYY-MM-DD", "events": [ { "timeET": "08:30", "title": "CPI", "impact": "high" } ] }
```


## FMP provider (auto high-impact news)

This build uses Financial Modeling Prep (FMP) Economic Calendar and filters HIGH impact events.

1) Get an FMP API key (free plan available): https://site.financialmodelingprep.com/developer/docs
2) Cloudflare Worker → Settings → Variables → add Secret: `FMP_API_KEY`
3) Deploy Worker.
4) In the app: News → API, paste your Worker URL ending with `/today` and tap Sync.

FMP endpoints:
- Stable: https://financialmodelingprep.com/stable/economic-calendar (docs: https://site.financialmodelingprep.com/developer/docs/stable/economics-calendar)
- Legacy: https://financialmodelingprep.com/api/v3/economic_calendar (docs: https://site.financialmodelingprep.com/developer/docs/economic-calendar-api)
