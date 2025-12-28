// Topstep Bank Mode (PWA) — Clean build with interactive decision checklist

const CFG = {
  account: "Topstep $100K (Standard)",
  instrument: "ES",
  timeframe: "2m",
  session: "RTH",
  profitTargetEval: 6000,
  dailyLossLimit: 2000,
  maxLossLimit: 3000,

  bracket: { contracts: 1, stopPts: 6.0, targetPts: 9.0 }, // 1 ES

  withdrawalGoal: 500,

  remindersET: [
    { key:"prep",   label:"Prep: Open TradingView + TopstepX", hour:9,  minute:25 },
    { key:"open",   label:"RTH Open (hands off)",             hour:9,  minute:30 },
    { key:"orlock", label:"OR Locked: start alert watch",     hour:9,  minute:45 },
    { key:"stop",   label:"Stop time: no more trades",        hour:10, minute:30 }
  ],

  sopRules: [
    "Trade ONLY when an alert fires. No alert = no trade.",
    "Only during the trade window (after OR is set).",
    "Candle must CLOSE back inside OR (rejection confirmed).",
    "Strong candle body (not a doji).",
    "VWAP aligned: SHORT only above VWAP, LONG only below VWAP.",
    "1 trade/day max. Win or loss = stop."
  ]
};

const LS_KEY = "topstep_bankmode_clean_v1";
const state = loadState();

function loadState() {
  const defaults = {
    log: [],
    protect: { active:false, note:"", date:"" },
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
  };
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || defaults; }
  catch { return defaults; }
}
function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

function todayStr(){ return new Date().toISOString().slice(0,10); }
function monthKey(){ return new Date().toISOString().slice(0,7); }

function tradesTodayCount(){
  const t = todayStr();
  return state.log.filter(x => x.type==="TRADE" && x.date===t).length;
}

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
  const pnl = monthPnL();
  const prog = Math.max(0, pnl);
  return { pnl, prog, goal: CFG.withdrawalGoal, pct: Math.min(100, (prog/CFG.withdrawalGoal)*100) };
}

// ---- New York time (DST-safe)
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

  function etToInstant(y,m,d,h,min){
    let guess = new Date(Date.UTC(y, m-1, d, h, min, 0));
    for(let i=0;i<6;i++){
      const p = Object.fromEntries(fmt.formatToParts(guess).map(p=>[p.type,p.value]));
      const gy=parseInt(p.year,10), gm=parseInt(p.month,10), gd=parseInt(p.day,10);
      const gh=parseInt(p.hour,10), gmin=parseInt(p.minute,10);
      const diff = (y-gy)*525600 + (m-gm)*43200 + (d-gd)*1440 + (h-gh)*60 + (min-gmin);
      guess = new Date(guess.getTime() + diff*60000);
      if(diff===0) break;
    }
    return guess;
  }

  let candidate = etToInstant(etY, etM, etD, hourET, minuteET);
  if(candidate.getTime() <= now.getTime()){
    candidate = new Date(candidate.getTime() + 24*60*60000);
  }
  return candidate;
}

function nowInTradeWindowET(){
  const tz = "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
  const now = new Date();
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p=>[p.type,p.value]));
  const y = parseInt(parts.year,10);
  const m = parseInt(parts.month,10);
  const d = parseInt(parts.day,10);

  function etToInstant(y,m,d,h,min){
    let guess = new Date(Date.UTC(y, m-1, d, h, min, 0));
    for(let i=0;i<6;i++){
      const p = Object.fromEntries(fmt.formatToParts(guess).map(p=>[p.type,p.value]));
      const gy=parseInt(p.year,10), gm=parseInt(p.month,10), gd=parseInt(p.day,10);
      const gh=parseInt(p.hour,10), gmin=parseInt(p.minute,10);
      const diff = (y-gy)*525600 + (m-gm)*43200 + (d-gd)*1440 + (h-gh)*60 + (min-gmin);
      guess = new Date(guess.getTime() + diff*60000);
      if(diff===0) break;
    }
    return guess;
  }

  const startToday = etToInstant(y,m,d,9,45);
  const stopToday  = etToInstant(y,m,d,10,30);
  return { inWindow: now >= startToday && now <= stopToday, startToday, stopToday };
}

// ---- Decision Engine
function decisionApproved(){
  const ttd = tradesTodayCount();
  const protectToday = state.protect.active && state.protect.date === todayStr();
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

  return { preOk, approved: preOk && !protectToday && ttd < 1 && w };
}

