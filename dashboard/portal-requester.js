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

let ME=null, USERS=[], BOOKINGS=[], VISITS=[], NOTES=[], INVOICES=[];

/* ---------- DEMO DATA ---------- */
const DEMO={
  me:{id:'r1',full_name:'Sarah Mensah',email:'sarah@example.com'},
  users:[{id:'u1',full_name:'Joan Mensah',city:'Guildford',relationship:'adult_child'}],
  bookings:[{id:'b1',service_user_id:'u1',companion_name:'Linda Hartley',service:'companionship',frequency:'weekly',hourly_rate:32,status:'active'}],
  visits:[
    {id:'v1',booking_id:'b1',scheduled_at:'2026-06-24T10:00',length_hrs:2,status:'completed',user_name:'Joan Mensah',companion_name:'Linda Hartley'},
    {id:'v2',booking_id:'b1',scheduled_at:'2026-07-01T10:00',length_hrs:2,status:'scheduled',user_name:'Joan Mensah',companion_name:'Linda Hartley'},
  ],
  notes:[{id:'n1',visit_id:'v1',summary:'Joan was in great spirits — crossword and two cups of tea, and she told me all about teaching in Lagos. She walked me to the door, which she was pleased about.',created_at:'2026-06-24',companion_name:'Linda Hartley',user_name:'Joan Mensah'}],
  invoices:[{id:'i1',number:'CMP-2026-0001',status:'sent',period_start:'2026-06-01',period_end:'2026-06-30',total:128,amount_paid:0,due_date:'2026-07-14'}],
};

async function boot(){
  if(typeof IS_LIVE!=='undefined' && IS_LIVE){
    if(!auth.restore()) return showLogin();
    try{ const me=await loadMe(); if(!me) return showLogin('This login isn’t linked to a family account.'); }
    catch(e){ return showLogin(); }
  } else {
    ME=DEMO.me; USERS=DEMO.users; BOOKINGS=DEMO.bookings; VISITS=DEMO.visits; NOTES=DEMO.notes; INVOICES=DEMO.invoices;
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
  return ME;
}

function showLogin(err){
  $('#root').innerHTML=`<div class="login-bg"><form class="login-card" id="lf">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="width:32px;height:32px;border-radius:50%;background:var(--wheat);display:grid;place-items:center;color:var(--aubergine-dark);font-weight:800">∞</span>
      <b style="font-family:var(--serif);font-size:1.3rem;color:var(--aubergine-dark)">Companio</b></div>
    <p class="muted" style="margin:0 0 14px">Family portal · sign in</p>
    ${err?`<div class="err">${err}</div>`:''}
    <label>Email</label><input id="e" type="email" required autocomplete="username">
    <label>Password</label><input id="p" type="password" required autocomplete="current-password">
    <button class="btn primary" style="width:100%;margin-top:18px;padding:12px" type="submit">Sign in</button>
  </form></div>`;
  $('#lf').onsubmit=async(ev)=>{ev.preventDefault();
    const b=$('#lf button');b.textContent='Signing in…';b.disabled=true;
    try{ await auth.login($('#e').value.trim(),$('#p').value);
      const me=await loadMe(); if(!me){ auth.logout(); return; } renderApp();
    }catch(e){ showLogin(e.message||'Login failed'); }
  };
}

let tab='loved';
function renderApp(){
  const live=(typeof IS_LIVE!=='undefined' && IS_LIVE);
  $('#root').innerHTML=`
  <div class="topbar"><div class="brand"><span class="mark">∞</span><b>Companio</b></div>
    <div class="who">${ME.full_name}${live?` · <a href="#" onclick="auth.logout();return false">sign out</a>`:' · demo'}</div></div>
  <div class="wrap">
    <div class="hello"><h1>Hello, ${ME.full_name.split(' ')[0]}</h1><p class="muted">How your loved one is doing, and everything in one place.</p></div>
    <div class="tabs">
      <button data-t="loved" class="${tab==='loved'?'on':''}">Loved ones</button>
      <button data-t="notes" class="${tab==='notes'?'on':''}">Notes from visits</button>
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
  v.innerHTML = tab==='loved'?viewLoved() : tab==='notes'?viewNotes() : tab==='visits'?viewVisits() : viewBills();
}

function viewLoved(){
  if(!USERS.length) return `<div class="panel"><div class="empty">Once your introduction call is done, your loved one and their companion appear here.</div></div>`;
  return USERS.map(u=>{
    const bks=BOOKINGS.filter(b=>b.service_user_id===u.id);
    return `<div class="panel"><div class="panel-h"><h3>${u.full_name}</h3><span class="muted">${u.city||''}</span></div>
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
  const card=v=>`<div class="row"><div style="display:flex;justify-content:space-between;align-items:center">
    <div><div class="name">${fmt(v.scheduled_at)} · ${fmtTime(v.scheduled_at)}</div>
      <div class="muted" style="font-size:.9rem">${v.companion_name} · ${v.length_hrs}h</div></div>
    <span class="chip ${v.status==='completed'?'good':'wheat'}">${cap(v.status)}</span></div></div>`;
  return `${up.length?`<div class="panel"><div class="panel-h"><h3>Upcoming</h3></div>${up.map(card).join('')}</div>`:''}
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
