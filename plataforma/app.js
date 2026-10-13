/* Observatorio de Riesgo Cardiovascular · Julián Rosonovich · Epidemiología */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const CFG = window.OBS_CONFIG || {};
const ENFR = { tab: 22.2, glu: 12.7, obe: 25.3, fyv: 94.0, sal: 16.4, col: 28.9 }; // ENFR 2018, total país, autorreporte
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

let sb = null, perfil = null, municipios = [], encuestas = [], ctxMuni = '', curTab = '';
const filt = { sexo: '', zona: '', edad: '' };

/* ================= utilidades ================= */
const num = v => { if (v === '' || v == null) return null; const n = Number(v); return isFinite(n) ? n : null; };
const pct = (a, b) => b ? 100 * a / b : null;
const f1 = v => v == null || isNaN(v) ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
function wilson(x, n) { if (!n) return [null, null]; const z = 1.96, p = x / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [100 * (c - m) / d, 100 * (c + m) / d]; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3200); }
const grupoEdad = e => e < 35 ? '18-34' : e < 50 ? '35-49' : e < 65 ? '50-64' : '65+';
const hoy = () => new Date().toLocaleDateString('en-CA');
function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9.@_-]+/g, '-').replace(/^-+|-+$/g, ''); }
const muniNombre = id => (municipios.find(m => m.id === id) || {}).nombre || id || '';
const esRol = (...r) => perfil && r.includes(perfil.rol);

/* ================= variables derivadas ================= */
function deriv(r) {
  const d = {};
  const pas = [r.pas1, r.pas2].filter(v => v != null), pad = [r.pad1, r.pad2].filter(v => v != null);
  d.pas = pas.length ? pas.reduce((a, b) => a + b) / pas.length : null;
  d.pad = pad.length ? pad.reduce((a, b) => a + b) / pad.length : null;
  d.paElev = d.pas != null && (d.pas >= 140 || d.pad >= 90);
  d.hta = d.paElev || !!r.htaTto;
  d.htaNoDx = d.paElev && !r.htaDx;
  d.imc = (r.peso && r.talla) ? r.peso / Math.pow(r.talla / 100, 2) : null;
  d.obe = d.imc != null && d.imc >= 30; d.sobre = d.imc != null && d.imc >= 25 && d.imc < 30;
  d.cintR = r.cintura != null ? (r.sexo === 'F' ? r.cintura > 88 : r.cintura > 102) : null;
  const met = 8 * (r.vigD || 0) * (r.vigM || 0) + 4 * (r.modD || 0) * (r.modM || 0) + 3.3 * (r.camD || 0) * (r.camM || 0);
  d.met = Math.round(met); d.afBaja = met < 600;
  d.glucMed = r.glucemia != null && (r.ayunas === 'si' ? r.glucemia >= 126 : r.glucemia >= 200);
  d.glu = d.glucMed || !!r.dbtDx || !!r.dbtTto;
  d.tab = r.tabaco === 'diario' || r.tabaco === 'ocasional';
  d.fyvIns = r.fyv != null && r.fyv < 5;
  d.sal = r.sal === 'siempre';
  d.col = (r.colTotal != null && r.colTotal >= 240) || !!r.colDx;
  d.nfr = [d.tab, d.hta, d.glu, d.obe, d.afBaja, d.col].filter(Boolean).length;
  return d;
}
function derivacion(r, d) {
  const out = [];
  if (d.pas != null && (d.pas >= 180 || d.pad >= 110)) out.push(['crit', `PA ${Math.round(d.pas)}/${Math.round(d.pad)} mmHg: derivar hoy a guardia o centro de salud.`]);
  else if (d.paElev && !r.htaDx) out.push(['warn', `PA ${Math.round(d.pas)}/${Math.round(d.pad)} mmHg sin diagnóstico previo: turno en el centro de salud.`]);
  else if (d.paElev && r.htaDx) out.push(['warn', 'Hipertensión conocida no controlada: control con su médico.']);
  if (r.glucemia != null) {
    if (r.glucemia >= 250) out.push(['crit', `Glucemia ${r.glucemia} mg/dL: derivar hoy.`]);
    else if (r.glucemia < 70) out.push(['crit', `Glucemia ${r.glucemia} mg/dL (baja): ofrecer azúcar y evaluar.`]);
    else if (d.glucMed && !r.dbtDx) out.push(['warn', `Glucemia ${r.glucemia} mg/dL sin diagnóstico previo: turno para estudio.`]);
  }
  if (r.colTotal != null && r.colTotal >= 240 && !r.colDx) out.push(['warn', `Colesterol ${r.colTotal} mg/dL: turno para perfil lipídico.`]);
  if (d.nfr >= 3) out.push(['warn', `${d.nfr} factores de riesgo acumulados: consejería y control en atención primaria.`]);
  return out;
}

/* ================= datos ================= */
const pendKey = () => 'obs_pendientes_' + (perfil ? perfil.id : 'x');
const pendientes = () => LS.get(pendKey(), []);
const setPendientes = a => { LS.set(pendKey(), a); renderSync(); };
const plano = e => ({ ...(e.datos || {}), id: e.id, municipio_id: e.municipio_id, zona: e.zona, fecha: e.fecha, encuestador: e.encuestador, creado_en: e.creado_en });

function dataset() {
  return encuestas.map(plano).filter(r => !ctxMuni || r.municipio_id === ctxMuni);
}
function filtered() {
  return dataset().filter(r => (!filt.sexo || r.sexo === filt.sexo) && (!filt.zona || r.zona === filt.zona) && (!filt.edad || grupoEdad(r.edad) === filt.edad));
}

