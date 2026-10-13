/* ====== CONFIGURACIÓN: pega aquí los datos de tu proyecto de Supabase ====== */
const SUPABASE_URL = "https://xchugqfleewewjfsihdz.supabase.co";        // ej. https://abcdxyz.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_acxxGAthw0D71O-XVjEgAA_33q_1pEa";   // publishable key (sb_publishable_…) o anon public
/* ========================================================================== */

const N_Q = 15;
const TABLES = [1,2,3,4,5,6,7,8,9];
const LS_PENDING = "tablasXimena.pending";
const LS_CACHE = "tablasXimena.cache";
let view = "welcome";
let practiceData = [];     // pruebas recientes (para adaptar las preguntas)
let parentData = null;     // historial completo (solo en panel de papá)
let parentCreds = null;    // se guarda solo en memoria
let pollTimer = null;

/* ---------- Supabase (RPC por fetch, sin librerías) ---------- */
async function rpc(fn, body){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  const text = await r.text();
  let data = null; try{ data = text ? JSON.parse(text) : null; }catch(e){}
  if(!r.ok){ const err = new Error((data && data.message) || ("Error " + r.status)); err.status = r.status; throw err; }
  if(data && !Array.isArray(data) && data.error) throw new Error(data.error);
  return data;
}

/* ---------- almacenamiento local (respaldo) ---------- */
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function pending(){ return lsGet(LS_PENDING, []); }
function uuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==="x"?r:(r&3|8)).toString(16);});
}
async function flush(){
  const p = pending(); if(!p.length) return;
  const left = [];
  for(const t of p){
    try{ await rpc("guardar_prueba", {p: t}); }catch(e){ left.push(t); }
  }
  lsSet(LS_PENDING, left);
  updateSync();
}
async function loadPractice(){
  try{
    const d = await rpc("datos_practica", {});
    practiceData = Array.isArray(d) ? d : [];
    lsSet(LS_CACHE, practiceData);
  }catch(e){ practiceData = lsGet(LS_CACHE, []); }
}
function practiceList(){
  const ids = new Set(practiceData.map(t=>t.id));
  return practiceData.concat(pending().filter(p=>!ids.has(p.id))).sort((a,b)=>a.fecha-b.fecha);
}
function updateSync(){
  const n = pending().length;
  document.getElementById("sync").textContent = n ? `${n} prueba(s) guardada(s) en este aparato, se subirán cuando haya internet.` : "";
}

