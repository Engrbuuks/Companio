/* ============================================================
   COMPANIO — COMPANION PORTAL
   A companion logs in and sees only THEIR own visits, writes
   notes-to-family, and manages availability. RLS enforces the
   scoping server-side; this is the friendly face of it.
   Demo mode (no creds) shows one sample companion's view.
   ============================================================ */
const $=(s,el=document)=>el.querySelector(s);
const fmt=d=>new Date(d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
const fmtTime=d=>new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const cap=s=>s?s[0].toUpperCase()+s.slice(1).replace(/_/g,' '):'';
const DAYS=['mon','tue','wed','thu','fri','sat','sun'];

/* in-memory state for this companion */
let ME=null;            // companions row
let VISITS=[], NOTES=[], AVAIL=[], USERS={}, PAY=[];

/* ---------- DEMO DATA ---------- */
const DEMO = {
  me:{id:'c1',full_name:'Linda Hartley',email:'linda@example.com',city:'Guildford',status:'active',offers:'both'},
  visits:[
    {id:'v2',scheduled_at:'2026-07-01T10:00',length_hrs:2,status:'scheduled',booking_id:'b1',user_name:'Joan Mensah'},
    {id:'v1',scheduled_at:'2026-06-24T10:00',length_hrs:2,status:'completed',booking_id:'b1',user_name:'Joan Mensah'},
  ],
  notes:[{id:'n1',visit_id:'v1',summary:'Joan was in great spirits — crossword and two cups of tea. She told me about teaching in Lagos.',created_at:'2026-06-24',user_name:'Joan Mensah'}],
  avail:[{id:'a1',day:'mon',start_time:'10:00',end_time:'14:00'},{id:'a2',day:'wed',start_time:'10:00',end_time:'13:00'}],
  pay:[{id:'vp1',visit_id:'v1',hours:2,rate:14,amount:28,status:'accrued'}],
};

/* ---------- BOOT ---------- */
async function boot(){
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    if(!auth.restore()){ return showLogin(); }
    try{
      const me = await loadMe();
      if(!me){ return showLogin('This login isn’t linked to a companion profile.'); }
    }catch(e){ return showLogin(); }
  } else {
    ME=DEMO.me; VISITS=DEMO.visits; NOTES=DEMO.notes; AVAIL=DEMO.avail; PAY=DEMO.pay;
  }
  renderApp();
}

async function loadMe(){
  // companions RLS: comp_self_read returns only my row
  const rows = await supa.select('companions', `select=*&auth_user_id=eq.${SB.user.id}`);
  if(!rows || !rows[0]) return null;
  ME = rows[0];
  // my visits + the user names, my notes, my availability
  const [visits, avail, notes, pay] = await Promise.all([
    supa.select('visits', `select=*,bookings(service_user_id,service_users(full_name))&companion_id=eq.${ME.id}&order=scheduled_at.desc`).catch(()=>[]),
    supa.select('companion_availability', `select=*&companion_id=eq.${ME.id}`).catch(()=>[]),
    supa.select('visit_notes', `select=*&companion_id=eq.${ME.id}&order=created_at.desc`).catch(()=>[]),
    supa.select('visit_pay', `select=*&companion_id=eq.${ME.id}`).catch(()=>[]),
  ]);
  VISITS = (visits||[]).map(v=>({...v, user_name: v.bookings?.service_users?.full_name || 'Service user'}));
  AVAIL = avail||[]; NOTES = notes||[]; PAY = pay||[];
  return ME;
}

/* ---------- LOGIN ---------- */
function showLogin(err){
  $('#root').innerHTML=`<div class="login-bg"><form class="login-card" id="lf">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="width:32px;height:32px;border-radius:50%;background:var(--wheat);display:grid;place-items:center;color:var(--aubergine-dark);font-weight:800">∞</span>
      <b style="font-family:var(--serif);font-size:1.3rem;color:var(--aubergine-dark)">Companio</b></div>
    <p class="muted" style="margin:0 0 14px">Companion portal · sign in</p>
    ${err?`<div class="err">${err}</div>`:''}
    <label>Email</label><input id="e" type="email" required autocomplete="username">
    <label>Password</label><input id="p" type="password" required autocomplete="current-password">
    <button class="btn primary" style="width:100%;margin-top:18px;padding:12px" type="submit">Sign in</button>
  </form></div>`;
  $('#lf').onsubmit=async(ev)=>{ev.preventDefault();
    const b=$('#lf button');b.textContent='Signing in…';b.disabled=true;
    try{ await auth.login($('#e').value.trim(),$('#p').value);
      const me=await loadMe();
      if(!me){ auth.logout(); return; }
      renderApp();
    }catch(e){ showLogin(e.message||'Login failed'); }
  };
}

