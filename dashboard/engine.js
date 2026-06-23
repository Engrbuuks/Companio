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
  visit_pay: [
    {id:'vp1',visit_id:'v1',companion_id:'c1',hours:2,rate:14,amount:28,status:'accrued'},
  ],
  payouts: [],
  features: {stripe:'off', reminders:'off', documents:'on', reporting:'on', ai:'off'},
  documents: [
    {id:'d1',kind:'dbs',companion_id:'c1',label:'DBS certificate',expires_on:'2029-03-01'},
  ],
  invoices: [
    {id:'i1',requester_id:'r1',number:'CMP-2026-0001',status:'sent',total:64,amount_paid:0,period_start:'2026-06-01',period_end:'2026-06-30',due_date:'2026-07-14'},
  ],
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
  {id:'pipeline',ico:'⇢',label:'Recruiting'},
  {id:'companions',ico:'❋',label:'Companions'},
  {id:'requesters',ico:'❑',label:'Requesters & Users'},
  {id:'schedule',ico:'▦',label:'Schedule'},
  {id:'bookings',ico:'✦',label:'Bookings'},
  {id:'visits',ico:'✓',label:'Visits & Notes'},
  {id:'finance',ico:'£',label:'Finance'},
  {id:'reports',ico:'▲',label:'Reports'},
  {id:'settings',ico:'⚙',label:'Settings'},
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
/* ---------- EDITABLE TEXT LAYER ----------
   Headings, tab descriptions and brand copy can be edited live and saved.
   Overrides are keyed (e.g. 'overview.title') and stored in app_settings as
   'text.<key>' in live mode, or in TEXT_OVERRIDES in demo. Buttons, data and
   structural labels are deliberately NOT editable, to keep the tool safe.    */
let EDIT_MODE=false;
let TEXT_OVERRIDES={};   // key -> custom text
function txt(key, fallback){
  return (TEXT_OVERRIDES[key]!=null && TEXT_OVERRIDES[key]!=='') ? TEXT_OVERRIDES[key] : fallback;
}
function editable(key, fallback, tag){
  const val = txt(key, fallback);
  if(!EDIT_MODE) return val;
  // contenteditable span that saves on blur
  return `<${tag||'span'} class="ed" contenteditable="true" data-key="${key}" data-fallback="${encodeURIComponent(fallback)}"
    onblur="saveText(this)" onkeydown="if(event.key==='Enter'&&'${tag||'span'}'!=='div'){event.preventDefault();this.blur();}">${val}</${tag||'span'}>`;
}
async function saveText(node){
  const key=node.dataset.key;
  const fallback=decodeURIComponent(node.dataset.fallback||'');
  const newVal=node.innerText.trim();
  if(newVal===txt(key,fallback)) return;           // unchanged
  if(newVal===fallback || newVal===''){ delete TEXT_OVERRIDES[key]; }
  else { TEXT_OVERRIDES[key]=newVal; }
  if(typeof api!=='undefined' && api.live){
    try{ await supa.rpc('set_text',{p_key:key, p_value:(newVal===fallback?'':newVal)}); }
    catch(e){ /* non-fatal: keep local */ }
  }
}
async function loadTextOverrides(){
  if(typeof api!=='undefined' && api.live){
    try{
      const rows=await supa.select('app_settings',`select=key,value&key=like.text.*`);
      (rows||[]).forEach(r=>{ TEXT_OVERRIDES[r.key.replace(/^text\./,'')]=r.value; });
    }catch(e){}
  }
}
function toggleEditMode(){
  EDIT_MODE=!EDIT_MODE;
  document.body.classList.toggle('editing',EDIT_MODE);
  // floating indicator (no visible button — edit mode is operator-only via shortcut)
  let pill=document.getElementById('editPill');
  if(EDIT_MODE){
    if(!pill){
      pill=document.createElement('div'); pill.id='editPill';
      pill.style.cssText='position:fixed;bottom:18px;right:18px;z-index:9999;background:var(--wheat);color:var(--aubergine-dark);font-weight:800;font-size:.82rem;padding:9px 14px;border-radius:99px;box-shadow:0 6px 20px rgba(0,0,0,.2);cursor:pointer';
      pill.textContent='✏️ Editing — press Esc or click here to finish';
      pill.onclick=toggleEditMode;
      document.body.appendChild(pill);
    }
  } else if(pill){ pill.remove(); }
  render();
}
// Secret operator shortcut to toggle editing: Ctrl+Shift+E (Esc exits)
document.addEventListener('keydown',function(e){
  if(e.ctrlKey && e.shiftKey && (e.key==='E'||e.key==='e')){ e.preventDefault(); toggleEditMode(); }
  else if(e.key==='Escape' && EDIT_MODE){ toggleEditMode(); }
});

