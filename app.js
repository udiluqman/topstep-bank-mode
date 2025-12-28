// ============================
// Topstep Bank Mode (PWA)
// Profile: $100K Standard + $500/mo goal + scaling map
// ============================

const CFG = {
  // Account
  account: "Topstep $100K (Standard)",
  profitTargetEval: 6000,
  dailyLossLimit: 2000,
  maxLossLimit: 3000,

  // Trading setup
  instrument: "ES",
  timeframe: "2m",
  session: "RTH",

  // Locked bracket (1 ES)
  bracket: {
    contracts: 1,
    stopPts: 6.0,     // -$300
    targetPts: 9.0    // +$450
  },

// ============================
// Decision Engine (interactive)
// ============================

function nowInTradeWindowET() {
  // trade window: 09:45 → 10:30 ET (from your reminders)
  const start = nextETOccurrence(9, 45);
  const stop  = nextETOccurrence(10, 30);

  // If we're before today's 09:45 ET, nextETOccurrence returns today 09:45.
  // If we're after, it returns next weekday 09:45. We want "today’s window"
  // relative to current time, so we compute today's ET window explicitly.

  const tz = "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
  const now = new Date();
  const p = Object.fromEntries(fmt.formatToParts(now).map(x=>[x.type,x.value]));
  const y = parseInt(p.year,10), m = parseInt(p.month,10), d = parseInt(p.day,10);

  // Convert ET wall clock to instant (use same method as nextETOccurrence does)
  const startToday = (function etToInstant(y,m,d,h,min){
    const fmt2 = fmt;
    let guess = new Date(Date.UTC(y, m-1, d, h, min, 0));
    for(let i=0;i<6;i++){
      const q = Object.fromEntries(fmt2.formatToParts(guess).map(x=>[x.type,x.value]));
      const gy=parseInt(q.year,10), gm=parseInt(q.month,10), gd=parseInt(q.day,10);
      const gh=parseInt(q.hour,10), gmin=parseInt(q.minute,10);
      const diff = (y-gy)*525600 + (m-gm)*43200 + (d-gd)*1440 + (h-gh)*60 + (min-gmin);
      guess = new Date(guess.getTime() + diff*60000);
      if(diff===0) break;
    }
    return guess;
  })(y,m,d,9,45);

  const stopToday = (function etToInstant(y,m,d,h,min){
    const fmt2 = fmt;
    let guess = new Date(Date.UTC(y, m-1, d, h, min, 0));
    for(let i=0;i<6;i++){
      const q = Object.fromEntries(fmt2.formatToParts(guess).map(x=>[x.type,x.value]));
      const gy=parseInt(q.year,10), gm=parseInt(q.month,10), gd=parseInt(q.day,10);
      const gh=parseInt(q.hour,10), gmin=parseInt(q.minute,10);
      const diff = (y-gy)*525600 + (m-gm)*43200 + (d-gd)*1440 + (h-gh)*60 + (min-gmin);
      guess = new Date(guess.getTime() + diff*60000);
      if(diff===0) break;
    }
    return guess;
  })(y,m,d,10,30);

  return { inWindow: now >= startToday && now <= stopToday, startToday, stopToday };
}

function decisionApproved() {
  const ttd = tradesTodayCount();
  const panicToday = state.panic.active && state.panic.date === todayStr();
  const w = nowInTradeWindowET().inWindow;

  const pre = state.meta.pre || {};
  const required = [
    pre.tradeToday === true,
    pre.oneTradeOnly === true,
    pre.platformReady === true,
    pre.vwapOk === true,
    pre.noNewsRisk === true,
    pre.calm === true
  ];

  const preOk = required.every(Boolean);

  // Approved = pre-ok + not panic + not traded yet + within window
  return {
    preOk,
    approved: preOk && !panicToday && ttd < 1 && w,
    reasons: {
      panicToday,
      alreadyTraded: ttd >= 1,
      inWindow: w
    }
  };
}

function setPre(key, val){
  state.meta.pre = state.meta.pre || {};
  state.meta.pre[key] = val;
  saveState();
  render(route());
}

function setExec(key, val){
  state.meta.exec = state.meta.exec || {};
  state.meta.exec[key] = val;
  saveState();
  render(route());
}

function resetExec(){
  state.meta.exec = { closedInsideOR:false, cleanBody:false };
  saveState();
}
  
  // Monthly withdrawal goal
  withdrawalGoal: 500,

  // Reminder times anchored to New York time (auto DST)
  remindersET: [
    { key:"prep",   label:"Prep: Open TradingView + TopstepX", hour:9,  minute:25 },
    { key:"open",   label:"RTH Open (hands off)",             hour:9,  minute:30 },
    { key:"orlock", label:"OR Locked: start alert watch",     hour:9,  minute:45 },
    { key:"stop",   label:"Stop time: no more trades",        hour:10, minute:30 }
  ],

  // SOP (tight + boring)
  sopRules: [
    "Trade ONLY when an alert fires. No alert = no trade.",
    "Only during the trade window (after OR is set).",
    "Candle must CLOSE back inside OR (rejection confirmed).",
    "Strong candle body (not a doji).",
    "VWAP aligned: SHORT only above VWAP, LONG only below VWAP.",
    "1 trade/day max. Win or loss = stop."
  ],

  // Personal guardrails (bank behavior)
  internalGuardrails: [
    "If you feel urgency to pass fast → Panic Mode (no trade today).",
    "If you miss the entry → no chase, no second attempt.",
    "If execution slip makes loss worse than -$400 → stop & log slip."
  ],

  // Panic protocol
  panicProtocol: [
    "Trigger if: urge to chase / revenge / add trades / anger / restlessness.",
    "Do nothing for 5 minutes (timer).",
    "Close chart or step away.",
    "Mark day as NO TRADE even if alerts come.",
    "Write 1 sentence: 'I am protecting the account.'"
  ],

  // Streak protocol (conservative; keeps you alive)
  streakProtocol: [
    "2 losses in last 3 trades → pause 24 hours.",
    "3 losses in a row → pause 48 hours.",
    "Weekly drawdown ≥ −$1200 → stop for week."
  ],

  // Scaling plan (instances > aggression)
  scalingPlan: [
    { phase: "Phase 1", title: "1× $100K (prove process)", rule: "1 ES, 1 trade/day, withdraw $500/mo once stable." },
    { phase: "Phase 2", title: "2× $100K (replicate)", rule: "Add 2nd $100K. Same rules. 1 ES per account. No size increase." },
    { phase: "Phase 3", title: "3× $100K OR 1× $150K (simplify)", rule: "Only after 2–3 clean payout cycles. Choose replication or consolidation." },
    { phase: "Phase 4", title: "Institution mode", rule: "Only after consistency: consider 2 ES per account OR partial automation—never earlier." }
  ]
};