async function cargarEncuestas() {
  if (!perfil || !perfil.rol) return;
  const todas = []; const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await sb.from('encuestas').select('id,municipio_id,zona,fecha,encuestador,datos,creado_en').order('creado_en', { ascending: false }).range(desde, desde + paso - 1);
    if (error) { if (!navigator.onLine) return; toast('No se pudieron cargar las encuestas: ' + error.message); return; }
    todas.push(...data);
    if (data.length < paso) break;
  }
  encuestas = todas; LS.set('obs_cache_' + perfil.id, encuestas);
  renderTodo();
}

async function sincronizar() {
  const lista = pendientes();
  if (!lista.length || !navigator.onLine) { renderSync(); return; }
  const ses = await sb.auth.getSession();
  if (!ses.data || !ses.data.session) { toast('Para subir las encuestas guardadas, salí y volvé a ingresar con tu usuario.'); renderSync(); return; }
  const quedan = []; let subidas = 0, rechazadas = 0;
  for (const p of lista) {
    const { error } = await sb.from('encuestas').insert(p.fila);
    if (!error || error.code === '23505') { subidas++; continue; }
    const definitivo = ['42501', '23503', '23502', '22P02', '22007', '22008'].includes(error.code);
    if (!definitivo) { quedan.push(p); continue; }
    rechazadas++; quedan.push({ ...p, error: error.message });
  }
  setPendientes(quedan);
  if (subidas) { toast(subidas === 1 ? 'Se subió 1 encuesta pendiente.' : `Se subieron ${subidas} encuestas pendientes.`); await cargarEncuestas(); }
  if (rechazadas) toast(`${rechazadas} encuesta(s) no se pudieron subir. Revisá la pestaña Encuestas.`);
}
function renderSync() {
  const n = pendientes().length, b = $('#syncBadge');
  b.hidden = false;
  if (n) { b.className = 'sync'; b.textContent = navigator.onLine ? `${n} por subir` : `Sin señal · ${n} guardada${n > 1 ? 's' : ''} en el teléfono`; }
  else if (!navigator.onLine) { b.className = 'sync'; b.textContent = 'Sin señal'; }
  else b.hidden = true;
  $('#btnSync').hidden = !n;
}

/* ================= ingreso ================= */
function mostrarLogin(msg) {
  $('#vLoading').hidden = true; $('#vApp').hidden = true; $('#vLogin').hidden = false;
  if (msg) { $('#lErr').textContent = msg; $('#lErr').hidden = false; }
  setTimeout(() => $('#lUser').focus(), 50);
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const u = slug($('#lUser').value), p = $('#lPass').value;
  $('#lErr').hidden = true;
  if (!u || !p) { mostrarLogin('Completá usuario y contraseña.'); return; }
  if (!sb) { mostrarLogin('La plataforma todavía no está configurada (falta config.js).'); return; }
  const email = u.includes('@') ? u : `${u}@${CFG.DOMINIO_USUARIOS}`;
  $('#lBtn').disabled = true; $('#lBtn').textContent = 'Ingresando…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: p });
  $('#lBtn').disabled = false; $('#lBtn').textContent = 'Ingresar';
  if (error) { mostrarLogin(/invalid/i.test(error.message) ? 'Usuario o contraseña incorrectos.' : !navigator.onLine ? 'Sin conexión. Para ingresar la primera vez necesitás internet.' : 'No se pudo ingresar: ' + error.message); return; }
  $('#lPass').value = '';
  await iniciarSesion(data.session);
});
$('#bLogout').addEventListener('click', async () => {
  if (pendientes().length && !confirm('Hay encuestas sin subir en este teléfono. Si salís, quedan guardadas pero no se suben hasta que vuelvas a ingresar con este usuario. ¿Salir igual?')) return;
  try { localStorage.removeItem('obs_last_uid'); } catch (e) {}
  await sb.auth.signOut().catch(() => {}); perfil = null; encuestas = []; mostrarLogin();
});

async function iniciarSesion(session) {
  const uid = session.user.id;
  const { data, error } = await sb.from('perfiles').select('*').eq('id', uid).maybeSingle();
  if (data) { perfil = data; LS.set('obs_perfil_' + uid, data); LS.set('obs_last_uid', uid); }
  else if (error && !navigator.onLine) perfil = LS.get('obs_perfil_' + uid, null);
  if (!perfil) { await sb.auth.signOut(); mostrarLogin('No se encontró el perfil de este usuario. Escribile al administrador.'); return; }
  const m = await sb.from('municipios').select('*').order('nombre');
  if (m.data) { municipios = m.data; LS.set('obs_munis', municipios); } else municipios = LS.get('obs_munis', []);
  encuestas = LS.get('obs_cache_' + uid, []);
  mostrarApp();
  cargarEncuestas(); sincronizar();
}