function head(eyebrow,title,sub,key){
  key = key || (title||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return `<div class="head"><div>
    <div class="eyebrow">${editable(key+'.eyebrow',eyebrow)}</div>
    <h1>${editable(key+'.title',title)}</h1>
    ${sub?`<p>${editable(key+'.sub',sub,'div')}</p>`:''}
  </div></div>`;
}
/* chart lifecycle — destroy any live charts before re-rendering, redraw after */
let CHARTS=[];
function killCharts(){ CHARTS.forEach(c=>{try{c.destroy();}catch(e){}}); CHARTS=[]; }
const CHART_PENDING=[];
function queueChart(fn){ CHART_PENDING.push(fn); }
function drawCharts(){
  if(typeof Chart==='undefined'){ CHART_PENDING.length=0; return; }
  Chart.defaults.font.family='Mulish, system-ui, sans-serif';
  Chart.defaults.color='#7A7488';
  CHART_PENDING.forEach(fn=>{ try{ const c=fn(); if(c) CHARTS.push(c);}catch(e){console.warn('chart',e);} });
  CHART_PENDING.length=0;
}
function render(){
  killCharts();
  const v=$('#view');
  if(current==='overview') v.innerHTML=viewOverview();
  else if(current==='pipeline') v.innerHTML=viewPipeline();
  else if(current==='schedule') v.innerHTML=viewSchedule();
  else if(current==='companions') v.innerHTML=viewCompanions();
  else if(current==='requesters') v.innerHTML=viewRequesters();
  else if(current==='bookings') v.innerHTML=viewBookings();
  else if(current==='visits') v.innerHTML=viewVisits();
  else if(current==='finance') v.innerHTML=viewFinance();
  else if(current==='reports') v.innerHTML=viewReports();
  else if(current==='settings') v.innerHTML=viewSettings();
  bindRows();
  drawCharts();
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
  const out = head('Operations','Good morning, BRAVO','One catchment · Guildford & Woking. The engine tracks supply, families, bookings and visits in one place.')+
  actionPanel()+`
  <div class="kpis">
    <div class="kpi"><div class="n">${active}</div><div class="l">Active companions</div></div>
    <div class="kpi accent"><div class="n">${vetting}</div><div class="l">In vetting</div></div>
    <div class="kpi"><div class="n">${users}</div><div class="l">Service users</div></div>
    <div class="kpi"><div class="n">${activeBk}</div><div class="l">Active bookings</div></div>
  </div>
  <div class="panel"><div class="panel-h"><h3>Companion capacity</h3><span class="muted" style="font-size:.82rem">${upcoming} visits scheduled</span></div>
    <div class="panel-b" style="padding:16px 20px"><div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">
      <div style="width:190px;height:190px;flex:0 0 auto"><canvas id="capChart"></canvas></div>
      <div style="flex:1;min-width:300px"><table style="width:100%"><thead><tr><th>Companion</th><th>Load</th><th>Utilisation</th><th>Headroom</th></tr></thead><tbody>${loadRows}</tbody></table></div>
    </div></div>
  </div>
  <div class="panel"><div class="panel-h"><h3>The one number that matters</h3></div>
    <div class="panel-b" style="padding:20px"><p class="muted" style="margin:0 0 6px">Breakthrough = one companion's week full of repeat clients at £30+/hr with margin left. Track it here as you grow.</p>
    <div class="score"><div class="ring" style="--p:25"><b>25%</b></div><div><b>Pilot underway</b><div class="sub2">1 active booking at £32/hr · target: fill Linda's week first</div></div></div></div>
  </div>`;
  // capacity doughnut
  const acomps=DB.companions.filter(c=>c.status==='active');
  const usedSlots=acomps.reduce((s,c)=>s+DB.bookings.filter(b=>b.companion_id===c.id&&b.status==='active').length,0);
  const capTotal=acomps.reduce((s,c)=>s+(c.max_clients||8),0);
  queueChart(()=>{const el=document.getElementById('capChart');if(!el)return;
    return new Chart(el,{type:'doughnut',data:{labels:['Filled','Free'],
      datasets:[{data:[usedSlots,Math.max(0,capTotal-usedSlots)],backgroundColor:['#E7B86A','#E2DBD0'],borderWidth:0}]},
      options:{cutout:'66%',plugins:{legend:{position:'bottom',labels:{padding:12,boxWidth:12,font:{size:12}}},
        title:{display:true,text:`${usedSlots} of ${capTotal} slots filled`,color:'#322E3D',font:{size:13,weight:'700'}}},animation:{duration:600}}});});
  return out;
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
    const action = v.status==='scheduled'
      ? `<button class="btn sm primary" onclick="completeVisit('${v.id}')">Mark visit happened</button>`
      : v.status==='completed'
        ? '<span class="chip good">completed</span>'
        : `<span class="chip">${cap(v.status)}</span>`;
    return `<tr><td><div class="name">${u.full_name}</div><div class="sub2">${c?c.full_name:''}</div></td>
      <td>${fmt(v.scheduled_at)}<div class="sub2">${new Date(v.scheduled_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · ${v.length_hrs}h</div></td>
      <td>${action}</td>
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

/* ---------- AI ASSIST (UI layer; dormant unless feature.ai on + configured) ---------- */
function aiEnabled(){ return DB.features && DB.features.ai==='on'; }
async function aiDraftNote(visitId, userName){
  const ta=$('#noteText'); if(!ta) return;
  const rough=ta.value.trim();
  if(!rough){ ta.placeholder='Jot a few rough words first, then let AI shape them…'; ta.focus(); return; }
  const btn=$('#aiDraftBtn'); if(btn){btn.textContent='Drafting…';btn.disabled=true;}
  if(typeof aiAssist==='undefined' || !(typeof api!=='undefined'&&api.live)){
    // demo: show a representative polished draft so you can see the feature
    ta.value=`We had a lovely visit today. ${rough.charAt(0).toUpperCase()+rough.slice(1)}. ${userName.split(' ')[0]} was in good spirits and we had plenty to talk about — I'll look forward to next time.`;
    if(btn){btn.textContent='✨ AI draft';btn.disabled=false;}
    return;
  }
  const out=await aiAssist('note_draft',{user_name:userName,rough});
  if(out.error){ alert(out.error==='AI not configured'?'AI isn’t set up yet — turn it on in Settings and add your API key.':'AI error: '+out.error); }
  else if(out.result){ ta.value=out.result; }
  if(btn){btn.textContent='✨ AI draft';btn.disabled=false;}
}


