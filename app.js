// Topstep Bank Mode (PWA) — Full build (Decision Engine + SOP + Reminders + Scale + Reinforcement)

const CFG = {
  account: "Topstep $150K (Standard)",
  instrument: "ES",
  timeframe: "2m",
  session: "RTH",
  profitTargetEval: 9000,
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
    { phase:"Phase 1", title:"1× $150K (prove process)", steps:[
      "Trade 1 ES, 1 trade/day for 20 trading days.",
      "Aim: consistency > speed. Protect Account is a skill.",
      "First goal: $500 payout rhythm, not max profit."
    ]},
    { phase:"Phase 2", title:"2× $150K (replicate)", steps:[
      "Add 2nd $150K only after 2 clean months (no rule breaks).",
      "Copy-paste same bracket & same window. No size increase.",
      "Treat account 2 as a photocopy, not a new strategy."
    ]},
    { phase:"Phase 3", title:"3× $150K OR move to $150K (simplify)", steps:[
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
  try{
    if(view==="log") return app.innerHTML = pageLog() + ritualModal();
    if(view==="newtrade") return app.innerHTML = pageNewTrade() + ritualModal();
    if(view==="scale") return app.innerHTML = pageScale() + ritualModal();
    if(view==="behavior") return app.innerHTML = pageBehavior() + ritualModal();
    if(view==="protect") return app.innerHTML = pageProtect() + ritualModal();
    return app.innerHTML = pageHome() + ritualModal();
  }catch(err){
    console.error(err);
    app.innerHTML = `
      <div class="wrap ${state.dayClosedFor===todayETStr() ? "dimmed" : ""}">
        ${navHeader("Oops")}
        <div class="card">
          <div class="bigTitle">Refresh</div>
          <div class="muted">If this persists: clear site storage (PWA cache).</div>
        </div>
      </div>
      ${bottomNav("home")}
    `;
  }
}

function bottomNav(active){
  const item = (key, label, icon) =>
    `<a class="navbtn ${active===key?"active":""}" href="#${key}">
       <div class="navicon">${icon}</div>
       <div class="navlbl">${label}</div>
     </a>`;
  return `
    <div class="bottomnav">
      ${item("home","Home","🏦")}
      ${item("log","Log","🧾")}
      ${item("scale","Scale","📈")}
      ${item("behavior","Behavior","✅")}
    </div>
  `;
}

function pageHome(){
  const ttd = tradesTodayCount();
  const { net, goal, pct } = monthWithdrawalProgress();
  const win = nowInTradeWindowET();

  const ritualDone = (state.ritualDoneFor === todayETStr());
  const ritualKeyRequired = win.isWeekday && !ritualDone;

  let tokenState = "AVAILABLE";
  const decisionMade = (state.dayDecision && state.dayDecision.date===todayStr() && state.dayDecision.made);

  if(!win.isWeekday) tokenState = "WEEKEND";
  else if(state.protect.active && state.protect.date===todayStr()) tokenState = "LOCKED";
  else if(ttd>=1) tokenState = "USED";
  else if(decisionMade) tokenState = "USED";
  else if(ritualKeyRequired) tokenState = "KEY";
  else tokenState = "AVAILABLE";

  const tokenClass = tokenState==="AVAILABLE" ? "good" : (tokenState==="USED" ? "warn" : "bad");

  const focus = tokenState==="AVAILABLE"
    ? "One token. One decision. No chase."
    : (tokenState==="USED" ? "Decision made. Bank is closed."
      : (tokenState==="KEY" ? "Unlock requires Ritual. Calm first."
        : (tokenState==="WEEKEND" ? "Weekend lock. No trading."
          : "Protect mode. Bank is closed.")));

  const inWindow = win.inWindow && win.isWeekday;
  const windowPill = inWindow ? `<span class="pill goodpill">RTH Window</span>` : `<span class="pill mutepill">${win.isWeekday ? "Outside Window" : "Weekend Lock"}</span>`;

  const ritualDone2 = (state.ritualDoneFor === todayETStr());
  const ritualHomeCard = `
    <div class="card">
      <div class="row between" style="align-items:center;">
        <div>
          <div class="kicker">BANK RITUAL</div>
          <div class="muted small">Unlock token. Calm → act.</div>
        </div>
        <button class="btn primary ${ritualDone2 ? "" : "pulse"}" onclick="openRitual()" ${ritualDone2 ? "disabled" : ""}>${ritualDone2 ? "Done ✅" : "Start (3m)"}</button>
      </div>
    </div>
  `;

  return `
    <div class="page">
      <div class="topbar">
        <div>
          <div class="title">Topstep Bank Mode</div>
          <div class="subtitle">${CFG.account} • ${CFG.instrument} • ${CFG.timeframe} • ${CFG.session}</div>
        </div>
      </div>

      ${ritualHomeCard}

      <div class="grid">
        <div class="card big">
          <div class="row between">
            <div class="kicker">TRADE TOKEN</div>
            ${windowPill}
          </div>
          <div class="token ${tokenClass}">${tokenState==="KEY" ? "LOCKED" : (tokenState==="WEEKEND" ? "WEEKEND" : tokenState)}</div>
          <div class="muted small">${focus}</div>
          <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap;">
            ${tokenState==="KEY" ? `<button class="btn primary pulse" onclick="openRitual()">Unlock (Ritual)</button>` : `<a class="btn primary" href="#behavior">${tokenState==="AVAILABLE" ? "Mark Green ✅" : "Review Streak"}</a>`}
            <a class="btn" href="#log">Open Log</a>
          </div>
          ${tokenState==="AVAILABLE" ? `<div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap;">
            <button class="btn primary" onclick="makeDayDecision('trade')">Trade Decision ✅</button>
            <button class="btn danger" onclick="makeDayDecision('skip')">Skip Day ❌</button>
          </div>` : ``}
        </div>

        <div class="card">
          <div class="kicker">WITHDRAWAL CYCLE</div>
          <div class="row between" style="margin-top:6px;">
            <div class="bigNum">$${net}</div>
            <div class="muted small">toward $${goal}</div>
          </div>
          <div class="bar"><div class="barFill" style="width:${Math.min(100, Math.max(0,pct))}%;"></div></div>
          <div class="row between" style="margin-top:8px;">
            <div class="muted small">${Math.round(pct)}%</div>
            <div class="muted small">Boring = profitable</div>
          </div>
        </div>

        <div class="card">
          <div class="kicker">TODAY'S RULE</div>
          <div class="ruleline">If missed entry → <b>skip day</b></div>
          <div class="ruleline">No second trade. Ever.</div>
        </div>
      </div>

      ${bottomNav("home")}
    </div>
  `;
}
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


function ritualModal(){
  if(!(state.ritual && state.ritual.active)) return "";
  const t = state.ritual.t ?? 180;
  const phase = (t > 105) ? "RESET" : (t > 60) ? "IDENTITY" : (t > 15) ? "RISK" : "COMMIT";
  const p = Math.max(0, Math.min(100, ((180 - t) / 180) * 100));
  const showCommit = t <= 15;
  return `
    <div class="modal" onclick="closeRitual()">
      <div class="modalCard" onclick="event.stopPropagation()">
        <div class="modalTop">
          <div class="title">Bank Ritual</div>
          <button class="xbtn" onclick="closeRitual()">✕</button>
        </div>
        <div class="ritualWrap" style="margin-top:14px;">
          <div class="ritualProg" id="ritualProg" style="--p:${p};">
            <div class="ritualInner">
              <div class="phaseWord" id="ritualPhase">${phase}</div>
              <div class="ritualNum" id="ritualNum">${t}</div>
            </div>
          </div>
          <div class="ritualSub">Bank breathing + identity + risk acceptance.</div>
          <button id="ritualCommit" class="btn btn-primary" style="display:${showCommit ? "inline-flex" : "none"};" onclick="ritualCommit()">COMMIT</button>
        </div>
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
  const rows = [...state.log].slice(-200).reverse();
  const items = rows.length ? rows.map(r=>{
    if(r.type==="TRADE") return `<li><b>${r.date} ${r.time}</b> — ${r.side} — <b>${r.result}</b>${r.note?` — ${r.note}`:""}</li>`;
    if(r.type==="PROTECT") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#B45353;font-weight:900;">PROTECT</span> — ${r.note||""}</li>`;
    if(r.type==="WITHDRAW") return `<li><b>${r.date} ${r.time}</b> — <span style="color:#5F8D4E;font-weight:900;">WITHDRAW</span> — $${r.amount||0}</li>`;
    if(r.type==="GREEN") return `<li><b>${r.date}</b> — <span style="color:#5F8D4E;font-weight:900;">GREEN</span> — ${r.note||""}</li>`;
    if(r.type==="RED") return `<li><b>${r.date}</b> — <span style="color:#B45353;font-weight:900;">RED</span> — ${r.note||""}</li>`;
    return `<li>${JSON.stringify(r)}</li>`;
  }).join("") : "<li>No entries yet.</li>";

  return `
    <div class="card">
      <h1>Log</h1>
      <div class="muted">Fast, low-text record keeping.</div>

      <div class="row" style="margin-top:12px;gap:10px;flex-wrap:wrap;">
        <a class="btn primary" href="#newtrade">+ Trade</a>
        <a class="btn" href="#protect">Protect Today</a>
        <button class="btn" onclick="quickWithdraw()">Record $500 Withdrawal</button>
      </div>

      <hr/>
      <ul>${items}</ul>

      <hr/>
      <button class="btn btn-danger" onclick="clearAll()">Reset (danger)</button>
    </div>
    ${bottomNav("log")}
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

function makeDayDecision(type){
  const win = nowInTradeWindowET();
  const ritualDone = (state.ritualDoneFor === todayETStr());

  if(!win.isWeekday){ toast("Weekend lock — no trading"); return; }
  if(state.protect.active && state.protect.date===todayStr()){ toast("Protect mode active"); return; }
  if(tradesTodayCount()>=1){ toast("Already used today"); return; }
  if(!ritualDone){ toast("Do Ritual to unlock"); openRitual(); return; }

  state.dayDecision = { date: todayStr(), made: true, type: type };
  saveState();

  if(type==="skip"){
    // reward compliance
    state.behavior = state.behavior || {};
    state.behavior[todayStr()] = "green";
    saveState();
    toast("Skip locked ✅");
    render(route());
  }else{
    toast("Decision: Trade ✅");
    location.hash = "newtrade";
  }
}

function saveTrade(){
  const win = nowInTradeWindowET();
  const ritualDone = (state.ritualDoneFor === todayETStr());
  if(!win.isWeekday){ alert("Weekend lock — no trading."); location.hash="home"; return; }
  if(!ritualDone){ alert("Unlock requires Ritual."); openRitual(); return; }
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
  const days = state.behavior?.days || {};
  const today = todayStr();

  // Build last 28 days heat
  const last = [];
  for(let i=27;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const key = d.toISOString().slice(0,10);
    last.push({key, v: days[key]||""});
  }

  const cells = last.map(x=>{
    const cls = x.v==="G" ? "cell g" : x.v==="R" ? "cell r" : "cell e";
    return `<div class="${cls}" title="${x.key}">${x.v||""}</div>`;
  }).join("");

  const streak = complianceStreak();
  const week = complianceWeekPct();

  return `
    <div class="card">
      <h1>Behavior</h1>
      <div class="muted">We measure <b>process</b>, not PnL.</div>

      <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap;">
        <div class="pill">Streak: <b>${streak} days</b></div>
        <div class="pill">This week: <b>${week}% green</b></div>
      </div>

      <div class="heatgrid" style="margin-top:12px;">${cells}</div>

      <div class="row" style="margin-top:12px;gap:10px;flex-wrap:wrap;">
        <button class="btn primary" onclick="markGreen()">Mark Green ✅</button>
        <button class="btn btn-danger" onclick="markRed()">Mark Red ❌</button>
      </div>
    </div>
    ${bottomNav("behavior")}
  `;
}
function pageScale(){
  const current = state.meta.accounts || 1;
  const target = Math.max(1, current);

  return `
    <div class="card">
      <h1>Scale</h1>
      <div class="muted">Replicate first. Withdraw monthly. Add accounts only after consistency.</div>

      <div class="pill">Base unit: <b>$150K</b></div>
      <div class="pill">Active replicas: <b>${current}×</b></div>

      <div class="row" style="margin-top:12px;gap:10px;flex-wrap:wrap;">
        <button class="btn" onclick="setAccounts(1)">1×</button>
        <button class="btn" onclick="setAccounts(2)">2×</button>
        <button class="btn" onclick="setAccounts(3)">3×</button>
      </div>

      <hr/>
      <div class="card" style="margin:0;padding:14px;">
        <div class="kicker">BANK RULE</div>
        <div class="ruleline">No scale until <b>4 green weeks</b> in a row.</div>
        <div class="ruleline">Withdraw at $500 cycles. Never “let it ride”.</div>
      </div>

      <div class="card" style="margin-top:12px;">
        <div class="kicker">NEXT STEP</div>
        <div class="ruleline">1× $150K → prove process</div>
        <div class="ruleline">2× $150K → replicate</div>
        <div class="ruleline">Then consider 3× only if calm + compliant</div>
      </div>
    </div>
    ${bottomNav("scale")}
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
function markGreen(){
  setCompliance(todayStr(), "G");
  state.log.push({ type:"GREEN", date: todayStr(), time: nowTime(), note:"Process followed." });
  saveState();
  celebrate("Green ✅");
  render("behavior");
}
function markRed(){
  setCompliance(todayStr(), "R");
  state.log.push({ type:"RED", date: todayStr(), time: nowTime(), note:"Rule break." });
  saveState();
  toast("Red ❌");
  render("behavior");
}
function quickWithdraw(){
  const amt = prompt("Withdrawal amount (USD)", "500");
  if(amt===null) return;
  const n = Number(amt);
  if(!isFinite(n) || n<=0){ alert("Invalid amount."); return; }
  state.log.push({ type:"WITHDRAW", date: todayStr(), time: nowTime(), amount: Math.round(n) });
  saveState();
  celebrate("Withdraw ✅");
  render("log");
}


function ritualCard(){
  const doneToday = state.ritual && state.ritual.lastDone === todayStr();
  const label = doneToday ? "Ritual Done ✅" : "Bank Ritual (10s)";
  const cls = doneToday ? "btn" : "btn btn-primary pulse";
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div class="title">Bank Ritual</div>
          <div class="muted">10s conditioning.</div>
        </div>
        <button class="${cls}" onclick="openRitual()" ${doneToday ? "disabled" : ""}>${label}</button>
      </div>
    </div>
  `;
}
function openRitual(){
  state.ritual = state.ritual || { active:false, t:180, lastDone:"", phaseIdx:0, phaseT:0 };
  state.ritual.active = true;
  state.ritual.t = 180;
  state.ritual.phaseIdx = 0;
  state.ritual.phaseT = 0;
  saveState();
  render(route());
  startRitualTimer();
}
function closeRitual(){
  window.__ritualTimer && clearInterval(window.__ritualTimer);
  if(state.ritual){ state.ritual.active = false; saveState(); }
  render(route());
}
function startRitualTimer(){
  window.__ritualTimer && clearInterval(window.__ritualTimer);

  // 3-minute ritual (180s): RESET 75s, IDENTITY 45s, RISK 45s, COMMIT 15s
  const phaseFor = (t) => (t > 105) ? "RESET" : (t > 60) ? "IDENTITY" : (t > 15) ? "RISK" : "COMMIT";

  const paint = () => {
    if(!(state.ritual && state.ritual.active)) return;
    const t = state.ritual.t ?? 180;

    // Update progress ring + text
    const p = Math.max(0, Math.min(100, ((180 - t) / 180) * 100));
    const prog = document.getElementById("ritualProg");
    const num  = document.getElementById("ritualNum");
    const ph   = document.getElementById("ritualPhase");
    const btn  = document.getElementById("ritualCommit");

    if(prog) prog.style.setProperty("--p", p);
    if(num)  num.textContent = String(t);
    if(ph)   ph.textContent  = phaseFor(t);
    if(btn)  btn.style.display = (t <= 15) ? "inline-flex" : "none";
  };

  paint();

  window.__ritualTimer = setInterval(() => {
    if(!(state.ritual && state.ritual.active)) { clearInterval(window.__ritualTimer); return; }
    state.ritual.t = Math.max(0, (state.ritual.t ?? 180) - 1);
    saveState();
    paint();

    if(state.ritual.t <= 0){
      // Auto-commit if user doesn't tap in the final window
      ritualCommit();
      clearInterval(window.__ritualTimer);
    }
  }, 1000);
}

function ritualCommit(){
  if(!(state.ritual && state.ritual.active)) return;
  state.ritual.active = false;
  state.ritual.lastDone = todayETStr();
  state.ritualDoneFor = todayETStr();
  saveState();
  toast("Bank Mode primed ✅");
  render(route());
}



function ritualRequiredNow(){
  const done = state.ritualDoneFor === todayETStr();
  const decisionMade = state.dayDecision && state.dayDecision.date===todayETStr() && state.dayDecision.made;
  const hasTrade = tradesTodayCount()>=1;
  // Required only on weekdays during RTH AND only before first decision/trade.
  return isWeekdayET() && inRTH() && !done && !decisionMade && !hasTrade;
}

function openDebrief(){
  state.debrief = {active:true, t:60};
  saveState();
  render(route());
  startDebriefTimer();
}
function closeDebrief(){
  window.__debriefTimer && clearInterval(window.__debriefTimer);
  if(state.debrief) state.debrief.active=false;
  saveState();
  render(route());
}
function startDebriefTimer(){
  window.__debriefTimer && clearInterval(window.__debriefTimer);
  const paint=()=>{
    const prog=document.getElementById("debriefProg");
    const num=document.getElementById("debriefNum");
    const phase=document.getElementById("debriefPhase");
    const acc=document.getElementById("debriefAcc");
    const close=document.getElementById("debriefClose");
    if(!(state.debrief && state.debrief.active)) return;
    const t=Math.max(0,state.debrief.t);
    const p=Math.min(100, Math.round((60-t)*100/60));
    if(prog) prog.style.setProperty("--p", String(p));
    if(num) num.textContent=String(t);
    let ph="EXHALE";
    if(t<=40 && t>20) ph="ACCOUNT";
    else if(t<=20) ph="CLOSE";
    if(phase) phase.textContent=ph;
    if(acc) acc.style.display = (t<=40 && t>20) ? "flex":"none";
    if(close) close.style.display = (t<=20) ? "inline-flex":"none";
  };
  paint();
  window.__debriefTimer=setInterval(()=>{
    if(!(state.debrief && state.debrief.active)){ clearInterval(window.__debriefTimer); return; }
    if(state.debrief.t<=0){ paint(); return; }
    state.debrief.t -= 1;
    saveState();
    paint();
  },1000);
}
function debriefMark(ok){
  state.behavior = state.behavior || {};
  state.behavior[todayETStr()] = ok ? "green" : "red";
  saveState();
  toast(ok ? "Logged: Rules followed" : "Logged: Rules broken");
}
function dayClosed(){
  state.dayClosedFor = todayETStr();
  if(state.debrief) state.debrief.active=false;
  saveState();
  toast("Bank closed.");
  render(route());
}
function debriefModal(){
  if(!(state.debrief && state.debrief.active)) return "";
  const t=Math.max(0,state.debrief.t||60);
  const p=Math.min(100, Math.round((60-t)*100/60));
  let ph="EXHALE";
  if(t<=40 && t>20) ph="ACCOUNT";
  else if(t<=20) ph="CLOSE";
  return `
    <div class="modal" onclick="closeDebrief()">
      <div class="modalCard" onclick="event.stopPropagation()">
        <div class="debriefProg" id="debriefProg" style="--p:${p};">
          <div class="debriefInner">
            <div class="phaseWord" id="debriefPhase">${ph}</div>
            <div class="ritualNum" id="debriefNum">${t}</div>
          </div>
        </div>

        <div id="debriefAcc" style="display:${(t<=40 && t>20)?"flex":"none"};gap:10px;justify-content:center;margin-top:10px">
          <button class="btn btn-primary" onclick="debriefMark(true)">✅</button>
          <button class="btn btn-danger" onclick="debriefMark(false)">❌</button>
        </div>

        <button id="debriefClose" class="btn" style="display:${(t<=20)?"inline-flex":"none"};margin-top:10px" onclick="dayClosed()">DAY CLOSED</button>
      </div>
    </div>
  `;
}

function homeRitualCard(){
  const req = ritualRequiredNow();
  const done = state.ritualDoneFor === todayETStr();
  const label = done ? "Ritual Done ✅" : (req ? "Bank Ritual (3m)" : "Bank Ritual");
  const cls = done ? "btn" : "btn btn-primary pulse";
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div class="title">Bank Ritual</div>
          <div class="muted">${req ? "Required before first trade." : "Session key."}</div>
        </div>
        <button class="${cls}" onclick="openRitual()" ${done ? "disabled" : ""}>${label}</button>
      </div>
    </div>
  `;
}
