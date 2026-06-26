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
let VISITS=[], NOTES=[], AVAIL=[], USERS={}, PAY=[], WELLBEING=[];
let DB_FEATURES={ai:'off'};   // loaded from app_settings in live mode

/* ---------- DEMO DATA ---------- */
const DEMO = {
  me:{id:'c1',full_name:'Linda Hartley',email:'linda@example.com',city:'Guildford',status:'active',offers:'both'},
  visits:[
    {id:'v2',scheduled_at:'2026-07-01T10:00',length_hrs:2,status:'scheduled',booking_id:'b1',user_name:'Joan Mensah'},
    {id:'v1',scheduled_at:'2026-06-24T10:00',length_hrs:2,status:'completed',booking_id:'b1',user_name:'Joan Mensah',checked_in_at:'2026-06-24T10:02',checked_out_at:'2026-06-24T12:05'},
  ],
  notes:[{id:'n1',visit_id:'v1',summary:'Joan was in great spirits — crossword and two cups of tea. She told me about teaching in Lagos.',created_at:'2026-06-24',user_name:'Joan Mensah'}],
  avail:[{id:'a1',day:'mon',start_time:'10:00',end_time:'14:00'},{id:'a2',day:'wed',start_time:'10:00',end_time:'13:00'}],
  pay:[{id:'vp1',visit_id:'v1',hours:2,rate:14,amount:28,status:'accrued'}],
  users:{ u1:{ id:'u1', full_name:'Joan Mensah', city:'Guildford', postcode:'GU1 3AB', temperament:'chatty',
    interests:['cards','music','tea','history'],
    notes:'Loves a long chat and a milky tea. Hard of hearing on the left.',
    mobility_notes:'Walks with a stick; short strolls fine.',
    fav_music:'Vera Lynn, wartime classics and a bit of jazz',
    routines:'Tea at 4pm sharp; likes the radio on in the mornings.',
    dietary:'No added salt; soft foods easier since her dentures.',
    family_details:'Son Daniel visits Sundays. Daughter in Canada calls Weds.',
    conversation_starters:'Ask about her years teaching infants in Leeds.' } },
  wellbeing:[
    {id:'w1',service_user_id:'u1',score:4,band:'strong',created_at:'2026-05-01'},
    {id:'w2',service_user_id:'u1',score:3,band:'moderate',created_at:'2026-05-22'},
    {id:'w3',service_user_id:'u1',score:2,band:'moderate',created_at:'2026-06-15'},
  ],
};

/* ---------- BOOT ---------- */
async function boot(){
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    if(!auth.restore()){ return showLogin(); }
    try{
      const me = await loadMe();
      if(!me){ return showLogin(linkErrorMessage()); }
    }catch(e){ return showLogin('Something went wrong loading your profile: '+(e.message||e)); }
  } else {
    ME=DEMO.me; VISITS=DEMO.visits; NOTES=DEMO.notes; AVAIL=DEMO.avail; PAY=DEMO.pay; USERS=DEMO.users; WELLBEING=DEMO.wellbeing; DB_FEATURES={ai:'on'};
  }
  renderApp();
}