async function completeVisit(visitId){
  const v=DB.visits.find(x=>x.id===visitId); if(!v) return;
  if(typeof api!=='undefined' && api.live){
    try{ await supa.rpc('complete_visit',{p_visit:visitId});
      // refresh from server so accruals/notes reflect
      await loadAll(DB);
    }catch(e){ alert('Could not complete visit: '+e.message); return; }
  } else {
    // demo: mirror complete_visit() — mark done + accrue companion pay
    v.status='completed';
    const c=DB.companions.find(x=>x.id===v.companion_id);
    const rate=c?(c.hourly_pay||14):14;
    if(!DB.visit_pay.some(p=>p.visit_id===visitId)){
      DB.visit_pay.push({id:'vp'+Date.now(),visit_id:visitId,companion_id:v.companion_id,hours:v.length_hrs,rate,amount:+(v.length_hrs*rate).toFixed(2),status:'accrued'});
    }
  }
  render();
}

/* ---------- FINANCE ---------- */
function financeNumbers(){
  const invoiced=DB.invoices.filter(i=>i.status!=='void').reduce((s,i)=>s+ +i.total,0);
  const collected=DB.invoices.filter(i=>i.status!=='void').reduce((s,i)=>s+ +i.amount_paid,0);
  const outstanding=invoiced-collected;
  const accrued=DB.visit_pay.reduce((s,p)=>s+ +p.amount,0);
  const paidOut=DB.visit_pay.filter(p=>p.status==='paid').reduce((s,p)=>s+ +p.amount,0);
  const pendingOut=DB.visit_pay.filter(p=>p.status==='accrued').reduce((s,p)=>s+ +p.amount,0);
  const margin=invoiced-accrued;
  const marginPct=invoiced>0?Math.round(margin/invoiced*1000)/10:0;
  return {invoiced,collected,outstanding,accrued,paidOut,pendingOut,margin,marginPct};
}
function money(n){return '£'+Number(n||0).toFixed(2);}
function viewFinance(){
  const f=financeNumbers();
  // per-companion earnings
  const earn=DB.companions.map(c=>{
    const rows=DB.visit_pay.filter(p=>p.companion_id===c.id);
    const pending=rows.filter(p=>p.status==='accrued').reduce((s,p)=>s+ +p.amount,0);
    const paid=rows.filter(p=>p.status==='paid').reduce((s,p)=>s+ +p.amount,0);
    return {name:c.full_name,pending,paid,lifetime:pending+paid};
  }).filter(e=>e.lifetime>0);
  const earnRows=earn.length?earn.map(e=>`<tr><td class="name">${e.name}</td>
    <td>${money(e.pending)}</td><td>${money(e.paid)}</td><td><b>${money(e.lifetime)}</b></td>
    <td>${e.pending>0?`<button class="btn sm primary" onclick="runPayout('${e.name.replace(/'/g,'')}')">Pay ${money(e.pending)}</button>`:'<span class="chip good">settled</span>'}</td></tr>`).join('')
    :'<tr><td colspan="5"><div class="empty">No earnings yet — complete some visits.</div></td></tr>';

  const out = head('Money','Finance','Revenue in, companion cost out, and the margin between — the one number that matters, from live data.')+`
  <div class="kpis">
    <div class="kpi"><div class="n">${money(f.invoiced)}</div><div class="l">Invoiced (revenue)</div></div>
    <div class="kpi"><div class="n">${money(f.collected)}</div><div class="l">Collected</div></div>
    <div class="kpi"><div class="n">${money(f.accrued)}</div><div class="l">Companion cost</div></div>
    <div class="kpi accent"><div class="n">${money(f.margin)}</div><div class="l">Gross margin · ${f.marginPct}%</div></div>
  </div>
  <div class="panel"><div class="panel-h"><h3>Money flow</h3><span class="muted" style="font-size:.82rem">hover for detail</span></div>
    <div class="panel-b" style="padding:18px 20px"><div style="height:230px"><canvas id="moneyChart"></canvas></div>
      <p class="muted" style="margin:14px 0 0;font-size:.85rem">Outstanding from families: <b>${money(f.outstanding)}</b> · Pending to companions: <b>${money(f.pendingOut)}</b></p>
    </div></div>
  <div class="panel"><div class="panel-h"><h3>Companion earnings & payouts</h3></div>
    <div class="panel-b"><table><thead><tr><th>Companion</th><th>Pending</th><th>Paid</th><th>Lifetime</th><th>Payout</th></tr></thead><tbody>${earnRows}</tbody></table></div></div>
  <div class="panel"><div class="panel-h"><h3>Invoices to families</h3></div>
    <div class="panel-b"><table><thead><tr><th>Invoice</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>
    ${DB.invoices.map(i=>`<tr><td class="name">${i.number||'—'}</td><td>${money(i.total)}</td><td>${money(i.amount_paid)}</td><td><span class="chip ${i.status==='paid'?'good':i.status==='void'?'':'warn'}">${cap(i.status)}</span></td></tr>`).join('')||'<tr><td colspan="4"><div class="empty">No invoices yet.</div></td></tr>'}
    </tbody></table></div></div>`;
  queueChart(()=>{const el=document.getElementById('moneyChart');if(!el)return;
    return new Chart(el,{type:'bar',data:{
      labels:['Invoiced','Collected','Companion cost','Gross margin'],
      datasets:[{data:[f.invoiced,f.collected,f.accrued,f.margin],
        backgroundColor:['#4A4458','#9B8AA8','#C8943B','#E7B86A'],borderRadius:6,maxBarThickness:80}]},
      options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw)}}},
        scales:{y:{beginAtZero:true,ticks:{callback:v=>'£'+v}},x:{grid:{display:false}}},animation:{duration:700}}});});
  return out;
}
async function runPayout(name){
  const c=DB.companions.find(x=>x.full_name===name); if(!c) return;
  if(typeof api!=='undefined' && api.live){
    try{ const po=await supa.rpc('run_payout',{p_companion:c.id});
      // mark paid immediately for the demo flow; in production you'd confirm bank transfer first
      await loadAll(DB);
    }catch(e){ alert('Payout failed: '+e.message); return; }
  } else {
    DB.visit_pay.filter(p=>p.companion_id===c.id&&p.status==='accrued').forEach(p=>p.status='paid');
  }
  render();
}