/* ---------- modelo de aprendizaje ---------- */
function factStats(list){
  const byTable = {}; TABLES.forEach(t=>byTable[t]=[]);
  const factMiss = {};
  const ordered = list.slice().sort((a,b)=>b.fecha-a.fecha);
  ordered.forEach((t,ti)=>{
    (t.respuestas||[]).forEach(r=>{
      if(byTable[r.a]) byTable[r.a].push(r);
      const k = r.a+"×"+r.b;
      if(!factMiss[k]) factMiss[k] = {a:r.a,b:r.b,miss:0,total:0,recentMiss:0};
      factMiss[k].total++;
      if(!r.ok){ factMiss[k].miss++; if(ti<3) factMiss[k].recentMiss++; }
    });
  });
  return {byTable, factMiss};
}
function tableStatus(list){
  const {byTable} = factStats(list);
  const out = {};
  TABLES.forEach(t=>{
    const all = byTable[t];
    const recent = all.slice(0,12);
    const n = recent.length;
    const acc = n ? recent.filter(r=>r.ok).length/n : null;
    const totalAcc = all.length ? all.filter(r=>r.ok).length/all.length : null;
    const times = recent.filter(r=>r.ok && r.ms).map(r=>r.ms);
    const avgMs = times.length ? times.reduce((s,x)=>s+x,0)/times.length : null;
    let st = "nueva";
    if(n >= 8 && acc >= 0.9 && (avgMs===null || avgMs < 8000)) st = "dominada";
    else if(n >= 4 && acc < 0.7) st = "practicar";
    else if(n >= 1) st = "camino";
    out[t] = {n, acc, totalAcc, total:all.length, avgMs, st};
  });
  return out;
}
function weightFor(s){
  if(s.st==="dominada") return 0.2;
  if(s.st==="nueva") return 1.2;
  return 1 + (1 - s.acc) * 3;
}
function buildQuiz(){
  const list = practiceList();
  const status = tableStatus(list);
  const {factMiss} = factStats(list);
  const qs = []; const used = new Set();
  const perTable = {}; TABLES.forEach(t=>perTable[t]=0);
  Object.values(factMiss).filter(f=>f.recentMiss>0).sort((a,b)=>b.recentMiss-a.recentMiss)
    .slice(0,4).forEach(f=>{ const k=f.a+"×"+f.b; if(!used.has(k)){used.add(k); qs.push({a:f.a,b:f.b}); perTable[f.a]++;} });
  let guard = 0;
  while(qs.length < N_Q && guard++ < 500){
    const w = TABLES.map(t=>{
      const s = status[t]; let x = weightFor(s);
      if(s.st==="dominada" && perTable[t] >= 1) x = 0;
      return x;
    });
    const sum = w.reduce((a,b)=>a+b,0); if(!sum) break;
    let r = Math.random()*sum, t = TABLES[0];
    for(let i=0;i<w.length;i++){ r -= w[i]; if(r<=0){ t = TABLES[i]; break; } }
    const b = 1 + Math.floor(Math.random()*10);
    const k = t+"×"+b; if(used.has(k)) continue;
    used.add(k); qs.push({a:t,b}); perTable[t]++;
  }
  while(qs.length < N_Q){ const a=1+Math.floor(Math.random()*9), b=1+Math.floor(Math.random()*10); const k=a+"×"+b; if(!used.has(k)){used.add(k);qs.push({a,b});} }
  for(let i=qs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [qs[i],qs[j]]=[qs[j],qs[i]]; }
  return qs;
}

