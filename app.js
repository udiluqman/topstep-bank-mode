// ============================
// CONFIG: $100K Standard
// ============================
const CFG = {
  account: "Topstep $100K (Standard)",
  targetProfit: 6000,
  maxLoss: 3000,
  dailyLoss: 2000,

  instrument: "ES",
  timeframe: "2m",
  session: "RTH",

  bracket: {
    contracts: 1,
    stopPts: 6.0,     // -$300
    targetPts: 9.0    // +$450
  },

  // Reminder times anchored to New York time (auto-adjusts for DST)
  remindersET: [
    { key:"prep",  label:"Prep: Open TradingView + TopstepX", hour:9,  minute:25 },
    { key:"open",  label:"RTH Open (hands off)",             hour:9,  minute:30 },
    { key:"orlock",label:"OR Locked: start alert watch",     hour:9,  minute:45 },
    { key:"stop",  label:"Stop time: no more trades",        hour:10, minute:30 }
  ],

  sopRules: [
    "Trade ONLY when an alert fires. No alert = no trade.",
    "Only in the trade window (after OR is set).",
    "Candle must CLOSE back inside OR (rejection confirmed).",
    "Strong candle body (not a doji).",
    "VWAP aligned: SHORT only above VWAP, LONG only below VWAP.",
    "1 trade/day max. Win or loss = stop."
  ],

  panicProtocol: [
    "Trigger if: urge to chase / revenge / add trades / anger / restlessness.",
    "Do nothing for 5 minutes.",
    "Close chart or step away.",
    "Mark day as NO TRADE even if alerts come.",
    "Write 1 sentence: 'I am protecting the account.'"
  ],

  streakProtocol: [
    "2 losses in last 3 trades → pause 24 hours.",
    "3 losses in a row → pause 48 hours.",
    "Weekly drawdown ≥ −$1200 → stop for week."
  ]
};

// ============================
// STATE + STORAGE
// ============================
const LS_KEY = "topstep_bankmode_v2";
const state = loadState();

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || { log: [], panic: { active:false, note:"", date:"" } };
  } catch {
    return { log: [], panic: { active:false, note:"", date:"" } };
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function tradesTodayCount() {
  const t = todayStr();
  return state.log.filter(x => x.type === "TRADE" && x.date === t).length;
}

function lastTrades(n=20) {
  const trades = state.log.filter(x => x.type === "TRADE");
  return trades.slice(-n);
}

function lossStreak() {
  const trades = lastTrades(50);
  let s = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].result === "L") s++;
    else break;
  }
  return s;
}

function lossesInLast(k=3) {
  const trades = lastTrades(50);
  const recent = trades.slice(-k);
  return recent.filter(x => x.result === "L").length;
}

function monthKey() {
  const d = new Date();
  return d.toISOString().slice(0,7);
}

function monthPnL() {
  const mk = monthKey();
  let pnl = 0;
  for (const x of state.log) {
    if (x.type !== "TRADE") continue;
    if (!x.date.startsWith(mk)) continue;
    pnl += (x.result === "W") ? (CFG.bracket.targetPts * 50) : (-CFG.bracket.stopPts * 50);
  }
  return pnl;
}

