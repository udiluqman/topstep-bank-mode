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