// ============================
// Storage
// ============================
const LS_KEY = "topstep_bankmode_v3";
const state = loadState();

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {
      log: [],
      panic: { active:false, note:"", date:"" },
      meta: {
  accounts: 1,
  pre: {
    tradeToday: true,
    oneTradeOnly: true,
    platformReady: true,
    vwapOk: true,
    noNewsRisk: true,
    calm: true
  },
  exec: { closedInsideOR:false, cleanBody:false }
}
;
  } catch {
    return { log: [], panic: { active:false, note:"", date:"" }, meta: {
  accounts: 1,
  pre: {
    tradeToday: true,
    oneTradeOnly: true,
    platformReady: true,
    vwapOk: true,
    noNewsRisk: true,
    calm: true
  },
  exec: { closedInsideOR:false, cleanBody:false }
}

function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

function todayStr(){ return new Date().toISOString().slice(0,10); }
function monthKey(){ return new Date().toISOString().slice(0,7); }

function tradesTodayCount(){
  const t = todayStr();
  return state.log.filter(x => x.type==="TRADE" && x.date===t).length;
}
function lastTrades(n=50){
  const t = state.log.filter(x => x.type==="TRADE");
  return t.slice(-n);
}
function lossStreak(){
  const t = lastTrades(80);
  let s=0;
  for(let i=t.length-1;i>=0;i--){
    if(t[i].result==="L") s++;
    else break;
  }
  return s;
}
function lossesInLast(k=3){
  const t = lastTrades(80);
  const r = t.slice(-k);
  return r.filter(x=>x.result==="L").length;
}

// Profit per trade is fixed by bracket (1 ES)
function tradePnL(result){
  const win = CFG.bracket.targetPts * 50;
  const loss = CFG.bracket.stopPts * 50;
  return result==="W" ? win : -loss;
}

function monthPnL(){
  const mk = monthKey();
  let pnl=0;
  for(const x of state.log){
    if(x.type!=="TRADE") continue;
    if(!x.date.startsWith(mk)) continue;
    pnl += tradePnL(x.result);
  }
  return pnl;
}

function monthWithdrawalProgress(){
  // You can withdraw from "profit buffer" conceptually — we track progress only.
  const pnl = monthPnL();
  const prog = Math.max(0, pnl); // don't count negative
  return { pnl, prog, goal: CFG.withdrawalGoal, pct: Math.min(100, (prog/CFG.withdrawalGoal)*100) };
}

function weekKey(){
  // ISO week-ish key (good enough for guardrail tracking)
  const d = new Date();
  const onejan = new Date(d.getFullYear(),0,1);
  const day = Math.floor((d - onejan) / 86400000) + 1;
  const wk = Math.ceil(day/7);
  return `${d.getFullYear()}-W${String(wk).padStart(2,"0")}`;
}
function weekPnL(){
  const wk = weekKey();
  let pnl=0;
  for(const x of state.log){
    if(x.type!=="TRADE") continue;
    if(x.week !== wk) continue;
    pnl += tradePnL(x.result);
  }
  return pnl;
}

// ============================
// Time: New York conversion (DST-safe enough for reminders)
// ============================
function nextETOccurrence(hourET, minuteET){
  const tz = "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });

  const now = new Date();
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p=>[p.type,p.value]));
  const etY = parseInt(parts.year,10);
  const etM = parseInt(parts.month,10);
  const etD = parseInt(parts.day,10);

  // Convert ET wall-clock -> instant by iterative correction
  function etToInstant(y,m,d,h,min){
    let guess = new Date(Date.UTC(y, m-1, d, h, min, 0));
    for(let i=0;i<6;i++){
      const p = Object.fromEntries(fmt.formatToParts(guess).map(p=>[p.type,p.value]));
      const gy=parseInt(p.year,10), gm=parseInt(p.month,10), gd=parseInt(p.day,10);
      const gh=parseInt(p.hour,10), gmin=parseInt(p.minute,10);
      const diff =
        (y-gy)*525600 + (m-gm)*43200 + (d-gd)*1440 + (h-gh)*60 + (min-gmin);
      guess = new Date(guess.getTime() + diff*60000);
      if(diff===0) break;
    }
    return guess;
  }

  function weekdayInET(date){
    const wfmt = new Intl.DateTimeFormat("en-US",{timeZone:tz, weekday:"short"});
    const w = wfmt.format(date);
    return ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[w] ?? date.getDay();
  }

  function nextWeekdayCandidate(y,m,d,h,min){
    for(let add=1;add<=10;add++){
      const cand = new Date(etToInstant(y,m,d,h,min).getTime() + add*24*60*60000);
      const wd = weekdayInET(cand);
      if(wd!==0 && wd!==6) return cand;
    }
    return new Date(etToInstant(y,m,d,h,min).getTime() + 24*60*60000);
  }

  let candidate = etToInstant(etY, etM, etD, hourET, minuteET);
  if(candidate.getTime() <= now.getTime()){
    candidate = nextWeekdayCandidate(etY, etM, etD, hourET, minuteET);
  }
  return candidate;
}

