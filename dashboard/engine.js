/* ============================================================
   COMPANIO ENGINE — dashboard logic
   Demo dataset mirrors sql/04_seed.sql. Matching mirrors
   sql/03_functions.sql match_score(). When LIVE, swap the
   data layer for Supabase REST calls (see live() helpers).
   ============================================================ */
console.log('%cCompanio operator dashboard — BUILD v13 (stripe)', 'color:#E7B86A;font-weight:bold');
window.COMPANIO_BUILD = 'v13';

/* ---------- DATA (empty for launch — live mode fills from Supabase) ----------
   These arrays are intentionally empty so a logged-out preview and any
   not-yet-live view show clean "nothing here yet" states instead of demo
   people. In live mode, loadAll() replaces them with real data from the DB.
   The config blocks below (features / rates / plans) are sensible defaults
   so the UI renders without errors before live data loads. */
const DB = {
  companions: [],
  requesters: [],
  service_users: [],
  safeguarding_concerns: [],
  bookings: [],
  visits: [],
  visit_notes: [],
  matches: [],
  visit_pay: [],
  payouts: [],
  features: {stripe:'off', reminders:'off', documents:'on', reporting:'on', ai:'off'},
  rates: {rate_companionship:'30', rate_help:'32', rate_both:'34'},
  plans: [
    {id:'p1',label:'Weekly',tier:'starter',visits_per_week:1,monthly_price:0,active:true,sort_order:1},
    {id:'p2',label:'Twice-Weekly',tier:'standard',visits_per_week:2,monthly_price:0,active:true,sort_order:2},
    {id:'p3',label:'Most Days',tier:'companion_plus',visits_per_week:4,monthly_price:0,active:true,sort_order:3},
  ],
  documents: [],
  invoices: [],
  memberships: [],
  membership_plans: [],
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
  // music affinity (up to +6) — companion interest echoed in client's favourite music
  if(user.fav_music && user.fav_music.trim() && comp.interests.length){
    const m=user.fav_music.toLowerCase();
    if(comp.interests.some(i=>m.includes(i.toLowerCase()))){s+=6;reasons.push('shares a love of their kind of music');}
  }
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
  {id:'safeguarding',ico:'⚑',label:'Safeguarding'},
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
  else if(current==='safeguarding') v.innerHTML=viewSafeguarding();
  else if(current==='finance') v.innerHTML=viewFinance();
  else if(current==='reports') v.innerHTML=viewReports();
  else if(current==='settings') v.innerHTML=viewSettings();
  bindRows();
  drawCharts();
}

/* ---------- SAFEGUARDING ---------- */
const SG_CATS={wellbeing:'Wellbeing',self_neglect:'Self-neglect',cognitive:'Confusion / memory',financial:'Financial concern',physical:'Physical / a fall',abuse:'Suspected abuse',environment:'Unsafe home',other:'Other'};
const SG_SEV={1:'Low',2:'Medium',3:'Urgent'};
const sgList=()=>DB.safeguarding_concerns||[];
const sgOpen=()=>sgList().filter(s=>['open','reviewing'].includes(s.status))
  .sort((a,b)=>(b.severity-a.severity)||(new Date(b.raised_at)-new Date(a.raised_at)));
function sgUserName(id){const u=DB.service_users.find(x=>x.id===id);return u?u.full_name:'a client';}
function sgCompName(id){const c=DB.companions.find(x=>x.id===id);return c?c.full_name:'a companion';}
function sevChip(sev){return `<span class="chip ${sev>=3?'bad':sev===2?'warn':''}">${SG_SEV[sev]||'—'}</span>`;}

// Banner on Overview — only shows when there are open concerns
function sgBanner(){
  const open=sgOpen();
  if(!open.length) return '';
  const urgent=open.filter(s=>s.severity>=3).length;
  return `<div class="panel" style="border:1px solid rgba(179,64,58,.35);background:rgba(179,64,58,.05);margin-bottom:14px">
    <div class="panel-b" style="padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="font-size:1.4rem">⚑</div>
      <div style="flex:1;min-width:220px">
        <b style="color:var(--bad,#b3402f)">${open.length} open safeguarding ${open.length===1?'concern':'concerns'}${urgent?` · ${urgent} urgent`:''}</b>
        <div class="sub2" style="margin-top:2px">${open.slice(0,2).map(s=>`${sgUserName(s.service_user_id)} — ${SG_CATS[s.category]}`).join(' · ')}${open.length>2?` · +${open.length-2} more`:''}</div>
      </div>
      <button class="btn sm primary" onclick="current='safeguarding';renderNav();render()">Review now</button>
    </div></div>`;
}

function viewSafeguarding(){
  const open=sgOpen();
  const closed=sgList().filter(s=>['actioned','referred','closed'].includes(s.status))
    .sort((a,b)=>new Date(b.actioned_at||b.raised_at)-new Date(a.actioned_at||a.raised_at));
  const card=s=>`<div class="panel" style="margin-bottom:10px${s.severity>=3&&['open','reviewing'].includes(s.status)?';border-left:4px solid var(--bad,#b3402f)':''}">
    <div class="panel-b" style="padding:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <b>${sgUserName(s.service_user_id)}</b> ${sevChip(s.severity)} <span class="tag">${SG_CATS[s.category]||s.category}</span>
          <div class="sub2" style="margin-top:6px;max-width:620px">${s.description}</div>
          <div class="muted" style="font-size:.78rem;margin-top:6px">Raised by ${sgCompName(s.companion_id)} · ${fmt(s.raised_at)}${s.action_taken?` · <b>Action:</b> ${s.action_taken}`:''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${['open','reviewing'].includes(s.status)
            ? `<button class="btn sm" onclick="sgTriage('${s.id}','reviewing')">Reviewing</button>
               <button class="btn sm primary" onclick="sgTriage('${s.id}','actioned')">Mark actioned</button>
               <button class="btn sm" onclick="sgTriage('${s.id}','referred')">Referred on</button>`
            : `<span class="chip ${s.status==='closed'?'':'good'}">${cap(s.status)}</span>`}
        </div>
      </div>
    </div></div>`;
  return head('Safeguarding','Welfare concerns','Every concern a companion raises lands here. Triage each one — nothing is lost in a note.')+
    `<div class="panel"><div class="panel-h"><h3>Open · ${open.length}</h3></div>
       <div class="panel-b" style="padding:16px 20px">${open.length?open.map(card).join(''):'<div class="empty">No open concerns. 🌿</div>'}</div></div>
     <div class="panel"><div class="panel-h"><h3>Resolved · ${closed.length}</h3></div>
       <div class="panel-b" style="padding:16px 20px">${closed.length?closed.map(card).join(''):'<div class="empty">Nothing resolved yet.</div>'}</div></div>`;
}

