// Topstep Bank Mode (PWA) — Full build (Decision Engine + SOP + Reminders + Scale + Reinforcement)

const CFG = {
  account: "Topstep $100K (Standard)",
  instrument: "ES",
  timeframe: "2m",
  session: "RTH",
  profitTargetEval: 6000,
  dailyLossLimit: 2000,
  maxLossLimit: 3000,

  // Locked bracket (1 ES)
  bracket: { contracts: 1, stopPts: 6.0, targetPts: 9.0 }, // -$300 / +$450

  withdrawalGoal: 500,

  // Reminder times anchored to New York time (DST auto)
  remindersET: [
    { key:"prep",   label:"Prep: Open TradingView + TopstepX", hour:9,  minute:25 },
    { key:"open",   label:"RTH Open (hands off)",             hour:9,  minute:30 },
    { key:"orlock", label:"OR Locked: start alert watch",     hour:9,  minute:45 },
    { key:"stop",   label:"Stop time: no more trades",        hour:10, minute:30 }
  ],

  // Entry rules (vwap fade framework)
  sopRules: [
    "Trade ONLY when an alert fires. No alert = no trade.",
    "Trade ONLY inside the window (after OR is locked).",
    "Rejection candle must CLOSE back inside OR (confirmed rejection).",
    "Candle body must be clean (not a doji / indecision).",
    "VWAP alignment: SHORT only when price is above VWAP; LONG only when price is below VWAP.",
    "1 trade/day max. Win or loss = stop."
  ],

  // When to Protect Account (conditions)
  protectWhen: [
    "You feel urgency to 'pass fast' or to 'make back' losses.",
    "You are tempted to take a second trade after a miss.",
    "You are staring at charts outside the window looking for action.",
    "You feel anger / frustration / restlessness.",
    "Your body cues: tight chest, jaw clench, shaky leg, fast breathing.",
    "You violated a rule earlier today (even if it was small).",
  ],

  // Protect Account protocol
  protectProtocol: [
    "Stand up. 10 slow breaths (4s in, 6s out).",
    "Walk away 5 minutes (timer).",
    "Write 1 sentence: 'I am protecting the account.'",
    "Mark today as NO TRADE. Ignore alerts.",
    "Come back tomorrow with a clean slate."
  ],

  // Streak protocol (keep account alive)
  streakProtocol: [
    "2 losses in last 3 trades → pause 24 hours.",
    "3 losses in a row → pause 48 hours.",
    "Weekly drawdown ≥ −$1200 → stop for week."
  ],

  // Scaling roadmap
  scalingPlan: [
    { phase:"Phase 1", title:"1× $100K (prove process)", steps:[
      "Trade 1 ES, 1 trade/day for 20 trading days.",
      "Aim: consistency > speed. Protect Account is a skill.",
      "First goal: $500 payout rhythm, not max profit."
    ]},
    { phase:"Phase 2", title:"2× $100K (replicate)", steps:[
      "Add 2nd $100K only after 2 clean months (no rule breaks).",
      "Copy-paste same bracket & same window. No size increase.",
      "Treat account 2 as a photocopy, not a new strategy."
    ]},
    { phase:"Phase 3", title:"3× $100K OR move to $150K (simplify)", steps:[
      "After 2–3 payouts across 2 accounts, choose: replicate or consolidate.",
      "If consolidate: keep the same risk per trade (do NOT scale risk just because account is larger)."
    ]},
    { phase:"Phase 4", title:"Institution mode", steps:[
      "Only after repeated payouts: consider 2 ES per account OR a second setup.",
      "Never add complexity when you're still 'trying to pass'. Complexity is a leak."
    ]},
  ]
};

// ============================
// Storage
// ============================
const LS_KEY = "topstep_bankmode_full_v2";
const state = loadState();

function loadState(){
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
      exec: { closedInsideOR:false, cleanBody:false },
      notif: { armed:false }
    },
    behavior: { days: {} }
  };
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY)) || defaults;
    // migrations
    if(!s.behavior) s.behavior = { days: {} };
    if(!s.news) s.news = { enabled:true, bufferMin:10, events: [] };
    if(typeof s.news.enabled !== 'boolean') s.news.enabled = true;
    if(!Number.isFinite(s.news.bufferMin)) s.news.bufferMin = 10;
    if(!Array.isArray(s.news.events)) s.news.events = [];
    if(typeof s.news.apiUrl !== 'string') s.news.apiUrl = "";
    if(typeof s.news.lastSyncET !== 'string') s.news.lastSyncET = "";
    if(typeof s.news.autoEnabled !== 'boolean') s.news.autoEnabled = true;


    if(!s.behavior.days) s.behavior.days = {};
    if(!s.meta) s.meta = defaults.meta;
    if(!s.meta.pre) s.meta.pre = defaults.meta.pre;
    if(!s.meta.exec) s.meta.exec = defaults.meta.exec;
    if(!s.meta.notif) s.meta.notif = defaults.meta.notif;
    if(!s.protect) s.protect = defaults.protect;
    if(!Array.isArray(s.log)) s.log = [];
    return s;
  }
  catch { return defaults; }
}
function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

function todayStr(){ return new Date().toISOString().slice(0,10); }
function monthKey(){ return new Date().toISOString().slice(0,7); }



// ============================
// News Lockout (manual schedule; ET-based)
// ============================
function etParts(date=new Date()){
  try{
    const d = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"}).format(date);
    const t = new Intl.DateTimeFormat("en-GB",{timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false}).format(date);
    const [hh,mm]=t.split(":").map(x=>parseInt(x,10));
    return {date:d, hh, mm, mins: hh*60+mm};
  }catch{
    const iso = date.toISOString().slice(0,10);
    return {date:iso, hh:date.getHours(), mm:date.getMinutes(), mins:date.getHours()*60+date.getMinutes()};
  }
}
function normalizeHHMM(s){
  const m = (s||"").trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  let hh = Math.max(0, Math.min(23, parseInt(m[1],10)));
  let mm = Math.max(0, Math.min(59, parseInt(m[2],10)));
  return String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0");
}