/* ---------- APP ---------- */
let tab='visits';
function renderApp(){
  const live = (typeof IS_LIVE!=='undefined' && IS_LIVE);
  $('#root').innerHTML=`
  <div class="topbar"><div class="brand"><span class="mark">∞</span><b>Companio</b></div>
    <div class="who">${ME.full_name}${live?` · <a href="#" onclick="auth.logout();return false">sign out</a>`:' · demo'}</div></div>
  <div class="wrap">
    <div class="hello"><h1>Hello, ${ME.full_name.split(' ')[0]}</h1><p class="muted">Your visits, notes to families, and availability.</p></div>
    <div class="tabs">
      <button data-t="visits" class="${tab==='visits'?'on':''}">My visits</button>
      <button data-t="notes" class="${tab==='notes'?'on':''}">Notes to family</button>
      <button data-t="earnings" class="${tab==='earnings'?'on':''}">My earnings</button>
      <button data-t="avail" class="${tab==='avail'?'on':''}">My availability</button>
    </div>
    <div id="tabview"></div>
  </div>`;
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;renderApp();});
  renderTab();
}
function renderTab(){
  const v=$('#tabview');
  if(tab==='visits') v.innerHTML=viewVisits();
  else if(tab==='notes') v.innerHTML=viewNotes();
  else if(tab==='earnings') v.innerHTML=viewEarnings();
  else v.innerHTML=viewAvail();
}

function viewEarnings(){
  const pending=PAY.filter(p=>p.status==='accrued').reduce((s,p)=>s+ +p.amount,0);
  const paid=PAY.filter(p=>p.status==='paid').reduce((s,p)=>s+ +p.amount,0);
  const money=n=>'£'+Number(n||0).toFixed(2);
  const rows=PAY.map(p=>{
    const v=VISITS.find(x=>x.id===p.visit_id);
    return `<div class="visit"><div style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="when">${money(p.amount)}</div><div class="who">${p.hours}h × ${money(p.rate)}${v?' · '+fmt(v.scheduled_at):''}</div></div>
      <span class="chip ${p.status==='paid'?'good':'wheat'}">${p.status==='paid'?'Paid':'Pending'}</span></div></div>`;
  }).join('');
  return `<div class="panel"><div class="panel-h"><h3>Your earnings</h3></div>
    <div style="padding:18px 20px;display:flex;gap:28px;flex-wrap:wrap">
      <div><div style="font-family:var(--serif);font-size:1.9rem;color:var(--wheat-deep)">${money(pending)}</div><div class="muted" style="font-size:.85rem">Pending</div></div>
      <div><div style="font-family:var(--serif);font-size:1.9rem;color:var(--aubergine-dark)">${money(paid)}</div><div class="muted" style="font-size:.85rem">Paid to date</div></div>
    </div></div>
    <div class="panel"><div class="panel-h"><h3>Per visit</h3></div>${rows||'<div class="empty">Your pay appears here after each completed visit.</div>'}</div>`;
}

function viewVisits(){
  if(!VISITS.length) return `<div class="panel"><div class="empty">No visits scheduled yet. They’ll appear here once you’re matched with a family.</div></div>`;
  const upcoming=VISITS.filter(v=>v.status==='scheduled');
  const past=VISITS.filter(v=>v.status!=='scheduled');
  const card=v=>{
    const hasNote=NOTES.some(n=>n.visit_id===v.id);
    return `<div class="visit">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div><div class="when">${fmt(v.scheduled_at)} · ${fmtTime(v.scheduled_at)}</div>
          <div class="who">${v.user_name} · ${v.length_hrs}h</div></div>
        <div style="text-align:right">
          <span class="chip ${v.status==='completed'?'good':'wheat'}">${cap(v.status)}</span>
          ${v.status==='completed'&&!hasNote?`<div style="margin-top:8px"><button class="btn sm primary" onclick="openNote('${v.id}','${v.user_name.replace(/'/g,'')}')">Write note to family</button></div>`:''}
          ${hasNote?'<div style="margin-top:8px"><span class="chip good">note sent</span></div>':''}
        </div>
      </div></div>`;
  };
  return `${upcoming.length?`<div class="panel"><div class="panel-h"><h3>Upcoming</h3></div>${upcoming.map(card).join('')}</div>`:''}
    ${past.length?`<div class="panel"><div class="panel-h"><h3>Past visits</h3></div>${past.map(card).join('')}</div>`:''}`;
}