// ============================
// TIME: New York conversion (DST-safe)
// ============================
// We compute "next occurrence of HH:MM in America/New_York" and return it as a Date in local time.
function nextETOccurrence(hourET, minuteET) {
  const tz = "America/New_York";

  // Helper: get ET date parts for a given UTC timestamp
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });

  const now = new Date();
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  // ET "today" as YYYY-MM-DD
  const etY = parseInt(parts.year, 10);
  const etM = parseInt(parts.month, 10);
  const etD = parseInt(parts.day, 10);

  // Candidate 1: today at HH:MM ET
  let candidate = etDateTimeToLocal(etY, etM, etD, hourET, minuteET);

  // If already passed in ET, move to next weekday (Mon-Fri)
  const nowET = etNowDate();
  if (candidate.getTime() <= now.getTime()) {
    candidate = nextWeekdayET(etY, etM, etD, hourET, minuteET);
  }
  return candidate;

  function etNowDate() {
    // We only use it indirectly; kept for clarity.
    return now;
  }

  function nextWeekdayET(y, m, d, h, min) {
    // step day by day in ET, skip Sat/Sun
    for (let add = 1; add <= 10; add++) {
      const dtLocal = etDateTimeToLocalByAddDays(y, m, d, add, h, min);
      // Determine weekday in ET for that local date
      const wd = weekdayInET(dtLocal);
      if (wd !== 0 && wd !== 6) return dtLocal; // 0 Sun, 6 Sat
    }
    return etDateTimeToLocalByAddDays(y, m, d, 1, h, min);
  }

  function weekdayInET(localDate) {
    const p = Object.fromEntries(fmt.formatToParts(localDate).map(p => [p.type, p.value]));
    // Create a Date from localDate just to use getDay(); localDate already exact instant.
    // Day-of-week computed in local timezone may differ, so we compute ET weekday by formatting weekday:
    const wfmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const w = wfmt.format(localDate);
    return ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[w] ?? localDate.getDay();
  }

  function etDateTimeToLocal(year, month, day, hour, minute) {
    // Convert ET wall-clock to an instant by searching around UTC.
    // Practical approach: start with UTC guess and adjust using formatted ET parts.
    // Good enough for our daily reminder needs.

    // Initial guess: treat ET time as if it were UTC (rough), then correct.
    let guess = new Date(Date.UTC(year, month-1, day, hour, minute, 0));

    // Refine a few iterations
    for (let i=0; i<5; i++) {
      const p = Object.fromEntries(fmt.formatToParts(guess).map(p => [p.type, p.value]));
      const gy = parseInt(p.year,10), gm=parseInt(p.month,10), gd=parseInt(p.day,10);
      const gh = parseInt(p.hour,10), gmin=parseInt(p.minute,10);

      const diffMinutes =
        ( (year-gy)*525600 ) +
        ( (month-gm)*43200 ) +
        ( (day-gd)*1440 ) +
        ( (hour-gh)*60 ) +
        (minute-gmin);

      guess = new Date(guess.getTime() + diffMinutes*60000);
      if (Math.abs(diffMinutes) === 0) break;
    }
    return guess;
  }

  function etDateTimeToLocalByAddDays(year, month, day, addDays, hour, minute) {
    // Add days in ET by using a local date that corresponds to ET midnight.
    // Simpler: create an approximate base and add 24h steps then reconvert.
    const base = etDateTimeToLocal(year, month, day, hour, minute);
    return new Date(base.getTime() + addDays*24*60*60000);
  }
}

// ============================
// NOTIFICATIONS (in-app)
// ============================
let notifArmed = false;
let notifTimers = [];

async function enableInAppNotifications() {
  if (!("Notification" in window)) {
    alert("Notifications not supported on this browser.");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    alert("Notification permission denied.");
    return;
  }
  scheduleNotifications();
  notifArmed = true;
  render(route());
}

function clearNotifTimers() {
  for (const t of notifTimers) clearTimeout(t);
  notifTimers = [];
}

function scheduleNotifications() {
  clearNotifTimers();
  // Schedule only the next occurrences for each reminder
  for (const r of CFG.remindersET) {
    const next = nextETOccurrence(r.hour, r.minute);
    const ms = next.getTime() - Date.now();
    if (ms > 0 && ms < 1000*60*60*24*3) {
      notifTimers.push(setTimeout(() => {
        try { new Notification(r.label); } catch {}
        // Reschedule after firing
        scheduleNotifications();
      }, ms));
    }
  }
}