async function syncNewsFromApi(force=false){
  // Fetches high-impact news from a user-provided API URL (recommended: Cloudflare Worker).
  // It merges events into today's list (ET) and marks them as auto:true so they can be replaced on next sync.
  const url = (state.news?.apiUrl||"").trim();
  if(!url) return {ok:false, reason:"no_url"};
  if(!state.news?.autoEnabled) return {ok:false, reason:"disabled"};

  const today = etParts().date;
  if(!force && state.news.lastSyncET === today) return {ok:true, skipped:true};

  try{
    const r = await fetch(url, {cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data = await r.json();
    const events = Array.isArray(data?.events) ? data.events : [];
    // expected: [{timeET:"08:30", title:"CPI", impact:"high"}]
    const high = events.filter(e => {
      const imp = String(e.impact||"").toLowerCase();
      return imp === "high" || imp === "red" || imp === "3";
    }).map(e => ({
      date: today,
      timeET: normalizeHHMM(e.timeET||e.time||""),
      title: String(e.title||e.name||"High impact").slice(0,40),
      auto: true
    })).filter(e=>!!e.timeET);

    state.news.events = state.news.events || [];
    // remove old auto events for today, then add new (dedupe by time)
    state.news.events = state.news.events.filter(e => !(e.date===today && e.auto));
    const seen = new Set(state.news.events.filter(e=>e.date===today).map(e=>`${e.date}|${e.timeET}`));
    for(const e of high){
      const key = `${e.date}|${e.timeET}`;
      if(seen.has(key)) continue;
      state.news.events.push(e);
      seen.add(key);
    }
    state.news.lastSyncET = today;
    saveState();
    return {ok:true, count:high.length};
  }catch(err){
    console.warn("syncNewsFromApi failed", err);
    return {ok:false, reason:String(err.message||err)};
  }
}

function parseNewsLines(text){
  const lines = (text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out=[];
  for(const line of lines){
    // Accept: "08:30 CPI", "8:30 - CPI", "0830 CPI", "08:30ET CPI"
    let t=null, title="";
    const m1 = line.match(/^(\d{1,2}):(\d{2})\s*(?:ET|et)?\s*[-–—]?\s*(.*)$/);
    if(m1){
      t = normalizeHHMM(`${m1[1]}:${m1[2]}`);
      title = (m1[3]||"").trim();
    }else{
      const m2 = line.match(/^(\d{2})(\d{2})\s*(?:ET|et)?\s*[-–—]?\s*(.*)$/);
      if(m2){
        t = normalizeHHMM(`${m2[1]}:${m2[2]}`);
        title = (m2[3]||"").trim();
      }
    }
    if(t){
      out.push({timeET:t, title: (title||"High impact").slice(0,40)});
    }
  }
  return out;
}
function importNewsText(dateStr, text){
  const items = parseNewsLines(text);
  if(!items.length){ toast("No valid times found. Use HH:MM ET, one per line."); return; }
  state.news = state.news || { enabled:true, bufferMin:10, events:[] };
  state.news.events = state.news.events || [];
  // De-dupe by time+date
  const existing = new Set(state.news.events.filter(e=>e.date===dateStr).map(e=>`${e.date}|${e.timeET}`));
  let added=0;
  for(const it of items){
    const key = `${dateStr}|${it.timeET}`;
    if(existing.has(key)) continue;
    state.news.events.push({date:dateStr, timeET:it.timeET, title:it.title});
    existing.add(key);
    added++;
  }
  saveState();
  if(added) toast(`Imported ${added} event(s) ✅`);
  else toast("Nothing new to import");
}

function addNewsEvent(dateStr, timeET, title){
  const t = normalizeHHMM(timeET);
  if(!t) { toast("Time must be HH:MM (ET)"); return; }
  state.news = state.news || { enabled:true, bufferMin:10, events:[] };
  state.news.events = state.news.events || [];
  state.news.events.push({date: dateStr, timeET: t, title: (title||"High impact").trim().slice(0,40)});
  saveState();
  toast("News event added ✅");
}
function removeNewsEvent(idx){
  if(!state.news?.events) return;
  state.news.events.splice(idx,1);
  saveState();
  toast("Removed");
}
function isInNewsLockout(){
  if(!state.news?.enabled) return {locked:false, next:null};
  const buf = Math.max(0, Math.min(120, parseInt(state.news.bufferMin||10,10)));
  const now = etParts();
  const list = (state.news.events||[]).filter(e=>e.date===now.date);
  let locked=false;
  let next=null;
  for(const e of list){
    const t = normalizeHHMM(e.timeET);
    if(!t) continue;
    const [hh,mm]=t.split(":").map(n=>parseInt(n,10));
    const emins = hh*60+mm;
    const start = emins - buf;
    const end = emins + buf;
    if(now.mins >= start && now.mins <= end){
      locked=true;
      next=e; break;
    }
    if(now.mins < start){
      if(!next) next=e;
      else{
        const [nh,nm]=normalizeHHMM(next.timeET).split(":").map(n=>parseInt(n,10));
        if(emins < nh*60+nm) next=e;
      }
    }
  }
  return {locked, next};
}

// ============================
// Behavior / Habit Tracking
// ============================
function isWeekdayET(date){
  try{
    const wfmt = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York", weekday:"short"});
    const w = wfmt.format(date);
    const wd = ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[w] ?? date.getDay();
    return wd !== 0 && wd !== 6;
  }catch{ // fallback
    const wd = date.getDay();
    return wd !== 0 && wd !== 6;
  }
}
function setCompliance(dateStr, ok, reason){
  state.behavior = state.behavior || { days:{} };
  state.behavior.days = state.behavior.days || {};
  state.behavior.days[dateStr] = { ok: !!ok, reason: reason||"", ts: Date.now() };
  saveState();
}
function getCompliance(dateStr){
  const d = state.behavior?.days?.[dateStr];
  return d ? d.ok : null;
}
function toggleCompliance(dateStr){
  const cur = getCompliance(dateStr);
  setCompliance(dateStr, !(cur===true), "manual");
}
function complianceStreak(daysBack=120){
  // count consecutive compliant ET-weekdays ending today (inclusive if weekday)
  const now = new Date();
  let streak=0;
  for(let i=0;i<daysBack;i++){
    const d = new Date(now.getTime() - i*24*60*60000);
    if(!isWeekdayET(d)) continue;
    const key = d.toISOString().slice(0,10);
    const ok = getCompliance(key);
    if(ok===true) streak++;
    else break;
  }
  return streak;
}
function lastNWeekdays(n=60){
  const arr=[];
  let d=new Date();
  // go back enough to collect n weekdays
  while(arr.length<n){
    if(isWeekdayET(d)) arr.push(new Date(d));
    d = new Date(d.getTime()-24*60*60000);
  }
  return arr.reverse();
}
function weeklyBuckets(weeks=15){
  // returns array of {label, ok, total, pct}
  const now = new Date();
  // find Monday of current week (ET-ish approximated in local; good enough for habit view)
  const start = new Date(now.getTime());
  start.setHours(0,0,0,0);
  const day = start.getDay(); // 0 sun
  const diff = (day+6)%7; // monday=0
  start.setDate(start.getDate()-diff);

  const buckets=[];
  for(let w=weeks-1; w>=0; w--){
    const wkStart = new Date(start.getTime() - w*7*24*60*60000);
    let ok=0,total=0;
    for(let i=0;i<5;i++){
      const d = new Date(wkStart.getTime() + i*24*60*60000);
      if(!isWeekdayET(d)) continue;
      total++;
      const key=d.toISOString().slice(0,10);
      if(getCompliance(key)===true) ok++;
    }
    const pct = total? Math.round((ok/total)*100):0;
    const label = wkStart.toISOString().slice(5,10); // MM-DD
    buckets.push({label, ok, total, pct});
  }
  return buckets;
}
function tradesTodayCount(){
  const t = todayStr();
  return state.log.filter(x=>x.type==="TRADE" && x.date===t).length;
}
function lastTrades(n=100){
  return state.log.filter(x=>x.type==="TRADE").slice(-n);
}
function lossStreak(){
  const t = lastTrades(200);
  let s=0;
  for(let i=t.length-1;i>=0;i--){
    if(t[i].result==="L") s++;
    else break;
  }
  return s;
}
function lossesInLast(k=3){
  const t = lastTrades(200);
  return t.slice(-k).filter(x=>x.result==="L").length;
}

// PnL math (fixed bracket)
function tradePnL(result){
  const win = CFG.bracket.targetPts * 50;
  const loss = CFG.bracket.stopPts * 50;
  return result==="W" ? win : -loss;
}
function monthTradePnL(){
  const mk = monthKey();
  let pnl=0;
  for(const x of state.log){
    if(x.type!=="TRADE") continue;
    if(!x.date.startsWith(mk)) continue;
    pnl += tradePnL(x.result);
  }
  return pnl;
}
function monthWithdrawn(){
  const mk = monthKey();
  let w=0;
  for(const x of state.log){
    if(x.type!=="WITHDRAW") continue;
    if(!x.date.startsWith(mk)) continue;
    w += (x.amount||0);
  }
  return w;
}
function monthWithdrawalProgress(){
  const trade = monthTradePnL();
  const withdrawn = monthWithdrawn();
  const net = trade - withdrawn;
  const prog = Math.max(0, net);
  const goal = CFG.withdrawalGoal;
  return { trade, withdrawn, net, prog, goal, pct: Math.min(100, (prog/goal)*100) };
}

// Weekly guardrail for streak protocol
function weekKey(){
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
// New York time helpers (DST-safe)
// ============================
const ET_TZ = "America/New_York";

function weekdayInET(date){
  const wfmt = new Intl.DateTimeFormat("en-US",{timeZone:ET_TZ, weekday:"short"});
  const w = wfmt.format(date);
  return ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[w] ?? date.getDay();
}
function isETWeekday(date){
  const wd = weekdayInET(date);
  return wd !== 0 && wd !== 6;
}

// Convert an ET date/time to a real instant (iterative, DST-safe)
function etToInstant(y,m,d,h,min){
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
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

// Next occurrence for an ET clock time, but ONLY on ET weekdays (Mon–Fri)
function nextETOccurrence(hourET, minuteET){
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });

  const now = new Date();
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p=>[p.type,p.value]));
  let y = parseInt(parts.year,10);
  let m = parseInt(parts.month,10);
  let d = parseInt(parts.day,10);

  let candidate = etToInstant(y,m,d,hourET,minuteET);

  function advanceOneDayET(){
    const next = new Date(candidate.getTime() + 24*60*60000);
    const p2 = Object.fromEntries(fmt.formatToParts(next).map(p=>[p.type,p.value]));
    y = parseInt(p2.year,10); m = parseInt(p2.month,10); d = parseInt(p2.day,10);
    candidate = etToInstant(y,m,d,hourET,minuteET);
  }

  while(candidate.getTime() <= now.getTime() || !isETWeekday(candidate)){
    advanceOneDayET();
    if((candidate.getTime()-now.getTime()) > 14*24*60*60000) break;
  }
  return candidate;
}

function nowInTradeWindowET(){
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
  const now = new Date();
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p=>[p.type,p.value]));
  const y = parseInt(parts.year,10);
  const m = parseInt(parts.month,10);
  const d = parseInt(parts.day,10);

  const startToday = etToInstant(y,m,d,9,45);
  const stopToday  = etToInstant(y,m,d,10,30);

  return { inWindow: (now >= startToday && now <= stopToday) && isETWeekday(now), startToday, stopToday, isWeekday: isETWeekday(now) };
}


