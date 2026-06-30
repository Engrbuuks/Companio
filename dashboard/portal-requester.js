/* ============================================================
   COMPANIO — FAMILY (REQUESTER) PORTAL
   A family member logs in and sees only THEIR loved ones, the
   visits delivered, the notes from companions, and their bills.
   RLS scopes everything to my_requester_id() server-side.
   ============================================================ */
const $=(s,el=document)=>el.querySelector(s);
const fmt=d=>new Date(d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
const fmtTime=d=>new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const cap=s=>s?s[0].toUpperCase()+s.slice(1).replace(/_/g,' '):'';
const money=n=>'£'+Number(n||0).toFixed(2);

let ME=null, USERS=[], BOOKINGS=[], VISITS=[], NOTES=[], INVOICES=[], COMPANIONS=[], WELLBEING=[];

/* ---------- DEMO DATA ---------- */
const DEMO={
  me:{id:'sample',full_name:'Sample Family',email:'sample@example.com'},
  users:[], bookings:[], visits:[], notes:[], invoices:[], companions:[],
};

async function boot(){
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    if(!auth.restore()) return showLogin();
    try{ const me=await loadMe(); if(!me) return showLogin('This login isn’t linked to a family account.'); }
    catch(e){ return showLogin(); }
  } else {
    ME=DEMO.me; USERS=DEMO.users; BOOKINGS=DEMO.bookings; VISITS=DEMO.visits; NOTES=DEMO.notes; INVOICES=DEMO.invoices; COMPANIONS=DEMO.companions;
  }
  renderApp();
}

async function loadMe(){
  const rows=await supa.select('requesters',`select=*&auth_user_id=eq.${SB.user.id}`);
  if(!rows||!rows[0]) return null;
  ME=rows[0];
  const [users,bookings,visits,notes,invoices]=await Promise.all([
    supa.select('service_users',`select=*&requester_id=eq.${ME.id}`).catch(()=>[]),
    supa.select('bookings',`select=*,companions(full_name)&requester_id=eq.${ME.id}`).catch(()=>[]),
    supa.select('visits',`select=*,bookings!inner(requester_id,service_users(full_name),companions(full_name))&bookings.requester_id=eq.${ME.id}&order=scheduled_at.desc`).catch(()=>[]),
    supa.select('visit_notes',`select=*,visits!inner(bookings!inner(requester_id,service_users(full_name),companions(full_name)))&shared_with_family=eq.true&visits.bookings.requester_id=eq.${ME.id}&order=created_at.desc`).catch(()=>[]),
    supa.select('invoices',`select=*&requester_id=eq.${ME.id}&order=created_at.desc`).catch(()=>[]),
  ]);
  USERS=users||[];
  BOOKINGS=(bookings||[]).map(b=>({...b,companion_name:b.companions?.full_name||'To be matched'}));
  VISITS=(visits||[]).map(v=>({...v,user_name:v.bookings?.service_users?.full_name||'',companion_name:v.bookings?.companions?.full_name||''}));
  NOTES=(notes||[]).map(n=>({...n,user_name:n.visits?.bookings?.service_users?.full_name||'',companion_name:n.visits?.bookings?.companions?.full_name||''}));
  INVOICES=invoices||[];
  // wellbeing check-ins for the loved ones (gentle peace-of-mind glance)
  try{
    const uids=USERS.map(u=>u.id);
    if(uids.length){ WELLBEING = await supa.select('wellbeing_checkins',`select=*&service_user_id=in.(${uids.join(',')})&order=created_at.desc`).catch(()=>[]) || []; }
  }catch(e){ WELLBEING=[]; }
  // "Who is looking after my loved one?" — operator-decided, family informed
  try{ COMPANIONS = await supa.rpc('my_companion',{}) || []; }catch(e){ COMPANIONS=[]; }
  return ME;
}