function setPre(key,val){
  state.meta.pre = state.meta.pre || {};
  state.meta.pre[key] = val;
  saveState();
  render(route());
}
function setExec(key,val){
  state.meta.exec = state.meta.exec || {};
  state.meta.exec[key] = val;
  saveState();
  render(route());
}
function resetExec(){
  state.meta.exec = { closedInsideOR:false, cleanBody:false };
  saveState();
}

function checkboxRow(label,key,checked){
  const id = `pre_${key}`;
  return `
    <div style="display:flex;gap:10px;align-items:flex-start;margin:10px 0;">
      <input type="checkbox" id="${id}" ${checked?"checked":""}
        onchange="setPre('${key}', this.checked)" style="width:22px;height:22px;margin-top:2px;">
      <label for="${id}" style="font-weight:800;flex:1;">${label}</label>
    </div>`;
}

// ---- Routing
function route(){ return location.hash.replace("#","") || "home"; }
window.addEventListener("hashchange", ()=>render(route()));

function render(view){
  const app = document.getElementById("app");
  if(view==="decision") return app.innerHTML = pageDecision();
  if(view==="execute") return app.innerHTML = pageExecute();
  if(view==="protect") return app.innerHTML = pageProtect();
  if(view==="log") return app.innerHTML = pageLog();
  if(view==="newtrade") return app.innerHTML = pageNewTrade();

  const ttd = tradesTodayCount();
  const { pnl, prog, goal, pct } = monthWithdrawalProgress();

  const nextTimes = CFG.remindersET.map(r=>{
    const dt = nextETOccurrence(r.hour, r.minute);
    return `<li><b>${r.label}</b><br/><span class="muted">${dt.toLocaleString()}</span></li>`;
  }).join("");

  app.innerHTML = `
    <div class="card">
      <h1>Topstep Bank Mode</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe} | ${CFG.session}</div>
      <div style="margin-top:10px;">
        <span class="pill">Daily allowance: <b>${ttd}/1</b></span>
        <span class="pill">Month PnL: <b>$${pnl}</b></span>
        <span class="pill">Goal: <b>$${goal}</b></span>
      </div>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#decision">Decision</a>
        <a class="btn" href="#log">Log</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
      </div>
    </div>

    <div class="card">
      <h2>$500 Withdrawal Tracker</h2>
      <div class="pill">Progress: <b>$${prog}</b> / $${goal} (${pct.toFixed(0)}%)</div>
      <div style="height:12px;background:#f2f3f1;border:1px solid #e5e7eb;border-radius:999px;overflow:hidden;margin-top:10px;">
        <div style="height:100%;width:${pct}%;background:#5F8D4E;"></div>
      </div>
    </div>

    <div class="card">
      <h2>Reminders (auto DST-adjusted)</h2>
      <div class="muted">Anchored to <span class="mono">America/New_York</span>.</div>
      <hr/>
      <ul>${nextTimes}</ul>
    </div>
  `;
}