function viewNotes(){
  if(!NOTES.length) return `<div class="panel"><div class="empty">No notes yet. After a completed visit, write a warm note for the family from the “My visits” tab.</div></div>`;
  return `<div class="panel"><div class="panel-h"><h3>Notes you’ve sent</h3></div><div style="padding:14px 0">
    ${NOTES.map(n=>{const v=VISITS.find(x=>x.id===n.visit_id);return `<div class="note-card"><div class="meta">${v?v.user_name:''} · ${fmt(n.created_at)}</div>${n.summary}</div>`;}).join('')}
  </div></div>`;
}

function viewAvail(){
  const byDay=DAYS.map(d=>{
    const slots=AVAIL.filter(a=>a.day===d);
    return `<div class="avail-row"><div style="width:54px;font-weight:800;color:var(--aubergine-dark)">${cap(d)}</div>
      <div style="flex:1">${slots.length?slots.map(s=>`${s.start_time}–${s.end_time}`).join(', '):'<span class="muted">Not available</span>'}</div></div>`;
  }).join('');
  return `<div class="panel"><div class="panel-h"><h3>When you can work</h3><button class="btn sm primary" onclick="openAvail()">Add a slot</button></div>${byDay}</div>
  <p class="muted" style="font-size:.85rem">Your coordinator uses this to schedule visits near you. Keep it up to date.</p>`;
}

/* ---------- write a note ---------- */
function openNote(visitId,userName){
  const v=$('#tabview');
  v.insertAdjacentHTML('afterbegin',`<div class="panel" id="noteForm" style="border-color:var(--wheat)">
    <div class="panel-h"><h3>Note to ${userName}’s family</h3></div>
    <div style="padding:16px 20px">
      <p class="muted" style="margin-top:0;font-size:.88rem">A warm, brief update on how the visit went. The family will read this — keep it kind and specific. Nothing medical.</p>
      <textarea id="noteText" rows="4" placeholder="e.g. We did the crossword over tea and had a lovely chat about the garden…"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn primary" onclick="saveNote('${visitId}')">Send to family</button>
        <button class="btn" onclick="renderTab()">Cancel</button>
      </div>
    </div></div>`);
  $('#noteText').focus();
}
async function saveNote(visitId){
  const text=$('#noteText').value.trim();
  if(!text){ $('#noteText').focus(); return; }
  const note={visit_id:visitId, companion_id:ME.id, summary:text, shared_with_family:true};
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    try{ const saved=await supa.insert('visit_notes',note); NOTES.unshift(saved); }
    catch(e){ alert('Could not save: '+e.message); return; }
  } else {
    NOTES.unshift({...note,id:'n'+Date.now(),created_at:new Date().toISOString()});
  }
  tab='notes'; renderApp();
}

/* ---------- add availability ---------- */
function openAvail(){
  const v=$('#tabview');
  v.insertAdjacentHTML('afterbegin',`<div class="panel" id="availForm" style="border-color:var(--wheat)">
    <div class="panel-h"><h3>Add availability</h3></div>
    <div style="padding:16px 20px">
      <label>Day</label><select id="avDay">${DAYS.map(d=>`<option value="${d}">${cap(d)}</option>`).join('')}</select>
      <div style="display:flex;gap:12px"><div style="flex:1"><label>From</label><input id="avFrom" type="time" value="10:00"></div>
      <div style="flex:1"><label>To</label><input id="avTo" type="time" value="14:00"></div></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn primary" onclick="saveAvail()">Save slot</button>
        <button class="btn" onclick="renderTab()">Cancel</button>
      </div></div></div>`);
}
async function saveAvail(){
  const row={companion_id:ME.id, day:$('#avDay').value, start_time:$('#avFrom').value, end_time:$('#avTo').value};
  if(row.end_time<=row.start_time){ alert('End time must be after start time.'); return; }
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    try{ const saved=await supa.insert('companion_availability',row); AVAIL.push(saved); }
    catch(e){ alert('Could not save: '+e.message); return; }
  } else { AVAIL.push({...row,id:'a'+Date.now()}); }
  renderApp();
}

boot();