function showLogin(err){
  $('#root').innerHTML=`<div class="login-bg"><form class="login-card" id="lf">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span class="cmp-logo" style="width:40px;height:40px"></span>
      <b style="font-family:var(--serif);font-size:1.3rem;color:var(--aubergine-dark)">Companio</b></div>
    <p class="muted" style="margin:0 0 14px">Family portal · sign in</p>
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
      const me=await loadMe(); if(!me){ auth.logout(); return; } renderApp();
    }catch(e){ showLogin(e.message||'Login failed'); }
  };
}

let tab='home';
function renderApp(){
  const live=(typeof IS_LIVE!=='undefined' && IS_LIVE);
  $('#root').innerHTML=`
  <div class="topbar"><div class="brand"><span class="cmp-logo"></span><b>Companio</b></div>
    <div class="who">${ME.full_name}${live?` <button class="signout-btn" onclick="auth.logout();return false">Sign out</button>`:' · demo'}</div></div>
  <div class="wrap">
    <div class="hello"><h1>Hello, ${ME.full_name.split(' ')[0]}</h1><p class="muted">How your loved one is doing, and everything in one place.</p></div>
    <div class="tabs">
      <button data-t="home" class="${tab==='home'?'on':''}">Home</button>
      <button data-t="loved" class="${tab==='loved'?'on':''}">Loved ones</button>
      <button data-t="notes" class="${tab==='notes'?'on':''}">Notes from visits</button>
      <button data-t="memories" class="${tab==='memories'?'on':''}">Their story</button>
      <button data-t="visits" class="${tab==='visits'?'on':''}">Schedule</button>
      <button data-t="bills" class="${tab==='bills'?'on':''}">Billing</button>
    </div>
    <div id="tabview"></div>
  </div>`;
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;renderApp();});
  renderTab();
}
function renderTab(){
  const v=$('#tabview');
  v.innerHTML = tab==='home'?viewHome() : tab==='loved'?viewLoved() : tab==='notes'?viewNotes() : tab==='memories'?viewMemories() : tab==='visits'?viewVisits() : viewBills();
}

function viewHome(){
  const firstName=(ME && (ME.full_name||'').split(' ')[0])||'there';
  const greeting=(()=>{ const h=new Date().getHours(); return h<12?'Good morning':h<18?'Good afternoon':'Good evening'; })();

  // who we're caring for
  const lovedNames = USERS.map(u=>u.full_name.split(' ')[0]).join(' & ');

  // next upcoming visit
  const now=new Date();
  const upcoming=VISITS.filter(v=>new Date(v.scheduled_at)>=now && v.status!=='cancelled')
    .sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  const nextVisit=upcoming[0];

  // latest shared note
  const latestNote=NOTES[0];

  // wellbeing glance (lower score = more connected)
  const wbByUser={};
  (WELLBEING||[]).forEach(w=>{ (wbByUser[w.service_user_id]=wbByUser[w.service_user_id]||[]).push(w); });

  // ---- Welcome ----
  let out=`<div class="panel" style="background:linear-gradient(165deg,#fff,var(--mist,#faf7f2));border:1px solid rgba(231,184,106,.4)">
    <div style="padding:22px 22px 20px">
      <div class="muted" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.06em">${greeting}</div>
      <h2 style="margin:4px 0 6px;font-family:var(--serif,serif)">Hello, ${firstName}</h2>
      <p class="muted" style="margin:0">${USERS.length?`Here’s how things are${lovedNames?` for ${lovedNames}`:''}. Everything important is on this page — and we’re always just a message away.`:`Welcome to Companio. Once your introduction call is done, this is where you’ll see everything about your loved one’s care.`}</p>
    </div>
  </div>`;

  // ---- Next visit (front and centre) ----
  if(nextVisit){
    const when=new Date(nextVisit.scheduled_at);
    const dayLabel=when.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
    const timeLabel=when.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    out+=`<div class="panel"><div class="panel-h"><h3>Next visit</h3><span class="chip good">Confirmed</span></div>
      <div style="padding:16px 20px;display:flex;align-items:center;gap:16px">
        <div style="text-align:center;background:var(--aubergine-dark,#322E3D);color:#fff;border-radius:14px;padding:12px 16px;min-width:64px">
          <div style="font-size:1.5rem;font-weight:800;line-height:1;font-family:var(--serif,serif)">${when.getDate()}</div>
          <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;opacity:.8">${when.toLocaleDateString('en-GB',{month:'short'})}</div>
        </div>
        <div style="flex:1">
          <div class="name" style="font-size:1.05rem">${dayLabel}, ${timeLabel}</div>
          <div class="muted">${nextVisit.user_name?`Visiting ${nextVisit.user_name.split(' ')[0]}`:''}${nextVisit.companion_name?` · with ${nextVisit.companion_name}`:''}</div>
        </div>
      </div></div>`;
  } else if(USERS.length){
    out+=`<div class="panel"><div class="panel-h"><h3>Next visit</h3></div>
      <div class="empty">No visit scheduled just yet. We’ll confirm the next one here as soon as it’s set.</div></div>`;
  }

  // ---- Companion + wellbeing per loved one ----
  USERS.forEach(u=>{
    const comp=(COMPANIONS||[]).find(c=>c.service_user_id===u.id);
    const wb=(wbByUser[u.id]||[]).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    const latest=wb[wb.length-1];
    let wbGlance='';
    if(latest){
      const band=latest.band||(latest.score<=1?'not_lonely':latest.score<=3?'moderate':'strong');
      const first=wb[0];
      const trend = wb.length<2?'':latest.score<first.score?' and improving':latest.score>first.score?'':'';
      const label = band==='strong'?'could use a little more connection'
        : band==='moderate'?`doing okay${trend}`
        : `doing well${trend}`;
      const chip = band==='strong'?'warn':band==='moderate'?'wheat':'good';
      wbGlance=`<div style="padding:0 20px 14px"><span class="chip ${chip}">Wellbeing: ${label}</span></div>`;
    }
    if(comp){
      const since=comp.since?new Date(comp.since):null;
      const weeks=since?Math.max(1,Math.floor((Date.now()-since.getTime())/(7*86400000))):0;
      const continuity = since ? (weeks>=1?`Your companion for ${weeks} week${weeks>1?'s':''}`:'Newly matched') : '';
      const interests=(comp.shared_interests&&comp.shared_interests.length)?comp.shared_interests:[];
      out+=`<div class="panel"><div class="panel-h"><h3>${u.full_name.split(' ')[0]}’s companion</h3>${continuity?`<span class="chip good">${continuity}</span>`:''}</div>
        <div class="row" style="padding:16px 20px">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div style="width:58px;height:58px;border-radius:50%;flex:0 0 auto;background:${comp.companion_photo?`url('${comp.companion_photo}') center/cover`:'var(--wheat,#E7B86A)'};display:grid;place-items:center;font-weight:800;color:#322E3D;font-family:var(--serif,serif)">${comp.companion_photo?'':(comp.companion_name||'?').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
            <div style="flex:1">
              <div class="name" style="font-size:1.08rem">${comp.companion_name}</div>
              ${comp.companion_bio?`<div class="muted" style="font-size:.88rem;margin-top:2px">${comp.companion_bio}</div>`:''}
              ${interests.length?`<div style="margin-top:10px;padding:10px 12px;background:var(--mist,#faf7f2);border-radius:10px">
                <div style="font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;color:var(--wheat-deep,#C8943B);font-weight:700;margin-bottom:5px">Why we matched them</div>
                <div style="font-size:.86rem">${comp.companion_name.split(' ')[0]} and ${u.full_name.split(' ')[0]} share a love of ${interests.slice(0,3).map(i=>`<b>${i}</b>`).join(', ').replace(/, ([^,]*)$/,' and $1')} — a natural starting point for real friendship.</div>
              </div>`:''}
            </div>
          </div>
        </div>${wbGlance}</div>`;
    } else if(wbGlance){
      out+=`<div class="panel"><div class="panel-h"><h3>${u.full_name.split(' ')[0]}</h3></div>${wbGlance}</div>`;
    }
  });

  // ---- Latest visit note (surfaced) ----
  if(latestNote){
    out+=`<div class="panel"><div class="panel-h"><h3>From the last visit</h3>
      <button class="linklike" onclick="tab='notes';renderApp()" style="background:none;border:0;color:var(--wheat-deep,#C8943B);font-weight:700;cursor:pointer;font-size:.85rem">See all notes →</button></div>
      <div style="padding:6px 20px 16px">
        <div class="note-card"><div class="meta">${latestNote.companion_name} on ${latestNote.user_name||'your loved one'} · ${fmt(latestNote.created_at)}</div>${latestNote.summary}</div>
      </div></div>`;
  }

  // ---- Contact / reach us + concierge ----
  out+=`<div class="panel"><div class="panel-h"><h3>Anything on your mind?</h3></div>
    <div style="padding:16px 20px">
      <p class="muted" style="margin:0 0 12px">We’re here whenever you need us — a question, a change to the schedule, or just to talk something through.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn primary" href="mailto:hello@mycompanio.co.uk?subject=A%20message%20about%20${encodeURIComponent(lovedNames||'my%20loved%20one')}">✉️ Message the team</a>
        <a class="btn" href="mailto:hello@mycompanio.co.uk?subject=${encodeURIComponent('Special request for '+(lovedNames||'my loved one'))}&body=${encodeURIComponent('I\'d like to arrange something special:\n\n(e.g. a birthday visit, an outing, accompanying to an appointment)\n\n')}">✨ Request an outing or occasion</a>
      </div>
    </div></div>`;

  return out;
}

// Their story — a warm, running timeline of visits the family can read.
// Built from shared visit notes; this is the emotional heart of the service.
function viewMemories(){
  const shared=(NOTES||[]).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  if(!shared.length){
    return `<div class="panel"><div class="panel-h"><h3>Their story</h3></div>
      <div class="empty">As visits happen, the moments your loved one shares with their companion — the chats, the outings, the small joys — will gather here, like a little diary of their friendship.</div></div>`;
  }
  // group by month for a gentle timeline feel
  const groups={};
  shared.forEach(n=>{
    const d=new Date(n.created_at);
    const key=d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    (groups[key]=groups[key]||[]).push(n);
  });
  let out=`<div class="panel" style="background:linear-gradient(165deg,#fff,var(--mist,#faf7f2));border:1px solid rgba(231,184,106,.4)">
    <div style="padding:20px 22px">
      <h2 style="margin:0 0 4px;font-family:var(--serif,serif)">Their story so far</h2>
      <p class="muted" style="margin:0">A gathering of moments from ${USERS.map(u=>u.full_name.split(' ')[0]).join(' & ')||'your loved one'}’s visits — the conversations, outings and small joys that make a friendship.</p>
    </div></div>`;

  Object.keys(groups).forEach(month=>{
    out+=`<div style="margin:18px 0 8px;padding:0 4px"><span style="font-family:var(--serif,serif);font-size:1.05rem;color:var(--aubergine-dark,#322E3D)">${month}</span></div>`;
    out+=`<div class="timeline">`;
    groups[month].forEach(n=>{
      const d=new Date(n.created_at);
      const day=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric'});
      out+=`<div class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-card">
          <div class="tl-meta">${day} · with ${n.companion_name||'their companion'}</div>
          <div class="tl-body">${n.summary}</div>
        </div>
      </div>`;
    });
    out+=`</div>`;
  });
  return out;
}

function viewLoved(){
  if(!USERS.length) return `<div class="panel"><div class="empty">Once your introduction call is done, your loved one and their companion appear here.</div></div>`;
  return USERS.map(u=>{
    const bks=BOOKINGS.filter(b=>b.service_user_id===u.id);
    const comp=(COMPANIONS||[]).find(c=>c.service_user_id===u.id);
    const compCard = comp ? `<div class="row" style="background:var(--mist,#faf7f2);border-radius:12px;padding:14px;margin:4px 10px 10px">
        <div style="display:flex;gap:14px;align-items:center">
          <div style="width:54px;height:54px;border-radius:50%;flex:0 0 auto;background:${comp.companion_photo?`url('${comp.companion_photo}') center/cover`:'var(--wheat,#E7B86A)'};display:grid;place-items:center;font-weight:800;color:#322E3D;font-family:var(--serif,serif);font-size:1.1rem">${comp.companion_photo?'':(comp.companion_name||'?').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
          <div style="flex:1">
            <div class="muted" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.04em">Your companion</div>
            <div class="name" style="font-size:1.05rem">${comp.companion_name}</div>
            ${comp.companion_bio?`<div class="muted" style="font-size:.88rem;margin-top:3px">${comp.companion_bio}</div>`:''}
            ${(comp.shared_interests&&comp.shared_interests.length)?`<div style="margin-top:7px;font-size:.82rem">In common with ${u.full_name.split(' ')[0]}: ${comp.shared_interests.map(i=>`<span class="chip">${i}</span>`).join(' ')}</div>`:''}
          </div>
        </div></div>` : '';
    return `<div class="panel"><div class="panel-h"><h3>${u.full_name}</h3><span class="muted">${u.city||''}</span></div>
      ${compCard}
      <div style="padding:6px 0">${bks.length?bks.map(b=>`<div class="row">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div class="name">${cap(b.service)} · ${cap(b.frequency)}</div>
            <div class="muted" style="font-size:.9rem">Companion: ${b.companion_name}</div></div>
          <span class="chip ${b.status==='active'?'good':'wheat'}">${cap(b.status)}</span>
        </div></div>`).join(''):'<div class="empty">No active arrangement yet.</div>'}</div></div>`;
  }).join('');
}

function viewNotes(){
  if(!NOTES.length) return `<div class="panel"><div class="empty">After each visit, your loved one’s companion leaves a warm note here.</div></div>`;
  return `<div class="panel"><div class="panel-h"><h3>Notes from visits</h3></div><div style="padding:14px 0">
    ${NOTES.map(n=>`<div class="note-card"><div class="meta">${n.companion_name} on ${n.user_name||'your loved one'} · ${fmt(n.created_at)}</div>${n.summary}</div>`).join('')}
  </div></div>`;
}

function viewVisits(){
  if(!VISITS.length) return `<div class="panel"><div class="empty">Upcoming visits will appear here once scheduled.</div></div>`;
  const up=VISITS.filter(v=>v.status==='scheduled'), past=VISITS.filter(v=>v.status!=='scheduled');
  // next-visit reassurance banner
  const next=up.slice().sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0];
  const reassure=next?`<div class="panel" style="border-color:var(--wheat);background:rgba(231,184,106,.06)">
    <div style="padding:18px 22px">
      <div class="muted" style="font-size:.82rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--wheat-deep)">Next visit</div>
      <div style="font-family:var(--serif);font-size:1.35rem;color:var(--aubergine-dark);margin-top:4px">${next.companion_name} visits ${next.user_name.split(' ')[0]}</div>
      <div style="margin-top:2px;font-weight:700">${fmt(next.scheduled_at)} at ${fmtTime(next.scheduled_at)}</div>
    </div></div>`:'';
  const card=v=>{
    const inProgress=v.checked_in_at && !v.checked_out_at && v.status==='scheduled';
    let status;
    if(inProgress) status='<span class="chip good" style="background:rgba(46,125,82,.15)">● Visiting now</span>';
    else if(v.status==='completed') status=`<span class="chip good">completed${v.checked_out_at?' '+fmtTime(v.checked_out_at):''}</span>`;
    else status=`<span class="chip wheat">${cap(v.status)}</span>`;
    return `<div class="row"><div style="display:flex;justify-content:space-between;align-items:center">
    <div><div class="name">${fmt(v.scheduled_at)} · ${fmtTime(v.scheduled_at)}</div>
      <div class="muted" style="font-size:.9rem">${v.companion_name} · ${v.length_hrs}h${v.checked_in_at&&v.checked_out_at?` · arrived ${fmtTime(v.checked_in_at)}, left ${fmtTime(v.checked_out_at)}`:''}</div></div>
    ${status}</div></div>`;
  };
  return `${reassure}
    ${up.length?`<div class="panel"><div class="panel-h"><h3>Upcoming</h3></div>${up.map(card).join('')}</div>`:''}
    ${past.length?`<div class="panel"><div class="panel-h"><h3>Past visits</h3></div>${past.map(card).join('')}</div>`:''}`;
}

function viewBills(){
  if(!INVOICES.length) return `<div class="panel"><div class="empty">Your invoices will appear here.</div></div>`;
  const outstanding=INVOICES.reduce((s,i)=>s+(i.total-i.amount_paid),0);
  return `<div class="panel"><div class="panel-h"><h3>Outstanding balance</h3></div>
    <div style="padding:18px 20px"><span class="big">${money(outstanding)}</span> <span class="muted">across ${INVOICES.length} invoice${INVOICES.length>1?'s':''}</span></div></div>
    <div class="panel"><div class="panel-h"><h3>Invoices</h3></div><div style="padding:6px 0">
    ${INVOICES.map(i=>{const owed=i.total-i.amount_paid;return `<div class="row"><div style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="name">${i.number||'Invoice'}</div>
        <div class="muted" style="font-size:.9rem">${i.period_start?fmt(i.period_start):''}${i.period_end?' – '+fmt(i.period_end):''} · due ${i.due_date?fmt(i.due_date):'—'}</div></div>
      <div style="text-align:right"><div class="name">${money(i.total)}</div>
        <span class="chip ${i.status==='paid'?'good':owed>0?'bad':'wheat'}">${i.status==='paid'?'Paid':money(owed)+' due'}</span></div>
    </div></div>`;}).join('')}
    </div></div>
    <p class="muted" style="font-size:.85rem">Questions about a bill? Reply to your invoice email or contact your coordinator.</p>`;
}

boot();