async function sgTriage(id,status){
  const s=sgList().find(x=>x.id===id); if(!s) return;
  let action=s.action_taken||'';
  if(status==='actioned'||status==='referred'){
    const label=status==='referred'?'Who did you refer this to, and any reference?':'What did you do? (kept for the record)';
    const got=await cmpPrompt(label,{title:status==='referred'?'Referred on':'Mark actioned',okText:'Save'});
    if(got===null) return;            // cancelled
    action=got||action;
  }
  s.status=status; s.action_taken=action; s.actioned_at=new Date().toISOString();
  if(typeof api!=='undefined' && api.live){
    try{ await supa.update('safeguarding_concerns',id,{status,action_taken:action,actioned_at:s.actioned_at}); }
    catch(e){ alert('Could not update: '+e.message); return; }
  }
  cmpToast('Concern updated','ok'); render();
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
  sgBanner()+
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

let compFilter={status:'all', q:''};
function gotoCompanions(status){ compFilter.status=status||'all'; compFilter.q=''; current='companions'; renderNav(); render(); }
function setCompFilter(status){ compFilter.status=status; render(); }
function viewCompanions(){
  const STATUSES=['all','active','vetting','applicant','paused','offboarded','rejected'];
  const q=(compFilter.q||'').toLowerCase();
  let list=DB.companions.filter(c=>{
    if(compFilter.status!=='all' && c.status!==compFilter.status) return false;
    if(q){
      const hay=`${c.full_name} ${c.city||''} ${c.postcode||''} ${c.email||''} ${c.phone||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  const rows=list.map(c=>{
    const used=DB.bookings.filter(b=>b.companion_id===c.id&&b.status==='active').length;
    return `<tr class="row" data-comp="${c.id}">
      <td><div class="name">${c.full_name}</div><div class="sub2">${c.city||''} · ${c.postcode||''}</div></td>
      <td><span class="chip ${statusChip(c.status)}">${cap(c.status)}</span></td>
      <td><span class="chip ${dbsChip(c.dbs)}">DBS ${c.dbs}</span></td>
      <td><span class="dot ${c.offers}"></span> ${cap(c.offers)}</td>
      <td>${c.status==='active'?`${used}/${c.max_clients}`:'—'}</td>
      <td>£${(c.hourly_pay||0).toFixed(2)}</td>
    </tr>`;}).join('')||`<tr><td colspan="6"><div class="empty" style="padding:20px">No companions match.</div></td></tr>`;
  const counts={};
  STATUSES.forEach(s=>counts[s]=s==='all'?DB.companions.length:DB.companions.filter(c=>c.status===s).length);
  const tabs=STATUSES.filter(s=>s==='all'||counts[s]>0).map(s=>
    `<button class="btn sm ${compFilter.status===s?'primary':''}" onclick="setCompFilter('${s}')">${s==='all'?'All':cap(s)} ${counts[s]?`<span class="sub2">(${counts[s]})</span>`:''}</button>`).join(' ');
  return head('Supply','Companions','Your roster. Search and filter as it grows — this scales to hundreds without clutter.')+`
  <div class="panel"><div class="panel-h">
    <h3>Roster (${list.length}${list.length!==DB.companions.length?` of ${DB.companions.length}`:''})</h3>
    <button class="btn sm primary" onclick="openAddApplicant()">+ Add companion</button></div>
    <div class="panel-b" style="padding:14px 20px 0">
      <input type="search" placeholder="Search name, town, postcode, email…" value="${compFilter.q||''}"
        oninput="compFilter.q=this.value;clearTimeout(window._cfT);window._cfT=setTimeout(render,150)"
        style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;margin-bottom:12px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${tabs}</div>
    </div>
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
        <div style="text-align:right">${requesterLoginBtn(r)}<div style="margin-top:6px">${membershipBtn(r)}</div></div>
      </div>
      ${r.matcher_notes?`<div class="sub2" style="margin-top:8px;background:var(--mist);border:1px solid var(--line);border-radius:9px;padding:9px 12px"><b>Matcher:</b> ${r.matcher_notes}</div>`:''}
      <div class="section-t">Service users (${users.length})</div>
      <div class="tree-users">${userCards}</div>
    </div></div>`;
  }).join('');
  return head('Demand','Requesters & Service Users','The buyer and the person who receives visits are usually different people. The requester arranges and pays; the service user gets the company.')+blocks;
}

function requesterLoginBtn(r){
  if(r.login_provisioned) return `<span class="chip good">✓ login invited</span>`;
  if(!r.email) return `<span class="sub2">No email</span>`;
  return `<button class="btn sm primary" onclick="createLogin('requester','${r.id}')">✉️ Send login invite</button>`;
}

// Membership status + setup. DB.memberships is loaded in live mode.
function membershipBtn(r){
  const m=(DB.memberships||[]).find(x=>x.requester_id===r.id && x.status!=='canceled');
  if(m && (m.status==='active'||m.status==='trialing')){
    return `<span class="chip good" title="${m.plan_key||''} · £${Number(m.monthly_price||0).toFixed(0)}/mo">✓ Member · ${cap(m.plan_key||'plan')}</span>`;
  }
  if(m && m.status==='past_due'){
    return `<span class="chip bad">Payment failed</span> <button class="btn sm" onclick="setupMembership('${r.id}')">Resend</button>`;
  }
  if(m && m.status==='incomplete'){
    return `<span class="chip warn">Awaiting payment</span> <button class="btn sm" onclick="setupMembership('${r.id}')">Resend link</button>`;
  }
  return `<button class="btn sm" onclick="setupMembership('${r.id}')">💳 Set up membership</button>`;
}

async function setupMembership(reqId){
  const r=DB.requesters.find(x=>x.id===reqId); if(!r) return;
  const plans=(DB.membership_plans&&DB.membership_plans.length)?DB.membership_plans
    :[{key:'weekly',name:'Weekly',monthly_price:260},{key:'companion',name:'Companion',monthly_price:570},{key:'concierge',name:'Concierge',monthly_price:1110}];
  // choose a plan
  const pick=await new Promise(res=>{
    const opts=plans.map(p=>`<button class="cmp-btn cmp-btn-ghost" style="display:block;width:100%;text-align:left;margin:4px 0" onclick="window.__planPick('${p.key}')">${p.name} — £${Number(p.monthly_price).toFixed(0)}/mo</button>`).join('');
    window.__planPick=(k)=>{ const ov=document.getElementById('cmpModalOverlay'); if(ov) ov.classList.remove('on'); res(k); };
    cmpModal({title:`Membership for ${r.full_name}`,mode:'alert',message:'Choose a plan. We’ll create a secure Stripe checkout link for the family to enter their card — billed monthly until cancelled.'});
    setTimeout(()=>{ const b=document.getElementById('cmpModalBody'); if(b) b.innerHTML+='<div style="margin-top:10px">'+opts+'</div>'; const f=document.getElementById('cmpModalFoot'); if(f) f.innerHTML=''; },20);
  });
  if(!pick) return;

  if(typeof api!=='undefined' && api.live){
    cmpToast('Creating secure checkout…','');
    const out=await createMembershipCheckout(reqId, pick, null);
    if(out.error){ cmpModal({title:'Could not set up membership',mode:'alert',message:out.error}); return; }
    // show the link to copy / send
    openDrawer(`
      <div class="drawer-h"><div><h2>Membership link ready</h2>
        <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">${r.full_name} · ${cap(pick)} plan</div></div>
        <button class="x" onclick="closeDrawer()">×</button></div>
      <div class="drawer-b">
        <p class="muted" style="font-size:.9rem">Send this secure link to the family. They enter their card on Stripe; the membership activates automatically and shows here once paid.</p>
        <input id="memlink" readonly value="${out.url}" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box;font-size:.85rem">
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn primary" style="flex:1" onclick="navigator.clipboard.writeText(document.getElementById('memlink').value).then(()=>cmpToast('Link copied','ok'))">Copy link</button>
          <a class="btn" href="mailto:${r.email||''}?subject=Your%20Companio%20membership&body=${encodeURIComponent('Here is your secure link to set up your Companio membership:\n\n'+out.url)}">Email it</a>
        </div>
      </div>`);
  } else {
    // demo: simulate the membership becoming active
    DB.memberships=DB.memberships||[];
    const ex=DB.memberships.find(x=>x.requester_id===reqId);
    const price=(plans.find(p=>p.key===pick)||{}).monthly_price||0;
    if(ex){ ex.status='active'; ex.plan_key=pick; ex.monthly_price=price; }
    else DB.memberships.push({id:'m'+Date.now(),requester_id:reqId,plan_key:pick,status:'active',monthly_price:price});
    cmpToast(`${cap(pick)} membership active (demo)`,'ok'); render();
  }
}

function viewBookings(){
  const rows=DB.bookings.map(b=>{
    const u=DB.service_users.find(x=>x.id===b.service_user_id);
    const r=DB.requesters.find(x=>x.id===b.requester_id);
    const c=DB.companions.find(x=>x.id===b.companion_id);
    return `<tr class="row" data-booking="${b.id}" style="cursor:pointer" onclick="openBooking('${b.id}')">
      <td><div class="name">${u.full_name}</div><div class="sub2">for ${r.full_name}</div></td>
      <td><span class="dot ${b.service}"></span> ${cap(b.service)}</td>
      <td>${cap(b.frequency)}</td>
      <td>${c?c.full_name:'<span class="chip warn">unassigned</span>'}</td>
      <td>£${b.hourly_rate.toFixed(0)}/hr</td>
      <td><span class="chip ${statusChip(b.status)}">${cap(b.status)}</span></td>
    </tr>`;}).join('');
  return head('Arrangements','Bookings','An ongoing arrangement: which user, what service, how often, who pays, and which companion delivers it.')+`
  <div class="panel"><div class="panel-h"><h3>Bookings (${DB.bookings.length})</h3></div>
  <div class="panel-b">${DB.bookings.length?`<table><thead><tr><th>Service user</th><th>Service</th><th>Frequency</th><th>Companion</th><th>Rate</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">No bookings yet. Bookings are created when you introduce a companion to a family from the Requesters tab.</div>'}</div></div>`;
}

// Booking drawer: shows the full chain and lets you assign/reassign the
// companion safely (capacity-aware), so there's never a mix-up.
function openBooking(id){
  const b=DB.bookings.find(x=>x.id===id); if(!b) return;
  const u=DB.service_users.find(x=>x.id===b.service_user_id);
  const r=DB.requesters.find(x=>x.id===b.requester_id);
  const c=DB.companions.find(x=>x.id===b.companion_id);
  // candidate companions: active, with capacity (current booking's companion always allowed)
  const cands=DB.companions.filter(x=>x.status==='active').map(x=>{
    const load=DB.bookings.filter(bk=>bk.companion_id===x.id&&bk.status==='active'&&bk.id!==id).length;
    const free=(x.max_clients||8)-load;
    return {x,load,free,full:free<=0};
  });
  const options=cands.map(o=>`<option value="${o.x.id}" ${o.x.id===b.companion_id?'selected':''} ${o.full&&o.x.id!==b.companion_id?'disabled':''}>${o.x.full_name}${o.full?' — at capacity':` (${o.free} free)`}</option>`).join('');
  openDrawer(`
    <div class="drawer-h"><div><h2>${u?u.full_name:'Booking'}</h2>
      <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">for ${r?r.full_name:'family'} · ${cap(b.status)}</div></div>
      <button class="x" onclick="closeDrawer()">×</button></div>
    <div class="drawer-b">
      <div class="section-t">The arrangement</div>
      <div class="field-row"><span class="k">Service user</span><span class="v"><b>${u?u.full_name:'—'}</b></span></div>
      <div class="field-row"><span class="k">Family (pays)</span><span class="v">${r?r.full_name:'—'}</span></div>
      <div class="field-row"><span class="k">Service</span><span class="v">${cap(b.service)} · ${cap(b.frequency)} · ${b.visit_length_hrs}h</span></div>
      <div class="field-row"><span class="k">Rate</span><span class="v">£${Number(b.hourly_rate||0).toFixed(0)}/hr</span></div>

      <div class="section-t" style="margin-top:18px">Assigned companion</div>
      <p class="muted" style="font-size:.85rem;margin:0 0 8px">${c?`Currently <b>${c.full_name}</b>.`:'No companion assigned yet.'} Changing this updates who delivers this family’s visits. Companions at capacity can’t be selected.</p>
      <select id="bk-companion" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box;font-family:inherit">
        <option value="">— Unassigned —</option>
        ${options}
      </select>
      <button class="btn primary" style="width:100%;margin-top:12px" onclick="assignBookingCompanion('${id}')">Save companion</button>

      <div class="section-t" style="margin-top:20px">Booking status</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${b.status!=='active'?`<button class="btn sm primary" onclick="setBookingStatus('${id}','active')">Activate</button>`:''}
        ${b.status!=='paused'?`<button class="btn sm" onclick="setBookingStatus('${id}','paused')">Pause</button>`:''}
        ${b.status!=='ended'?`<button class="btn sm" onclick="setBookingStatus('${id}','ended')">End</button>`:''}
      </div>
    </div>`);
}

async function assignBookingCompanion(id){
  const b=DB.bookings.find(x=>x.id===id); if(!b) return;
  const newId=document.getElementById('bk-companion').value||null;
  if(newId===b.companion_id){ closeDrawer(); return; }
  const c=DB.companions.find(x=>x.id===newId);
  const u=DB.service_users.find(x=>x.id===b.service_user_id);
  const verb=b.companion_id?'Reassign':'Assign';
  if(!await cmpConfirm(`${verb} ${c?c.full_name:'(unassign)'} ${c?'to':'from'} ${u?u.full_name:'this booking'}? Future visits for this booking will use ${c?'the new companion':'no companion until reassigned'}.`,{title:verb+' companion',okText:verb})) return;
  if(typeof api!=='undefined' && api.live){
    try{ await supa.update('bookings',id,{companion_id:newId}); await loadAll(DB); }
    catch(e){ alert('Could not save: '+e.message); return; }
  } else {
    b.companion_id=newId;
  }
  closeDrawer(); cmpToast('Companion '+(newId?'assigned':'removed'),'ok'); render();
}

async function setBookingStatus(id,status){
  const b=DB.bookings.find(x=>x.id===id); if(!b) return;
  if(status==='ended' && !await cmpConfirm('End this booking? It stops future visits for this arrangement.',{title:'End booking',danger:true,okText:'End it'})) return;
  if(typeof api!=='undefined' && api.live){
    try{ await supa.update('bookings',id,{status}); await loadAll(DB); }
    catch(e){ alert('Could not update: '+e.message); return; }
  } else { b.status=status; }
  closeDrawer(); cmpToast('Booking '+status,'ok'); render();
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
  <div class="panel"><div class="panel-h"><h3>Invoices to families</h3><button class="btn sm primary" onclick="createInvoice()">+ Create invoice</button></div>
    <div class="panel-b"><table><thead><tr><th>Invoice</th><th>Family</th><th>Total</th><th>Paid</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${DB.invoices.map(i=>{
      const r=DB.requesters.find(x=>x.id===i.requester_id);
      const fam=r?r.full_name:'—';
      const acts=i.status==='void'?'<span class="chip">Void</span>' :
        i.status==='paid'?`<button class="btn sm" onclick="editInvoice('${i.id}')">Edit</button> <span class="chip good">settled</span>` :
        `<button class="btn sm" onclick="editInvoice('${i.id}')">Edit</button> `+
        `${i.status==='draft'?`<button class="btn sm" onclick="invoiceAction('${i.id}','sent')">Mark sent</button> `:''}`+
        `<button class="btn sm primary" onclick="invoiceAction('${i.id}','paid')">Mark paid</button> `+
        `<button class="btn sm" onclick="invoiceAction('${i.id}','void')">Void</button>`;
      return `<tr><td class="name">${i.number||'—'}</td><td>${fam}</td><td>${money(i.total)}</td><td>${money(i.amount_paid)}</td>
        <td><span class="chip ${i.status==='paid'?'good':i.status==='void'?'':'warn'}">${cap(i.status)}</span></td>
        <td>${acts}</td></tr>`;
    }).join('')||'<tr><td colspan="6"><div class="empty">No invoices yet. Click “Create invoice” to bill a family for their completed visits.</div></td></tr>'}
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

/* ---------- INVOICING ---------- */
// Create an invoice for a family from their completed, un-invoiced visits.
async function createInvoice(){
  // pick a family
  const families = DB.requesters.filter(r=>r.id);
  if(!families.length){ cmpModal({title:'No families yet',mode:'alert',message:'Once you have a family with completed visits, you can bill them here.'}); return; }
  const pick = await new Promise(res=>{
    const opts = families.map(r=>`<button class="cmp-btn cmp-btn-ghost" style="display:block;width:100%;text-align:left;margin:4px 0" onclick="window.__invPick('${r.id}')">${r.full_name}</button>`).join('');
    window.__invPick=(id)=>{ document.getElementById('cmpModalOverlay').classList.remove('on'); res(id); };
    cmpModal({title:'Create an invoice',mode:'alert',message:'Which family is this invoice for? It will bill their completed, not-yet-invoiced visits.'});
    setTimeout(()=>{ const b=document.getElementById('cmpModalBody'); if(b) b.innerHTML+='<div style="margin-top:10px">'+opts+'</div>'; const f=document.getElementById('cmpModalFoot'); if(f) f.innerHTML=''; },20);
  });
  if(!pick) return;

  if(typeof api!=='undefined' && api.live){
    try{
      const newId = await supa.rpc('generate_invoice',{p_requester:pick, p_from:null, p_to:null});
      await loadAll(DB);
      render();
      // confirm result
      const created = DB.invoices.find(i=>i.id===newId);
      cmpToast(created?`Invoice ${created.number} created`:'Invoice created','ok');
    }catch(e){
      // common case: nothing to bill
      const msg = /no .*visit|nothing/i.test(e.message||'') ? 'There are no completed, un-invoiced visits for this family yet.' : ('Could not create invoice: '+e.message);
      cmpModal({title:'Nothing to invoice',mode:'alert',message:msg});
    }
  } else {
    // demo: synthesise an invoice from this family's completed visits
    const r=DB.requesters.find(x=>x.id===pick);
    const num='CMP-2026-'+String(1000+DB.invoices.length+1).slice(1);
    const total=64; // demo amount
    DB.invoices.push({id:'inv'+Date.now(),requester_id:pick,number:num,status:'draft',total,amount_paid:0,period_start:'2026-06-01',period_end:'2026-06-30',due_date:'2026-07-14'});
    cmpToast(`Invoice ${num} created (demo)`,'ok');
    render();
  }
}

async function invoiceAction(id,action){
  const inv=DB.invoices.find(i=>i.id===id); if(!inv) return;
  if(typeof api!=='undefined' && api.live && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)){
    cmpModal({title:'Demo invoice',mode:'alert',message:'This is sample data. Create a real invoice with “+ Create invoice” to manage it.'});
    return;
  }
  if(action==='void'){
    if(!await cmpConfirm(`Void invoice ${inv.number}? This cancels it.`,{title:'Void invoice',danger:true,okText:'Void it'})) return;
  }
  const patch = action==='paid' ? {status:'paid',amount_paid:inv.total}
              : action==='sent' ? {status:'sent'}
              : {status:'void'};
  if(typeof api!=='undefined' && api.live){
    try{ await supa.update('invoices',id,patch); await loadAll(DB); }
    catch(e){ alert('Update failed: '+e.message); return; }
  } else {
    Object.assign(inv,patch);
  }
  cmpToast(`Invoice ${action==='paid'?'marked paid':action==='sent'?'marked sent':'voided'}`,'ok');
  render();
}

// Edit an invoice's amount, due date and notes.
function editInvoice(id){
  const inv=DB.invoices.find(i=>i.id===id); if(!inv) return;
  const r=DB.requesters.find(x=>x.id===inv.requester_id);
  openDrawer(`
    <div class="drawer-h"><div><h2>Edit ${inv.number||'invoice'}</h2>
      <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">${r?r.full_name:'family'} · ${cap(inv.status)}</div></div>
      <button class="x" onclick="closeDrawer()">×</button></div>
    <div class="drawer-b">
      <label style="font-weight:700;font-size:.85rem">Total (£)</label>
      <input id="inv-total" type="number" step="0.01" min="0" value="${Number(inv.total||0)}" style="width:100%;padding:10px;margin:4px 0 14px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box">
      <label style="font-weight:700;font-size:.85rem">Amount paid (£)</label>
      <input id="inv-paid" type="number" step="0.01" min="0" value="${Number(inv.amount_paid||0)}" style="width:100%;padding:10px;margin:4px 0 14px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box">
      <div style="display:flex;gap:12px">
        <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Due date</label>
          <input id="inv-due" type="date" value="${inv.due_date||''}" style="width:100%;padding:10px;margin:4px 0 14px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box"></div>
      </div>
      <div style="display:flex;gap:12px">
        <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Period start</label>
          <input id="inv-ps" type="date" value="${inv.period_start||''}" style="width:100%;padding:10px;margin:4px 0 14px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box"></div>
        <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Period end</label>
          <input id="inv-pe" type="date" value="${inv.period_end||''}" style="width:100%;padding:10px;margin:4px 0 14px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box"></div>
      </div>
      <label style="font-weight:700;font-size:.85rem">Notes (appears on the invoice)</label>
      <textarea id="inv-notes" rows="3" style="width:100%;padding:10px;margin:4px 0 14px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box;font-family:inherit">${inv.notes||''}</textarea>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn primary" style="flex:1" onclick="saveInvoice('${id}')">Save changes</button>
        <button class="btn" onclick="closeDrawer()">Cancel</button>
      </div>
    </div>`);
}

async function saveInvoice(id){
  const inv=DB.invoices.find(i=>i.id===id); if(!inv) return;
  // guard: a demo seed row (id like 'i1') can't be saved to a UUID column
  if(typeof api!=='undefined' && api.live && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)){
    cmpModal({title:'Demo invoice',mode:'alert',message:'This is sample data, not a real invoice. Create a real invoice with “+ Create invoice” and you’ll be able to edit it.'});
    return;
  }
  const num=v=>{const n=parseFloat(v);return isNaN(n)?0:Math.round(n*100)/100;};
  const patch={
    total: num(document.getElementById('inv-total').value),
    amount_paid: num(document.getElementById('inv-paid').value),
    due_date: document.getElementById('inv-due').value||null,
    period_start: document.getElementById('inv-ps').value||null,
    period_end: document.getElementById('inv-pe').value||null,
    notes: document.getElementById('inv-notes').value||null,
  };
  if(typeof api!=='undefined' && api.live){
    try{ await supa.update('invoices',id,patch); await loadAll(DB); }
    catch(e){ alert('Could not save: '+e.message); return; }
  } else {
    Object.assign(inv,patch);
  }
  closeDrawer(); cmpToast('Invoice updated','ok'); render();
}

function computeActions(){
  const items=[];
  // MISSED CHECK-IN: scheduled visit, start time passed by >20 min, no check-in
  const now=new Date(); const GRACE=20*60000;
  DB.visits.filter(v=>v.status==='scheduled' && !v.checked_in_at && (now-new Date(v.scheduled_at))>GRACE).forEach(v=>{
    const b=DB.bookings.find(x=>x.id===v.booking_id); const u=b&&DB.service_users.find(x=>x.id===b.service_user_id);
    const c=DB.companions.find(x=>x.id===v.companion_id);
    const mins=Math.floor((now-new Date(v.scheduled_at))/60000);
    items.push({kind:'missed_checkin',sev:'high',label:`⚠ ${u?u.full_name:'A visit'} — ${c?c.full_name:'companion'} hasn’t checked in (${mins}m late)`,ref:v.id});
  });
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

/* ---------- RECRUITING PIPELINE (end to end) ---------- */
function viewPipeline(){
  const TARGET=8;  // companions you're aiming for
  const stages=[
    {key:'applicant',label:'Applied',hint:'New applications',accent:'var(--lilac)'},
    {key:'vetting',label:'Vetting',hint:'DBS + references',accent:'var(--wheat-deep)'},
    {key:'active',label:'Active',hint:'Ready to work',accent:'var(--good)'},
    {key:'paused',label:'Paused',hint:'On hold',accent:'var(--muted)'},
  ];
  const active=DB.companions.filter(c=>c.status==='active').length;
  const inVetting=DB.companions.filter(c=>c.status==='vetting'||c.status==='applicant').length;
  const pct=Math.min(100,Math.round(active/TARGET*100));

  // follow-up: anyone in applicant/vetting whose next_action is due, or stuck >14 days
  const today=new Date();
  const daysSince=d=>d?Math.floor((today-new Date(d))/86400000):null;
  const followUps=DB.companions.filter(c=>['applicant','vetting'].includes(c.status)).map(c=>{
    const dueIn=c.next_action_due?Math.floor((new Date(c.next_action_due)-today)/86400000):null;
    const stuck=daysSince(c.stage_changed_at);
    const overdue=dueIn!=null && dueIn<0;
    const dueSoon=dueIn!=null && dueIn>=0 && dueIn<=2;
    const stale=stuck!=null && stuck>14;
    return {c,dueIn,stuck,overdue,dueSoon,stale,flag:overdue||dueSoon||stale};
  }).filter(x=>x.flag).sort((a,b)=>(a.dueIn??99)-(b.dueIn??99));

  const sourceChip=s=>s?`<span class="chip" style="background:rgba(155,138,168,.16);color:var(--aubergine);border:none">${cap(s)}</span>`:'';

  // RECRUITING columns = the stages you actively move people through (small by nature).
  // Active & Paused are NOT shown as endless card stacks — they're summarised with a
  // count and a link to the searchable Companions roster (scales to hundreds cleanly).
  const recruitingStages=stages.filter(s=>['applicant','vetting'].includes(s.key));
  const cols=recruitingStages.map(st=>{
    const people=DB.companions.filter(c=>c.status===st.key);
    return `<div style="flex:1;min-width:250px;max-width:420px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid ${st.accent}">
        <div><div style="font-weight:800;color:var(--aubergine-dark)">${st.label}</div><div class="sub2">${st.hint}</div></div>
        <span class="chip" style="background:${st.accent};color:#fff;border:none;font-weight:800">${people.length}</span></div>
      <div style="max-height:62vh;overflow-y:auto;padding-right:4px">
      ${people.map(c=>{
        const dueIn=c.next_action_due?Math.floor((new Date(c.next_action_due)-today)/86400000):null;
        const fuChip = c.next_action ? `<div style="margin-top:9px;padding:7px 9px;background:var(--mist);border-radius:7px;border-left:3px solid ${dueIn!=null&&dueIn<0?'var(--bad)':'var(--wheat)'}">
          <div style="font-size:.78rem;font-weight:700;color:var(--aubergine-dark)">${c.next_action}</div>
          ${c.next_action_due?`<div class="sub2" style="font-size:.72rem">${dueIn<0?`${-dueIn}d overdue`:dueIn===0?'due today':`due in ${dueIn}d`}</div>`:''}</div>` : '';
        return `<div class="ip-card" style="padding:13px 14px;margin-bottom:11px;cursor:pointer" onclick="openCompanion('${c.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><div class="name">${c.full_name}</div><div class="sub2">${c.city||''}</div></div>
          ${sourceChip(c.source)}
        </div>
        <div style="margin-top:9px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="chip ${dbsChip(c.dbs)}">DBS ${c.dbs}</span>
          ${c.references_ok?'<span class="chip good">refs ✓</span>':'<span class="chip warn">refs pending</span>'}
        </div>
        ${(c.phone||c.email)?`<div style="margin-top:9px;display:flex;gap:8px" onclick="event.stopPropagation()">
          ${c.phone?`<a href="tel:${c.phone}" class="sub2" style="color:var(--aubergine);font-weight:700;text-decoration:none">📞 ${c.phone}</a>`:''}
          ${c.email?`<a href="mailto:${c.email}" class="sub2" style="color:var(--aubergine);text-decoration:none">✉️</a>`:''}
        </div>`:''}
        ${fuChip}
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap" onclick="event.stopPropagation()">
          ${stageActions(c,st.key)}
          <button class="btn sm" onclick="openFollowUp('${c.id}')">📝 Follow-up</button>
        </div>
      </div>`;}).join('')||`<div class="empty" style="padding:18px;font-size:.85rem">None right now</div>`}
      </div>
    </div>`;
  }).join('');

  // Active & Paused summary cards (scale-safe — counts + jump to roster)
  const activePaused=[
    {key:'active',label:'Active companions',hint:'Working now',accent:'var(--good)'},
    {key:'paused',label:'Paused',hint:'On hold',accent:'var(--muted)'},
  ].map(s=>{
    const n=DB.companions.filter(c=>c.status===s.key).length;
    return `<div class="ip-card" style="flex:1;min-width:200px;padding:16px 18px;border-left:4px solid ${s.accent}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:800;color:var(--aubergine-dark)">${s.label}</div><div class="sub2">${s.hint}</div></div>
        <div style="font-size:1.8rem;font-weight:800;color:var(--aubergine-dark)">${n}</div></div>
      ${n>0?`<button class="btn sm" style="margin-top:10px" onclick="gotoCompanions('${s.key}')">View ${s.key==='active'?'roster':'paused'} →</button>`:'<div class="sub2" style="margin-top:8px">None yet</div>'}
    </div>`;
  }).join('');

  const off=DB.companions.filter(c=>c.status==='offboarded');
  const rejected=DB.companions.filter(c=>c.status==='rejected');

  return head('Supply','Recruiting pipeline','Your funnel from application to active companion. This is the gate the whole business depends on — keep it moving.')+`
  <div class="panel"><div class="panel-b" style="padding:18px 20px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
      <div style="flex:1;min-width:260px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-weight:800;color:var(--aubergine-dark)">${active} of ${TARGET} active companions</span>
          <span class="sub2">${inVetting} in the pipeline</span></div>
        <div style="background:var(--line);border-radius:99px;height:10px"><div style="width:${pct}%;height:10px;border-radius:99px;background:${active>=TARGET?'var(--good)':'var(--wheat)'}"></div></div>
        <div class="sub2" style="margin-top:6px">${active>=TARGET?'You’ve hit your supply target — focus on demand.':`Recruit ${TARGET-active} more to hit your target.`}</div>
      </div>
      <button class="btn primary" onclick="openAddApplicant()">+ Add applicant</button>
    </div>
  </div></div>
  ${followUps.length?`<div class="panel" style="border-color:var(--wheat)"><div class="panel-h"><h3>⏰ Needs follow-up</h3><span class="chip ${followUps.some(f=>f.overdue)?'bad':'warn'}">${followUps.length}</span></div>
    <div class="panel-b">${followUps.map(f=>`<div class="row" style="padding:11px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line)">
      <div style="flex:1"><span class="name">${f.c.full_name}</span> <span class="sub2">· ${cap(f.c.status)}${f.c.source?' · '+cap(f.c.source):''}</span>
        <div class="sub2">${f.c.next_action||'No next action set'} ${f.overdue?`<span style="color:var(--bad);font-weight:700">· ${-f.dueIn}d overdue</span>`:f.dueSoon?`<span style="color:var(--wheat-deep);font-weight:700">· due in ${f.dueIn}d</span>`:f.stale?`<span style="color:var(--muted)">· ${f.stuck}d in stage</span>`:''}</div></div>
      ${f.c.phone?`<a href="tel:${f.c.phone}" class="btn sm">📞 Call</a>`:''}
      <button class="btn sm" onclick="openFollowUp('${f.c.id}')">Update</button>
    </div>`).join('')}</div></div>`:''}
  <div class="panel"><div class="panel-h"><h3>Active recruiting</h3><span class="muted" style="font-size:.82rem">applicants & vetting — tap a card for full profile</span></div>
  <div class="panel-b" style="padding:18px 20px"><div style="display:flex;gap:16px;align-items:flex-start;overflow-x:auto">${cols}</div></div></div>
  <div class="panel"><div class="panel-h"><h3>Your roster</h3><span class="muted" style="font-size:.82rem">manage the full list in Companions</span></div>
  <div class="panel-b" style="padding:18px 20px"><div style="display:flex;gap:16px;flex-wrap:wrap">${activePaused}</div></div></div>
  ${(off.length||rejected.length)?`<div class="panel"><div class="panel-h"><h3>Not active</h3></div><div class="panel-b" style="padding:10px 20px">
    ${off.map(c=>`<div class="row" style="padding:9px 0;display:flex;justify-content:space-between"><span>${c.full_name} <span class="sub2">· ${c.city||''}</span></span><span class="chip">offboarded</span></div>`).join('')}
    ${rejected.map(c=>`<div class="row" style="padding:9px 0;display:flex;justify-content:space-between"><span>${c.full_name} <span class="sub2">· ${c.city||''}${c.reject_reason?' · '+c.reject_reason:''}</span></span><span class="chip bad">not suitable</span></div>`).join('')}
  </div></div>`:''}`;
}

/* ---------- FOLLOW-UP editor ---------- */
function openFollowUp(id){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  openDrawer(`<div class="drawer-h"><div><h2>${c.full_name}</h2>
    <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">${cap(c.status)}${c.source?' · from '+cap(c.source):''}</div></div>
    <button class="x" onclick="closeDrawer()">×</button></div>
  <div class="drawer-b">
    ${c.phone||c.email?`<div class="section-t">Contact</div>
    ${c.phone?`<div class="field-row"><span class="k">Phone</span><span class="v"><a href="tel:${c.phone}" style="color:var(--aubergine);font-weight:700">${c.phone}</a></span></div>`:''}
    ${c.email?`<div class="field-row"><span class="k">Email</span><span class="v"><a href="mailto:${c.email}" style="color:var(--aubergine)">${c.email}</a></span></div>`:''}`:''}
    <div class="section-t">Next action</div>
    <label style="font-weight:700;font-size:.85rem">What needs doing next?</label>
    <input id="fu_action" value="${(c.next_action||'').replace(/"/g,'&quot;')}" placeholder="e.g. Chase DBS, call back Friday" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px">
    <label style="font-weight:700;font-size:.85rem">Due by</label>
    <input id="fu_due" type="date" value="${c.next_action_due||''}" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px">
    <button class="btn primary" style="width:100%;padding:11px;margin-bottom:8px" onclick="saveFollowUp('${id}')">Save & mark contacted today</button>
    <button class="btn" style="width:100%" onclick="clearFollowUp('${id}')">Clear next action (done)</button>
  </div>`);
}
async function saveFollowUp(id){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  const patch={next_action:$('#fu_action').value.trim(), next_action_due:$('#fu_due').value||null, last_contact_at:new Date().toISOString()};
  if(typeof api!=='undefined' && api.live){ try{ await supa.update('companions',id,patch); }catch(e){ alert(e.message); return; } }
  Object.assign(c,patch); closeDrawer(); render();
}
async function clearFollowUp(id){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  const patch={next_action:null, next_action_due:null};
  if(typeof api!=='undefined' && api.live){ try{ await supa.update('companions',id,patch); }catch(e){ alert(e.message); return; } }
  Object.assign(c,patch); closeDrawer(); render();
}

// per-stage action buttons (forward + the exits)
function stageActions(c,stage){
  const fwd={applicant:'vetting',vetting:'active',paused:'active'}[stage];
  const fwdLabel={vetting:'→ Vetting',active:'→ Mark active'}[fwd];
  let btns='';
  if(fwd) btns+=`<button class="btn sm primary" onclick="moveStage('${c.id}','${fwd}')">${fwdLabel}</button>`;
  if(stage==='active') btns+=`<button class="btn sm" onclick="moveStage('${c.id}','paused')">Pause</button>
    <button class="btn sm" style="border-color:var(--bad);color:var(--bad)" onclick="moveStage('${c.id}','offboarded')">Offboard</button>`;
  if(stage==='applicant'||stage==='vetting') btns+=`<button class="btn sm" style="border-color:var(--bad);color:var(--bad)" onclick="moveStage('${c.id}','rejected')">Not suitable</button>`;
  if(stage==='paused') btns+=`<button class="btn sm" style="border-color:var(--bad);color:var(--bad)" onclick="moveStage('${c.id}','offboarded')">Offboard</button>`;
  return btns;
}

async function moveStage(id,status){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  // SAFETY GATE: warn (but allow override) before marking someone active
  if(status==='active'){
    const issues=[];
    if(c.dbs!=='cleared') issues.push(`DBS is "${c.dbs}", not cleared`);
    if(!c.references_ok) issues.push('references not yet confirmed');
    if(issues.length){
      const ok=await cmpConfirm(`This person will visit vulnerable elderly people, but:\n\n• ${issues.join('\n• ')}\n\nMark them active anyway?`,{title:'⚠ Safeguarding check — '+c.full_name,danger:true,okText:'Mark active anyway',cancelText:'Go back'});
      if(!ok) return;
    }
  }
  if(status==='rejected'){
    if(!await cmpConfirm(`Mark ${c.full_name} as not suitable? They’ll move out of the active pipeline.`,{title:'Mark not suitable',danger:true,okText:'Mark not suitable'})) return;
  }
  if(status==='offboarded'){
    if(!await cmpConfirm(`Offboard ${c.full_name}? They’ll no longer be available for visits.`,{title:'Offboard companion',danger:true,okText:'Offboard'})) return;
  }
  if(typeof api!=='undefined' && api.live){ try{ await supa.update('companions',id,{status}); }catch(e){ alert(e.message); return; } }
  c.status=status; render();
}

/* ---------- ADD APPLICANT (the entrance) ---------- */
function openAddApplicant(){
  openDrawer(`<div class="drawer-h"><div><h2>New applicant</h2>
    <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">Add someone who’s applied to become a companion</div></div>
    <button class="x" onclick="closeDrawer()">×</button></div>
  <div class="drawer-b">
    <label style="font-weight:700;font-size:.85rem">Full name *</label>
    <input id="ap_name" placeholder="e.g. Patricia Adeyemi" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px">
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Town</label>
        <input id="ap_city" placeholder="Guildford" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px"></div>
      <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Postcode</label>
        <input id="ap_pc" placeholder="GU1 3AA" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px"></div>
    </div>
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Phone</label>
        <input id="ap_phone" placeholder="07700 900000" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px"></div>
      <div style="flex:1"><label style="font-weight:700;font-size:.85rem">Email</label>
        <input id="ap_email" type="email" placeholder="name@email.com" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px"></div>
    </div>
    <label style="font-weight:700;font-size:.85rem">Offers</label>
    <select id="ap_offers" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px">
      <option value="both">Both companionship & help</option>
      <option value="companionship">Companionship only</option>
      <option value="help">Practical help only</option>
    </select>
    <label style="font-weight:700;font-size:.85rem">Where did they come from?</label>
    <select id="ap_source" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 12px">
      <option value="website">Website</option>
      <option value="referral">Referral / word of mouth</option>
      <option value="flyer">Flyer / poster</option>
      <option value="facebook">Facebook / social</option>
      <option value="indeed">Job board (Indeed etc.)</option>
      <option value="other">Other</option>
    </select>
    <label style="font-weight:700;font-size:.85rem">A note (optional)</label>
    <textarea id="ap_bio" rows="2" placeholder="Where they came from, first impressions…" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin:5px 0 14px"></textarea>
    <button class="btn primary" style="width:100%;padding:11px" onclick="saveApplicant()">Add to pipeline</button>
  </div>`);
  setTimeout(()=>{const n=document.getElementById('ap_name');if(n)n.focus();},100);
}
async function saveApplicant(){
  const name=$('#ap_name').value.trim();
  if(!name){ $('#ap_name').focus(); alert('A name is needed.'); return; }
  const row={
    full_name:name, city:$('#ap_city').value.trim(), postcode:$('#ap_pc').value.trim().toUpperCase(),
    phone:$('#ap_phone').value.trim(), email:$('#ap_email').value.trim(),
    offers:$('#ap_offers').value, bio:$('#ap_bio').value.trim(), source:$('#ap_source').value,
    status:'applicant', dbs:'none', references_ok:false, hourly_pay:14, max_clients:8,
    interests:[], temperament:'', has_car:false,
  };
  if(typeof api!=='undefined' && api.live){
    try{ const saved=await supa.insert('companions',row); DB.companions.push(saved); }
    catch(e){ alert('Could not save: '+e.message); return; }
  } else {
    DB.companions.push({...row,id:'c'+Date.now()});
  }
  closeDrawer(); current='pipeline'; renderNav(); render();
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

/* ---------- THEME CUSTOMIZATION ----------
   Overrides CSS variables + fonts + logo at runtime; persists to app_settings
   as 'theme.<prop>'. Covers colours, fonts and the logo — full visual control. */
const THEME_PROPS=[
  {k:'aubergine',label:'Primary (aubergine)',def:'#4A4458'},
  {k:'aubergine-dark',label:'Primary dark',def:'#322E3D'},
  {k:'wheat',label:'Accent (wheat)',def:'#E7B86A'},
  {k:'wheat-deep',label:'Accent deep',def:'#C8943B'},
  {k:'offwhite',label:'Background',def:'#F4F0EA'},
  {k:'ink',label:'Text',def:'#241F2B'},
];
const FONT_CHOICES={
  serif:['Fraunces','Georgia','"Playfair Display"','Cormorant Garamond','"Times New Roman"'],
  sans:['Mulish','system-ui','Inter','"Helvetica Neue"','Arial','Verdana'],
};
let THEME={};      // prop -> value overrides
let LOGO_URL='';   // custom logo data/URL
function applyTheme(){
  const root=document.documentElement;
  THEME_PROPS.forEach(p=>{
    if(THEME[p.k]) root.style.setProperty('--'+p.k, THEME[p.k]);
    else root.style.removeProperty('--'+p.k);
  });
  if(THEME.serif) root.style.setProperty('--serif', THEME.serif+',Georgia,serif');
  else root.style.removeProperty('--serif');
  if(THEME.sans) root.style.setProperty('--sans', THEME.sans+',system-ui,sans-serif');
  else root.style.removeProperty('--sans');
  // logo
  if(LOGO_URL){
    document.querySelectorAll('.brand .mark, .topbar .mark, #brandMark').forEach(m=>{
      m.innerHTML=`<img src="${LOGO_URL}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    });
  }
}
async function setTheme(prop,val){
  if(val) THEME[prop]=val; else delete THEME[prop];
  applyTheme();
  if(typeof api!=='undefined' && api.live){
    try{ await supa.rpc('set_setting',{p_key:'theme.'+prop, p_value:val||''}); }catch(e){}
  }
}
async function setLogo(url){
  LOGO_URL=url; applyTheme();
  if(typeof api!=='undefined' && api.live){
    try{ await supa.rpc('set_setting',{p_key:'theme.logo', p_value:url||''}); }catch(e){}
  }
}
async function loadTheme(){
  if(typeof api!=='undefined' && api.live){
    try{
      const rows=await supa.select('app_settings',`select=key,value&key=like.theme.*`);
      (rows||[]).forEach(r=>{
        const prop=r.key.replace(/^theme\./,'');
        if(prop==='logo') LOGO_URL=r.value; else THEME[prop]=r.value;
      });
    }catch(e){}
  }
  applyTheme();
}
async function resetTheme(){
  if(!await cmpConfirm('Reset all colours, fonts and logo to the Companio defaults?',{title:'Reset theme',okText:'Reset'})) return;
  THEME={}; LOGO_URL='';
  if(typeof api!=='undefined' && api.live){
    THEME_PROPS.forEach(p=>{try{supa.rpc('set_setting',{p_key:'theme.'+p.k,p_value:''});}catch(e){}});
    try{supa.rpc('set_setting',{p_key:'theme.serif',p_value:''});supa.rpc('set_setting',{p_key:'theme.sans',p_value:''});supa.rpc('set_setting',{p_key:'theme.logo',p_value:''});}catch(e){}
  }
  applyTheme(); render();
}
function viewTheme(){
  const sw=THEME_PROPS.map(p=>{
    const cur=THEME[p.k]||p.def;
    return `<div class="row" style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid var(--line)">
      <input type="color" value="${cur}" oninput="setTheme('${p.k}',this.value)" style="width:42px;height:34px;border:1px solid var(--line);border-radius:7px;cursor:pointer;padding:2px">
      <div style="flex:1"><div class="name">${p.label}</div><div class="sub2">${cur}</div></div>
      ${THEME[p.k]?`<button class="btn sm" onclick="setTheme('${p.k}','');render()">Reset</button>`:''}
    </div>`;
  }).join('');
  const fontSel=(type,label)=>{
    const cur=THEME[type]||FONT_CHOICES[type][0];
    return `<div class="row" style="padding:11px 20px;border-bottom:1px solid var(--line)">
      <label style="font-weight:700;font-size:.85rem">${label}</label>
      <select onchange="setTheme('${type}',this.value);render()" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;margin-top:5px">
        ${FONT_CHOICES[type].map(f=>`<option value="${f}" ${cur===f?'selected':''}>${f.replace(/"/g,'')}</option>`).join('')}
      </select></div>`;
  };
  return `<div class="panel"><div class="panel-h"><h3>Brand colours</h3><button class="btn sm" onclick="resetTheme()">Reset all</button></div>
    <div class="panel-b">${sw}</div></div>
  <div class="panel"><div class="panel-h"><h3>Fonts</h3></div><div class="panel-b">
    ${fontSel('serif','Headings font')}${fontSel('sans','Body font')}</div></div>
  <div class="panel"><div class="panel-h"><h3>Logo</h3></div><div class="panel-b" style="padding:16px 20px">
    <p class="sub2" style="margin-top:0">Paste a logo image URL, or upload a file (it’s stored with your dashboard). Replaces the default Companio mark.</p>
    <input id="logoUrl" placeholder="https://… or upload below" value="${LOGO_URL&&!LOGO_URL.startsWith('data:')?LOGO_URL:''}" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" onclick="setLogo($('#logoUrl').value.trim());render()">Use this URL</button>
      <label class="btn" style="cursor:pointer">Upload file<input type="file" accept="image/*" style="display:none" onchange="uploadLogo(this)"></label>
      ${LOGO_URL?`<button class="btn" onclick="setLogo('');render()">Remove logo</button>`:''}
    </div>
    ${LOGO_URL?`<div style="margin-top:14px;display:flex;align-items:center;gap:10px"><span class="sub2">Preview:</span><span style="width:40px;height:40px;border-radius:50%;overflow:hidden;display:inline-block;border:1px solid var(--line)"><img src="${LOGO_URL}" style="width:100%;height:100%;object-fit:cover"></span></div>`:''}
  </div></div>`;
}
function uploadLogo(input){
  const f=input.files&&input.files[0]; if(!f) return;
  if(f.size>500000){ alert('Please use an image under 500KB.'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ setLogo(e.target.result); render(); };  // data URL, travels with the dashboard
  reader.readAsDataURL(f);
}


/* ---------- PRICING (single source of truth — website reads from here) ---------- */
function viewPricing(){
  const r=DB.rates||{rate_companionship:'28',rate_help:'30',rate_both:'32'};
  const plans=DB.plans||[];
  const rateRow=(key,label)=>`<div class="row" style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid var(--line)">
    <div style="flex:1"><div class="name">${label}</div></div>
    <div style="display:flex;align-items:center;gap:4px"><span class="muted">£</span>
    <input type="number" value="${r[key]||''}" min="0" step="0.5" onchange="saveRate('${key}',this.value)" style="width:80px;padding:8px;border:1px solid var(--line);border-radius:8px;text-align:right">
    <span class="muted">/hr</span></div></div>`;
  const planRow=p=>`<div class="row" style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid var(--line)">
    <div style="flex:1"><div class="name">${p.label}</div><div class="sub2">${p.visits_per_week} visit${p.visits_per_week>1?'s':''}/week · ${p.tier}</div></div>
    <div style="display:flex;align-items:center;gap:4px"><span class="muted">£</span>
    <input type="number" value="${p.monthly_price||''}" min="0" onchange="savePlan('${p.id}',this.value)" style="width:90px;padding:8px;border:1px solid var(--line);border-radius:8px;text-align:right">
    <span class="muted">/mo</span></div></div>`;
  return `<div class="panel"><div class="panel-h"><h3>💷 Pricing</h3><span class="muted" style="font-size:.82rem">your website reads these — change once, updates everywhere</span></div>
    <div class="panel-b" style="padding:0">
      <div style="padding:12px 20px 4px"><div class="sub2" style="font-weight:800;color:var(--aubergine-dark)">Hourly rates</div></div>
      ${rateRow('rate_companionship','Companionship')}
      ${rateRow('rate_help','Practical help')}
      ${rateRow('rate_both','Companionship + Help')}
      <div style="padding:14px 20px 4px"><div class="sub2" style="font-weight:800;color:var(--aubergine-dark)">Monthly packages</div></div>
      ${plans.map(planRow).join('')||'<div class="empty" style="padding:14px 20px">No packages yet.</div>'}
      <div style="padding:12px 20px"><p class="sub2" style="margin:0">${plans.some(p=>!p.monthly_price)?'⚠ Set your monthly package prices — they’re £0 until you do.':'Prices flow to your website automatically.'}</p></div>
    </div></div>`;
}
async function saveRate(key,val){
  if(!DB.rates) DB.rates={};
  DB.rates[key]=val;
  if(typeof api!=='undefined' && api.live){ try{ await supa.rpc('set_setting',{p_key:key,p_value:String(val)}); }catch(e){ alert('Could not save: '+e.message); } }
}
async function savePlan(id,val){
  const p=(DB.plans||[]).find(x=>x.id===id); if(!p) return;
  p.monthly_price=Number(val)||0;
  if(typeof api!=='undefined' && api.live){ try{ await supa.update('plans',id,{monthly_price:p.monthly_price}); }catch(e){ alert('Could not save: '+e.message); } }
  render();
}

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
  <div class="panel"><div class="panel-h"><h3>🎨 Appearance</h3><span class="muted" style="font-size:.82rem">colours, fonts & logo — changes apply instantly</span></div>
    <div class="panel-b" style="padding:0"></div></div>
  ${viewTheme()}
  ${viewPricing()}
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
  openDrawer(`<div class="drawer-h"><div><h2>${c.full_name}</h2><div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:3px">${c.city||''} · ${c.postcode||''}</div></div><button class="x" onclick="closeDrawer()">×</button></div>
  <div class="drawer-b">
    <p>${c.bio||''}</p>
    <div class="section-t">Status</div>
    <div class="field-row"><span class="k">Status</span><span class="v"><span class="chip ${statusChip(c.status)}">${cap(c.status)}</span></span></div>
    <div class="field-row"><span class="k">Offers</span><span class="v"><span class="dot ${c.offers}"></span> ${cap(c.offers)}</span></div>
    ${loginRow(c,'companion')}
    ${vettingChecklist(c)}
    <div class="section-t">Capacity & pay</div>
    <div class="field-row"><span class="k">Clients</span><span class="v">${used} / ${c.max_clients}</span></div>
    <div class="field-row"><span class="k">Pay rate</span><span class="v">£<input type="number" value="${(c.hourly_pay||0).toFixed(2)}" min="0" step="0.5" onchange="savePay('${c.id}',this.value)" style="width:80px;padding:6px 8px;border:1px solid var(--line);border-radius:7px;text-align:right;font-family:inherit">/hr</span></div>
    <div class="section-t">Personality & interests</div>
    <div class="field-row"><span class="k">Temperament</span><span class="v">${cap(c.temperament)||'—'}</span></div>
    ${c.fav_music?`<div class="field-row"><span class="k">Music</span><span class="v">${c.fav_music}</span></div>`:''}
    <div class="tags" style="margin-top:10px">${(c.interests||[]).map(i=>`<span class="tag">${i}</span>`).join('')||'<span class="sub2">No interest tags yet — add from their bio above</span>'}</div>
    <div class="section-t">Practical</div>
    ${(c.availability&&c.availability.length)?`<div class="field-row"><span class="k">Availability</span><span class="v">${c.availability.map(a=>availLabel(a)).join(', ')}</span></div>`:''}
    <div class="field-row"><span class="k">Right to work</span><span class="v">${c.right_to_work===true?'<span class="chip good">declared ✓</span>':c.right_to_work===false?'<span class="chip warn">not declared</span>':'—'}</span></div>
    <div class="field-row"><span class="k">Can drive</span><span class="v">${c.has_car?'Yes':'No'}</span></div>
    ${c.age_band?`<div class="field-row"><span class="k">Age band</span><span class="v">${c.age_band}</span></div>`:''}
    ${c.heard_about?`<div class="field-row"><span class="k">Heard via</span><span class="v">${cap(c.heard_about)}</span></div>`:''}
  </div>`);
}
function availLabel(a){return ({weekday_morning:'Weekday mornings',weekday_afternoon:'Weekday afternoons',evening:'Evenings',weekend:'Weekends',flexible:'Flexible'}[a])||a;}

/* ---------- LOGIN PROVISIONING (Model A: invite on approval) ---------- */
function loginRow(person, role){
  const approved = role==='companion' ? person.status==='active' : true; // requesters approved when confirmed
  if(person.login_provisioned){
    return `<div class="field-row"><span class="k">Login</span><span class="v"><span class="chip good">✓ invited${person.login_invited_at?' '+fmtDate(person.login_invited_at):''}</span></span></div>`;
  }
  if(!person.email){
    return `<div class="field-row"><span class="k">Login</span><span class="v"><span class="sub2">No email on file — add one to enable login</span></span></div>`;
  }
  if(!approved){
    return `<div class="field-row"><span class="k">Login</span><span class="v"><span class="sub2">${role==='companion'?'Mark active to enable their login':'Confirm to enable login'}</span></span></div>`;
  }
  return `<div class="field-row"><span class="k">Login</span><span class="v">
    <button class="btn sm primary" onclick="createLogin('${role}','${person.id}')">✉️ Send login invite</button>
    <div class="sub2" style="margin-top:4px">Emails ${person.email} a link to set their password</div></span></div>`;
}
function fmtDate(d){ try{ return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }catch(e){ return ''; } }
async function savePay(id, val){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  c.hourly_pay=Number(val)||0;
  if(typeof api!=='undefined' && api.live){ try{ await supa.update('companions',id,{hourly_pay:c.hourly_pay}); }catch(e){ alert('Could not save pay rate: '+e.message); } }
}
async function createLogin(role, id){
  const arr = role==='companion'?DB.companions:DB.requesters;
  const person=(arr||[]).find(x=>x.id===id); if(!person) return;
  if(!await cmpConfirm(`Send ${person.full_name} an email invite to set their password and access their portal?`,{title:'Send login invite',okText:'Send invite'})) return;
  if(typeof api!=='undefined' && api.live){
    const res=await provisionLogin(role,id);
    if(res.error){ alert('Could not create login: '+res.error); return; }
    person.login_provisioned=true; person.login_invited_at=new Date().toISOString();
    alert(`Invite sent to ${res.email}. They’ll set their own password and can then log in.`);
  } else {
    person.login_provisioned=true; person.login_invited_at=new Date().toISOString();
    alert('Demo: in live mode this emails them a set-password link.');
  }
  if(role==='companion') openCompanion(id); else render();
}

/* ---------- VETTING CHECKLIST (tick each clearance step per applicant) ---------- */
const VETTING_CHECKS=[
  {key:'chk_interview',     label:'Interview / met them',      hint:'You’ve spoken with them properly'},
  {key:'chk_right_to_work', label:'Right to work confirmed',   hint:'gov.uk online check done'},
  {key:'chk_dbs_submitted', label:'DBS submitted',             hint:'Application sent via umbrella body'},
  {key:'chk_dbs_cleared',   label:'DBS cleared',               hint:'Certificate back and clear'},
  {key:'chk_references',    label:'References received',       hint:'2 referees contacted'},
  {key:'chk_training',      label:'Induction / training done', hint:'Ready to visit clients'},
];
function vettingChecklist(c){
  const done=VETTING_CHECKS.filter(ch=>c[ch.key]).length;
  const total=VETTING_CHECKS.length;
  const pct=Math.round(done/total*100);
  const rows=VETTING_CHECKS.map(ch=>{
    const on=!!c[ch.key];
    return `<label class="vchk" style="display:flex;align-items:flex-start;gap:11px;padding:10px 2px;cursor:pointer;border-bottom:1px solid var(--line)">
      <input type="checkbox" ${on?'checked':''} onchange="toggleCheck('${c.id}','${ch.key}',this.checked)" style="width:20px;height:20px;margin-top:1px;accent-color:var(--good);cursor:pointer">
      <span style="flex:1"><span style="font-weight:700;${on?'color:var(--good)':''}">${ch.label}</span>
        <div class="sub2" style="font-size:.78rem">${ch.hint}</div></span>
      ${on?'<span class="chip good" style="align-self:center">done</span>':''}
    </label>`;
  }).join('');
  return `<div class="section-t" style="display:flex;justify-content:space-between;align-items:center">
      <span>Vetting checklist</span>
      <span class="chip ${done===total?'good':'warn'}">${done}/${total} done</span></div>
    <div style="background:var(--line);border-radius:99px;height:7px;margin:2px 0 10px"><div style="width:${pct}%;height:7px;border-radius:99px;background:${done===total?'var(--good)':'var(--wheat)'}"></div></div>
    ${rows}
    ${done===total?`<div style="margin-top:10px;padding:10px 12px;background:rgba(46,125,82,.08);border-radius:8px;color:var(--good);font-weight:700;font-size:.86rem">✓ Fully cleared — safe to mark active.</div>`:''}`;
}
async function toggleCheck(id,key,val){
  const c=DB.companions.find(x=>x.id===id); if(!c) return;
  c[key]=val;
  // mirror into the existing flags the pipeline/safety-gate use
  if(key==='chk_references') c.references_ok=val;
  if(key==='chk_dbs_cleared' && val){ c.dbs='cleared'; }
  else if(key==='chk_dbs_submitted' && val && c.dbs!=='cleared'){ c.dbs='submitted'; }
  if(typeof api!=='undefined' && api.live){
    const patch={[key]:val};
    try{ await supa.update('companions',id,patch); }catch(e){ alert('Could not save: '+e.message); }
  }
  // re-render the drawer so progress + chips update live
  openCompanion(id);
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
    ${sgUserBlock(u)}
    ${successPlanBlock(u)}
    <div class="section-t">Suggested companions</div>
    <div id="matchList"><div class="empty">Finding matches…</div></div>
  </div>`);
  fillMatchList(id);
}
// Success Plan — "know the person, not the booking"
function successPlanBlock(u){
  const row=(k,v)=>v?`<div class="field-row"><span class="k">${k}</span><span class="v">${v}</span></div>`:'';
  const age=u.birthday?` (${Math.floor((Date.now()-new Date(u.birthday))/3.15576e10)})`:'';
  const any=u.fav_music||u.routines||u.dietary||u.birthday||u.important_dates||u.family_details||u.conversation_starters;
  if(!any) return `<div class="section-t">Success plan</div><p class="muted" style="font-size:.86rem">No success-plan details yet — add favourite music, routines, key dates and family so visits feel personal.</p>`;
  return `<div class="section-t">Success plan</div>
    ${row('Favourite music',u.fav_music)}
    ${row('Routines',u.routines)}
    ${row('Dietary',u.dietary)}
    ${row('Birthday',u.birthday?fmt(u.birthday)+age:'')}
    ${row('Important dates',u.important_dates)}
    ${row('Family',u.family_details)}
    ${row('Conversation starters',u.conversation_starters)}`;
}
// Any safeguarding history for this client, shown in their drawer
function sgUserBlock(u){
  const items=sgList().filter(s=>s.service_user_id===u.id)
    .sort((a,b)=>new Date(b.raised_at)-new Date(a.raised_at));
  if(!items.length) return '';
  return `<div class="section-t">Safeguarding history</div>`+items.map(s=>
    `<div class="field-row"><span class="k">${fmt(s.raised_at)}</span><span class="v">${sevChip(s.severity)} ${SG_CATS[s.category]||s.category} · <span class="chip ${['open','reviewing'].includes(s.status)?'warn':'good'}">${cap(s.status)}</span></span></div>`
  ).join('');
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
  const u=DB.service_users.find(x=>x.id===userId);
  const c=DB.companions.find(x=>x.id===compId);
  if(!await cmpConfirm(`Introduce ${name.split(' ')[0]} to ${u?u.full_name:'this family'}?\n\nThis records the match and creates a draft booking you can confirm once the family agrees.`,{title:'Introduce companion',okText:'Introduce'})) return;
  if(typeof api!=='undefined' && api.live){
    try{
      await api.introduceMatch(DB,userId,compId);
      // create a draft booking tying requester + user + companion
      await supa.insert('bookings',{
        requester_id:u.requester_id, service_user_id:userId, companion_id:compId,
        service:(c&&c.offers&&c.offers!=='both')?c.offers:'companionship',
        frequency:'weekly', hourly_rate:32, visit_length_hrs:2, status:'draft'
      });
      await loadAll(DB);
      closeDrawer(); render();
      alert(`${name.split(' ')[0]} introduced — a draft booking is ready in Bookings. Confirm it once the family says yes.`);
    }catch(e){ alert('Could not introduce: '+e.message); }
  } else {
    // demo: create the draft booking locally so the flow is visible
    DB.bookings.push({id:'b'+Date.now(),requester_id:u.requester_id,service_user_id:userId,companion_id:compId,
      service:'companionship',frequency:'weekly',hourly_rate:32,visit_length_hrs:2,status:'draft'});
    closeDrawer(); render();
    alert(`Demo: ${name.split(' ')[0]} introduced — a draft booking now appears in Bookings.`);
  }
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
        <span class="cmp-logo" style="width:36px;height:36px"></span>
        <b style="font-family:var(--serif);font-size:1.4rem;color:var(--aubergine-dark)">Companio</b>
      </div>
      <p style="color:var(--muted);margin:0 0 22px;font-size:.9rem">Operations · sign in to continue</p>
      ${errMsg?`<div style="background:rgba(179,64,58,.1);color:var(--bad);border:1px solid rgba(179,64,58,.3);border-radius:9px;padding:10px 13px;font-size:.85rem;font-weight:700;margin-bottom:14px">${errMsg}</div>`:''}
      <label style="font-weight:700;font-size:.85rem">Email</label>
      <input id="li_email" type="email" required autocomplete="username" style="width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;margin:5px 0 14px;font:inherit">
      <label style="font-weight:700;font-size:.85rem">Password</label>
      <input id="li_pass" type="password" required autocomplete="current-password" style="width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;margin:5px 0 20px;font:inherit">
      <button class="btn primary" style="width:100%;padding:12px" type="submit">Sign in</button>
      <p style="text-align:center;margin:16px 0 0"><a href="#" id="li_forgot" style="color:var(--aubergine);font-size:.85rem;font-weight:600;text-decoration:none">Forgot your password?</a></p>
    </form>
  </div>`;
  const fp=$('#li_forgot');
  if(fp) fp.onclick=async(e)=>{
    e.preventDefault();
    const email=($('#li_email').value||'').trim();
    if(!email){ showLogin('Enter your email above first, then click “Forgot your password?”'); return; }
    try{ await auth.resetPassword(email); showLogin(''); alert('If an account exists for '+email+', a reset link is on its way. Check your inbox.'); }
    catch(err){ showLogin(err.message||'Could not send reset email'); }
  };
  $('#loginForm').onsubmit = async (e)=>{
    e.preventDefault();
    const btn=$('#loginForm button'); btn.textContent='Signing in…'; btn.disabled=true;
    try{
      await auth.login($('#li_email').value.trim(), $('#li_pass').value);
      const staff = await auth.verifyStaff();
      if(!staff){
        // Not an operator — they're probably a companion or family who landed
        // on the wrong page. Send them to the right portal instead of bouncing.
        const dest = await portalForCurrentUser();
        if(dest){ window.location.href = dest; return; }
        auth.logout();
        showLogin('That account isn’t a Companio operator. If you’re a companion or family member, use the link Companio sent you.');
        return;
      }
      location.reload();
    }catch(err){ showLogin(err.message||'Login failed'); }
  };
}

// Decide which portal a logged-in (non-staff) user belongs to, by looking up
// their auth id in companions / requesters. Returns a URL or null.
async function portalForCurrentUser(){
  try{
    const uid = SB.user && SB.user.id;
    if(!uid) return null;
    const comp = await supa.select('companions', `select=id&auth_user_id=eq.${uid}`).catch(()=>[]);
    if(comp && comp[0]) return 'portal-companion.html';
    const req = await supa.select('requesters', `select=id&auth_user_id=eq.${uid}`).catch(()=>[]);
    if(req && req[0]) return 'portal-requester.html';
  }catch(e){}
  return null;
}

/* ---------- BOOT ---------- */
async function boot(){
  if (typeof IS_LIVE !== 'undefined' && IS_LIVE) {
    // live mode: require a staff session
    if (!auth.restore()) { showLogin(); return; }
    let staff;
    try { staff = await auth.verifyStaff(); }
    catch(e){ auth.logout(); return; }
    if (!staff) {
      const dest = await portalForCurrentUser();
      if(dest){ window.location.href = dest; return; }
      showLogin('That account is not a Companio operator.');
      return;
    }
    try {
      $('#view').innerHTML = '<div class="empty">Loading your data…</div>';
      await loadAll(DB);
      await loadTextOverrides();
      await loadTheme();
    } catch(e){
      $('#view').innerHTML = '<div class="empty">Could not load data: '+e.message+'</div>'; return;
    }
    // reflect mode + who's signed in
    const m=$('#modeNote'); if(m) m.innerHTML = 'Mode: <b>Live</b><br><span class="muted" style="color:rgba(244,240,234,.5)">'+staff.full_name+'</span>';
    const so=$('#topSignout'); if(so) so.style.display='block';
  }
  renderNav(); render();
}
boot();