// ============================
// Decision Engine (interactive)
// ============================
function decisionApproved(){
  const news = isInNewsLockout();
  const ttd = tradesTodayCount();
  const protectToday = state.protect.active && state.protect.date === todayStr();
  const win = nowInTradeWindowET();
  const weekendLockout = !win.isWeekday;

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

  return { preOk, approved: preOk && !protectToday && ttd < 1 && win.inWindow && !weekendLockout, protectToday, ttd, inWindow: win.inWindow, weekendLockout };
}

function setPre(key,val){
  state.meta.pre = state.meta.pre || {};
  state.meta.pre[key] = val;
  saveState();
  // Reinforce: when preOk achieved while calm, celebrate lightly
  const d = decisionApproved();
  if(d.preOk) celebrate("Pre-approved ✅");
  render(route());
}
function safeToggleExec(key){
  const d = decisionApproved();
  if(!d.approved){
    const msg = d.newsLockout ? ("News lockout: " + (d.newsNext?.title || "High impact")) : (d.weekendLockout ? "Weekend lockout (RTH closed)" : (d.inWindow ? "Blocked today" : "Outside trade window" ));
    toast("Can't tap: " + msg);
    return;
  }
  state.meta.exec = state.meta.exec || { closedInsideOR:false, cleanBody:false };
  state.meta.exec[key] = !state.meta.exec[key];
  saveState();
  const d2 = decisionApproved();
  if(d2.approved && state.meta.exec.closedInsideOR && state.meta.exec.cleanBody) celebrate("Execute ✅");
  render(route());
}