/* ---------- ACTION ITEMS (what needs attention) ---------- */
function computeActions(){
  const items=[];
  // notes due
  DB.visits.filter(v=>v.status==='completed' && !DB.visit_notes.some(n=>n.visit_id===v.id)).forEach(v=>{
    const b=DB.bookings.find(x=>x.id===v.booking_id); const u=b&&DB.service_users.find(x=>x.id===b.service_user_id);
    items.push({kind:'note_due',sev:'high',label:`${u?u.full_name:'A visit'} — note to family due`,ref:v.id});
  });
  // overdue invoices
  DB.invoices.filter(i=>['sent','overdue'].includes(i.status) && i.due_date && new Date(i.due_date)<new Date() && (i.total-i.amount_paid)>0).forEach(i=>{
    items.push({kind:'invoice_overdue',sev:'high',label:`${i.number} overdue · ${money(i.total-i.amount_paid)} due`,ref:i.id});
  });
  // vetting in progress
  DB.companions.filter(c=>['applicant','vetting'].includes(c.status)).forEach(c=>{
    items.push({kind:'vetting',sev:'medium',label:`${c.full_name} in vetting (DBS: ${c.dbs})`,ref:c.id});
  });
  // unassigned active bookings
  DB.bookings.filter(b=>b.status==='active'&&!b.companion_id).forEach(b=>{
    const u=DB.service_users.find(x=>x.id===b.service_user_id);
    items.push({kind:'unassigned',sev:'high',label:`${u?u.full_name:'A booking'} has no companion assigned`,ref:b.id});
  });
  const order={high:1,medium:2,low:3};
  return items.sort((a,b)=>order[a.sev]-order[b.sev]);
}
function actionPanel(){
  const items=computeActions();
  if(!items.length) return `<div class="panel" style="border-color:rgba(46,125,82,.4)"><div class="panel-b" style="padding:16px 20px;color:var(--good);font-weight:700">✓ All clear — nothing needs your attention right now.</div></div>`;
  const dot=s=>s==='high'?'var(--bad)':s==='medium'?'var(--wheat-deep)':'var(--muted)';
  return `<div class="panel"><div class="panel-h"><h3>Needs attention</h3><span class="chip ${items.some(i=>i.sev==='high')?'bad':'warn'}">${items.length}</span></div>
  <div class="panel-b">${items.map(i=>`<div class="row" style="display:flex;align-items:center;gap:12px;padding:11px 20px;border-bottom:1px solid var(--line)">
    <span class="dot" style="background:${dot(i.sev)};width:9px;height:9px"></span>
    <span style="flex:1">${i.label}</span>
    ${i.kind==='note_due'?`<button class="btn sm" onclick="current='visits';renderNav();render()">Write note</button>`:''}
    ${i.kind==='vetting'?`<button class="btn sm" onclick="current='pipeline';renderNav();render()">Open pipeline</button>`:''}
  </div>`).join('')}</div></div>`;
}

