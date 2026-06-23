/* ============================================================
   COMPANIO ENGINE — dashboard logic
   Demo dataset mirrors sql/04_seed.sql. Matching mirrors
   sql/03_functions.sql match_score(). When LIVE, swap the
   data layer for Supabase REST calls (see live() helpers).
   ============================================================ */

/* ---------- DEMO DATA (mirror of seed) ---------- */
const DB = {
  companions: [
    {id:'c1',full_name:'Linda Hartley',city:'Guildford',postcode:'GU1 3AA',status:'active',dbs:'cleared',offers:'both',hourly_pay:14,max_clients:8,interests:['cards','music','tea','history','chat'],temperament:'chatty',has_car:true,bio:'A natural conversationalist who never runs out of stories.'},
    {id:'c2',full_name:'Grace Owens',city:'Guildford',postcode:'GU2 7XH',status:'active',dbs:'cleared',offers:'companionship',hourly_pay:14,max_clients:8,interests:['walking','gardening','nature','tea'],temperament:'active',has_car:true,bio:'Always up for a walk in the park or the garden centre.'},
    {id:'c3',full_name:'Margaret Hill',city:'Woking',postcode:'GU21 6XR',status:'active',dbs:'cleared',offers:'both',hourly_pay:14.5,max_clients:8,interests:['cards','puzzles','music','baking'],temperament:'playful',has_car:false,bio:'Cards, crosswords and a competitive streak.'},
    {id:'c4',full_name:'Eleanor Voss',city:'Guildford',postcode:'GU1 4RT',status:'active',dbs:'cleared',offers:'help',hourly_pay:15,max_clients:8,interests:['tech','admin','reading','quiet','tea'],temperament:'calm',has_car:true,bio:'Gentle, unhurried company; brilliant with tech and paperwork.'},
    {id:'c5',full_name:'Tom Bridges',city:'Woking',postcode:'GU22 7AA',status:'vetting',dbs:'submitted',offers:'both',hourly_pay:14,max_clients:8,interests:['tech','football','history','chat'],temperament:'chatty',has_car:true,bio:'Awaiting DBS clearance.'},
  ],
  requesters: [
    {id:'r1',full_name:'Sarah Mensah',email:'sarah@example.com',phone:'07700 900201',status:'active',source:'matcher',
     matcher_notes:'For: My mum · Enjoys: A good chat & a cuppa · Frequency: Once a week, gently · Suggested match: Linda'},
  ],
  service_users: [
    {id:'u1',requester_id:'r1',full_name:'Joan Mensah',relationship:'adult_child',city:'Guildford',postcode:'GU1 3AB',interests:['cards','music','tea','history'],temperament:'chatty',notes:'Loves a long chat and a milky tea. Hard of hearing on the left.',mobility_notes:'Walks with a stick; short strolls fine.'},
    {id:'u2',requester_id:'r1',full_name:'Albert Mensah',relationship:'adult_child',city:'Guildford',postcode:'GU1 3AB',interests:['tech','reading','quiet','tea'],temperament:'calm',notes:'Struggles with his tablet and the post pile. Prefers calm company.',mobility_notes:''},
  ],
  bookings: [
    {id:'b1',requester_id:'r1',service_user_id:'u1',companion_id:'c1',service:'companionship',frequency:'weekly',hourly_rate:32,visit_length_hrs:2,status:'active',start_date:'2026-06-24'},
  ],
  visits: [
    {id:'v1',booking_id:'b1',companion_id:'c1',scheduled_at:'2026-06-24T10:00',length_hrs:2,status:'completed'},
    {id:'v2',booking_id:'b1',companion_id:'c1',scheduled_at:'2026-07-01T10:00',length_hrs:2,status:'scheduled'},
  ],
  visit_notes: [
    {id:'n1',visit_id:'v1',companion_id:'c1',summary:'Joan was in great spirits — we worked through the crossword over two cups of tea and she told me all about her time teaching in Lagos. She walked me to the door, which she was pleased about.',shared_with_family:true,created_at:'2026-06-24'},
  ],
  matches: [],
};