/* ================= aplicación ================= */
function mostrarApp() {
  $('#vLoading').hidden = true; $('#vLogin').hidden = true; $('#vApp').hidden = false;
  const activo = perfil.rol && (perfil.rol === 'admin' || perfil.municipio_id);
  $('#noRole').hidden = !!activo;
  $$('.tabs button').forEach(b => b.hidden = false);
  $$('[data-roles]').forEach(el => el.hidden = !esRol(...el.dataset.roles.split(' ')));
  $$('.tabs button').forEach(b => { if (!activo && b.dataset.tab !== 'met') b.hidden = true; });
  // contexto de municipio
  if (perfil.rol === 'admin') {
    ctxMuni = LS.get('obs_ctx', '');
    if (ctxMuni && !municipios.some(m => m.id === ctxMuni)) ctxMuni = '';
    $('#ctxMuni').hidden = false; $('#muniName').textContent = '';
  } else {
    ctxMuni = perfil.municipio_id || '';
    $('#ctxMuni').hidden = true; $('#muniName').textContent = muniNombre(ctxMuni);
  }
  const rolTxt = { admin: 'Administrador', gestor: 'Gestión municipal', encuestador: 'Equipo de campo' }[perfil.rol] || 'Sin rol asignado';
  $('#hello').textContent = `${perfil.nombre || perfil.usuario} · ${rolTxt}`;
  renderCtx(); resetForm(true);
  const def = !activo ? 'met' : perfil.rol === 'encuestador' ? 'form' : 'dash';
  const prev = LS.get('obs_tab_' + perfil.id, def);
  setTab($(`.tabs button[data-tab="${prev}"]:not([hidden])`) ? prev : def);
  renderSync();
  if (perfil.rol === 'admin') cargarAdmin();
}

function renderCtx() {
  const sel = $('#ctxMuni');
  sel.innerHTML = '<option value="">Todos los municipios</option>' + municipios.map(m => `<option value="${esc(m.id)}" ${m.id === ctxMuni ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('');
  const opts = perfil.rol === 'admin' ? municipios : municipios.filter(m => m.id === perfil.municipio_id);
  const ms = $('#municipio'), actual = ms.value || ctxMuni || perfil.municipio_id || (opts[0] || {}).id;
  ms.innerHTML = opts.map(m => `<option value="${esc(m.id)}" ${m.id === actual ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('');
  ms.disabled = perfil.rol !== 'admin';
  const zs = [...new Set(dataset().map(r => r.zona).filter(Boolean))].sort();
  $('#dlZona').innerHTML = zs.map(z => `<option value="${esc(z)}">`).join('');
  if (filt.zona && !zs.includes(filt.zona)) filt.zona = '';
  $('#fZona').innerHTML = '<option value="">Todas</option>' + zs.map(z => `<option ${z === filt.zona ? 'selected' : ''}>${esc(z)}</option>`).join('');
}
function renderTodo() { renderCtx(); renderDash(); renderBase(); }

function setTab(t) {
  curTab = t;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('[role=tabpanel]').forEach(p => p.hidden = p.id !== 'p-' + t);
  if (perfil) LS.set('obs_tab_' + perfil.id, t);
  if (t === 'dash') renderDash();
  if (t === 'base') renderBase();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) setTab(g.dataset.go); });