/* ---------- RECRUITING PIPELINE ---------- */
function viewPipeline(){
  const stages=[
    {key:'applicant',label:'Applied',hint:'New applications'},
    {key:'vetting',label:'Vetting',hint:'DBS + references'},
    {key:'active',label:'Active',hint:'Ready to work'},
    {key:'paused',label:'Paused',hint:'On hold'},
  ];
  const cols=stages.map(st=>{
    const people=DB.companions.filter(c=>c.status===st.key);
    return `<div style="flex:1;min-width:200px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><div style="font-weight:800;color:var(--aubergine-dark)">${st.label}</div><div class="sub2">${st.hint}</div></div>
        <span class="chip wheat">${people.length}</span></div>
      ${people.map(c=>`<div class="ip-card" style="padding:14px;margin-bottom:10px;cursor:pointer" onclick="openCompanion('${c.id}')">
        <div class="name">${c.full_name}</div><div class="sub2">${c.city||''}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="chip ${dbsChip(c.dbs)}">DBS ${c.dbs}</span>
          ${c.references_ok?'<span class="chip good">refs ✓</span>':'<span class="chip warn">refs pending</span>'}
        </div>
        ${st.key!=='active'?`<div style="margin-top:10px;display:flex;gap:6px">${nextStageBtn(c,st.key)}</div>`:''}
      </div>`).join('')||`<div class="empty" style="padding:18px;font-size:.85rem">None</div>`}
    </div>`;
  }).join('');
  return head('Supply','Recruiting pipeline','Your funnel from application to active companion. This is the gate the whole business depends on — keep it moving.')+`
  <div class="panel"><div class="panel-b" style="padding:18px 20px"><div style="display:flex;gap:16px;align-items:flex-start;overflow-x:auto">${cols}</div></div></div>`;
}
function nextStageBtn(c,stage){
  const next={applicant:'vetting',vetting:'active',paused:'active'}[stage];
  if(!next) return '';
  const label={vetting:'Move to vetting',active:'Mark active'}[next];
  return `<button class="btn sm primary" onclick="event.stopPropagation();moveStage('${c.id}','${next}')">${label}</button>`;
}
async function moveStage(id,status){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  if(typeof api!=='undefined' && api.live){ try{ await supa.update('companions',id,{status}); }catch(e){ alert(e.message); return; } }
  c.status=status; render();
}