/* ---------- MATCHING (mirror of sql match_score) ---------- */
function matchScore(user, comp){
  let s=0, reasons=[];
  if(comp.status!=='active') return {score:0,reasons:['companion not active']};
  const shared = user.interests.filter(i=>comp.interests.includes(i));
  if(shared.length>=3){s+=35;reasons.push(`shares ${shared.length} interests: ${shared.join(', ')}`);}
  else if(shared.length===2){s+=26;reasons.push(`shares 2 interests: ${shared.join(', ')}`);}
  else if(shared.length===1){s+=16;reasons.push(`shares an interest: ${shared[0]}`);}
  else reasons.push('no shared interests yet');
  if(user.temperament&&comp.temperament){
    if(user.temperament.toLowerCase()===comp.temperament.toLowerCase()){s+=15;reasons.push(`temperament match: ${comp.temperament}`);}
    else{s+=5;reasons.push('temperament differs');}
  }
  const bk = DB.bookings.find(b=>b.service_user_id===user.id&&['active','proposed','draft'].includes(b.status));
  const reqService = bk?bk.service:'companionship';
  if(comp.offers==='both'||comp.offers===reqService){s+=20;reasons.push(`covers ${reqService}`);}
  else reasons.push(`does not offer ${reqService}`);
  const out=p=>(p||'').toUpperCase().split(' ')[0];
  if(user.postcode&&comp.postcode&&out(user.postcode)===out(comp.postcode)){s+=20;reasons.push('same postcode district');}
  else if(user.city&&comp.city&&user.city.toLowerCase()===comp.city.toLowerCase()){s+=12;reasons.push('same town');}
  else reasons.push('further afield');
  const active = DB.bookings.filter(b=>b.companion_id===comp.id&&b.status==='active').length;
  if(active<comp.max_clients){s+=Math.max(0,10-active);reasons.push(`${comp.max_clients-active} client slots free`);}
  else reasons.push('at capacity');
  return {score:Math.min(s,100),reasons};
}
function suggestMatches(userId,limit=5){
  const user=DB.service_users.find(u=>u.id===userId);
  return DB.companions.filter(c=>c.status==='active')
    .map(c=>({companion:c,...matchScore(user,c)}))
    .filter(m=>m.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}

/* ---------- helpers ---------- */
const $=(s,el=document)=>el.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const fmt=d=>new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
const initials=n=>n.split(' ').map(x=>x[0]).slice(0,2).join('');
const cap=s=>s? s[0].toUpperCase()+s.slice(1).replace(/_/g,' '):'';
const dbsChip=d=>({cleared:'good',submitted:'warn',none:'bad',expired:'bad'}[d]||'');
const statusChip=s=>({active:'good',vetting:'warn',applicant:'warn',paused:'',offboarded:'bad',lead:'warn',completed:'good',scheduled:'wheat'}[s]||'');

/* ---------- NAV ---------- */
const TABS=[
  {id:'overview',ico:'◎',label:'Overview'},
  {id:'companions',ico:'❋',label:'Companions'},
  {id:'requesters',ico:'❑',label:'Requesters & Users'},
  {id:'bookings',ico:'✦',label:'Bookings'},
  {id:'visits',ico:'✓',label:'Visits & Notes'},
];
let current='overview';
function renderNav(){
  const n=$('#nav');n.innerHTML='';
  TABS.forEach(t=>{
    const b=el('button',t.id===current?'on':'',`<span class="ico">${t.ico}</span>${t.label}`);
    b.onclick=()=>{current=t.id;renderNav();render();};
    n.appendChild(b);
  });
}

/* ---------- VIEWS ---------- */
function head(eyebrow,title,sub){
  return `<div class="head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div></div>`;
}
function render(){
  const v=$('#view');
  if(current==='overview') v.innerHTML=viewOverview();
  else if(current==='companions') v.innerHTML=viewCompanions();
  else if(current==='requesters') v.innerHTML=viewRequesters();
  else if(current==='bookings') v.innerHTML=viewBookings();
  else if(current==='visits') v.innerHTML=viewVisits();
  bindRows();
}

function viewOverview(){
  const active=DB.companions.filter(c=>c.status==='active').length;
  const vetting=DB.companions.filter(c=>c.status==='vetting'||c.status==='applicant').length;
  const users=DB.service_users.length;
  const activeBk=DB.bookings.filter(b=>b.status==='active').length;
  const upcoming=DB.visits.filter(v=>v.status==='scheduled').length;
  // capacity
  const loadRows=DB.companions.filter(c=>c.status==='active').map(c=>{
    const used=DB.bookings.filter(b=>b.companion_id===c.id&&b.status==='active').length;
    const pct=Math.round(used/c.max_clients*100);
    return `<tr><td class="name">${c.full_name}</td><td>${used} / ${c.max_clients} clients</td>
      <td style="width:40%"><div style="background:var(--line);border-radius:99px;height:8px"><div style="width:${pct}%;height:8px;border-radius:99px;background:var(--wheat)"></div></div></td>
      <td><span class="chip ${c.max_clients-used>0?'good':'bad'}">${c.max_clients-used} free</span></td></tr>`;
  }).join('');
  return head('Operations','Good morning, BRAVO','One catchment · Guildford & Woking. The engine tracks supply, families, bookings and visits in one place.')+`
  <div class="kpis">
    <div class="kpi"><div class="n">${active}</div><div class="l">Active companions</div></div>
    <div class="kpi accent"><div class="n">${vetting}</div><div class="l">In vetting</div></div>
    <div class="kpi"><div class="n">${users}</div><div class="l">Service users</div></div>
    <div class="kpi"><div class="n">${activeBk}</div><div class="l">Active bookings</div></div>
  </div>
  <div class="panel"><div class="panel-h"><h3>Companion capacity</h3><span class="muted" style="font-size:.82rem">${upcoming} visits scheduled</span></div>
    <div class="panel-b"><table><thead><tr><th>Companion</th><th>Load</th><th>Utilisation</th><th>Headroom</th></tr></thead><tbody>${loadRows}</tbody></table></div>
  </div>
  <div class="panel"><div class="panel-h"><h3>The one number that matters</h3></div>
    <div class="panel-b" style="padding:20px"><p class="muted" style="margin:0 0 6px">Breakthrough = one companion's week full of repeat clients at £30+/hr with margin left. Track it here as you grow.</p>
    <div class="score"><div class="ring" style="--p:25"><b>25%</b></div><div><b>Pilot underway</b><div class="sub2">1 active booking at £32/hr · target: fill Linda's week first</div></div></div></div>
  </div>`;
}

function viewCompanions(){
  const rows=DB.companions.map(c=>{
    const used=DB.bookings.filter(b=>b.companion_id===c.id&&b.status==='active').length;
    return `<tr class="row" data-comp="${c.id}">
      <td><div class="name">${c.full_name}</div><div class="sub2">${c.city} · ${c.postcode}</div></td>
      <td><span class="chip ${statusChip(c.status)}">${cap(c.status)}</span></td>
      <td><span class="chip ${dbsChip(c.dbs)}">DBS ${c.dbs}</span></td>
      <td><span class="dot ${c.offers}"></span> ${cap(c.offers)}</td>
      <td>${c.status==='active'?`${used}/${c.max_clients}`:'—'}</td>
      <td>£${c.hourly_pay.toFixed(2)}</td>
    </tr>`;}).join('');
  return head('Supply','Companions','Your roster. Solve supply before demand — fill the gate of 5–8 great people before scaling marketing.')+`
  <div class="panel"><div class="panel-h"><h3>Roster (${DB.companions.length})</h3><button class="btn sm primary" onclick="alert('In live mode this opens the new-companion form.')">+ Add companion</button></div>
  <div class="panel-b"><table><thead><tr><th>Name</th><th>Status</th><th>Vetting</th><th>Offers</th><th>Clients</th><th>Pay/hr</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function viewRequesters(){
  const blocks=DB.requesters.map(r=>{
    const users=DB.service_users.filter(u=>u.requester_id===r.id);
    const userCards=users.map(u=>`
      <div class="tree-user row" data-user="${u.id}">
        <div class="av">${initials(u.full_name)}</div>
        <div style="flex:1">
          <div class="name">${u.full_name} <span class="sub2">· ${u.relationship.replace('_',' ')}'s ${r.full_name.split(' ')[0]==='Sarah'?'parent':'relative'}</span></div>
          <div class="sub2">${u.city} · ${u.postcode}</div>
          <div class="tags" style="margin-top:6px">${u.interests.map(i=>`<span class="tag">${i}</span>`).join('')}</div>
        </div>
        <button class="btn sm" onclick="event.stopPropagation();openMatches('${u.id}')">Find matches</button>
      </div>`).join('');
    return `<div class="panel"><div class="tree-req">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div class="name" style="font-size:1.05rem">${r.full_name} <span class="chip ${statusChip(r.status)}">${cap(r.status)}</span></div>
        <div class="sub2">${r.email} · ${r.phone} · via ${r.source}</div></div>
      </div>
      ${r.matcher_notes?`<div class="sub2" style="margin-top:8px;background:var(--mist);border:1px solid var(--line);border-radius:9px;padding:9px 12px"><b>Matcher:</b> ${r.matcher_notes}</div>`:''}
      <div class="section-t">Service users (${users.length})</div>
      <div class="tree-users">${userCards}</div>
    </div></div>`;
  }).join('');
  return head('Demand','Requesters & Service Users','The buyer and the person who receives visits are usually different people. The requester arranges and pays; the service user gets the company.')+blocks;
}

function viewBookings(){
  const rows=DB.bookings.map(b=>{
    const u=DB.service_users.find(x=>x.id===b.service_user_id);
    const r=DB.requesters.find(x=>x.id===b.requester_id);
    const c=DB.companions.find(x=>x.id===b.companion_id);
    return `<tr class="row" data-booking="${b.id}">
      <td><div class="name">${u.full_name}</div><div class="sub2">for ${r.full_name}</div></td>
      <td><span class="dot ${b.service}"></span> ${cap(b.service)}</td>
      <td>${cap(b.frequency)}</td>
      <td>${c?c.full_name:'<span class="chip warn">unassigned</span>'}</td>
      <td>£${b.hourly_rate.toFixed(0)}/hr</td>
      <td><span class="chip ${statusChip(b.status)}">${cap(b.status)}</span></td>
    </tr>`;}).join('');
  return head('Arrangements','Bookings','An ongoing arrangement: which user, what service, how often, who pays, and which companion delivers it.')+`
  <div class="panel"><div class="panel-h"><h3>Bookings (${DB.bookings.length})</h3></div>
  <div class="panel-b"><table><thead><tr><th>Service user</th><th>Service</th><th>Frequency</th><th>Companion</th><th>Rate</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function viewVisits(){
  const rows=DB.visits.map(v=>{
    const b=DB.bookings.find(x=>x.id===v.booking_id);
    const u=DB.service_users.find(x=>x.id===b.service_user_id);
    const c=DB.companions.find(x=>x.id===v.companion_id);
    const note=DB.visit_notes.find(n=>n.visit_id===v.id);
    return `<tr><td><div class="name">${u.full_name}</div><div class="sub2">${c?c.full_name:''}</div></td>
      <td>${fmt(v.scheduled_at)}<div class="sub2">${new Date(v.scheduled_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · ${v.length_hrs}h</div></td>
      <td><span class="chip ${statusChip(v.status)}">${cap(v.status)}</span></td>
      <td>${note?'<span class="chip good">note shared</span>':(v.status==='completed'?'<span class="chip warn">note due</span>':'—')}</td></tr>`;
  }).join('');
  const notes=DB.visit_notes.map(n=>{
    const v=DB.visits.find(x=>x.id===n.visit_id);const b=DB.bookings.find(x=>x.id===v.booking_id);
    const u=DB.service_users.find(x=>x.id===b.service_user_id);const c=DB.companions.find(x=>x.id===n.companion_id);
    return `<div class="note-card"><div class="meta"><b>${u.full_name}</b> · ${c.full_name} · ${fmt(n.created_at)} ${n.shared_with_family?'· <span style="color:var(--good)">shared with family</span>':''}</div>${n.summary}</div>`;
  }).join('');
  return head('Delivery','Visits & Notes','Every visit ends with a warm note to the family — the promise that keeps requesters reassured.')+`
  <div class="panel"><div class="panel-h"><h3>Visits</h3></div><div class="panel-b"><table><thead><tr><th>Service user</th><th>When</th><th>Status</th><th>Note to family</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="panel"><div class="panel-h"><h3>Recent notes to family</h3></div><div class="panel-b" style="padding:16px 20px">${notes||'<div class="empty">No notes yet.</div>'}</div></div>`;
}

/* ---------- DRAWERS ---------- */
function openDrawer(html){$('#drawerContent').innerHTML=html;$('#drawer').classList.add('open');$('#drawerBg').classList.add('open');}
function closeDrawer(){$('#drawer').classList.remove('open');$('#drawerBg').classList.remove('open');}

function openCompanion(id){
  const c=DB.companions.find(x=>x.id===id);
  const used=DB.bookings.filter(b=>b.companion_id===c.id&&b.status==='active').length;
  openDrawer(`<div class="drawer-h"><div><h2>${c.full_name}</h2><div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">${c.city} · ${c.postcode}</div></div><button class="x" onclick="closeDrawer()">×</button></div>
  <div class="drawer-b">
    <p>${c.bio}</p>
    <div class="section-t">Status & vetting</div>
    <div class="field-row"><span class="k">Status</span><span class="v"><span class="chip ${statusChip(c.status)}">${cap(c.status)}</span></span></div>
    <div class="field-row"><span class="k">DBS</span><span class="v"><span class="chip ${dbsChip(c.dbs)}">${c.dbs}</span></span></div>
    <div class="field-row"><span class="k">Offers</span><span class="v"><span class="dot ${c.offers}"></span> ${cap(c.offers)}</span></div>
    <div class="field-row"><span class="k">Has car</span><span class="v">${c.has_car?'Yes':'No'}</span></div>
    <div class="section-t">Capacity & pay</div>
    <div class="field-row"><span class="k">Clients</span><span class="v">${used} / ${c.max_clients}</span></div>
    <div class="field-row"><span class="k">Pay rate</span><span class="v">£${c.hourly_pay.toFixed(2)}/hr</span></div>
    <div class="section-t">Personality & interests</div>
    <div class="field-row"><span class="k">Temperament</span><span class="v">${cap(c.temperament)}</span></div>
    <div class="tags" style="margin-top:10px">${c.interests.map(i=>`<span class="tag">${i}</span>`).join('')}</div>
  </div>`);
}
function openUser(id){
  const u=DB.service_users.find(x=>x.id===id);const r=DB.requesters.find(x=>x.id===u.requester_id);
  openDrawer(`<div class="drawer-h"><div><h2>${u.full_name}</h2><div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">Service user · arranged by ${r.full_name}</div></div><button class="x" onclick="closeDrawer()">×</button></div>
  <div class="drawer-b">
    <div class="section-t">About</div>
    <div class="field-row"><span class="k">Lives in</span><span class="v">${u.city} · ${u.postcode}</span></div>
    <div class="field-row"><span class="k">Temperament</span><span class="v">${cap(u.temperament)}</span></div>
    <p style="margin-top:12px">${u.notes||''}</p>
    ${u.mobility_notes?`<p class="muted" style="font-size:.88rem">Mobility: ${u.mobility_notes}</p>`:''}
    <div class="tags" style="margin-top:10px">${(u.interests||[]).map(i=>`<span class="tag">${i}</span>`).join('')}</div>
    <div class="section-t">Suggested companions</div>
    <div id="matchList"><div class="empty">Finding matches…</div></div>
  </div>`);
  fillMatchList(id);
}
async function fillMatchList(userId){
  let ms=null;
  if(typeof api!=='undefined' && api.live){ ms=await api.suggestMatches(DB,userId,4); }
  if(!ms) ms=suggestMatches(userId,4);   // local fallback
  const box=$('#matchList'); if(!box) return;
  if(!ms.length){ box.innerHTML='<div class="empty">No active companions to match yet.</div>'; return; }
  box.innerHTML=ms.map(m=>`<div class="matchrow">
    <div class="ring" style="--p:${m.score}"><b>${m.score}</b></div>
    <div class="body"><div class="name">${m.companion.full_name}</div>
      <div class="reasons">${(m.reasons||[]).slice(0,3).join(' · ')}</div></div>
    <button class="btn sm primary" onclick="introduce('${userId}','${m.companion.id}','${m.companion.full_name.replace(/'/g,"")}')">Introduce</button>
  </div>`).join('');
}
async function introduce(userId,compId,name){
  if(typeof api!=='undefined'){ try{ await api.introduceMatch(DB,userId,compId); }catch(e){} }
  alert((api&&api.live?'Introduced ':'Demo: would introduce ')+name.split(' ')[0]+' to this family.');
}
function openMatches(userId){openUser(userId);}

/* ---------- bind row clicks ---------- */
function bindRows(){
  document.querySelectorAll('[data-comp]').forEach(r=>r.onclick=()=>openCompanion(r.dataset.comp));
  document.querySelectorAll('[data-user]').forEach(r=>r.onclick=()=>openUser(r.dataset.user));
}

/* ---------- LOGIN SCREEN (live mode) ---------- */
function showLogin(errMsg){
  document.body.innerHTML = `
  <div style="min-height:100vh;display:grid;place-items:center;background:var(--aubergine-dark)">
    <form id="loginForm" style="background:var(--offwhite);border-radius:16px;padding:36px 34px;width:min(380px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="width:34px;height:34px;border-radius:50%;background:var(--wheat);display:grid;place-items:center;color:var(--aubergine-dark);font-weight:800">∞</span>
        <b style="font-family:var(--serif);font-size:1.4rem;color:var(--aubergine-dark)">Companio</b>
      </div>
      <p style="color:var(--muted);margin:0 0 22px;font-size:.9rem">Operations · sign in to continue</p>
      ${errMsg?`<div style="background:rgba(179,64,58,.1);color:var(--bad);border:1px solid rgba(179,64,58,.3);border-radius:9px;padding:10px 13px;font-size:.85rem;font-weight:700;margin-bottom:14px">${errMsg}</div>`:''}
      <label style="font-weight:700;font-size:.85rem">Email</label>
      <input id="li_email" type="email" required autocomplete="username" style="width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;margin:5px 0 14px;font:inherit">
      <label style="font-weight:700;font-size:.85rem">Password</label>
      <input id="li_pass" type="password" required autocomplete="current-password" style="width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;margin:5px 0 20px;font:inherit">
      <button class="btn primary" style="width:100%;padding:12px" type="submit">Sign in</button>
    </form>
  </div>`;
  $('#loginForm').onsubmit = async (e)=>{
    e.preventDefault();
    const btn=$('#loginForm button'); btn.textContent='Signing in…'; btn.disabled=true;
    try{
      await auth.login($('#li_email').value.trim(), $('#li_pass').value);
      const staff = await auth.verifyStaff();
      if(!staff){ auth.logout(); return; }
      location.reload();
    }catch(err){ showLogin(err.message||'Login failed'); }
  };
}

/* ---------- BOOT ---------- */
async function boot(){
  if (typeof IS_LIVE !== 'undefined' && IS_LIVE) {
    // live mode: require a staff session
    if (!auth.restore()) { showLogin(); return; }
    let staff;
    try { staff = await auth.verifyStaff(); }
    catch(e){ auth.logout(); return; }
    if (!staff) { showLogin('That account is not a Companio operator.'); return; }
    try {
      $('#view').innerHTML = '<div class="empty">Loading your data…</div>';
      await loadAll(DB);
    } catch(e){
      $('#view').innerHTML = '<div class="empty">Could not load data: '+e.message+'</div>'; return;
    }
    // reflect mode + who's signed in
    const m=$('#modeNote'); if(m) m.innerHTML = 'Mode: <b>Live</b><br><span class="muted" style="color:rgba(244,240,234,.5)">'+staff.full_name+' · <a href="#" onclick="auth.logout();return false" style="color:var(--wheat)">sign out</a></span>';
  }
  renderNav(); render();
}
boot();