// ============================
// ICS CALENDAR EXPORT (DST-safe)
// ============================
function downloadICS() {
  // Create recurring weekday events in America/New_York
  // Android Calendar handles TZID + DST correctly.
  const tzid = "America/New_York";
  const uidBase = "topstep-bankmode-" + Math.random().toString(16).slice(2);

  const now = new Date();
  const dtstamp = toICSUTC(now);

  // Next Monday as DTSTART anchor (safe)
  const nextMon = nextWeekdayLocal(1); // 1=Mon
  const y = nextMon.getFullYear();
  const m = String(nextMon.getMonth()+1).padStart(2,"0");
  const d = String(nextMon.getDate()).padStart(2,"0");
  const datePart = `${y}${m}${d}`;

  const lines = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Topstep Bank Mode//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  for (const r of CFG.remindersET) {
    const hh = String(r.hour).padStart(2,"0");
    const mm = String(r.minute).padStart(2,"0");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uidBase}-${r.key}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`SUMMARY:${escapeICS(r.label)}`);
    lines.push(`DTSTART;TZID=${tzid}:${datePart}T${hh}${mm}00`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`);
    lines.push("DURATION:PT5M");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Topstep_BankMode_Reminders.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toICSUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const da = String(d.getUTCDate()).padStart(2,"0");
  const hh = String(d.getUTCHours()).padStart(2,"0");
  const mm = String(d.getUTCMinutes()).padStart(2,"0");
  const ss = String(d.getUTCSeconds()).padStart(2,"0");
  return `${y}${m}${da}T${hh}${mm}${ss}Z`;
}

function escapeICS(s) {
  return String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n");
}

function nextWeekdayLocal(targetDay) {
  const d = new Date();
  const day = d.getDay(); // 0 Sun
  let add = (targetDay - day + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  d.setHours(0,0,0,0);
  return d;
}

// ============================
// ROUTER + UI
// ============================
function route() {
  const h = location.hash.replace("#","") || "home";
  return h;
}

window.addEventListener("hashchange", () => render(route()));

function render(view) {
  const app = document.getElementById("app");
  const ttd = tradesTodayCount();
  const streak = lossStreak();
  const l3 = lossesInLast(3);
  const pnl = monthPnL();

  const warnings = [];
  if (state.panic.active && state.panic.date === todayStr()) warnings.push("PANIC MODE active today → SKIP everything.");
  if (ttd >= 1) warnings.push("Already traded today → SKIP everything.");
  if (streak >= 3) warnings.push("3-loss streak → pause 48 hours.");
  else if (l3 >= 2) warnings.push("2 losses in last 3 trades → pause 24 hours.");

  const warnCard = warnings.length ? `
    <div class="card"><h3>Warnings</h3><ul>${warnings.map(w=>`<li>${w}</li>`).join("")}</ul></div>
  ` : "";

  if (view === "sop") return app.innerHTML = pageSOP();
  if (view === "decision") return app.innerHTML = pageDecision();
  if (view === "panic") return app.innerHTML = pagePanic();
  if (view === "log") return app.innerHTML = pageLog();
  if (view === "newtrade") return app.innerHTML = pageNewTrade();

  // home
  const nextTimes = CFG.remindersET.map(r => {
    const dt = nextETOccurrence(r.hour, r.minute);
    return `<li><b>${r.label}</b><br/><span class="muted">${dt.toLocaleString()}</span></li>`;
  }).join("");

  const b = CFG.bracket;
  app.innerHTML = `
    <div class="card">
      <h1>Topstep Bank Mode</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe} | ${CFG.session}</div>
      <div style="margin-top:10px;">
        <span class="pill">Today trades: <b>${ttd}/1</b></span>
        <span class="pill">Loss streak: <b>${streak}</b></span>
        <span class="pill">Losses last 3: <b>${l3}</b></span>
        <span class="pill">This month PnL: <b>$${pnl}</b></span>
        <span class="pill">Goal: <b>$500 withdrawal</b></span>
      </div>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#sop">SOP</a>
        <a class="btn" href="#decision">Decision</a>
        <a class="btn btn-danger" href="#panic">PANIC</a>
        <a class="btn" href="#log">Log</a>
      </div>
    </div>

    ${warnCard}

    <div class="card">
      <h2>Bracket (LOCKED)</h2>
      <ul>
        <li>Size: <b>${b.contracts} ES</b></li>
        <li>Stop: <b>${b.stopPts.toFixed(1)} pts</b> (≈ -$${(b.stopPts*50).toFixed(0)})</li>
        <li>Target: <b>${b.targetPts.toFixed(1)} pts</b> (≈ +$${(b.targetPts*50).toFixed(0)})</li>
      </ul>
    </div>

    <div class="card">
      <h2>Reminders (auto DST-adjusted)</h2>
      <div class="muted">Anchored to <span class="mono">America/New_York</span> so it follows seasonal DST correctly.</div>
      <hr/>
      <h3>Next reminder times (your phone time)</h3>
      <ul>${nextTimes}</ul>
      <hr/>
      <div class="row">
        <button class="btn" onclick="downloadICS()">Add to Calendar (recommended)</button>
        <button class="btn ${notifArmed?'btn-good':''}" onclick="enableInAppNotifications()">
          ${notifArmed ? "Notifications ON" : "Enable in-app notifications"}
        </button>
      </div>
      <div class="muted" style="margin-top:10px;">
        Calendar alarms are the reliable “bank-grade” option. In-app notifications work best when the app stays open.
      </div>
    </div>
  `;
}

function pageSOP() {
  const b = CFG.bracket;
  return `
    <div class="card">
      <h1>One-page SOP</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe} | ${CFG.session}</div>
      <hr/>
      <h3>Entry Conditions (ALL must be true)</h3>
      <ul>${CFG.sopRules.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <h3>Orders (Fixed)</h3>
      <ul>
        <li>Size: <b>${b.contracts} ES</b></li>
        <li>Stop: <b>${b.stopPts.toFixed(1)} pts</b> (≈ -$${(b.stopPts*50).toFixed(0)})</li>
        <li>Target: <b>${b.targetPts.toFixed(1)} pts</b> (≈ +$${(b.targetPts*50).toFixed(0)})</li>
        <li><b>1 trade/day max.</b> Win or loss → stop.</li>
      </ul>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#decision">Decision</a>
      </div>
    </div>
  `;
}

function pageDecision() {
  return `
    <div class="card">
      <h1>Decision Tree (Trade / Skip)</h1>
      <hr/>
      <h3>If NO alert</h3>
      <ul><li><b>SKIP</b>. No trade = success.</li></ul>
      <hr/>
      <h3>If alert fires → checklist</h3>
      <ol>
        <li>Inside 21:45–22:30 (UTC+8)? If no → <b>SKIP</b></li>
        <li>Candle CLOSED back inside OR? If no → <b>SKIP</b></li>
        <li>Strong candle body (not doji)? If no → <b>SKIP</b></li>
        <li>VWAP aligned? If no → <b>SKIP</b></li>
        <li>PANIC MODE today? If yes → <b>SKIP</b></li>
        <li>Already traded today? If yes → <b>SKIP</b></li>
        <li>All yes → <b>TAKE TRADE</b> then stop for the day.</li>
      </ol>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn btn-danger" href="#panic">PANIC</a>
      </div>
    </div>
  `;
}

function pagePanic() {
  return `
    <div class="card">
      <h1>🛑 PANIC MODE</h1>
      <div class="muted">Overrides trading for today.</div>
      <hr/>
      <h3>Do this now</h3>
      <ul>${CFG.panicProtocol.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <h3>Loss-streak rules</h3>
      <ul>${CFG.streakProtocol.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <label>One sentence (required)</label>
      <textarea id="panicNote" rows="3" placeholder="I am protecting the account."></textarea>
      <div class="row" style="margin-top:12px;">
        <button class="btn btn-danger" onclick="setPanic()">Activate Panic Today</button>
        <a class="btn" href="#">Cancel</a>
      </div>
    </div>
  `;
}

function setPanic() {
  const note = (document.getElementById("panicNote").value || "").trim();
  if (!note) { alert("Write one sentence first."); return; }
  state.panic = { active:true, note, date: todayStr() };
  state.log.push({ type:"PANIC", date: todayStr(), time: new Date().toLocaleTimeString(), note });
  saveState();
  location.hash = "log";
}

function pageLog() {
  const rows = [...state.log].slice(-80).reverse();
  const items = rows.length ? rows.map(r => {
    if (r.type === "TRADE") return `<li><b>${r.date} ${r.time}</b> — TRADE ${r.side} — <b>${r.result}</b> — ${r.note||""}</li>`;
    if (r.type === "PANIC") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#ff8080;font-weight:900;">PANIC</span> — ${r.note||""}</li>`;
    return `<li>${JSON.stringify(r)}</li>`;
  }).join("") : "<li>No entries yet.</li>";

  return `
    <div class="card">
      <h1>Log</h1>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#newtrade">New Trade</a>
        <a class="btn btn-danger" href="#panic">PANIC</a>
      </div>
      <hr/>
      <ul>${items}</ul>
      <hr/>
      <button class="btn btn-danger" onclick="clearAll()">Reset log (danger)</button>
    </div>
  `;
}