// When loadMe finds no companion row for this auth user, explain it usefully
// instead of silently bouncing. Stash details for the support line.
function linkErrorMessage(){
  const uid = (SB.user && SB.user.id) ? SB.user.id : 'unknown';
  const email = (SB.user && SB.user.email) ? SB.user.email : 'your email';
  window.__companioDebug = { auth_user_id: uid, email };
  return `You’re signed in as ${email}, but this login isn’t linked to a companion profile yet. `+
         `Please ask Companio to check your account is approved and connected. (Ref: ${uid.slice(0,8)})`;
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
  VISITS = (visits||[]).map(v=>({...v, user_name: v.bookings?.service_users?.full_name || 'Service user', service_user_id: v.bookings?.service_user_id || null }));
  AVAIL = avail||[]; NOTES = notes||[]; PAY = pay||[];
  // The people I look after — full Success Plan, scoped by RLS to my active clients
  try{
    const ids = [...new Set(VISITS.map(v=>v.service_user_id).filter(Boolean))];
    if(ids.length){
      const su = await supa.select('service_users', `select=*&id=in.(${ids.join(',')})`).catch(()=>[]);
      (su||[]).forEach(u=>{ USERS[u.id]=u; });
      const wb = await supa.select('wellbeing_checkins', `select=*&service_user_id=in.(${ids.join(',')})&order=created_at.asc`).catch(()=>[]);
      WELLBEING = wb||[];
    }
  }catch(e){ /* non-fatal */ }
  try{ const f=await supa.select('app_settings',`select=value&key=eq.feature.ai`); DB_FEATURES.ai = (f&&f[0]&&f[0].value)||'off'; }catch(e){ DB_FEATURES.ai='off'; }
  return ME;
}

/* ---------- LOGIN ---------- */
function showLogin(err){
  $('#root').innerHTML=`<div class="login-bg"><form class="login-card" id="lf">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span class="cmp-logo" style="width:40px;height:40px"></span>
      <b style="font-family:var(--serif);font-size:1.3rem;color:var(--aubergine-dark)">Companio</b></div>
    <p class="muted" style="margin:0 0 14px">Companion portal · sign in</p>
    ${err?`<div class="err">${err}</div>`:''}
    <label>Email</label><input id="e" type="email" required autocomplete="username">
    <label>Password</label><input id="p" type="password" required autocomplete="current-password">
    <button class="btn primary" style="width:100%;margin-top:18px;padding:12px" type="submit">Sign in</button>
    <p style="text-align:center;margin:14px 0 0"><a href="#" id="fp" style="color:var(--aubergine);font-size:.85rem;font-weight:600;text-decoration:none">Forgot your password?</a></p>
  </form></div>`;
  const fpl=$('#fp');
  if(fpl) fpl.onclick=async(ev)=>{ev.preventDefault();
    const email=($('#e').value||'').trim();
    if(!email){ showLogin('Enter your email above first, then click “Forgot your password?”'); return; }
    try{ await auth.resetPassword(email); alert('If an account exists for '+email+', a reset link is on its way.'); }
    catch(e){ showLogin(e.message||'Could not send reset email'); }
  };
  $('#lf').onsubmit=async(ev)=>{ev.preventDefault();
    const b=$('#lf button');b.textContent='Signing in…';b.disabled=true;
    try{ await auth.login($('#e').value.trim(),$('#p').value);
      const me=await loadMe();
      if(!me){ const msg=linkErrorMessage(); auth.logout(); return showLogin(msg); }
      renderApp();
    }catch(e){ showLogin(e.message||'Login failed'); }
  };
}