/* ---------- SCHEDULE (week calendar) ---------- */
let schedWeek=0; // offset in weeks from current
function viewSchedule(){
  const now=new Date(); now.setHours(0,0,0,0);
  const monday=new Date(now); monday.setDate(now.getDate()-((now.getDay()+6)%7)+schedWeek*7);
  const days=[...Array(7)].map((_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d;});
  const dayName=d=>d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  const sameDay=(a,b)=>a.toDateString()===new Date(b).toDateString();
  const cols=days.map(d=>{
    const vs=DB.visits.filter(v=>sameDay(d,v.scheduled_at)).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
    const isToday=sameDay(d,new Date());
    return `<div style="flex:1;min-width:150px">
      <div style="font-weight:800;color:${isToday?'var(--wheat-deep)':'var(--aubergine-dark)'};padding:8px;border-bottom:2px solid ${isToday?'var(--wheat)':'var(--line)'};margin-bottom:8px">${dayName(d)}</div>
      ${vs.map(v=>{const b=DB.bookings.find(x=>x.id===v.booking_id);const u=b&&DB.service_users.find(x=>x.id===b.service_user_id);const c=DB.companions.find(x=>x.id===v.companion_id);
        const col=v.status==='completed'?'var(--good)':v.status==='cancelled'||v.status==='no_access'?'var(--muted)':'var(--wheat-deep)';
        return `<div class="ip-card" style="padding:10px 12px;margin-bottom:7px;border-left:3px solid ${col};cursor:pointer" onclick="openVisitOps('${v.id}')">
          <div style="font-weight:800;font-size:.86rem">${new Date(v.scheduled_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
          <div class="sub2">${u?u.full_name:''}</div><div class="sub2" style="color:var(--aubergine)">${c?c.full_name:'unassigned'}</div>
          ${v.status!=='scheduled'?`<span class="chip" style="margin-top:4px;font-size:.66rem">${cap(v.status)}</span>`:''}
        </div>`;}).join('')||'<div class="sub2" style="padding:8px;color:var(--line)">—</div>'}
    </div>`;
  }).join('');
  return head('Operations','Schedule','Who’s where, when. The core operational view for a visit-based business.')+`
  <div class="panel"><div class="panel-h">
    <div style="display:flex;gap:8px;align-items:center"><button class="btn sm" onclick="schedWeek--;render()">← Prev</button>
    <button class="btn sm" onclick="schedWeek=0;render()">This week</button>
    <button class="btn sm" onclick="schedWeek++;render()">Next →</button></div>
    <span class="muted" style="font-size:.85rem">Click a visit to manage it</span></div>
    <div class="panel-b" style="padding:14px;overflow-x:auto"><div style="display:flex;gap:10px">${cols}</div></div></div>`;
}

/* ---------- VISIT OPS (complete / cancel / reschedule / reassign) ---------- */
function openVisitOps(visitId){
  const v=DB.visits.find(x=>x.id===visitId); if(!v) return;
  const b=DB.bookings.find(x=>x.id===v.booking_id); const u=b&&DB.service_users.find(x=>x.id===b.service_user_id);
  const c=DB.companions.find(x=>x.id===v.companion_id);
  const activeComps=DB.companions.filter(x=>x.status==='active');
  openDrawer(`<div class="drawer-h"><div><h2>${u?u.full_name:'Visit'}</h2>
    <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">${fmt(v.scheduled_at)} · ${new Date(v.scheduled_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · ${c?c.full_name:'unassigned'}</div></div>
    <button class="x" onclick="closeDrawer()">×</button></div>
  <div class="drawer-b">
    <div class="field-row"><span class="k">Status</span><span class="v"><span class="chip ${statusChip(v.status)}">${cap(v.status)}</span></span></div>
    ${v.status==='scheduled'?`
    <div class="section-t">Manage this visit</div>
    <button class="btn primary" style="width:100%;margin-bottom:8px" onclick="completeVisit('${v.id}');closeDrawer()">✓ Mark visit happened</button>
    <label style="font-weight:700;font-size:.85rem">Reschedule to</label>
    <input id="reAt" type="datetime-local" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;margin:5px 0 8px">
    <button class="btn" style="width:100%;margin-bottom:14px" onclick="doReschedule('${v.id}')">Reschedule</button>
    <label style="font-weight:700;font-size:.85rem">Reassign to</label>
    <select id="reTo" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;margin:5px 0 8px">
      ${activeComps.map(x=>`<option value="${x.id}" ${x.id===v.companion_id?'selected':''}>${x.full_name}</option>`).join('')}</select>
    <button class="btn" style="width:100%;margin-bottom:14px" onclick="doReassign('${v.id}')">Reassign companion</button>
    <label style="font-weight:700;font-size:.85rem">Cancel reason</label>
    <input id="caRe" type="text" placeholder="e.g. Family away" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;margin:5px 0 8px">
    <button class="btn" style="width:100%;border-color:var(--bad);color:var(--bad)" onclick="doCancel('${v.id}')">Cancel visit</button>
    `:`<p class="muted">This visit is ${cap(v.status).toLowerCase()} — no further action.</p>`}
  </div>`);
}
async function doReschedule(id){
  const at=$('#reAt').value; if(!at){alert('Pick a new date/time');return;}
  const v=DB.visits.find(x=>x.id===id);
  if(typeof api!=='undefined'&&api.live){try{await supa.rpc('reschedule_visit',{p_visit:id,p_new_at:new Date(at).toISOString()});}catch(e){alert(e.message);return;}}
  v.scheduled_at=at; closeDrawer(); render();
}
async function doReassign(id){
  const to=$('#reTo').value; const v=DB.visits.find(x=>x.id===id);
  if(typeof api!=='undefined'&&api.live){try{await supa.rpc('reassign_visit',{p_visit:id,p_new_companion:to});}catch(e){alert(e.message);return;}}
  v.reassigned_from=v.companion_id; v.companion_id=to; closeDrawer(); render();
}
async function doCancel(id){
  const reason=$('#caRe').value; const v=DB.visits.find(x=>x.id===id);
  if(typeof api!=='undefined'&&api.live){try{await supa.rpc('cancel_visit',{p_visit:id,p_reason:reason});}catch(e){alert(e.message);return;}}
  v.status='cancelled'; v.cancel_reason=reason;
  DB.visit_pay.filter(p=>p.visit_id===id&&p.status==='accrued').forEach(p=>p.status='void');
  closeDrawer(); render();
}

/* ---------- REPORTS ---------- */
function viewReports(){
  const months=[]; const now=new Date();
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push(d);}
  const monthLabel=d=>d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
  const revByMonth=m=>DB.invoices.filter(i=>i.status!=='void'&&i.period_end&&new Date(i.period_end).getMonth()===m.getMonth()&&new Date(i.period_end).getFullYear()===m.getFullYear()).reduce((s,i)=>s+ +i.total,0);
  const costByMonth=m=>DB.visit_pay.reduce((s,p)=>{const v=DB.visits.find(x=>x.id===p.visit_id);if(v&&new Date(v.scheduled_at).getMonth()===m.getMonth()&&new Date(v.scheduled_at).getFullYear()===m.getFullYear())return s+ +p.amount;return s;},0);
  const data=months.map(m=>({label:monthLabel(m),rev:revByMonth(m),cost:costByMonth(m)}));
  const util=DB.companions.filter(c=>c.status==='active').map(c=>({name:c.full_name,
    hrs:DB.visits.filter(v=>v.companion_id===c.id&&v.status==='completed').reduce((s,v)=>s+ +v.length_hrs,0)}));

  const out = head('Insight','Reports','Trends over time. These fill out as you complete visits and raise invoices — sparse now, meaningful in a few months.')+`
  <div class="panel"><div class="panel-h"><h3>Revenue, cost & margin by month</h3><span class="muted" style="font-size:.8rem">hover for figures</span></div>
    <div class="panel-b" style="padding:18px 20px"><div style="height:260px"><canvas id="trendChart"></canvas></div></div></div>
  <div class="panel"><div class="panel-h"><h3>Companion utilisation — completed hours (30 days)</h3></div>
    <div class="panel-b" style="padding:18px 20px"><div style="height:${Math.max(160,util.length*46)}px"><canvas id="utilChart"></canvas></div></div></div>
  <p class="muted" style="font-size:.84rem">Retention and cohort reports appear here once you have clients across multiple months.</p>`;

  queueChart(()=>{const el=document.getElementById('trendChart');if(!el)return;
    return new Chart(el,{type:'bar',data:{labels:data.map(d=>d.label),datasets:[
      {label:'Revenue',data:data.map(d=>d.rev),backgroundColor:'#E7B86A',borderRadius:5,order:2},
      {label:'Companion cost',data:data.map(d=>d.cost),backgroundColor:'#4A4458',borderRadius:5,order:2},
      {label:'Margin',type:'line',data:data.map(d=>d.rev-d.cost),borderColor:'#C8943B',backgroundColor:'#C8943B',
        tension:.3,borderWidth:2,pointRadius:3,order:1,fill:false}]},
      options:{plugins:{legend:{position:'bottom',labels:{padding:14,boxWidth:12}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+money(c.raw)}}},
        scales:{y:{beginAtZero:true,ticks:{callback:v=>'£'+v}},x:{grid:{display:false}}},animation:{duration:700}}});});

  queueChart(()=>{const el=document.getElementById('utilChart');if(!el)return;
    return new Chart(el,{type:'bar',data:{labels:util.map(u=>u.name),datasets:[{data:util.map(u=>u.hrs),
      backgroundColor:'#E7B86A',borderRadius:5,maxBarThickness:26}]},
      options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'h completed'}}},
        scales:{x:{beginAtZero:true,ticks:{callback:v=>v+'h'}},y:{grid:{display:false}}},animation:{duration:600}}});});
  return out;
}