function pageNewTrade() {
  const ttd = tradesTodayCount();
  const disabled = (ttd >= 1) || (state.panic.active && state.panic.date === todayStr());
  return `
    <div class="card">
      <h1>New Trade</h1>
      <div class="muted">Enforces 1 trade/day. ${disabled ? "Locked today." : ""}</div>
      <hr/>
      <label>Side</label>
      <select id="side" ${disabled ? "disabled":""}>
        <option value="LONG">LONG</option>
        <option value="SHORT">SHORT</option>
      </select>

      <label style="margin-top:10px;">Result</label>
      <select id="result" ${disabled ? "disabled":""}>
        <option value="W">W (Target)</option>
        <option value="L">L (Stop)</option>
      </select>

      <label style="margin-top:10px;">Note (optional)</label>
      <input id="note" placeholder="A+ / borderline / news / slipped" ${disabled ? "disabled":""}/>

      <div class="row" style="margin-top:12px;">
        <button class="btn btn-good" onclick="saveTrade()" ${disabled ? "disabled":""}>Save</button>
        <a class="btn" href="#log">Cancel</a>
      </div>
    </div>
  `;
}

function saveTrade() {
  if (tradesTodayCount() >= 1) { alert("Already traded today. Stop."); location.hash="log"; return; }
  if (state.panic.active && state.panic.date === todayStr()) { alert("Panic mode active today. Stop."); location.hash="log"; return; }

  const side = document.getElementById("side").value;
  const result = document.getElementById("result").value;
  const note = (document.getElementById("note").value || "").trim();

  state.log.push({
    type: "TRADE",
    date: todayStr(),
    time: new Date().toLocaleTimeString(),
    side, result, note
  });
  saveState();
  location.hash = "log";
}

function clearAll() {
  if (!confirm("Reset everything? This deletes your log.")) return;
  state.log = [];
  state.panic = { active:false, note:"", date:"" };
  saveState();
  location.hash = "";
}

// initial render
render(route());