// ============================
// Notifications + Calendar export
// ============================
let notifArmed = false;
let notifTimers = [];

async function enableInAppNotifications(){
  if(!("Notification" in window)){ alert("Notifications not supported."); return; }
  const perm = await Notification.requestPermission();
  if(perm !== "granted"){ alert("Permission denied."); return; }
  scheduleNotifications();
  notifArmed = true;
  render(route());
}
function clearNotifTimers(){ notifTimers.forEach(t=>clearTimeout(t)); notifTimers=[]; }
function scheduleNotifications(){
  clearNotifTimers();
  for(const r of CFG.remindersET){
    const next = nextETOccurrence(r.hour, r.minute);
    const ms = next.getTime() - Date.now();
    if(ms>0 && ms < 1000*60*60*24*3){
      notifTimers.push(setTimeout(()=>{
        try{ new Notification(r.label); }catch(e){}
        scheduleNotifications();
      }, ms));
    }
  }
}

function downloadICS(){
  const tzid = "America/New_York";
  const uidBase = "topstep-bankmode-" + Math.random().toString(16).slice(2);
  const dtstamp = toICSUTC(new Date());

  const nextMon = nextLocalWeekday(1); // Monday
  const y = nextMon.getFullYear();
  const m = String(nextMon.getMonth()+1).padStart(2,"0");
  const d = String(nextMon.getDate()).padStart(2,"0");
  const datePart = `${y}${m}${d}`;

  const lines = [];
  lines.push("BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Topstep Bank Mode//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH");

  for(const r of CFG.remindersET){
    const hh = String(r.hour).padStart(2,"0");
    const mm = String(r.minute).padStart(2,"0");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uidBase}-${r.key}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`SUMMARY:${escapeICS(r.label)}`);
    lines.push(`DTSTART;TZID=${tzid}:${datePart}T${hh}${mm}00`);
    lines.push("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    lines.push("DURATION:PT5M");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n")], { type:"text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Topstep_BankMode_Reminders.ics";
  document.body.appendChild(a);
  a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function toICSUTC(d){
  const y=d.getUTCFullYear();
  const m=String(d.getUTCMonth()+1).padStart(2,"0");
  const da=String(d.getUTCDate()).padStart(2,"0");
  const hh=String(d.getUTCHours()).padStart(2,"0");
  const mm=String(d.getUTCMinutes()).padStart(2,"0");
  const ss=String(d.getUTCSeconds()).padStart(2,"0");
  return `${y}${m}${da}T${hh}${mm}${ss}Z`;
}
function escapeICS(s){
  return String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n");
}
function nextLocalWeekday(target){
  const d=new Date();
  const day=d.getDay();
  let add=(target-day+7)%7; if(add===0) add=7;
  d.setDate(d.getDate()+add); d.setHours(0,0,0,0);
  return d;
}

// ============================
// UI routing
// ============================
function route(){
  return location.hash.replace("#","") || "home";
}
window.addEventListener("hashchange", ()=>render(route()));

function render(view){
  const app = document.getElementById("app");
  const ttd = tradesTodayCount();
  const streak = lossStreak();
  const l3 = lossesInLast(3);
  const wkPnl = weekPnL();
  const { pnl, prog, goal, pct } = monthWithdrawalProgress();

  const warnings = [];
  if(state.panic.active && state.panic.date === todayStr()) warnings.push("Protect Account mode active → No trades today.");
  if(ttd >= 1) warnings.push("Already traded today → SKIP everything.");
  if(streak >= 3) warnings.push("3-loss streak → pause 48 hours.");
  else if(l3 >= 2) warnings.push("2 losses in last 3 trades → pause 24 hours.");
  if(wkPnl <= -1200) warnings.push("Weekly drawdown guardrail hit (≤ -$1200) → stop for week.");

  const warnCard = warnings.length ? `<div class="card"><h3>Warnings</h3><ul>${warnings.map(w=>`<li>${w}</li>`).join("")}</ul></div>` : "";

  if(view==="sop") return app.innerHTML = pageSOP();
  if(view==="decision") return app.innerHTML = pageDecision();
  if(view==="panic") return app.innerHTML = pagePanic();
  if(view==="log") return app.innerHTML = pageLog();
  if(view==="newtrade") return app.innerHTML = pageNewTrade();
  if(view==="scale") return app.innerHTML = pageScale();
  if(view==="settings") return app.innerHTML = pageSettings();
  if(view==="execute") return app.innerHTML = pageExecute();

  const b = CFG.bracket;
  const nextTimes = CFG.remindersET.map(r=>{
    const dt = nextETOccurrence(r.hour, r.minute);
    return `<li><b>${r.label}</b><br/><span class="muted">${dt.toLocaleString()}</span></li>`;
  }).join("");

  app.innerHTML = `
    <div class="card">
      <h1>Topstep Bank Mode</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe} | ${CFG.session}</div>
      <div style="margin-top:10px;">
        <span class="pill">Accounts: <b>${state.meta.accounts}×100K</b></span>
        <span class="pill">Today trades: <b>${ttd}/1</b></span>
        <span class="pill">Loss streak: <b>${streak}</b></span>
        <span class="pill">Losses last 3: <b>${l3}</b></span>
      </div>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#sop">SOP</a>
        <a class="btn" href="#decision">Decision</a>
        <a class="btn btn-danger" href="#panic">Protect Account</a>
        <a class="btn" href="#log">Log</a>
        <a class="btn" href="#scale">Scale</a>
        <a class="btn" href="#settings">Settings</a>
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
      <h2>$500 Monthly Withdrawal Tracker</h2>
      <div class="muted">Tracks this month’s logged PnL toward a conservative $${goal} withdrawal.</div>
      <hr/>
      <div class="pill">Month PnL: <b>$${pnl}</b></div>
      <div class="pill">Progress: <b>$${prog}</b> / $${goal} (${pct.toFixed(0)}%)</div>
      <div style="height:12px;background:#0f1622;border:1px solid #2a3a52;border-radius:999px;overflow:hidden;margin-top:10px;">
        <div style="height:100%;width:${pct}%;background:#1e5a35;"></div>
      </div>
      <div class="muted" style="margin-top:10px;">Rule: withdraw only after goal is hit AND you’re not in a drawdown week.</div>
    </div>

    <div class="card">
      <h2>Reminders (auto DST-adjusted)</h2>
      <div class="muted">Anchored to <span class="mono">America/New_York</span> so seasonal DST shifts are automatic.</div>
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
        Calendar alarms are the reliable option (fires even if app closed). In-app notifications work best when the app stays open.
      </div>
    </div>
  `;
}

function pageSOP(){
  const b = CFG.bracket;
  return `
    <div class="card">
      <h1>One-page SOP</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe} | ${CFG.session}</div>
      <hr/>
      <h3>Entry Conditions (ALL must be true)</h3>
      <ul>${CFG.sopRules.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <h3>Internal Guardrails (you obey these)</h3>
      <ul>${CFG.internalGuardrails.map(x=>`<li>${x}</li>`).join("")}</ul>
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

function pageDecision(){
  state.meta.pre = state.meta.pre || {};
  const pre = state.meta.pre;

  const win = nowInTradeWindowET();
  const d = decisionApproved();

  const verdict = d.approved
    ? `<div class="pill" style="border-color:rgba(95,141,78,.35);background:rgba(95,141,78,.10);color:#5F8D4E;"><b>✅ APPROVED</b> — when alert fires, execute fast</div>`
    : `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ NO TRADE</b> — protect the account</div>`;

  const windowLine = `<div class="muted">Trade window (ET): <b>09:45–10:30</b> · Your time: <b>${win.startToday.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${win.stopToday.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</b> · Now: <b>${win.inWindow ? "IN WINDOW" : "OUTSIDE"}</b></div>`;

  return `
    <div class="card">
      <h1>Decision</h1>
      <div class="muted">You decide slowly now, so you can execute instantly later.</div>
      <hr/>
      ${windowLine}
      <div style="margin-top:10px;">${verdict}</div>
    </div>

    <div class="card">
      <h2>Pre-Approval (do once before session)</h2>
      <div class="muted">If these are true, the alert becomes “permission”, not “debate”.</div>
      <hr/>

      ${checkboxRow("I am trading today (otherwise I ignore all alerts)", "tradeToday", pre.tradeToday)}
      ${checkboxRow("I accept 1 trade only (win or loss, I stop)", "oneTradeOnly", pre.oneTradeOnly)}
      ${checkboxRow("TopstepX + TradingView ready (logged in, data ok)", "platformReady", pre.platformReady)}
      ${checkboxRow("VWAP context is acceptable today", "vwapOk", pre.vwapOk)}
      ${checkboxRow("No major news risk for my window", "noNewsRisk", pre.noNewsRisk)}
      ${checkboxRow("I feel calm / not rushed (otherwise stand down)", "calm", pre.calm)}

      <div class="muted" style="margin-top:10px;">
        Auto blocks: Protect Account mode, already traded today, outside window.
      </div>

      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn btn-danger" href="#panic">Protect Account</a>
        <a class="btn" href="#execute" onclick="resetExec()">Alert Fired → Execute</a>
      </div>
    </div>
  `;
}

function pageExecute(){
  state.meta.exec = state.meta.exec || { closedInsideOR:false, cleanBody:false };
  const ex = state.meta.exec;

  const d = decisionApproved();
  const canExecute = d.approved;

  const verdict = !canExecute
    ? `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;">
         <b>⛔ DO NOT TRADE</b> — not pre-approved / blocked today
       </div>`
    : (ex.closedInsideOR && ex.cleanBody)
      ? `<div class="pill" style="border-color:rgba(95,141,78,.35);background:rgba(95,141,78,.10);color:#5F8D4E;">
           <b>✅ TAKE TRADE</b> — place bracket immediately
         </div>`
      : `<div class="pill"><b>⚡ EXECUTE CHECK</b> — 2 quick confirmations</div>`;

  return `
    <div class="card">
      <h1>Execute (Alert Fired)</h1>
      <div class="muted">Two taps. No thinking. If both true → enter.</div>
      <hr/>
      ${verdict}
      <hr/>

      <h3>Fast checks</h3>
      <div class="row" style="margin-top:10px;">
        <button class="btn ${ex.closedInsideOR?'btn-good':''}" onclick="setExec('closedInsideOR', ${!ex.closedInsideOR})" ${!canExecute?'disabled':''}>
          ${ex.closedInsideOR ? "✓" : "○"} Closed back inside OR
        </button>

        <button class="btn ${ex.cleanBody?'btn-good':''}" onclick="setExec('cleanBody', ${!ex.cleanBody})" ${!canExecute?'disabled':''}>
          ${ex.cleanBody ? "✓" : "○"} Clean body (not doji)
        </button>
      </div>

      <hr/>
      <h3>Bracket (locked)</h3>
      <ul>
        <li><b>${CFG.bracket.contracts} ES</b></li>
        <li>Stop: <b>${CFG.bracket.stopPts.toFixed(1)} pts</b> (≈ -$${(CFG.bracket.stopPts*50).toFixed(0)})</li>
        <li>Target: <b>${CFG.bracket.targetPts.toFixed(1)} pts</b> (≈ +$${(CFG.bracket.targetPts*50).toFixed(0)})</li>
      </ul>

      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#decision">Back</a>
        <a class="btn" href="#newtrade">Log after trade</a>
        <button class="btn btn-danger" onclick="resetExec(); location.hash='#decision';">Skip & Reset</button>
      </div>
    </div>
  `;
}
    
function checkboxRow(label, key, checked){
  const id = `pre_${key}`;
  return `
    <div style="display:flex;gap:10px;align-items:flex-start;margin:10px 0;">
      <input type="checkbox" id="${id}" ${checked ? "checked":""}
        onchange="setPre('${key}', this.checked)" style="width:22px;height:22px;margin-top:2px;">
      <label for="${id}" style="font-weight:800;flex:1;">${label}</label>
    </div>
  `;
}

function pagePanic(){
  return `
    <div class="card">
      <h1>🛑 Protect Account Mode</h1>
      <div class="muted">You are deliberately standing down to preserve capital.</div>
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
        <button class="btn btn-danger" onclick="setPanic()">Stand Down for Today</button>
        <a class="btn" href="#">Cancel</a>
      </div>
    </div>
  `;
}

function setPanic(){
  const note = (document.getElementById("panicNote").value||"").trim();
  if(!note){ alert("Write one sentence first."); return; }
  state.panic = { active:true, note, date: todayStr() };
  state.log.push({ type:"PANIC", date: todayStr(), time: new Date().toLocaleTimeString(), note });
  saveState();
  location.hash = "log";
}

function pageLog(){
  const rows = [...state.log].slice(-100).reverse();
  const items = rows.length ? rows.map(r=>{
    if(r.type==="TRADE") return `<li><b>${r.date} ${r.time}</b> — TRADE ${r.side} — <b>${r.result}</b> — ${r.note||""}</li>`;
    if(r.type==="PANIC") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#B45353;font-weight:900;">PROTECT ACCOUNT</span> — ${r.note||""}</li>`;
    return `<li>${JSON.stringify(r)}</li>`;
  }).join("") : "<li>No entries yet.</li>";

  return `
    <div class="card">
      <h1>Log</h1>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#newtrade">New Trade</a>
        <a class="btn btn-danger" href="#panic">Protect Account</a>
      </div>
      <hr/>
      <ul>${items}</ul>
      <hr/>
      <button class="btn btn-danger" onclick="clearAll()">Reset log (danger)</button>
    </div>
  `;
}

function pageNewTrade(){
  const ttd = tradesTodayCount();
  const locked = (ttd>=1) || (state.panic.active && state.panic.date===todayStr());

  return `
    <div class="card">
      <h1>New Trade</h1>
      <div class="muted">Enforces 1 trade/day. ${locked ? "Locked today." : ""}</div>
      <hr/>
      <label>Side</label>
      <select id="side" ${locked?"disabled":""}>
        <option value="LONG">LONG</option>
        <option value="SHORT">SHORT</option>
      </select>

      <label style="margin-top:10px;">Result</label>
      <select id="result" ${locked?"disabled":""}>
        <option value="W">W (Target)</option>
        <option value="L">L (Stop)</option>
      </select>

      <label style="margin-top:10px;">Note (optional)</label>
      <input id="note" placeholder="A+ / borderline / news / slipped" ${locked?"disabled":""}/>

      <div class="row" style="margin-top:12px;">
        <button class="btn btn-good" onclick="saveTrade()" ${locked?"disabled":""}>Save</button>
        <a class="btn" href="#log">Cancel</a>
      </div>
    </div>
  `;
}

function saveTrade(){
  if(tradesTodayCount()>=1){ alert("Already traded today. Stop."); location.hash="log"; return; }
  if(state.panic.active && state.panic.date===todayStr()){ alert("Panic mode today. Stop."); location.hash="log"; return; }

  const side = document.getElementById("side").value;
  const result = document.getElementById("result").value;
  const note = (document.getElementById("note").value||"").trim();

  state.log.push({
    type:"TRADE",
    date: todayStr(),
    time: new Date().toLocaleTimeString(),
    week: weekKey(),
    side, result, note
  });
  saveState();
  location.hash="log";
}

function pageScale(){
  const items = CFG.scalingPlan.map(x=>`
    <li><b>${x.phase} — ${x.title}</b><br/><span class="muted">${x.rule}</span></li>
  `).join("");

  return `
    <div class="card">
      <h1>Scale Like a Bank</h1>
      <div class="muted">Scale by replication first. Size comes later.</div>
      <hr/>
      <h3>Your current stack</h3>
      <div class="pill"><b>${state.meta.accounts}× $100K</b></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn" onclick="setAccounts(1)">1×</button>
        <button class="btn" onclick="setAccounts(2)">2×</button>
        <button class="btn" onclick="setAccounts(3)">3×</button>
      </div>
      <hr/>
      <h3>Plan</h3>
      <ul>${items}</ul>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#sop">SOP</a>
      </div>
    </div>
  `;
}

function setAccounts(n){
  state.meta.accounts = n;
  saveState();
  render("scale");
}

function pageSettings(){
  return `
    <div class="card">
      <h1>Settings</h1>
      <div class="muted">Light controls only. Strategy is locked.</div>
      <hr/>
      <div class="pill">Account: <b>${CFG.account}</b></div>
      <div class="pill">Profit target (eval): <b>$${CFG.profitTargetEval}</b></div>
      <div class="pill">Daily loss limit: <b>-$${CFG.dailyLossLimit}</b></div>
      <div class="pill">Max loss limit: <b>-$${CFG.maxLossLimit}</b></div>
      <hr/>
      <div class="row">
        <a class="btn" href="#">Home</a>
      </div>
    </div>
  `;
}

function clearAll(){
  if(!confirm("Reset everything? This deletes your log + panic status.")) return;
  state.log = [];
  state.panic = { active:false, note:"", date:"" };
  state.meta = { accounts: 1 };
  saveState();
  location.hash="";
}

// Init
document.addEventListener("DOMContentLoaded", ()=>render(route()));