$('#ctxMuni').addEventListener('change', e => { ctxMuni = e.target.value; LS.set('obs_ctx', ctxMuni); filt.zona = ''; if (ctxMuni) $('#municipio').value = ctxMuni; renderTodo(); });
$$('.seg button').forEach(b => b.addEventListener('click', () => { filt.sexo = b.dataset.sexo; $$('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderDash(); }));
$('#fZona').addEventListener('change', e => { filt.zona = e.target.value; renderDash(); });
$('#fEdad').addEventListener('change', e => { filt.edad = e.target.value; renderDash(); });
$('#bRefresh').addEventListener('click', () => cargarEncuestas().then(() => toast('Tablero actualizado')));

/* ================= gráficos ================= */
const svg = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" role="img" font-family="Source Sans 3, system-ui, sans-serif">${inner}</svg>`;
const C = { teal: 'fill:var(--teal)', navy: 'fill:var(--navy-2)', ref: 'fill:var(--ref)', crit: 'fill:var(--crit)', ink: 'fill:var(--ink)', muted: 'fill:var(--muted)' };
function chartPrev(rows) {
  const ds = rows.map(deriv);
  const items = [
    ['Hipertensión arterial', 'hta', 'm', null], ['Actividad física baja', 'afBaja', 'a', null],
    ['Obesidad (IMC ≥ 30)', 'obe', 'm', ENFR.obe], ['Obesidad abdominal', 'cintR', 'm', null],
    ['Colesterol elevado', 'col', 'x', ENFR.col], ['Tabaquismo actual', 'tab', 'a', ENFR.tab],
    ['Glucemia elevada / DBT', 'glu', 'x', ENFR.glu], ['Menos de 5 porciones FyV', 'fyvIns', 'a', ENFR.fyv],
    ['Sal en la mesa', 'sal', 'a', ENFR.sal]
  ].map(([l, k, t, ref]) => { const v = ds.filter(d => d[k] != null), x = v.filter(d => d[k]).length; return { l, t, ref, p: pct(x, v.length), ci: wilson(x, v.length) }; });
  const W = 640, L = 184, R = 50, rh = 34, T = 22, H = T + items.length * rh + 6, sx = v => L + (W - L - R) * v / 100;
  let g = '';
  [0, 25, 50, 75, 100].forEach(t => { g += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${T - 6}" y2="${H - 4}" style="stroke:var(--grid)"/><text x="${sx(t)}" y="${T - 10}" font-size="11" text-anchor="middle" style="${C.muted}">${t}%</text>`; });
  items.forEach((it, i) => {
    const y = T + i * rh;
    g += `<text x="${L - 10}" y="${y + 18}" font-size="13" text-anchor="end" style="${C.ink}">${esc(it.l)}</text>`;
    if (it.p != null) {
      g += `<rect x="${L}" y="${y + 7}" width="${Math.max(1, sx(it.p) - L)}" height="16" rx="3" style="${it.t === 'a' ? C.navy : C.teal}"/>`;
      g += `<line x1="${sx(it.ci[0])}" x2="${sx(it.ci[1])}" y1="${y + 15}" y2="${y + 15}" style="stroke:var(--ink);stroke-width:1.4;opacity:.5"/>`;
      const lx = sx(it.ci[1]) + 6, fin = lx > W - 36;
      g += `<text x="${fin ? W - 2 : lx}" y="${y + 19}" font-size="12.5" font-weight="600" ${fin ? 'text-anchor="end"' : ''} style="${C.ink}">${f1(it.p)}%</text>`;
    } else g += `<text x="${L + 4}" y="${y + 19}" font-size="12" style="${C.muted}">sin datos</text>`;
    if (it.ref != null) g += `<rect x="${sx(it.ref) - 1.5}" y="${y + 3}" width="3" height="24" rx="1" style="${C.ref}"><title>ENFR 2018: ${f1(it.ref)}%</title></rect>`;
  });
  return svg(W, H, g);
}
function chartEdad(rows) {
  const gs = ['18-34', '35-49', '50-64', '65+'], keys = [['hta', C.teal], ['obe', C.navy], ['glu', C.ref]];
  const W = 520, H = 230, L = 36, B = 34, T = 14, cw = (W - L - 8) / gs.length, bw = 20, sy = v => T + (H - T - B) * (1 - v / 100);
  let g = '';
  [0, 25, 50, 75, 100].forEach(t => { g += `<line x1="${L}" x2="${W - 4}" y1="${sy(t)}" y2="${sy(t)}" style="stroke:var(--grid)"/><text x="${L - 6}" y="${sy(t) + 4}" font-size="11" text-anchor="end" style="${C.muted}">${t}</text>`; });
  gs.forEach((gr, i) => {
    const sub = rows.filter(r => grupoEdad(r.edad) === gr).map(deriv), cx = L + cw * i + cw / 2;
    keys.forEach(([k, c], j) => {
      const p = sub.length ? pct(sub.filter(d => d[k]).length, sub.length) : 0, x = cx + (j - 1) * (bw + 4) - bw / 2;
      g += `<rect x="${x}" y="${sy(p)}" width="${bw}" height="${Math.max(0, sy(0) - sy(p))}" rx="3" style="${c}"><title>${gr}: ${f1(p)}%</title></rect>`;
      if (sub.length) g += `<text x="${x + bw / 2}" y="${sy(p) - 4}" font-size="10.5" text-anchor="middle" style="${C.ink}">${Math.round(p)}</text>`;
    });
    g += `<text x="${cx}" y="${H - 15}" font-size="12.5" text-anchor="middle" style="${C.ink}">${gr === '65+' ? '65 y más' : gr.replace('-', '–')}</text><text x="${cx}" y="${H - 1}" font-size="11" text-anchor="middle" style="${C.muted}">n=${sub.length}</text>`;
  });
  return svg(W, H, g);
}
function chartAcum(rows) {
  const ds = rows.map(deriv), cats = ['0', '1', '2', '3', '4+'], cnt = [0, 0, 0, 0, 0];
  ds.forEach(d => cnt[Math.min(4, d.nfr)]++);
  const n = ds.length || 1, ps = cnt.map(c => 100 * c / n), mx = Math.max(50, ...ps) * 1.08;
  const W = 440, H = 220, L = 12, B = 42, T = 20, cw = (W - 2 * L) / 5, sy = v => T + (H - T - B) * (1 - v / mx);
  let g = '';
  ps.forEach((p, i) => {
    const x = L + cw * i + 10, w = cw - 20;
    g += `<rect x="${x}" y="${sy(p)}" width="${w}" height="${Math.max(0, sy(0) - sy(p))}" rx="4" style="${i >= 3 ? C.crit : C.teal}"/>`;
    g += `<text x="${x + w / 2}" y="${sy(p) - 6}" font-size="12.5" font-weight="600" text-anchor="middle" style="${C.ink}">${f1(p)}%</text>`;
    g += `<text x="${x + w / 2}" y="${H - 24}" font-size="13" text-anchor="middle" style="${C.ink}">${cats[i]}</text>`;
  });
  g += `<text x="${W / 2}" y="${H - 5}" font-size="11.5" text-anchor="middle" style="${C.muted}">cantidad de factores de riesgo por persona</text>`;
  return svg(W, H, g);
}

/* ================= tablero ================= */
function renderDash() {
  if (!perfil || !esRol('admin', 'gestor')) return;
  const total = dataset().length;
  $('#dashEmpty').hidden = total > 0; $('#dashBody').hidden = total === 0;
  if (!total) return;
  const rows = filtered(), ds = rows.map(deriv), n = rows.length, cnt = f => ds.filter(f).length;
  const hta = cnt(d => d.hta), paE = cnt(d => d.paElev), noDx = cnt(d => d.htaNoDx), fr3 = cnt(d => d.nfr >= 3);
  const urg = rows.filter((r, i) => derivacion(r, ds[i]).some(x => x[0] === 'crit')).length;
  const k = (cls, label, v, s) => `<div class="kpi ${cls}"><div class="k">${label}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
  $('#kpis').innerHTML = n ? [
    k('lead', 'Personas encuestadas', n.toLocaleString('es-AR'), `${new Set(rows.map(r => r.zona)).size} zonas · ${new Set(rows.map(r => r.encuestador)).size} encuestadores`),
    k('', 'Hipertensión arterial', f1(pct(hta, n)) + '%', `IC 95% ${wilson(hta, n).map(f1).join('–')}`),
    k('', 'PA elevada sin diagnóstico', f1(pct(noDx, paE)) + '%', 'de quienes tuvieron PA elevada'),
    k('', '3 o más factores de riesgo', f1(pct(fr3, n)) + '%', `${fr3} personas`),
    k('', 'Derivaciones urgentes', urg, 'PA ≥ 180/110 o glucemia ≥ 250 / &lt; 70')
  ].join('') : `<div class="kpi" style="grid-column:1/-1"><div class="k">Sin encuestas para este filtro</div><div class="s">Cambiá los filtros de sexo, zona o edad.</div></div>`;
  $('#chPrev').innerHTML = n ? chartPrev(rows) : ''; $('#chEdad').innerHTML = n ? chartEdad(rows) : ''; $('#chAcum').innerHTML = n ? chartAcum(rows) : '';
  const F = [];
  if (n) {
    if (paE) F.push(`<b>${f1(pct(noDx, paE))}%</b> de las personas con presión elevada no sabía que la tenía. Es el hallazgo más accionable: detección y captación en los centros de salud.`);
    const tx = rows.filter(r => r.htaTto).length, txNo = rows.filter((r, i) => r.htaTto && ds[i].paElev).length;
    if (tx >= 5) F.push(`De quienes toman medicación para la presión, <b>${f1(pct(txNo, tx))}%</b> tenía valores no controlados.`);
    const gx = cnt(d => d.glucMed), gNo = rows.filter((r, i) => ds[i].glucMed && !r.dbtDx).length;
    if (gx) F.push(`<b>${f1(pct(gNo, gx))}%</b> de las glucemias elevadas correspondió a personas sin diagnóstico de diabetes.`);
    F.push(`<b>${f1(pct(cnt(d => d.fyvIns), n))}%</b> come menos de 5 porciones de frutas y verduras por día y <b>${f1(pct(cnt(d => d.afBaja), n))}%</b> tiene actividad física baja.`);
    const byZ = {}; rows.forEach((r, i) => (byZ[r.zona] = byZ[r.zona] || []).push(ds[i]));
    const zs = Object.entries(byZ).filter(([, a]) => a.length >= 20).map(([z, a]) => [z, pct(a.filter(d => d.nfr >= 3).length, a.length)]).sort((a, b) => b[1] - a[1]);
    if (zs.length > 1) F.push(`La zona con más personas con 3 o más factores es <b>${esc(zs[0][0])}</b> (${f1(zs[0][1])}%), frente a ${f1(zs[zs.length - 1][1])}% en ${esc(zs[zs.length - 1][0])}.`);
  }
  $('#findings').innerHTML = F.map(x => `<li>${x}</li>`).join('') || '<li>Los hallazgos aparecen con las primeras encuestas.</li>';
  const byZ = {}; rows.forEach((r, i) => (byZ[r.zona || 'Sin zona'] = byZ[r.zona || 'Sin zona'] || []).push(ds[i]));
  const keys = [['hta', 'HTA'], ['glu', 'Gluc. elevada'], ['obe', 'Obesidad'], ['tab', 'Tabaco'], ['afBaja', 'AF baja']];
  const p3 = a => pct(a.filter(d => d.nfr >= 3).length, a.length);
  $('#tZona').innerHTML = `<thead><tr><th>Zona</th><th class="num">n</th>${keys.map(x => `<th class="num">${x[1]} %</th>`).join('')}<th class="num">3+ FR %</th></tr></thead><tbody>` +
    (Object.entries(byZ).sort().map(([z, a]) => `<tr><td>${esc(z)}</td><td class="num">${a.length}</td>${keys.map(([kk]) => `<td class="num">${f1(pct(a.filter(d => d[kk]).length, a.length))}</td>`).join('')}<td class="num"><span class="pill ${p3(a) >= 30 ? 'crit' : 'ok'}">${f1(p3(a))}</span></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sin datos</td></tr>') + '</tbody>';
}

/* ================= encuestas / CSV ================= */
const COLS = ['id', 'fecha', 'municipio_id', 'zona', 'encuestador', 'sexo', 'edad', 'educacion', 'cobertura', 'tabaco', 'cigDia', 'humo', 'alcohol', 'fyv', 'sal', 'vigD', 'vigM', 'modD', 'modM', 'camD', 'camM', 'peso', 'talla', 'cintura', 'pas1', 'pad1', 'pas2', 'pad2', 'glucemia', 'ayunas', 'colTotal', 'htaDx', 'htaTto', 'dbtDx', 'dbtTto', 'colDx', 'evCV'];
const DCOLS = ['pas', 'pad', 'imc', 'met', 'hta', 'htaNoDx', 'glu', 'obe', 'cintR', 'tab', 'afBaja', 'fyvIns', 'col', 'nfr'];
function csv(rows) {
  const fmt = v => v == null ? '' : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`;
  return '﻿' + [...COLS, ...DCOLS.map(c => c + '_der')].join(';') + '\n' + rows.map(r => { const d = deriv(r); return [...COLS.map(c => fmt(r[c])), ...DCOLS.map(c => fmt(d[c]))].join(';'); }).join('\n');
}
$('#btnCsv').addEventListener('click', () => {
  const rows = dataset(); if (!rows.length) { toast('No hay encuestas para descargar.'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
  a.download = `observatorio_rcv_${ctxMuni || 'todos'}_${hoy()}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('#btnSync').addEventListener('click', () => sincronizar());

function renderBase() {
  if (!perfil) return;
  const pend = pendientes().map(p => ({ ...plano(p.fila), _pend: true, _err: p.error }));
  const rows = [...pend, ...dataset()];
  const puedeBorrar = esRol('admin', 'gestor');
  $('#baseCount').textContent = rows.length ? `${dataset().length} guardadas${pend.length ? ` · ${pend.length} por subir` : ''}${perfil.rol === 'admin' ? ' · ' + (ctxMuni ? muniNombre(ctxMuni) : 'todos los municipios') : ''}` : 'Todavía no hay encuestas.';
  $('#baseHelp').hidden = !esRol('admin', 'gestor');
  const h = ['Código', 'Fecha', 'Zona', 'Encuestador', 'Sexo', 'Edad', 'PA prom.', 'IMC', 'Glucemia', 'FR', 'Alertas', 'Estado'];
  $('#tBase').innerHTML = `<thead><tr>${h.map(x => `<th>${x}</th>`).join('')}${puedeBorrar ? '<th></th>' : ''}</tr></thead><tbody>` + (rows.slice(0, 1000).map(r => {
    const d = deriv(r), al = derivacion(r, d), lvl = al.some(a => a[0] === 'crit') ? 'crit' : al.length ? 'warn' : 'ok';
    const est = r._pend ? `<span class="pill ${r._err ? 'crit' : 'pend'}" title="${esc(r._err || '')}">${r._err ? 'Rechazada' : 'Por subir'}</span>` : '<span class="pill ok">Guardada</span>';
    return `<tr><td>${esc(r.id)}</td><td>${esc(r.fecha)}</td><td>${esc(r.zona)}</td><td>${esc(r.encuestador)}</td><td>${esc(r.sexo)}</td><td class="num">${r.edad ?? '—'}</td><td class="num">${d.pas != null ? Math.round(d.pas) + '/' + Math.round(d.pad) : '—'}</td><td class="num">${d.imc ? f1(d.imc) : '—'}</td><td class="num">${r.glucemia ?? '—'}</td><td class="num">${d.nfr}</td><td><span class="pill ${lvl}">${lvl === 'crit' ? 'Urgente' : lvl === 'warn' ? 'Derivar' : 'Sin alerta'}</span></td><td>${est}</td>${puedeBorrar ? `<td>${r._pend ? '' : `<button class="btn btn-ghost btn-xs" data-del="${esc(r.id)}">Borrar</button>`}</td>` : ''}</tr>`;
  }).join('') || `<tr><td colspan="13" class="muted">Las encuestas que se carguen van a aparecer acá.</td></tr>`) + '</tbody>';
}
$('#tBase').addEventListener('click', async e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '¿Confirmar?'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Borrar'; } }, 4000); return; }
  const { error } = await sb.from('encuestas').delete().eq('id', b.dataset.del);
  if (error) toast('No se pudo borrar: ' + error.message);
  else { encuestas = encuestas.filter(x => x.id !== b.dataset.del); renderTodo(); toast('Encuesta eliminada'); }
});

/* ================= formulario ================= */
const FN = ['edad', 'cigDia', 'fyv', 'vigD', 'vigM', 'modD', 'modM', 'camD', 'camM', 'peso', 'talla', 'cintura', 'pas1', 'pad1', 'pas2', 'pad2', 'glucemia', 'colTotal'];
const FT = ['fecha', 'municipio', 'zona', 'encuestador', 'sexo', 'educacion', 'cobertura', 'tabaco', 'sal', 'ayunas'];
const FC = ['humo', 'alcohol', 'htaDx', 'htaTto', 'dbtDx', 'dbtTto', 'colDx', 'evCV'];
function leerForm() {
  const r = { id: $('#codigo').value };
  FN.forEach(k => r[k] = num($('#' + k).value)); FT.forEach(k => r[k] = $('#' + k).value.trim()); FC.forEach(k => r[k] = $('#' + k).checked);
  r.municipio_id = r.municipio; delete r.municipio; return r;
}
function nuevoCodigo() {
  const pre = ($('#municipio').value || 'rcv').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'RCV';
  return `${pre}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}
function resetForm(conservar) {
  const prev = { enc: $('#encuestador').value, zona: $('#zona').value, muni: $('#municipio').value };
  $('#enc').reset();
  $('#fecha').value = hoy();
  const guard = LS.get('obs_form_' + (perfil ? perfil.id : ''), {});
  $('#encuestador').value = (conservar && prev.enc) || guard.enc || (perfil && perfil.rol === 'encuestador' ? (perfil.nombre || perfil.usuario) : '');
  $('#zona').value = (conservar && prev.zona) || guard.zona || '';
  if (perfil && perfil.rol === 'admin') $('#municipio').value = (conservar && prev.muni) || ctxMuni || (municipios[0] || {}).id || '';
  else if (perfil) $('#municipio').value = perfil.municipio_id || '';
  $('#codigo').value = nuevoCodigo();
  $('#livePills').innerHTML = ''; $('#formMsg').textContent = 'Presión, peso, talla y hábitos son obligatorios.'; $('#formMsg').style.color = '';
}
function livePills() {
  const r = leerForm(), d = deriv(r), p = [];
  if (d.imc) p.push([d.obe ? 'crit' : d.sobre ? 'warn' : 'ok', `IMC ${f1(d.imc)}`]);
  if (d.pas != null && d.pad != null) p.push([d.pas >= 180 || d.pad >= 110 ? 'crit' : d.paElev ? 'warn' : 'ok', `PA promedio ${Math.round(d.pas)}/${Math.round(d.pad)}`]);
  if (r.glucemia != null) p.push([r.glucemia >= 250 || r.glucemia < 70 ? 'crit' : d.glucMed ? 'warn' : 'ok', `Glucemia ${r.glucemia}`]);
  if (d.cintR != null) p.push([d.cintR ? 'warn' : 'ok', `Cintura ${d.cintR ? 'de riesgo' : 'normal'}`]);
  p.push([d.afBaja ? 'warn' : 'ok', `${d.met.toLocaleString('es-AR')} MET-min/sem`]);
  $('#livePills').innerHTML = p.map(([c, t]) => `<span class="pill ${c}">${t}</span>`).join('');
}
$('#enc').addEventListener('input', livePills);
$('#municipio').addEventListener('change', () => { $('#codigo').value = nuevoCodigo(); });
$('#btnReset').addEventListener('click', () => { resetForm(true); $('#resultBox').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#enc').addEventListener('submit', async e => {
  e.preventDefault();
  const r = leerForm(), falta = [];
  if (!$('#consent').checked) falta.push('consentimiento');
  [['fecha', 'fecha'], ['municipio_id', 'municipio'], ['zona', 'zona'], ['encuestador', 'encuestador/a'], ['sexo', 'sexo'], ['tabaco', 'tabaco']].forEach(([k, l]) => { if (!r[k]) falta.push(l); });
  [['edad', 'edad'], ['fyv', 'frutas y verduras'], ['peso', 'peso'], ['talla', 'talla'], ['pas1', 'PAS'], ['pad1', 'PAD']].forEach(([k, l]) => { if (r[k] == null) falta.push(l); });
  if (r.edad != null && r.edad < 18) falta.push('edad (18 o más)');
  if (r.pas1 != null && r.pad1 != null && r.pad1 >= r.pas1) falta.push('PA (la diastólica supera a la sistólica)');
  if (falta.length) { $('#formMsg').textContent = 'Falta o revisar: ' + falta.join(', ') + '.'; $('#formMsg').style.color = 'var(--crit)'; return; }
  const d = deriv(r), al = derivacion(r, d), lvl = al.some(a => a[0] === 'crit') ? '' : al.length ? 'warn' : 'ok';
  const box = $('#resultBox'); box.className = 'alertbox ' + lvl; box.hidden = false;
  box.innerHTML = `<h4>${lvl === '' ? 'Derivación urgente' : lvl === 'warn' ? 'Indicar consulta en el centro de salud' : 'Sin criterios de derivación'} · ${esc(r.id)}</h4>` + (al.length ? `<ul>${al.map(a => `<li>${esc(a[1])}</li>`).join('')}</ul>` : '<p>Reforzar hábitos saludables y control anual.</p>');
  const { id, municipio_id, zona, fecha, encuestador, ...datos } = r;
  const fila = { id, municipio_id, zona, fecha, encuestador, datos };
  setPendientes([...pendientes(), { fila, guardada: Date.now() }]);
  LS.set('obs_form_' + perfil.id, { enc: encuestador, zona });
  resetForm(true);
  if (navigator.onLine) { await sincronizar(); if (!pendientes().some(p => p.fila.id === id)) toast(`Encuesta ${id} guardada`); }
  else toast(`Sin señal: la encuesta ${id} quedó guardada en el teléfono y se sube sola al volver la conexión.`);
  renderBase();
  window.scrollTo({ top: box.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
});

/* ================= administración ================= */
async function cargarAdmin() {
  const [m, p] = await Promise.all([sb.from('municipios').select('*').order('nombre'), sb.from('perfiles').select('*').order('creado_en')]);
  if (m.data) { municipios = m.data; LS.set('obs_munis', municipios); }
  const perfiles = p.data || [];
  const cuenta = id => encuestas.filter(e => e.municipio_id === id).length;
  $('#tMunis').innerHTML = '<thead><tr><th>Municipio</th><th>Usuario base</th><th class="num">Encuestas</th><th class="num">Usuarios</th></tr></thead><tbody>' +
    (municipios.map(x => `<tr><td>${esc(x.nombre)}</td><td>${esc(x.id)}</td><td class="num">${cuenta(x.id)}</td><td class="num">${perfiles.filter(u => u.municipio_id === x.id).length}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Agregá el primer municipio.</td></tr>') + '</tbody>';
  $('#uMuni').innerHTML = '<option value="">— (sin municipio, solo admin)</option>' + municipios.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('');
  const muniOpts = sel => '<option value="">—</option>' + municipios.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
  const rolOpts = sel => ['', 'gestor', 'encuestador', 'admin'].map(r => `<option value="${r}" ${r === (sel || '') ? 'selected' : ''}>${{ '': 'Sin rol', gestor: 'Gestor', encuestador: 'Encuestador', admin: 'Administrador' }[r]}</option>`).join('');
  $('#tUsers').innerHTML = '<thead><tr><th>Usuario</th><th>Nombre</th><th>Municipio</th><th>Rol</th></tr></thead><tbody>' +
    perfiles.map(u => `<tr><td>${esc(u.usuario)}</td><td>${esc(u.nombre || '')}</td><td><select data-u="${u.id}" data-f="municipio_id" ${u.id === perfil.id ? 'disabled' : ''}>${muniOpts(u.municipio_id)}</select></td><td><select data-u="${u.id}" data-f="rol" ${u.id === perfil.id ? 'disabled' : ''}>${rolOpts(u.rol)}</select></td></tr>`).join('') + '</tbody>';
  renderCtx();
}
$('#tUsers').addEventListener('change', async e => {
  const s = e.target.closest('select[data-u]'); if (!s) return;
  const { error } = await sb.from('perfiles').update({ [s.dataset.f]: s.value || null }).eq('id', s.dataset.u);
  toast(error ? 'No se pudo actualizar: ' + error.message : 'Usuario actualizado'); cargarAdmin();
});
$('#mNombre').addEventListener('input', e => { if (!$('#mId').dataset.touched) $('#mId').value = slug(e.target.value); });
$('#mId').addEventListener('input', e => { e.target.dataset.touched = '1'; });
$('#fMuni').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = $('#mNombre').value.trim(), id = slug($('#mId').value);
  if (!nombre || !id) { toast('Completá nombre y usuario base.'); return; }
  const { error } = await sb.from('municipios').insert({ id, nombre });
  if (error) { toast(error.code === '23505' ? 'Ya existe un municipio con ese usuario base.' : 'No se pudo agregar: ' + error.message); return; }
  $('#fMuni').reset(); delete $('#mId').dataset.touched;
  toast(`${nombre} agregado. Ahora creale un usuario.`);
  await cargarAdmin(); $('#uMuni').value = id; $('#uUser').value = id;
});
$('#fUser').addEventListener('submit', async e => {
  e.preventDefault();
  const usuario = slug($('#uUser').value), pass = $('#uPass').value, rol = $('#uRol').value, municipio_id = $('#uMuni').value || null, nombre = $('#uNombre').value.trim() || null;
  const msg = $('#uMsg'); msg.style.color = 'var(--crit)';
  if (!usuario || usuario.includes('@')) { msg.textContent = 'Elegí un usuario sin espacios ni @, por ejemplo malvinas-argentinas.'; return; }
  if (pass.length < 8) { msg.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
  if (rol !== 'admin' && !municipio_id) { msg.textContent = 'Elegí el municipio del usuario.'; return; }
  $('#uBtn').disabled = true; msg.style.color = ''; msg.textContent = 'Creando…';
  // Cliente aparte para no cerrar la sesión del administrador
  const tmp = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'obs-alta' } });
  const { data, error } = await tmp.auth.signUp({ email: `${usuario}@${CFG.DOMINIO_USUARIOS}`, password: pass });
  $('#uBtn').disabled = false;
  if (error) { msg.style.color = 'var(--crit)'; msg.textContent = /registered|exists/i.test(error.message) ? 'Ese usuario ya existe.' : 'No se pudo crear: ' + error.message; return; }
  if (!data.user || (data.user.identities && data.user.identities.length === 0)) { msg.style.color = 'var(--crit)'; msg.textContent = 'Ese usuario ya existe.'; return; }
  const up = await sb.from('perfiles').update({ rol, municipio_id, nombre }).eq('id', data.user.id);
  if (up.error) { msg.style.color = 'var(--crit)'; msg.textContent = 'El usuario se creó pero no se pudo asignar el rol: ' + up.error.message; return; }
  msg.style.color = 'var(--ok)';
  msg.textContent = data.session ? `Listo. Usuario: ${usuario} · Contraseña: ${pass}. Pasáselos por un canal privado.` : `Usuario creado, pero Supabase pide confirmar el mail y no va a poder entrar. Desactivá "Confirm email" (ver la guía) y confirmalo desde Supabase → Authentication → Users.`;
  $('#fUser').reset(); cargarAdmin();
});

/* ================= arranque ================= */
window.addEventListener('online', () => { renderSync(); sincronizar(); });
window.addEventListener('offline', renderSync);
setInterval(() => { if (perfil && pendientes().length) sincronizar(); }, 60000);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/plataforma/sw.js', { scope: '/plataforma/' }).catch(() => {}));

(async function iniciar() {
  const configurado = CFG.SUPABASE_URL && !/TU-PROYECTO/.test(CFG.SUPABASE_URL) && CFG.SUPABASE_ANON_KEY && !/PEGAR/.test(CFG.SUPABASE_ANON_KEY);
  if (!window.supabase || !configurado) { mostrarLogin(!window.supabase ? 'No se pudo cargar la plataforma. Revisá la conexión e intentá de nuevo.' : 'La plataforma todavía no está configurada: completá plataforma/config.js con los datos de Supabase.'); return; }
  sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'obs-sesion' } });
  const { data } = await sb.auth.getSession();
  if (data && data.session) await iniciarSesion(data.session);
  else if (!navigator.onLine && LS.get('obs_last_uid', null)) {
    // Sin señal y con la sesión vencida: se puede seguir cargando; se sube al volver a ingresar
    const uid = LS.get('obs_last_uid', null);
    perfil = LS.get('obs_perfil_' + uid, null); municipios = LS.get('obs_munis', []); encuestas = LS.get('obs_cache_' + uid, []);
    if (perfil) mostrarApp(); else mostrarLogin();
  } else mostrarLogin();
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && perfil) { perfil = null; mostrarLogin(); } });
})();
})();