/* ---------- SETTINGS (the master control panel) ---------- */
function viewSettings(){
  const F=DB.features;
  const feat=(key,title,desc,reqs)=>{
    const on=F[key]==='on';
    return `<div class="row" style="padding:16px 20px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
      <div style="flex:1"><div class="name">${title} ${on?'<span class="chip good">on</span>':'<span class="chip">off</span>'}</div>
        <div class="sub2" style="margin-top:3px">${desc}</div>
        ${reqs?`<div class="sub2" style="margin-top:6px;color:var(--wheat-deep)">⚑ Before switching on: ${reqs}</div>`:''}</div>
      <button class="btn sm ${on?'':'primary'}" onclick="toggleFeature('${key}')">${on?'Turn off':'Turn on'}</button>
    </div>`;
  };
  return head('Control','Settings','Activate capabilities when you’re ready. Everything below is built and waiting — flip a switch to turn it on.')+`
  <div class="panel"><div class="panel-h"><h3>Features</h3></div><div class="panel-b">
    ${feat('stripe','Card payments (Stripe)','Let families pay invoices online by card, auto-reconciled.','add your Stripe keys + deploy the checkout function')}
    ${feat('reminders','Visit reminders','Automatically email families and companions 24h before each visit.','email (Resend) must be configured')}
    ${feat('documents','Document storage','Attach DBS, ID, references and agreements to companion and client records.','create a “companio-docs” storage bucket in Supabase')}
    ${feat('reporting','Trend reporting','Revenue, cost, utilisation and retention over time.','nothing — fills automatically as data grows')}
    ${feat('ai','AI assist','Draft notes to family, explain matches, prep companions for visits, and triage enquiries — you always review before anything is sent.','deploy the ai-assist function + add your free Gemini API key')}
  </div></div>
  <div class="panel"><div class="panel-h"><h3>Documents on file</h3></div><div class="panel-b">
    ${DB.documents.length?DB.documents.map(d=>{const c=DB.companions.find(x=>x.id===d.companion_id);return `<div class="row" style="padding:12px 20px;display:flex;justify-content:space-between"><span><b>${d.label}</b> <span class="sub2">· ${c?c.full_name:''}</span></span><span class="chip ${d.expires_on&&new Date(d.expires_on)<new Date()?'bad':''}">${d.kind}${d.expires_on?' · exp '+fmt(d.expires_on):''}</span></div>`;}).join(''):'<div class="empty">No documents yet.</div>'}
  </div></div>
  <p class="muted" style="font-size:.84rem">In live mode these switches write to your <code>app_settings</code> table; each feature reads its flag before doing anything, so nothing fires until you’re ready.</p>`;
}
async function toggleFeature(key){
  const cur=DB.features[key]; const next=cur==='on'?'off':'on';
  if(typeof api!=='undefined' && api.live){
    try{ await supa.update('app_settings', null, {value:next}); }catch(e){/* live uses key not id; handled below */}
    try{ await supa.rpc('set_feature',{p_name:key,p_state:next}); }catch(e){}
  }
  DB.features[key]=next; render();
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
  const aiBtn = aiEnabled() ? `<button class="btn sm" id="aiFitBtn" style="margin-bottom:10px" onclick="aiExplainMatches('${userId}')">✨ AI: explain the fit</button>` : '';
  box.innerHTML=aiBtn+ms.map(m=>`<div class="matchrow" data-cid="${m.companion.id}">
    <div class="ring" style="--p:${m.score}"><b>${m.score}</b></div>
    <div class="body"><div class="name">${m.companion.full_name}</div>
      <div class="reasons">${(m.reasons||[]).slice(0,3).join(' · ')}</div>
      <div class="ai-reason" style="font-size:.8rem;color:var(--wheat-deep);margin-top:4px"></div></div>
    <button class="btn sm primary" onclick="introduce('${userId}','${m.companion.id}','${m.companion.full_name.replace(/'/g,"")}')">Introduce</button>
  </div>`).join('');
}
async function aiExplainMatches(userId){
  const btn=$('#aiFitBtn'); if(btn){btn.textContent='Thinking…';btn.disabled=true;}
  const u=DB.service_users.find(x=>x.id===userId);
  const cands=DB.companions.filter(c=>c.status==='active').map(c=>({companion_id:c.id,full_name:c.full_name,interests:c.interests,temperament:c.temperament,offers:c.offers,bio:c.bio}));
  let parsed=null;
  if(typeof aiAssist!=='undefined' && typeof api!=='undefined' && api.live){
    const out=await aiAssist('match_explain',{user:{full_name:u.full_name,interests:u.interests,temperament:u.temperament,notes:u.notes},candidates:cands});
    if(out.error){ alert('AI error: '+out.error); if(btn){btn.textContent='✨ AI: explain the fit';btn.disabled=false;} return; }
    try{ parsed=JSON.parse(out.result); }catch(e){}
  }
  if(!parsed){
    // demo: representative reasoning
    parsed=cands.map(c=>{const shared=(u.interests||[]).filter(i=>(c.interests||[]).includes(i));
      return {companion_id:c.companion_id,fit:shared.length>=3?'strong':shared.length>=1?'good':'weak',
        reason:shared.length?`Natural common ground — both enjoy ${shared.slice(0,2).join(' and ')}, and ${c.temperament} suits ${u.full_name.split(' ')[0]}.`:`Less overlap in interests, though ${c.temperament} company could still work.`};});
  }
  parsed.forEach(p=>{const row=document.querySelector(`.matchrow[data-cid="${p.companion_id}"] .ai-reason`);
    if(row) row.textContent='✨ '+(p.fit?p.fit.toUpperCase()+' — ':'')+p.reason;});
  if(btn){btn.textContent='✨ AI: explain the fit';btn.disabled=false;}
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
      await loadTextOverrides();
    } catch(e){
      $('#view').innerHTML = '<div class="empty">Could not load data: '+e.message+'</div>'; return;
    }
    // reflect mode + who's signed in
    const m=$('#modeNote'); if(m) m.innerHTML = 'Mode: <b>Live</b><br><span class="muted" style="color:rgba(244,240,234,.5)">'+staff.full_name+' · <a href="#" onclick="auth.logout();return false" style="color:var(--wheat)">sign out</a></span>';
  }
  renderNav(); render();
}
boot();