/* ---------- utilidades ---------- */
const $app = () => document.getElementById("app");
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function fmtDate(ms){ return new Date(ms).toLocaleString("es-MX",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}); }
function grade10(ok,total){ return Math.round(ok/total*100)/10; }
function gradeColor(g){ return g>=9 ? "var(--good)" : g>=7 ? "var(--warn)" : "var(--bad)"; }
function star(on){ return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z" fill="${on?'var(--sun)':'var(--line)'}" stroke="${on?'var(--coral-ink)':'none'}" stroke-width="1"/></svg>`; }
const ST_LABEL = {dominada:["Dominada","g"],camino:["En camino","w"],practicar:["Practicar","b"],nueva:["Sin datos","n"]};
function setNav(show){ const nb=document.getElementById("navBtn"); nb.hidden=!show; nb.textContent="Cambiar de usuario"; }
function stopPoll(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }

/* ---------- bienvenida ---------- */
function renderWelcome(){
  view="welcome"; setNav(false); stopPoll(); parentCreds=null; parentData=null;
  $app().innerHTML = `
  <section class="card hello">
    <h1>¿Quién va a entrar?</h1>
    <div class="who">
      <button class="whoBtn" id="wX" type="button">
        <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 30 L4 12 L13 20 L20 8 L27 20 L36 12 L34 30 Z" fill="var(--sun)" stroke="var(--coral-ink)" stroke-width="2" stroke-linejoin="round"/><rect x="6" y="30" width="28" height="4" rx="2" fill="var(--coral)"/></svg>
        <b>Soy Ximena</b><span>Hacer una prueba</span>
      </button>
      <button class="whoBtn dad" id="wP" type="button">
        <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="22" width="6" height="12" rx="2" fill="var(--mint)"/><rect x="17" y="14" width="6" height="20" rx="2" fill="var(--sun)"/><rect x="27" y="6" width="6" height="28" rx="2" fill="var(--coral)"/></svg>
        <b>Papá</b><span>Ver historial y avance</span>
      </button>
    </div>
  </section>`;
  document.getElementById("wX").onclick = renderHome;
  document.getElementById("wP").onclick = renderLogin;
}

/* ---------- Ximena ---------- */
async function renderHome(){
  view="home"; setNav(true);
  $app().innerHTML = `<section class="card hello"><h1>¡Hola, Ximena!</h1><p>Cargando…</p></section>`;
  await flush(); await loadPractice();
  if(view!=="home") return;
  const list = practiceList(); const last = list[list.length-1];
  const status = tableStatus(list);
  const dom = TABLES.filter(t=>status[t].st==="dominada");
  const prac = TABLES.filter(t=>status[t].st==="practicar");
  $app().innerHTML = `
  <section class="card hello">
    <h1>¡Hola, Ximena!</h1>
    <p>Cada prueba tiene ${N_Q} preguntas de las tablas del 1 al 9. Escribe tu respuesta y presiona la palomita.</p>
    <button class="btn" id="start" type="button">Iniciar prueba</button>
    ${last ? `<p class="muted" style="font-size:.95rem">Tu última calificación: <b style="color:${gradeColor(last.calificacion)}">${last.calificacion}</b></p>` : ""}
    ${(dom.length||prac.length) ? `<div class="chips">
      ${dom.map(t=>`<span class="chip g">★ Tabla del ${t}</span>`).join("")}
      ${prac.map(t=>`<span class="chip b">Practicando la del ${t}</span>`).join("")}
    </div>` : ""}
  </section>`;
  document.getElementById("start").onclick = startQuiz;
}

let quiz = null;
function startQuiz(){
  quiz = {qs:buildQuiz(), i:0, input:"", res:[], t0:performance.now(), locked:false, started:Date.now()};
  renderQ();
}
function renderQ(){
  view="quiz";
  const q = quiz.qs[quiz.i];
  const dots = quiz.qs.map((_,k)=>`<span class="dot ${k<quiz.i ? (quiz.res[k].ok?'ok':'no') : k===quiz.i?'cur':''}"></span>`).join("");
  $app().innerHTML = `
  <section class="card">
    <div class="qhead"><span>Pregunta ${quiz.i+1} de ${N_Q}</span><div class="dots" aria-hidden="true">${dots}</div></div>
    <div class="q pop">${q.a} × ${q.b}</div>
    <div class="ans" id="ans" aria-live="polite">${esc(quiz.input)||"&nbsp;"}</div>
    <div class="fb" id="fb" aria-live="polite"></div>
    <div class="pad">
      ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="key" data-k="${n}" type="button">${n}</button>`).join("")}
      <button class="key del" data-k="del" type="button" aria-label="Borrar">Borrar</button>
      <button class="key" data-k="0" type="button">0</button>
      <button class="key go" data-k="ok" type="button" aria-label="Revisar">✓</button>
    </div>
  </section>`;
  document.querySelectorAll(".key").forEach(b=>b.onclick=()=>press(b.dataset.k));
  quiz.t0 = performance.now();
}
function press(k){
  if(!quiz || quiz.locked) return;
  if(k==="del") quiz.input = quiz.input.slice(0,-1);
  else if(k==="ok"){ if(quiz.input) check(); return; }
  else if(quiz.input.length < 3) quiz.input += k;
  document.getElementById("ans").innerHTML = esc(quiz.input)||"&nbsp;";
}
function check(){
  quiz.locked = true;
  const q = quiz.qs[quiz.i]; const val = parseInt(quiz.input,10);
  const ok = val === q.a*q.b;
  quiz.res.push({a:q.a,b:q.b,resp:val,ok,ms:Math.round(performance.now()-quiz.t0)});
  const ans = document.getElementById("ans"), fb = document.getElementById("fb");
  ans.classList.add(ok?"ok":"no");
  const cheers = ["¡Muy bien!","¡Excelente!","¡Así se hace!","¡Perfecto!","¡Bravo!"];
  fb.innerHTML = ok ? `<span style="color:var(--good)">${cheers[Math.floor(Math.random()*cheers.length)]}</span>`
                    : `<span style="color:var(--bad)">Casi. ${q.a} × ${q.b} = ${q.a*q.b}</span>`;
  setTimeout(()=>{
    quiz.i++; quiz.input=""; quiz.locked=false;
    if(quiz.i >= N_Q) finish(); else renderQ();
  }, ok ? 900 : 2200);
}
async function finish(){
  const ok = quiz.res.filter(r=>r.ok).length;
  const t = {
    id: uuid(), fecha: Date.now(), aciertos: ok, total: N_Q,
    calificacion: grade10(ok,N_Q),
    duracionSeg: Math.round((Date.now()-quiz.started)/1000),
    respuestas: quiz.res
  };
  lsSet(LS_PENDING, pending().concat([t]));   // primero en el aparato: nunca se pierde
  renderResult(t);
  await flush();
}
function renderResult(t){
  view="result";
  const g = t.calificacion;
  const nStars = g>=9.5?3:g>=8?2:g>=6?1:0;
  const msg = g===10 ? "¡Perfecta! Eres una campeona de las tablas." : g>=8 ? "¡Muy buen trabajo! Ya casi todas te salen." : g>=6 ? "¡Vas muy bien! Vamos a practicar las que fallaste." : "Cada prueba te hace más fuerte. ¡Otra vez!";
  const misses = t.respuestas.filter(r=>!r.ok);
  $app().innerHTML = `
  <section class="card result">
    <div class="stars">${[0,1,2].map(i=>star(i<nStars)).join("")}</div>
    <div class="grade pop" style="color:${gradeColor(g)}">${g}</div>
    <div class="muted" style="font-weight:800">${t.aciertos} de ${t.total} correctas</div>
    <h2 style="font-size:1.4rem">${msg}</h2>
    ${misses.length ? `<p class="muted" style="margin:0">Estas son las que hay que repasar:</p>
    <div class="review">${misses.map(r=>`<div class="rv no">${r.a} × ${r.b} = ${r.a*r.b}<small>Escribiste ${r.resp}</small></div>`).join("")}</div>` : ""}
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:8px">
      <button class="btn" id="again" type="button">Otra prueba</button>
      <button class="btn alt" id="home" type="button">Inicio</button>
    </div>
  </section>`;
  document.getElementById("again").onclick = async ()=>{ await loadPractice(); startQuiz(); };
  document.getElementById("home").onclick = renderHome;
}

/* ---------- Papá ---------- */
function renderLogin(){
  view="login"; setNav(true);
  $app().innerHTML = `
  <section class="card gate">
    <h2>Panel de papá</h2>
    <form id="gf" style="display:flex;flex-direction:column;gap:10px">
      <label for="gu" class="muted" style="font-weight:700">Usuario</label>
      <input id="gu" autocomplete="username" autocapitalize="characters" style="width:220px">
      <label for="gp" class="muted" style="font-weight:700">Contraseña</label>
      <input id="gp" type="password" inputmode="numeric" autocomplete="current-password" style="width:220px">
      <button class="btn" type="submit" style="font-size:1rem;padding:10px 20px;align-self:flex-start">Entrar</button>
    </form>
    <p id="gerr" class="muted" style="margin:0"></p>
  </section>`;
  document.getElementById("gf").onsubmit = async e=>{
    e.preventDefault();
    const usuario = document.getElementById("gu").value.trim();
    const clave = document.getElementById("gp").value;
    const err = document.getElementById("gerr");
    err.textContent = "Revisando…";
    try{
      const d = await rpc("panel_papa", {usuario, clave});
      parentCreds = {usuario, clave}; parentData = Array.isArray(d) ? d : [];
      renderParent();
      stopPoll(); pollTimer = setInterval(refreshParent, 5000);
    }catch(x){
      err.textContent = /bloqueado/i.test(x.message) ? "Demasiados intentos. Espera 15 minutos." :
                        /incorrecto/i.test(x.message) ? "Usuario o contraseña incorrectos." :
                        "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
    }
  };
}
async function refreshParent(){
  if(view!=="parent" || !parentCreds || document.hidden) return;
  try{
    const d = await rpc("panel_papa", parentCreds);
    const next = Array.isArray(d) ? d : [];
    if(next.length !== parentData.length){
      const openIds = [...document.querySelectorAll("details.h[open]")].map(x=>x.dataset.id);
      parentData = next; renderParent(openIds);
    }
  }catch(e){}
}
function trendSvg(list){
  const pts = list.slice(-30);
  if(pts.length < 2) return `<p class="muted" style="margin:0">La gráfica aparece después de 2 pruebas.</p>`;
  const W=640,H=200,L=34,R=12,T=12,B=26;
  const x = i => L + i*(W-L-R)/(pts.length-1);
  const y = v => T + (10-v)*(H-T-B)/10;
  const grid = [0,5,7,9,10].map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`).join("");
  const line = pts.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p.calificacion).toFixed(1)}`).join(" ");
  const area = line + ` L${x(pts.length-1)},${y(0)} L${x(0)},${y(0)} Z`;
  const dots = pts.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.calificacion)}" r="${i===pts.length-1?5:3}" fill="${i===pts.length-1?'var(--coral)':'var(--surface)'}" stroke="var(--coral)" stroke-width="2"><title>${fmtDate(p.fecha)}: ${p.calificacion}</title></circle>`).join("");
  const d0 = new Date(pts[0].fecha).toLocaleDateString("es-MX",{day:"numeric",month:"short"});
  const d1 = new Date(pts[pts.length-1].fecha).toLocaleDateString("es-MX",{day:"numeric",month:"short"});
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calificaciones de las últimas pruebas">${grid}<path d="${area}" fill="var(--coral)" opacity=".1"/><path d="${line}" fill="none" stroke="var(--coral)" stroke-width="2.5" stroke-linejoin="round"/>${dots}<text x="${L}" y="${H-6}" font-size="11" fill="var(--muted)">${d0}</text><text x="${W-R}" y="${H-6}" text-anchor="end" font-size="11" fill="var(--muted)">${d1}</text></svg></div>`;
}
function renderParent(openIds){
  view="parent"; setNav(true);
  const list = (parentData||[]).slice().sort((a,b)=>a.fecha-b.fecha);
  const status = tableStatus(list);
  const {factMiss} = factStats(list);
  const n = list.length;
  const avg = n ? Math.round(list.reduce((s,t)=>s+Number(t.calificacion),0)/n*10)/10 : null;
  const last5 = list.slice(-5);
  const avg5 = last5.length ? Math.round(last5.reduce((s,t)=>s+Number(t.calificacion),0)/last5.length*10)/10 : null;
  const best = n ? Math.max(...list.map(t=>Number(t.calificacion))) : null;
  const dom = TABLES.filter(t=>status[t].st==="dominada");
  const prac = TABLES.filter(t=>status[t].st==="practicar");
  const camino = TABLES.filter(t=>status[t].st==="camino");
  const worstFacts = Object.values(factMiss).filter(f=>f.miss>0).sort((a,b)=>(b.miss/b.total)-(a.miss/a.total) || b.miss-a.miss).slice(0,10);
  const ordered = TABLES.slice().sort((a,b)=>(status[a].acc??2)-(status[b].acc??2));
  const open = new Set(openIds||[]);

  let plan = "";
  if(!n) plan = "<p>Todavía no hay pruebas. Cuando Ximena haga la primera, aquí verás qué tablas domina y cuáles practicar.</p>";
  else {
    if(prac.length) plan += `<p><b>Enfocar esta semana:</b> tabla${prac.length>1?"s":""} del ${prac.join(", ")}. La app ya le pregunta más de estas.</p>`;
    if(camino.length) plan += `<p><b>Reforzar:</b> ${camino.join(", ")}. Van bien, falta constancia.</p>`;
    if(dom.length) plan += `<p><b>Ya domina:</b> ${dom.join(", ")}. Solo aparecen como repaso, máximo una vez por prueba.</p>`;
    if(worstFacts.length) plan += `<p><b>Multiplicaciones que más se le complican:</b> ${worstFacts.slice(0,4).map(f=>f.a+"×"+f.b).join(", ")}.</p>`;
  }

  $app().innerHTML = `
  <section class="card sec">
    <h2>Avance de Ximena</h2>
    <div class="kpis">
      <div class="kpi"><span>Pruebas</span><b>${n}</b></div>
      <div class="kpi"><span>Promedio general</span><b style="color:${avg!==null?gradeColor(avg):'inherit'}">${avg ?? "—"}</b></div>
      <div class="kpi"><span>Últimas 5</span><b style="color:${avg5!==null?gradeColor(avg5):'inherit'}">${avg5 ?? "—"}</b></div>
      <div class="kpi"><span>Mejor</span><b>${best ?? "—"}</b></div>
    </div>
    <div class="plan">${plan}</div>
    <p class="muted" style="margin:0;font-size:.8rem">Se actualiza solo cada 5 segundos.</p>
  </section>

  <section class="card sec">
    <h2>Calificaciones</h2>
    ${trendSvg(list)}
  </section>

  <section class="card sec">
    <h2>Dominio por tabla</h2>
    <p class="muted" style="margin:0;font-size:.9rem">Basado en sus últimas 12 respuestas de cada tabla. "Dominada" = 90% o más de aciertos con al menos 8 respuestas.</p>
    <div>
    ${ordered.map(t=>{
      const s = status[t]; const [lab,cls] = ST_LABEL[s.st];
      const pct = s.acc===null ? 0 : Math.round(s.acc*100);
      const col = s.st==="dominada"?"var(--good)":s.st==="practicar"?"var(--bad)":s.st==="camino"?"var(--warn)":"var(--line)";
      return `<div class="trow">
        <div class="tname">× ${t}</div>
        <div style="min-width:0"><div class="bar"><i style="width:${pct}%;background:${col}"></i></div>
          <div class="tmeta">${s.acc===null?"Sin respuestas aún":`${pct}% reciente · ${Math.round(s.totalAcc*100)}% histórico · ${s.total} respuestas${s.avgMs?` · ${(s.avgMs/1000).toFixed(1)} s promedio`:""}`}</div></div>
        <span class="chip ${cls}">${lab}</span>
      </div>`;}).join("")}
    </div>
  </section>

  ${worstFacts.length ? `<section class="card sec">
    <h2>Las que más falla</h2>
    <div class="facts">${worstFacts.map(f=>`<span class="fact">${f.a} × ${f.b} = ${f.a*f.b}<small>${f.miss} de ${f.total}</small></span>`).join("")}</div>
  </section>` : ""}

  <section class="card sec">
    <h2>Historial completo</h2>
    <div class="hist">
    ${n ? list.slice().reverse().map(t=>`<details class="h" data-id="${esc(t.id)}" ${open.has(String(t.id))?"open":""}>
      <summary><span>${fmtDate(t.fecha)}</span><span><b style="color:${gradeColor(Number(t.calificacion))}">${t.calificacion}</b> · ${t.aciertos}/${t.total}</span></summary>
      <div class="review">${(t.respuestas||[]).map(r=>`<div class="rv ${r.ok?'':'no'}">${r.a} × ${r.b} = ${r.ok?r.resp:r.a*r.b}${r.ok?"":`<small>Escribió ${r.resp}</small>`}</div>`).join("")}</div>
      ${t.duracionSeg?`<p class="muted" style="margin:8px 0 0;font-size:.85rem">Duración: ${Math.floor(t.duracionSeg/60)} min ${t.duracionSeg%60} s</p>`:""}
    </details>`).join("") : `<p class="muted" style="margin:0">Aún no hay pruebas guardadas.</p>`}
    </div>
  </section>`;
}

/* ---------- arranque ---------- */
document.getElementById("navBtn").onclick = ()=>{
  if(view==="quiz" && quiz && quiz.i>0 && quiz.i<N_Q) return;
  quiz = null; renderWelcome();
};
document.addEventListener("keydown", e=>{
  if(view!=="quiz") return;
  if(/^[0-9]$/.test(e.key)) press(e.key);
  else if(e.key==="Backspace") press("del");
  else if(e.key==="Enter") press("ok");
});
window.addEventListener("online", flush);
renderWelcome(); updateSync(); flush();