/* ---------- APP ---------- */
let tab='home';
function renderApp(){
  const live = (typeof IS_LIVE!=='undefined' && IS_LIVE);
  $('#root').innerHTML=`
  <div class="topbar"><div class="brand"><span class="cmp-logo"></span><b>Companio</b></div>
    <div class="who">${ME.full_name}${live?` · <a href="#" onclick="auth.logout();return false">sign out</a>`:' · demo'}</div></div>
  <div class="wrap">
    <div class="hello"><h1>Hello, ${ME.full_name.split(' ')[0]}</h1><p class="muted">Welcome back. Here’s everything you need for your visits.</p></div>
    <div class="tabs">
      <button data-t="home" class="${tab==='home'?'on':''}">Home</button>
      <button data-t="people" class="${tab==='people'?'on':''}">My people</button>
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
  if(tab==='home') v.innerHTML=viewHome();
  else if(tab==='people') v.innerHTML=viewPeople();
  else if(tab==='visits') v.innerHTML=viewVisits();
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

/* ---------- HOME / OVERVIEW ---------- */
function viewHome(){
  const upcoming=VISITS.filter(v=>v.status==='scheduled').sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  const next=upcoming[0];
  const peopleCount=Object.keys(USERS).length || new Set(VISITS.map(v=>v.service_user_id).filter(Boolean)).size;
  const doneThisMonth=VISITS.filter(v=>v.status==='completed' && new Date(v.checked_out_at||v.scheduled_at).getMonth()===new Date().getMonth()).length;
  const notesToWrite=VISITS.filter(v=>(v.checked_out_at||v.status==='completed') && !NOTES.some(n=>n.visit_id===v.id)).length;

  const nextCard = next ? `
    <div class="panel" style="background:linear-gradient(135deg,var(--aubergine-dark),var(--aubergine));color:#fff;border:none">
      <div style="padding:20px 22px">
        <div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7">Your next visit</div>
        <div style="font-family:var(--serif,serif);font-size:1.6rem;margin:6px 0 2px">${next.user_name}</div>
        <div style="opacity:.85">${fmt(next.scheduled_at)} · ${fmtTime(next.scheduled_at)} · ${next.length_hrs}h</div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm" style="background:var(--wheat);color:var(--aubergine-dark);border:none" onclick="prepVisit('${next.service_user_id||''}','${(next.user_name||'').replace(/'/g,'')}')">Prepare for this visit</button>
          ${next.service_user_id?`<button class="btn sm" style="background:rgba(255,255,255,.15);color:#fff;border:none" onclick="tab='people';renderApp();setTimeout(()=>openPerson('${next.service_user_id}'),50)">See their profile</button>`:''}
        </div>
      </div>
    </div>` : `<div class="panel"><div class="empty">No visits scheduled yet. They’ll appear here once you’re matched with a family.</div></div>`;

  return `${nextCard}
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:14px 0">
      <div class="panel" style="flex:1;min-width:130px;text-align:center"><div style="padding:16px"><div style="font-size:1.8rem;font-weight:800;color:var(--aubergine-dark)">${peopleCount}</div><div class="muted" style="font-size:.85rem">${peopleCount===1?'person':'people'} you visit</div></div></div>
      <div class="panel" style="flex:1;min-width:130px;text-align:center"><div style="padding:16px"><div style="font-size:1.8rem;font-weight:800;color:var(--aubergine-dark)">${doneThisMonth}</div><div class="muted" style="font-size:.85rem">visits this month</div></div></div>
      <div class="panel" style="flex:1;min-width:130px;text-align:center"><div style="padding:16px"><div style="font-size:1.8rem;font-weight:800;color:${notesToWrite?'var(--wheat-deep,#C8943B)':'var(--aubergine-dark)'}">${notesToWrite}</div><div class="muted" style="font-size:.85rem">${notesToWrite===1?'note to write':'notes to write'}</div></div></div>
    </div>
    ${notesToWrite?`<div class="panel"><div class="panel-h"><h3>A gentle reminder</h3></div><div style="padding:14px 18px"><p class="muted" style="margin:0">You have ${notesToWrite} family ${notesToWrite===1?'note':'notes'} still to write. Families treasure these — a few warm lines about how the visit went means a lot. <button class="btn sm" onclick="tab='visits';renderApp()">Go to visits</button></p></div></div>`:''}
    ${upcoming.length>1?`<div class="panel"><div class="panel-h"><h3>Also coming up</h3></div>${upcoming.slice(1,4).map(v=>`<div class="visit"><div class="when">${fmt(v.scheduled_at)} · ${fmtTime(v.scheduled_at)}</div><div class="who">${v.user_name} · ${v.length_hrs}h</div></div>`).join('')}</div>`:''}`;
}

/* ---------- MY PEOPLE ---------- */
function peopleList(){
  // unique clients from visits, hydrated with USERS profile where available
  const ids=[...new Set(VISITS.map(v=>v.service_user_id).filter(Boolean))];
  return ids.map(id=>USERS[id]||{id,full_name:(VISITS.find(v=>v.service_user_id===id)||{}).user_name||'Service user'});
}
function viewPeople(){
  const people=peopleList();
  if(!people.length) return `<div class="panel"><div class="empty">The people you visit will appear here, with everything you need to know to make each visit special.</div></div>`;
  return `<p class="muted" style="margin:0 0 12px">The people you look after. Tap any of them to see what makes them tick — it’s what turns a visit into a friendship.</p>`+
    people.map(u=>{
      const lastWb=WELLBEING.filter(w=>w.service_user_id===u.id).slice(-1)[0];
      const wbChip=lastWb?`<span class="chip ${lastWb.band==='strong'?'warn':lastWb.band==='moderate'?'wheat':'good'}" style="font-size:.72rem">wellbeing ${lastWb.score}/6</span>`:'';
      return `<div class="panel" style="margin-bottom:10px;cursor:pointer" onclick="openPerson('${u.id}')">
        <div style="padding:14px 18px;display:flex;align-items:center;gap:14px">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--wheat);display:grid;place-items:center;font-weight:800;color:var(--aubergine-dark);font-family:var(--serif,serif);flex:0 0 auto">${(u.full_name||'?').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:1.08rem">${u.full_name}</div>
            <div class="muted" style="font-size:.86rem">${u.city||''}${u.interests&&u.interests.length?' · likes '+u.interests.slice(0,3).join(', '):''}</div>
          </div>
          <div style="text-align:right">${wbChip}<div class="muted" style="font-size:.8rem;margin-top:4px">View →</div></div>
        </div></div>`;
    }).join('');
}

function openPerson(id){
  const u=USERS[id];
  if(!u){ cmpToast('Profile not loaded yet','err'); return; }
  const row=(k,v)=>v?`<div class="field-row" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span class="muted" style="font-size:.86rem">${k}</span><span style="text-align:right;max-width:62%">${v}</span></div>`:'';
  const wb=WELLBEING.filter(w=>w.service_user_id===id);
  openSheet(`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--wheat);display:grid;place-items:center;font-weight:800;color:var(--aubergine-dark);font-family:var(--serif,serif);font-size:1.2rem">${(u.full_name||'?').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
      <div><h2 style="margin:0">${u.full_name}</h2><div class="muted" style="font-size:.88rem">${u.city||''} ${u.postcode||''}</div></div>
    </div>
    ${u.notes?`<p style="background:var(--mist,#faf7f2);border-radius:10px;padding:12px 14px;font-size:.95rem">${u.notes}</p>`:''}
    ${wb.length?`<div class="section-t" style="font-weight:800;margin:16px 0 6px;color:var(--aubergine-dark)">Wellbeing trend</div>${wbSpark(wb)}`:''}
    <div class="section-t" style="font-weight:800;margin:16px 0 6px;color:var(--aubergine-dark)">What makes them, them</div>
    ${row('Loves to chat about', (u.interests||[]).join(', '))}
    ${row('Favourite music', u.fav_music)}
    ${row('Daily routines', u.routines)}
    ${row('Dietary', u.dietary)}
    ${row('Family', u.family_details)}
    ${row('Getting around', u.mobility_notes)}
    ${u.conversation_starters?`<div style="background:rgba(231,184,106,.12);border:1px solid rgba(231,184,106,.4);border-radius:12px;padding:14px 16px;margin-top:14px"><div style="font-weight:800;font-size:.82rem;text-transform:uppercase;letter-spacing:.04em;color:var(--wheat-deep,#C8943B);margin-bottom:4px">💡 A lovely way in</div>${u.conversation_starters}</div>`:''}
    <button class="btn primary" style="width:100%;margin-top:16px" onclick="aiConversation('${id}')">✨ Ideas for what to talk about</button>
    <div id="ai-ideas" style="margin-top:12px"></div>
  `);
}

// tiny inline sparkline for wellbeing (lower score = better; we invert so up = improving)
function wbSpark(points){
  const w=260,h=54,pad=6;
  const xs=points.map((p,i)=>pad+i*((w-2*pad)/Math.max(1,points.length-1)));
  const ys=points.map(p=>pad+(p.score/6)*(h-2*pad)); // higher score lower on chart (more lonely = lower line)
  const d=xs.map((x,i)=>`${i?'L':'M'}${x.toFixed(1)},${(h-ys[i]).toFixed(1)}`).join(' ');
  const last=points[points.length-1], first=points[0];
  const trend = last.score<first.score?'improving 🌱' : last.score>first.score?'needs a little extra warmth' : 'steady';
  return `<div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:54px"><path d="${d}" fill="none" stroke="var(--wheat-deep,#C8943B)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${xs.map((x,i)=>`<circle cx="${x.toFixed(1)}" cy="${(h-ys[i]).toFixed(1)}" r="3" fill="var(--wheat-deep,#C8943B)"/>`).join('')}</svg>
    <div class="muted" style="font-size:.82rem;margin-top:4px">Over ${points.length} check-ins · <b style="color:var(--aubergine-dark)">${trend}</b>. A lower number means more connected.</div>
  </div>`;
}

// Visit prep — opens the person profile framed for the upcoming visit
function prepVisit(id, name){
  if(id && USERS[id]){ tab='people'; renderApp(); setTimeout(()=>openPerson(id),50); }
  else { cmpModal({title:'Prepare for your visit with '+name, mode:'alert', message:'Arrive a few minutes early, introduce yourself warmly, and ask how they’d like to spend the time. End by recapping the visit and confirming when you’ll next see them. Their full profile will appear here once it’s loaded.'}); }
}

// AI conversation ideas — uses the client's Success Plan via ai-assist
async function aiConversation(id){
  const box=document.getElementById('ai-ideas'); const u=USERS[id];
  if(!box||!u) return;
  box.innerHTML='<div class="muted" style="font-size:.88rem">✨ Thinking of some lovely ideas…</div>';
  const profile={ name:u.full_name, interests:u.interests, fav_music:u.fav_music, routines:u.routines, conversation_starters:u.conversation_starters, notes:u.notes };
  let ideas=null;
  if(typeof IS_LIVE!=='undefined' && IS_LIVE && DB_FEATURES.ai==='on' && typeof aiAssist!=='undefined'){
    try{ const out=await aiAssist('companion_prep',{profile}); if(out&&!out.error) ideas=out.text||out; }catch(e){}
  }
  if(!ideas){
    // graceful, genuinely useful fallback built from their own profile
    const bits=[];
    if(u.interests&&u.interests.length) bits.push(`Bring up ${u.interests[0]} — ask them about a favourite memory of it.`);
    if(u.fav_music) bits.push(`Put on some ${u.fav_music} and ask what it reminds them of.`);
    if(u.conversation_starters) bits.push(u.conversation_starters);
    if(u.routines) bits.push(`Fit in with their routine — ${u.routines.toLowerCase()}`);
    bits.push('Ask an open question about their younger years; people light up sharing stories.');
    ideas='• '+bits.join('\n• ');
  }
  box.innerHTML=`<div style="background:rgba(231,184,106,.1);border:1px solid rgba(231,184,106,.4);border-radius:12px;padding:14px 16px;white-space:pre-wrap;font-size:.95rem;line-height:1.5">${ideas}</div>`;
}

// lightweight bottom sheet for the companion portal (mobile-friendly)
function openSheet(html){
  let el=document.getElementById('cmpSheet');
  if(!el){ el=document.createElement('div'); el.id='cmpSheet';
    el.style.cssText='position:fixed;inset:0;background:rgba(50,46,61,.5);z-index:9000;display:flex;align-items:flex-end;justify-content:center';
    el.innerHTML='<div id="cmpSheetBody" style="background:#fff;width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:22px 20px 30px"></div>';
    el.onclick=(e)=>{ if(e.target===el) el.remove(); };
    document.body.appendChild(el);
  }
  el.querySelector('#cmpSheetBody').innerHTML='<button onclick="document.getElementById(\'cmpSheet\').remove()" style="float:right;border:none;background:none;font-size:1.5rem;cursor:pointer;color:var(--aubergine)">×</button>'+html;
}

function viewVisits(){
  if(!VISITS.length) return `<div class="panel"><div class="empty">No visits scheduled yet. They’ll appear here once you’re matched with a family.</div></div>`;
  const upcoming=VISITS.filter(v=>v.status==='scheduled');
  const past=VISITS.filter(v=>v.status!=='scheduled');
  const card=v=>{
    const hasNote=NOTES.some(n=>n.visit_id===v.id);
    const checkedIn=!!v.checked_in_at;
    const checkedOut=!!v.checked_out_at || v.status==='completed';
    let action='';
    if(v.status==='scheduled' && !checkedIn){
      action=`<button class="btn sm primary" onclick="checkIn('${v.id}')">📍 I've arrived</button>`;
    } else if(checkedIn && !checkedOut){
      action=`<div><span class="chip good">arrived ${v.checked_in_at?fmtTime(v.checked_in_at):''}</span>
        <div style="margin-top:8px"><button class="btn sm primary" onclick="checkOut('${v.id}')">👋 I've finished</button></div></div>`;
    } else if(checkedOut && !hasNote){
      action=`<div><span class="chip good">visit done</span>
        <div style="margin-top:8px"><button class="btn sm primary" onclick="openNote('${v.id}','${v.user_name.replace(/'/g,'')}')">Write note to family</button></div></div>`;
    } else if(hasNote){
      action='<span class="chip good">note sent</span>';
    } else {
      action=`<span class="chip ${v.status==='completed'?'good':'wheat'}">${cap(v.status)}</span>`;
    }
    return `<div class="visit">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div><div class="when">${fmt(v.scheduled_at)} · ${fmtTime(v.scheduled_at)}</div>
          <div class="who">${v.user_name} · ${v.length_hrs}h</div>
          ${checkedIn&&checkedOut?`<div class="sub2" style="font-size:.78rem;margin-top:4px">In ${fmtTime(v.checked_in_at)} · out ${fmtTime(v.checked_out_at)}</div>`:''}
          <div style="margin-top:8px"><button class="btn sm" style="font-size:.78rem;padding:5px 10px" onclick="raiseConcern('${v.id}','${(v.user_name||'').replace(/'/g,'')}','${v.service_user_id||''}')">⚑ Raise a concern</button></div></div>
        <div style="text-align:right">${action}</div>
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
  const aiBtn = (ME && DB_FEATURES.ai==='on')
    ? `<button class="btn" id="aiDraftBtn" onclick="aiDraftNote('${visitId}','${userName.replace(/'/g,'')}')">✨ AI draft</button>` : '';
  v.insertAdjacentHTML('afterbegin',`<div class="panel" id="noteForm" style="border-color:var(--wheat)">
    <div class="panel-h"><h3>Note to ${userName}’s family</h3></div>
    <div style="padding:16px 20px">
      <p class="muted" style="margin-top:0;font-size:.88rem">A warm, brief update on how the visit went. The family will read this — keep it kind and specific. Nothing medical.${aiBtn?' Jot rough notes and tap ✨ AI draft to shape them — you can edit before sending.':''}</p>
      <textarea id="noteText" rows="4" placeholder="e.g. crossword, two teas, talked about the garden…"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn primary" onclick="saveNote('${visitId}')">Send to family</button>
        ${aiBtn}
        <button class="btn" onclick="renderTab()">Cancel</button>
      </div>
    </div></div>`);
  $('#noteText').focus();
}
async function aiDraftNote(visitId,userName){
  const ta=$('#noteText'); if(!ta) return;
  const rough=ta.value.trim();
  if(!rough){ ta.placeholder='Jot a few rough words first, then tap AI draft…'; ta.focus(); return; }
  const btn=$('#aiDraftBtn'); if(btn){btn.textContent='Drafting…';btn.disabled=true;}
  let done=false;
  if(typeof aiAssist!=='undefined' && typeof IS_LIVE!=='undefined' && IS_LIVE){
    const out=await aiAssist('note_draft',{user_name:userName,rough});
    if(out.error){ alert(out.error==='AI not configured'?'AI isn’t set up yet.':'AI error: '+out.error); }
    else if(out.result){ ta.value=out.result; done=true; }
  }
  if(!done && !(typeof IS_LIVE!=='undefined'&&IS_LIVE)){
    // demo preview so the feature is visible without a live key
    ta.value=`We had a lovely visit today — ${rough}. ${userName.split(' ')[0]} was in good spirits and we had plenty to talk about. Looking forward to next time.`;
  }
  if(btn){btn.textContent='✨ AI draft';btn.disabled=false;}
}
async function checkIn(visitId){
  const v=VISITS.find(x=>x.id===visitId); if(!v) return;
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    try{ await supa.rpc('check_in_visit',{p_visit:visitId}); }catch(e){ alert('Could not check in: '+e.message); return; }
  }
  v.checked_in_at=new Date().toISOString();
  renderTab();
}
async function checkOut(visitId){
  const v=VISITS.find(x=>x.id===visitId); if(!v) return;
  if(!await cmpConfirm('Mark this visit as finished? The family will see it’s complete, and you can write them a note next.',{title:'Finish visit',okText:'Mark finished'})) return;
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    try{ await supa.rpc('check_out_visit',{p_visit:visitId}); }catch(e){ alert('Could not finish: '+e.message); return; }
  }
  v.checked_out_at=new Date().toISOString();
  v.status='completed';
  renderTab();
}

// Companion raises a welfare concern about a client — lands in the operator's
// Safeguarding queue. Two gentle steps: pick a category, then describe it.
const SG_CHOICES=[
  ['wellbeing','Seemed low / not themselves'],
  ['self_neglect','Not eating / home decline'],
  ['cognitive','Confused / forgetful'],
  ['physical','A fall / unwell / injury'],
  ['financial','Money worries / pressure'],
  ['environment','Unsafe home'],
  ['abuse','Something felt wrong'],
  ['other','Something else'],
];
async function raiseConcern(visitId, userName, serviceUserId){
  // step 1 — category via a simple chooser modal
  const pickHtml = SG_CHOICES.map(([k,label])=>
    `<button class="cmp-btn cmp-btn-ghost" style="display:block;width:100%;text-align:left;margin:4px 0" onclick="window.__sgPick('${k}')">${label}</button>`
  ).join('');
  const category = await new Promise(res=>{
    window.__sgPick=(k)=>{ document.getElementById('cmpModalOverlay').classList.remove('on'); res(k); };
    cmpModal({title:`Raise a concern · ${userName}`, mode:'alert', message:'What did you notice? Pick the closest. Companio will see this straight away.'});
    // inject the choices into the modal body
    setTimeout(()=>{ const b=document.getElementById('cmpModalBody'); if(b) b.innerHTML+='<div style="margin-top:10px">'+pickHtml+'</div>';
      const f=document.getElementById('cmpModalFoot'); if(f) f.innerHTML=''; },20);
  });
  if(!category) return;
  // step 2 — description
  const desc = await cmpPrompt('Tell Companio what you saw, in your own words.',{title:'Describe the concern',okText:'Send to Companio',placeholder:'e.g. She seemed confused about the day and hadn’t eaten lunch.'});
  if(desc===null || !desc.trim()){ return; }
  // step 3 — urgency
  const urgent = await cmpConfirm('Does this need attention today?',{title:'How urgent?',okText:'Yes — today',cancelText:'No — routine'});
  const severity = urgent?3:2;
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    try{ await supa.rpc('raise_concern',{p_service_user:serviceUserId||null,p_category:category,p_severity:severity,p_description:desc.trim(),p_visit:visitId||null}); }
    catch(e){ alert('Could not send: '+e.message); return; }
  }
  cmpToast('Thank you — Companio has been alerted','ok');
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