function setExec(key,val){
  state.meta.exec = state.meta.exec || {};
  state.meta.exec[key] = val;
  saveState();
  const d = decisionApproved();
  if(d.approved && state.meta.exec.closedInsideOR && state.meta.exec.cleanBody) celebrate("Execute ✅");
  render(route());
}
function resetExec(){
  state.meta.exec = { closedInsideOR:false, cleanBody:false };
  saveState();
}

function skipAndReset(){
  const win = nowInTradeWindowET ? nowInTradeWindowET() : { inWindow:false, isWeekday:true };
  // Give compliance credit for skipping (discipline). Only credit on ET weekdays.
  if(win.isWeekday) setCompliance(todayStr(), true, "skip");
  resetExec();
  toast("Skipped ✅ (no chase)");
  location.hash = "decision";
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

// ============================
// Celebrations (clean, subtle)
// ============================
function toast(msg){
  const el = document.getElementById("toast");
  if(!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.display="none"; }, 1200);
}

function celebrate(label="Nice"){
  toast(label);
  // subtle particles (muted)
  const c = document.getElementById("celebrate");
  if(!c) return;
  const ctx = c.getContext("2d");
  const w = c.width = window.innerWidth;
  const h = c.height = window.innerHeight;
  c.style.display = "block";

  const colors = ["#4C7F7A","#5F8D4E","#3A7CA5","#E5E7EB"];
  const parts = [];
  const N = 60;

  for(let i=0;i<N;i++){
    parts.push({
      x: w/2 + (Math.random()-0.5)*120,
      y: 40 + (Math.random()-0.5)*30,
      vx: (Math.random()-0.5)*4,
      vy: Math.random()*3 + 1,
      r: Math.random()*3 + 2,
      a: 1,
      col: colors[(Math.random()*colors.length)|0]
    });
  }

  let t=0;
  function frame(){
    t++;
    ctx.clearRect(0,0,w,h);
    for(const p of parts){
      p.x += p.vx;
      p.y += p.vy + 0.03*t;
      p.a -= 0.012;
      ctx.globalAlpha = Math.max(0,p.a);
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = p.col;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if(t<70){
      requestAnimationFrame(frame);
    } else {
      c.style.display = "none";
      ctx.clearRect(0,0,w,h);
    }
  }
  requestAnimationFrame(frame);
}

// ============================
// Reminders + Notifications + ICS
// ============================
let notifTimers = [];

async function enableInAppNotifications(){
  if(!("Notification" in window)){ alert("Notifications not supported."); return; }
  const perm = await Notification.requestPermission();
  if(perm !== "granted"){ alert("Permission denied."); return; }
  state.meta.notif = state.meta.notif || { armed:false };
  state.meta.notif.armed = true;
  saveState();
  scheduleNotifications();
  celebrate("Reminders ON ✅");
  render(route());
}

function disableInAppNotifications(){
  state.meta.notif = state.meta.notif || { armed:false };
  state.meta.notif.armed = false;
  saveState();
  clearNotifTimers();
  render(route());
}

function clearNotifTimers(){ notifTimers.forEach(t=>clearTimeout(t)); notifTimers=[]; }

function scheduleNotifications(){
  clearNotifTimers();
  if(!(state.meta.notif && state.meta.notif.armed)) return;

  for(const r of CFG.remindersET){
    const next = nextETOccurrence(r.hour, r.minute);
    const ms = next.getTime() - Date.now();
    if(ms>0 && ms < 1000*60*60*24*3){
      notifTimers.push(setTimeout(()=>{
        try{ new Notification(r.label); }catch(e){}
        scheduleNotifications(); // reschedule
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

  celebrate("Calendar added ✅");
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
// Routing
// ============================
function route(){ return location.hash.replace("#","") || "home"; }
window.addEventListener("hashchange", ()=>render(route()));
window.addEventListener("focus", ()=>{ if(state.meta.notif && state.meta.notif.armed) scheduleNotifications(); });

function render(view){
  const app = document.getElementById("app");

  if(view==="sop") return app.innerHTML = pageSOP();
  if(view==="decision") return app.innerHTML = pageDecision();
  if(view==="execute") return app.innerHTML = pageExecute();
  if(view==="protect") return app.innerHTML = pageProtect();
  if(view==="log") return app.innerHTML = pageLog();
  if(view==="newtrade") return app.innerHTML = pageNewTrade();
  if(view==="scale") return app.innerHTML = pageScale();
  if(view==="behavior") return app.innerHTML = pageBehavior();
  if(view==="news") return app.innerHTML = pageNews();
  if(view==="settings") return app.innerHTML = pageSettings();

  const ttd = tradesTodayCount();
  const streak = lossStreak();
  const l3 = lossesInLast(3);
  const wkPnl = weekPnL();
  const { trade, withdrawn, net, prog, goal, pct } = monthWithdrawalProgress();

  const warnings = [];
  if(state.protect.active && state.protect.date === todayStr()) warnings.push("Protect Account mode active → No trades today.");
  if(ttd >= 1) warnings.push("Already traded today → no more trades.");
  if(streak >= 3) warnings.push("3-loss streak → pause 48 hours.");
  else if(l3 >= 2) warnings.push("2 losses in last 3 trades → pause 24 hours.");
  if(wkPnl <= -1200) warnings.push("Weekly guardrail hit (≤ -$1200) → stop for week.");

  const warnCard = warnings.length ? `<div class="card"><h3>Caution</h3><ul>${warnings.map(w=>`<li>${w}</li>`).join("")}</ul></div>` : "";

  const win = nowInTradeWindowET();
  const weekendCard = (!win.isWeekday)
    ? `<div class="card"><h3>Weekend lockout</h3><div class="muted"><b>RTH is closed</b> in New York. This app is <b>RTH weekdays only</b> (Mon–Fri). No trades today.</div></div>`
    : "";

  const b = CFG.bracket;
  const nextTimes = CFG.remindersET.map(r=>{
    const dt = nextETOccurrence(r.hour, r.minute);
    return `<li><b>${r.label}</b><br/><span class="muted">${dt.toLocaleString()}</span></li>`;
  }).join("");

  const notifArmed = !!(state.meta.notif && state.meta.notif.armed);

  // If goal met, offer "Record Withdrawal" button
  const canWithdraw = prog >= goal;
  const withdrawCta = canWithdraw ? `
    <div class="row" style="margin-top:12px;">
      <button class="btn btn-good" onclick="recordWithdrawal(${goal})">Record withdrawal $${goal}</button>
      <button class="btn" onclick="resetWithdrawalTracker()">Reset tracker (manual)</button>
    </div>
    <div class="muted" style="margin-top:10px;">Recording a withdrawal subtracts $${goal} from this month's tracker without deleting your trade log.</div>
  ` : `
    <div class="muted" style="margin-top:10px;">When the bar fills: record a withdrawal to reset the tracker for the next $${goal} cycle.</div>
  `;

  app.innerHTML = `
    <div class="card">
      <h1>Topstep Bank Mode</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe} | ${CFG.session}</div>
      <div style="margin-top:10px;">
        <span class="pill">Accounts: <b>${state.meta.accounts}×100K</b></span>
        <span class="pill">Daily allowance: <b>${ttd}/1</b></span>
        <span class="pill">Recent outcomes: <b>${streak} L-streak</b></span>
        <span class="pill">This month net: <b>$${net}</b></span>
      </div>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#sop">SOP</a>
        <a class="btn" href="#decision">Decision</a>
        <a class="btn btn-accent" href="#execute" onclick="resetExec()">Execute</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
        <a class="btn" href="#behavior">Stats</a>
        <a class="btn" href="#news">News</a>
        <a class="btn" href="#log">Log</a>
        <a class="btn" href="#scale">Scale</a>
        <a class="btn" href="#settings">Settings</a>
      </div>
    </div>

    ${weekendCard}

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
      <h2>$${goal} Withdrawal Tracker</h2>
      <div class="muted">Net tracker = trades PnL − recorded withdrawals (this month).</div>
      <hr/>
      <div class="pill">Trades: <b>$${trade}</b></div>
      <div class="pill">Withdrawn: <b>$${withdrawn}</b></div>
      <div class="pill">Net: <b>$${net}</b></div>
      <div class="pill">Progress: <b>$${prog}</b> / $${goal} (${pct.toFixed(0)}%)</div>
      <div style="height:12px;background:#f2f3f1;border:1px solid #e5e7eb;border-radius:999px;overflow:hidden;margin-top:10px;">
        <div style="height:100%;width:${pct}%;background:#5F8D4E;"></div>
      </div>
      ${withdrawCta}
    </div>

    <div class="card">
      <h2>Reminders (RTH weekdays only)</h2>
      <div class="muted">Anchored to <span class="mono">America/New_York</span> so seasonal shifts are automatic (Mon–Fri only).</div>
      <hr/>
      <h3>Next reminder times (your phone time)</h3>
      <ul>${nextTimes}</ul>
      <hr/>
      <div class="row">
        <button class="btn" onclick="downloadICS()">Add to Calendar (best)</button>
        ${notifArmed
          ? `<button class="btn btn-good" onclick="disableInAppNotifications()">In-app notifications: ON</button>`
          : `<button class="btn" onclick="enableInAppNotifications()">Enable in-app notifications</button>`
        }
      </div>
      <div class="muted" style="margin-top:10px;">
        Calendar alarms are the reliable option (fires even if app closed). In-app notifications work best when app is opened daily.
      </div>
    </div>
  `;
}

function recordWithdrawal(amount){
  // log a withdrawal and celebrate
  state.log.push({ type:"WITHDRAW", date: todayStr(), time: new Date().toLocaleTimeString(), amount: Number(amount)||0 });
  saveState();
  celebrate("Withdrawal recorded 💚");
  render("home");
}

function resetWithdrawalTracker(){
  // manual: record a withdrawal equal to current progress (so tracker becomes 0)
  const { prog } = monthWithdrawalProgress();
  if(prog<=0){ toast("Nothing to reset"); return; }
  state.log.push({ type:"WITHDRAW", date: todayStr(), time: new Date().toLocaleTimeString(), amount: Number(prog)||0, note:"manual reset" });
  saveState();
  celebrate("Tracker reset ✅");
  render("home");
}

// ============================
// Pages
// ============================
function pageSOP(){
  const b = CFG.bracket;
  return `
    <div class="card">
      <h1>One-page SOP</h1>
      <div class="muted">${CFG.account} | ${CFG.instrument} ${CFG.timeframe}</div>
      <hr/>
      <h3>Rules (must obey)</h3>
      <ul>${CFG.sopRules.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <h3>Orders (Fixed)</h3>
      <ul>
        <li>Size: <b>${b.contracts} ES</b></li>
        <li>Stop: <b>${b.stopPts.toFixed(1)} pts</b> (≈ -$${(b.stopPts*50).toFixed(0)})</li>
        <li>Target: <b>${b.targetPts.toFixed(1)} pts</b> (≈ +$${(b.targetPts*50).toFixed(0)})</li>
        <li><b>1 trade/day max.</b></li>
      </ul>
      <hr/>
      <h3>Protect Account (when in doubt)</h3>
      <ul>${CFG.protectWhen.map(x=>`<li>${x}</li>`).join("")}</ul>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#decision">Decision</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
        <a class="btn" href="#behavior">Stats</a>
        <a class="btn" href="#news">News</a>
      </div>
    </div>
  `;
}

function pageDecision(){
  state.meta.pre = state.meta.pre || {};
  const pre = state.meta.pre;
  const win = nowInTradeWindowET();
  const d = decisionApproved();

  const weekendLine = d.weekendLockout
    ? `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ WEEKEND</b> — RTH closed in New York (no trades)</div>`
    : "";

  const verdict = d.approved
    ? `<div class="pill" style="border-color:rgba(95,141,78,.35);background:rgba(95,141,78,.10);color:#5F8D4E;"><b>✅ APPROVED</b> — alert = execute</div>`
    : `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ NO TRADE</b> — protect the account</div>`;

  const blockers = [];
  if(d.weekendLockout) blockers.push("Weekend (RTH closed)");
  if(d.protectToday) blockers.push("Protect Account active today");
  if(d.ttd>=1) blockers.push("Already traded today");
  if(!d.inWindow) blockers.push("Outside trade window");
  const blockerLine = blockers.length ? `<div class="muted">Blocked by: <b>${blockers.join(", ")}</b></div>` : `<div class="muted">No blockers detected.</div>`;

  return `
    <div class="card">
      <h1>Decision</h1>
      <div class="muted">Decide slowly now, execute instantly later.</div>
      <hr/>
      <div class="muted">Trade window (ET): <b>09:45–10:30</b> · Your time: <b>${win.startToday.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${win.stopToday.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</b> · Now: <b>${win.inWindow ? "IN WINDOW" : "OUTSIDE"}</b></div>
      ${weekendLine}
      <div style="margin-top:10px;">${verdict}</div>
      <div style="margin-top:6px;">${blockerLine}</div>
    </div>

    <div class="card">
      <h2>Pre-Approval (tap)</h2>
      <div class="muted">If all are true, the alert becomes permission.</div>
      <hr/>
      ${checkboxRow("I am trading today (otherwise ignore alerts)", "tradeToday", pre.tradeToday)}
      ${checkboxRow("I accept 1 trade only (win/loss stop)", "oneTradeOnly", pre.oneTradeOnly)}
      ${checkboxRow("TopstepX + TradingView ready (logged in, data ok)", "platformReady", pre.platformReady)}
      ${checkboxRow("VWAP context acceptable today", "vwapOk", pre.vwapOk)}
      ${checkboxRow("No major news risk in my window", "noNewsRisk", pre.noNewsRisk)}
      ${checkboxRow("I feel calm / not rushed", "calm", pre.calm)}

      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
        <a class="btn" href="#behavior">Stats</a>
        <a class="btn" href="#news">News</a>
        <a class="btn btn-accent" href="#execute" onclick="resetExec()">Alert Fired → Execute</a>
      </div>
    </div>
  `;
}

function pageExecute(){
  state.meta.exec = state.meta.exec || { closedInsideOR:false, cleanBody:false };
  const ex = state.meta.exec;
  const d = decisionApproved();
  const canExecute = d.approved;
  const tradeOk = canExecute && ex.closedInsideOR && ex.cleanBody;
  const tradeOkBanner = tradeOk
    ? `<div class="card" style="border-color:rgba(95,141,78,.45);background:rgba(95,141,78,.10);">
         <h2 style="margin:0;color:var(--good);">✅ TRADE OK</h2>
         <div class="muted">Inside window • Not blocked • Both checks confirmed. Execute your bracket.</div>
       </div>`
    : (canExecute
        ? `<div class="card" style="border-color:rgba(76,127,122,.35);background:rgba(76,127,122,.08);">
             <h3 style="margin:0;color:var(--accent);">Ready</h3>
             <div class="muted">Tap the two checks below. When both are ON, you’ll get a green TRADE OK.</div>
           </div>`
        : "");

  const verdict = !canExecute
    ? `<div class="pill" style="border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ DO NOT TRADE</b> — blocked today</div>`
    : (ex.closedInsideOR && ex.cleanBody)
      ? `<div class="pill" style="border-color:rgba(95,141,78,.35);background:rgba(95,141,78,.10);color:#5F8D4E;"><b>✅ TAKE TRADE</b> — place bracket now</div>`
      : `<div class="pill"><b>⚡ EXECUTE CHECK</b> — two taps</div>`;

  return `
    <div class="card">
      <h1>Execute (Alert Fired)</h1>
      <div class="muted">Two taps. If both true → enter. If blocked, taps will show why. If you missed entry → skip (no chase).</div>
      <hr/>
      ${verdict}
      ${tradeOkBanner}
      <hr/>
      <h3>Fast checks</h3>
      <div class="row" style="margin-top:10px;">
        <button class="btn ${ex.closedInsideOR?'btn-good':''}" onclick="safeToggleExec('closedInsideOR')">
          ${ex.closedInsideOR ? "✓" : "○"} Closed back inside OR
        </button>
        <button class="btn ${ex.cleanBody?'btn-good':''}" onclick="safeToggleExec('cleanBody')">
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
        <button class="btn btn-danger" onclick="skipAndReset()">Skip & Reset</button>
      </div>
    </div>
  `;
}

function pageProtect(){
  return `
    <div class="card">
      <h1>🛑 Protect Account Mode</h1>
      <div class="muted">This is a skill. Banks stand down.</div>
      <hr/>
      <h3>Use this when</h3>
      <ul>${CFG.protectWhen.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <h3>Do this now</h3>
      <ul>${CFG.protectProtocol.map(x=>`<li>${x}</li>`).join("")}</ul>
      <hr/>
      <h3>Loss-streak rules</h3>
      <ul>${CFG.streakProtocol.map(x=>`<li>${x}</li>`).join("")}</ul>
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
  celebrate("Protected ✅");
  location.hash = "log";
}

function pageLog(){
  const rows = [...state.log].slice(-160).reverse();
  const items = rows.length ? rows.map(r=>{
    if(r.type==="TRADE") return `<li><b>${r.date} ${r.time}</b> — TRADE ${r.side} — <b>${r.result}</b> — ${r.note||""}</li>`;
    if(r.type==="PROTECT") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#B45353;font-weight:900;">PROTECT ACCOUNT</span> — ${r.note||""}</li>`;
    if(r.type==="WITHDRAW") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#5F8D4E;font-weight:900;">WITHDRAW</span> — $${r.amount||0}</li>`;
    return `<li>${JSON.stringify(r)}</li>`;
  }).join("") : "<li>No entries yet.</li>";

  return `
    <div class="card">
      <h1>Log</h1>
      <div class="row" style="margin-top:12px;">
        <a class="btn" href="#">Home</a>
        <a class="btn" href="#newtrade">New Trade</a>
        <a class="btn btn-danger" href="#protect">Protect Account</a>
        <a class="btn" href="#behavior">Stats</a>
        <a class="btn" href="#news">News</a>
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
  const locked = (ttd>=1) || (state.protect.active && state.protect.date===todayStr());

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
  if(state.protect.active && state.protect.date===todayStr()){ alert("Protect Account mode today. Stop."); location.hash="log"; return; }

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
  // If you logged a trade, you followed the loop (behavior credit)
  setCompliance(todayStr(), true, "trade_logged");
  if(result==="W") celebrate("Win logged ✅");
  else toast("Loss logged");
  location.hash="log";
}



function pageNews(){
  const now = etParts();
  const buf = state.news?.bufferMin ?? 10;
  const lock = isInNewsLockout();
  const todays = (state.news?.events||[]).filter(e=>e.date===now.date);
  const rows = todays.length ? todays.map((e,i)=>{
    const idx = state.news.events.indexOf(e);
    return `<div class="row" style="justify-content:space-between;align-items:center;margin-top:8px;">
      <div><b>${e.timeET} ET</b> — ${esc(e.title||"High impact")}</div>
      <button class="btn btn-danger" onclick="removeNewsEvent(${idx}); render('news');">Remove</button>
    </div>`;
  }).join("") : `<div class="muted">No events added for today (ET).</div>`;

  return `
    <div class="card">
      <h1>📰 High-Impact News Lockout</h1>
      <div class="muted">Auto-syncing high-impact news in real time isn’t possible here (no backend + PineScript can’t fetch calendars). So this is the practical version: <b>you add today’s high-impact times (ET)</b>, and the app blocks trading ± buffer minutes automatically.</div>
      <hr/>
      <div class="row" style="gap:10px;flex-wrap:wrap;">
        <span class="pill">Today (ET): <b>${now.date}</b></span>
        <span class="pill">Buffer: <b>±${buf} min</b></span>
        <span class="pill">${state.news?.enabled ? "Lockout: <b>ON</b>" : "Lockout: <b>OFF</b>"}</span>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3 style="margin:0;">API (auto)</h3>
        <div class="muted">Optional: use a Cloudflare Worker URL to auto-load today\'s high-impact events (ET). No API key is stored in this app.</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
          <input id="newsApiUrl" class="inp" placeholder="Paste Worker URL (https://.../today)" style="flex:1;min-width:220px;" value="${esc(state.news?.apiUrl||"")}" />
          <button class="btn" onclick="state.news.apiUrl=document.getElementById('newsApiUrl').value.trim(); saveState(); toast('Saved');">Save</button>
          <button class="btn" onclick="syncNewsFromApi(true).then(res=>{ if(res.ok) toast('Synced ✅'); else toast('Sync failed: '+(res.reason||'')); render('news');});">Sync now</button>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn" onclick="state.news.autoEnabled = !state.news.autoEnabled; saveState(); toast('Auto sync '+(state.news.autoEnabled?'ON':'OFF')); render('news');">Auto sync: ${state.news?.autoEnabled?'ON':'OFF'}</button>
          <span class="pill">Last sync (ET): <b>${esc(state.news?.lastSyncET||'—')}</b></span>
        </div>
      </div>
      ${lock.locked ? `<div class="pill" style="margin-top:12px;border-color:rgba(180,83,83,.35);background:rgba(180,83,83,.10);color:#B45353;"><b>⛔ NEWS LOCKOUT ACTIVE</b> — ${esc(lock.next?.title||"High impact")} (${esc(lock.next?.timeET||"") } ET)</div>` : ""}

      <div class="card" style="margin-top:12px;">
        <h3 style="margin:0;">Add today’s event</h3>
        <div class="muted">HH:MM ET (example: 08:30 CPI/NFP, 14:00 FOMC).</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
          <input id="newsTime" class="inp" placeholder="HH:MM (ET)" style="flex:1;min-width:120px;" />
          <input id="newsTitle" class="inp" placeholder="Title (CPI / FOMC / NFP...)" style="flex:2;min-width:180px;" />
          <button class="btn" onclick="addNewsEvent(etParts().date, document.getElementById('newsTime').value, document.getElementById('newsTitle').value); render('news');">Add</button>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn" onclick="state.news.enabled = !state.news.enabled; saveState(); toast('Lockout ' + (state.news.enabled?'ON':'OFF')); render('news');">${state.news?.enabled?'Disable':'Enable'}</button>
          <button class="btn" onclick="const v=prompt('Buffer minutes (0–120):', String(state.news.bufferMin||10)); if(v!==null){ state.news.bufferMin=Math.max(0,Math.min(120,parseInt(v,10)||10)); saveState(); render('news'); }">Set buffer</button>
          <a class="btn" href="#home">Home</a>
        
</div>
</div>

<div class="card" style="margin-top:12px;">
  <h3 style="margin:0;">Paste-import (fast)</h3>
  <div class="muted">Paste one per line. Examples: <b>08:30 CPI</b>, <b>14:00 FOMC</b>, <b>0830 NFP</b>. ET assumed.</div>
  <textarea id="newsPaste" class="inp" style="width:100%;min-height:120px;margin-top:10px;resize:vertical;" placeholder="08:30 CPI&#10;10:00 ISM&#10;14:00 FOMC"></textarea>
  <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
    <button class="btn" onclick="importNewsText(etParts().date, document.getElementById('newsPaste').value); render('news');">Import</button>
    <button class="btn btn-danger" onclick="document.getElementById('newsPaste').value=''; toast('Cleared');">Clear</button>
  </div>
</div>

<div class="card" style="margin-top:12px;">
  <h3 style="margin:0;">Today’s events (ET)</h3>
        ${rows}
      </div>

      <div class="card" style="margin-top:12px;">
        <h3 style="margin:0;">2-minute routine</h3>
        <ol>
          <li>Before your session, open TradingView Economic Calendar.</li>
          <li>Add only the <b>high-impact</b> times (ET) for today.</li>
          <li>Now the app auto-blocks trades around them.</li>
        </ol>
      </div>
    </div>
  `;
}

function pageBehavior(){
  const weeks = weeklyBuckets(15);
  const avg10 = weeks.slice(-10).reduce((a,x)=>a+x.pct,0) / Math.max(1, weeks.slice(-10).length);
  const avg10r = Math.round(avg10);
  const streak = complianceStreak(180);

  const days = lastNWeekdays(60); // ~12 weeks
  const cells = days.map(d=>{
    const key = d.toISOString().slice(0,10);
    const ok = getCompliance(key);
    const bg = ok===true ? "rgba(95,141,78,.18)" : (ok===false ? "rgba(180,83,83,.16)" : "rgba(255,255,255,.06)");
    const bd = ok===true ? "rgba(95,141,78,.40)" : (ok===false ? "rgba(180,83,83,.35)" : "rgba(255,255,255,.12)");
    const txt = key.slice(5);
    const title = ok===true ? "Compliant day ✅" : (ok===false ? "Broken rules ❌" : "Unmarked (tap to set ✅)");
    return `<button class="heat" title="${title}" onclick="toggleCompliance('${key}'); render('behavior');" style="background:${bg};border-color:${bd};">${txt}</button>`;
  }).join("");

  // Simple SVG line chart for weekly pct
  const w = 320, h = 90, pad = 10;
  const pts = weeks.map((x,i)=>{
    const xi = pad + (i*( (w-2*pad)/Math.max(1,weeks.length-1) ));
    const yi = pad + ( (100-x.pct) * ((h-2*pad)/100) );
    return [xi, yi];
  });
  const dpath = pts.map((p,i)=> (i===0?`M ${p[0].toFixed(1)} ${p[1].toFixed(1)}`:`L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)).join(" ");

  const goalLineY = pad + ( (100-85) * ((h-2*pad)/100) );

  return `
    <div class="card">
      <h1>📈 Discipline Stats</h1>
      <div class="muted">This is your “green dashboard”. The goal is to make rule-following feel satisfying.</div>
      <hr/>

      <div class="row" style="gap:10px;flex-wrap:wrap;">
        <span class="pill">10-week avg: <b>${avg10r}%</b></span>
        <span class="pill">Streak: <b>${streak}</b> weekday(s)</span>
        <span class="pill">Target: <b>≥ 85%</b></span>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3 style="margin:0;">Weekly compliance</h3>
        <div class="muted">Each point = Mon–Fri compliance. Keep it above 85%.</div>
        <div style="margin-top:10px;overflow:hidden;">
          <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="display:block;">
            <line x1="${pad}" y1="${goalLineY}" x2="${w-pad}" y2="${goalLineY}" stroke="rgba(95,141,78,.35)" stroke-dasharray="4 4" />
            <path d="${dpath}" fill="none" stroke="rgba(76,127,122,.95)" stroke-width="2.5" />
            ${pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="rgba(76,127,122,.95)" />`).join("")}
          </svg>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3 style="margin:0;">Daily heatmap (last ~12 weeks)</h3>
        <div class="muted">Tap a day to mark compliant ✅ (green). Red = you marked it as a rule break.</div>
        <div class="heatgrid">${cells}</div>
        <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap;">
          <button class="btn" onclick="setCompliance(todayStr(), true, 'manual'); celebrate('Marked ✅'); render('behavior');">Mark today ✅</button>
          <button class="btn btn-danger" onclick="setCompliance(todayStr(), false, 'manual'); toast('Marked ❌'); render('behavior');">Mark today ❌</button>
          <a class="btn" href="#home">Home</a>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3 style="margin:0;">How to use this</h3>
        <ul>
          <li><b>Green means:</b> you followed the process (even if you didn’t trade).</li>
          <li><b>Red means:</b> you broke a rule (overtraded, chased, traded outside window, etc.).</li>
          <li>Most days should be <b>green by skipping</b>. That’s the bank behavior.</li>
        </ul>
      </div>
    </div>
  `;
}
function pageScale(){
  const items = CFG.scalingPlan.map(x=>`
    <li style="margin-bottom:10px;">
      <b>${x.phase} — ${x.title}</b>
      <ul>${x.steps.map(s=>`<li>${s}</li>`).join("")}</ul>
    </li>
  `).join("");

  return `
    <div class="card">
      <h1>Scale Like a Bank</h1>
      <div class="muted">Replication first. Size later.</div>
      <hr/>
      <div class="pill">Current: <b>${state.meta.accounts}× $100K</b></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn" onclick="setAccounts(1)">1×</button>
        <button class="btn" onclick="setAccounts(2)">2×</button>
        <button class="btn" onclick="setAccounts(3)">3×</button>
        <button class="btn" onclick="setAccounts(5)">5×</button>
      </div>
      <hr/>
      <h3>Roadmap</h3>
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
  toast("Saved");
  render("scale");
}

function pageSettings(){
  const notifArmed = !!(state.meta.notif && state.meta.notif.armed);
  return `
    <div class="card">
      <h1>Settings</h1>
      <div class="muted">Strategy is locked. Only utilities here.</div>
      <hr/>
      <div class="pill">Account: <b>${CFG.account}</b></div>
      <div class="pill">Eval target: <b>$${CFG.profitTargetEval}</b></div>
      <div class="pill">Daily loss limit: <b>-$${CFG.dailyLossLimit}</b></div>
      <div class="pill">Max loss limit: <b>-$${CFG.maxLossLimit}</b></div>
      <hr/>
      <h3>Notifications</h3>
      <div class="muted">In-app notifications may require opening the app daily. Calendar is best.</div>
      <div class="row" style="margin-top:12px;">
        <button class="btn ${notifArmed?'btn-good':''}" onclick="${notifArmed?'disableInAppNotifications()':'enableInAppNotifications()'}">
          ${notifArmed?'In-app notifications: ON':'Enable in-app notifications'}
        </button>
        <button class="btn" onclick="downloadICS()">Download calendar (.ics)</button>
      </div>
      <hr/>
      <div class="row">
        <a class="btn" href="#">Home</a>
      </div>
    </div>
  `;
}

function clearAll(){
  if(!confirm("Reset everything? This deletes your log + Protect status.")) return;
  state.log = [];
  state.protect = { active:false, note:"", date:"" };
  state.meta = {
    accounts: 1,
    pre: { tradeToday:true, oneTradeOnly:true, platformReady:true, vwapOk:true, noNewsRisk:true, calm:true },
    exec: { closedInsideOR:false, cleanBody:false },
    notif: { armed:false }
  };
  saveState();
  toast("Reset");
  location.hash="";
}

// Init
document.addEventListener("DOMContentLoaded", ()=>{
  render(route());
  // schedule notifs if armed
  if(state.meta.notif && state.meta.notif.armed) scheduleNotifications();
});