function pageDecision(){
  state.meta.pre = state.meta.pre || {};
  const pre = state.meta.pre;
  const win = nowInTradeWindowET();
  const d = decisionApproved();

  const verdict = d.approved
    ? `<div class="pill" style="border-color:rgba(95,141,78,.35);background:rgba(95,141,78,.10);color:#5F8D4E;"><b>✅ APPROVED</b> — alert = execute</div>`
    : `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ NO TRADE</b> — protect the account</div>`;

  return `
    <div class="card">
      <h1>Decision</h1>
      <div class="muted">Decide slowly now, execute instantly later.</div>
      <hr/>
      <div class="muted">Trade window (ET): <b>09:45–10:30</b> · Your time: <b>${win.startToday.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${win.stopToday.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</b> · Now: <b>${win.inWindow ? "IN WINDOW" : "OUTSIDE"}</b></div>
      <div style="margin-top:10px;">${verdict}</div>
    </div>

    <div class="card">
      <h2>Pre-Approval (tap)</h2>
      <div class="muted">If these are true, alert becomes permission.</div>
      <hr/>
      ${checkboxRow("I am trading today (otherwise ignore alerts)", "tradeToday", pre.tradeToday)}
      ${checkboxRow("I accept 1 trade only (win/loss stop)", "oneTradeOnly", pre.oneTradeOnly)}
      ${checkboxRow("TopstepX + TradingView ready", "platformReady", pre.platformReady)}
      ${checkboxRow("VWAP context acceptable", "vwapOk", pre.vwapOk)}
      ${checkboxRow("No major news risk in window", "noNewsRisk", pre.noNewsRisk)}
      ${checkboxRow("I feel calm / not rushed", "calm", pre.calm)}

      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
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
    ? `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ DO NOT TRADE</b> — blocked today</div>`
    : (ex.closedInsideOR && ex.cleanBody)
      ? `<div class="pill" style="border-color:rgba(95,141,78,.35);background:rgba(95,141,78,.10);color:#5F8D4E;"><b>✅ TAKE TRADE</b> — place bracket now</div>`
      : `<div class="pill"><b>⚡ EXECUTE CHECK</b> — two taps</div>`;

  return `
    <div class="card">
      <h1>Execute (Alert Fired)</h1>
      <div class="muted">Two taps. If both true → enter.</div>
      <hr/>
      ${verdict}
      <hr/>
      <div class="row">
        <button class="btn ${ex.closedInsideOR?'btn-good':''}" onclick="setExec('closedInsideOR', ${!ex.closedInsideOR})" ${!canExecute?'disabled':''}>
          ${ex.closedInsideOR ? "✓" : "○"} Closed back inside OR
        </button>
        <button class="btn ${ex.cleanBody?'btn-good':''}" onclick="setExec('cleanBody', ${!ex.cleanBody})" ${!canExecute?'disabled':''}>
          ${ex.cleanBody ? "✓" : "○"} Clean body (not doji)
        </button>
      </div>
      <hr/>
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

function pageProtect(){
  return `
    <div class="card">
      <h1>🛑 Protect Account Mode</h1>
      <div class="muted">Stand down to preserve capital.</div>
      <hr/>
      <label>One sentence (required)</label>
      <textarea id="protectNote" rows="3" placeholder="I am protecting the account."></textarea>
      <div class="row" style="margin-top:12px;">
        <button class="btn btn-danger" onclick="setProtect()">Stand Down for Today</button>
        <a class="btn" href="#">Cancel</a>
      </div>
    </div>
  `;
}
function setProtect(){
  const note = (document.getElementById("protectNote").value||"").trim();
  if(!note){ alert("Write one sentence first."); return; }
  state.protect = { active:true, note, date: todayStr() };
  state.log.push({ type:"PROTECT", date: todayStr(), time: new Date().toLocaleTimeString(), note });
  saveState();
  location.hash = "log";
}

function pageLog(){
  const rows = [...state.log].slice(-120).reverse();
  const items = rows.length ? rows.map(r=>{
    if(r.type==="TRADE") return `<li><b>${r.date} ${r.time}</b> — TRADE ${r.side} — <b>${r.result}</b> — ${r.note||""}</li>`;
    if(r.type==="PROTECT") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#B45353;font-weight:900;">PROTECT ACCOUNT</span> — ${r.note||""}</li>`;
    return `<li>${JSON.stringify(r)}</li>`;
  }).join("") : "<li>No entries yet.</li>";

  return `
    <div class="card">
      <h1>Log</h1>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#newtrade">New Trade</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
      </div>
      <hr/>
      <ul>${items}</ul>
      <hr/>
      <button class="btn btn-danger" onclick="clearAll()">Reset (danger)</button>
    </div>
  `;
}

function pageNewTrade(){
  const ttd = tradesTodayCount();
  const locked = (ttd>=1) || (state.protect.active && state.protect.date===todayStr());
  return `
    <div class="card">
      <h1>New Trade</h1>
      <div class="muted">1 trade/day enforced.</div>
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
      <input id="note" placeholder="A+ / borderline / slipped" ${locked?"disabled":""}/>
      <div class="row" style="margin-top:12px;">
        <button class="btn btn-good" onclick="saveTrade()" ${locked?"disabled":""}>Save</button>
        <a class="btn" href="#log">Cancel</a>
      </div>
    </div>
  `;
}
function saveTrade(){
  if(tradesTodayCount()>=1){ alert("Already traded today."); location.hash="log"; return; }
  if(state.protect.active && state.protect.date===todayStr()){ alert("Protect Account mode today."); location.hash="log"; return; }
  const side = document.getElementById("side").value;
  const result = document.getElementById("result").value;
  const note = (document.getElementById("note").value||"").trim();
  state.log.push({ type:"TRADE", date: todayStr(), time:new Date().toLocaleTimeString(), side, result, note });
  saveState();
  location.hash="log";
}

function clearAll(){
  if(!confirm("Reset everything?")) return;
  state.log = [];
  state.protect = { active:false, note:"", date:"" };
  state.meta = {
    accounts: 1,
    pre: { tradeToday:true, oneTradeOnly:true, platformReady:true, vwapOk:true, noNewsRisk:true, calm:true },
    exec: { closedInsideOR:false, cleanBody:false }
  };
  saveState();
  location.hash="";
}

document.addEventListener("DOMContentLoaded", ()=>render(route()));
