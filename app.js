"use strict";
/* Cotejo de albaranes — app web sin servidor. Datos en localStorage del dispositivo. */

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const eur = n => (n == null || isNaN(n)) ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + " €";
const num = n => (n == null || isNaN(n)) ? "—" : n.toLocaleString("es-ES", { maximumFractionDigits: 3 });
const comma = n => n == null ? "" : String(n).replace(".", ",");
function parseNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€\s]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
const norm = s => String(s ?? "").toUpperCase().replace(/[\s\-\.\/]/g, "");
const stripZ = s => s.replace(/^0+(?=\d)/, "");
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
function downloadFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const ICON = {
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

/* ---------- almacenamiento ---------- */
const LS_KEY = "cotejo-albaranes-v1";
const S = { albs: new Map(), active: null };
function load() {
  try { JSON.parse(lsGet(LS_KEY) || "[]").forEach(a => S.albs.set(a.id, a)); } catch { }
  S.active = lsGet("cotejo-activo");
  if (!S.albs.has(S.active)) S.active = newest();
}
let saveTimer = null;
function persist(alb) {
  if (alb) alb.actualizado = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!lsSet(LS_KEY, JSON.stringify([...S.albs.values()])))
      flash("No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.", "err");
  }, 250);
}
window.addEventListener("pagehide", () => { clearTimeout(saveTimer); lsSet(LS_KEY, JSON.stringify([...S.albs.values()])); });
const newest = () => [...S.albs.values()].sort((a, b) => (b.creado || 0) - (a.creado || 0))[0]?.id || null;
const cur = () => S.albs.get(S.active);
function removeAlb(id) { S.albs.delete(id); if (S.active === id) S.active = newest(); persist(); render(); }

/* ---------- modelo ---------- */
function status(l) {
  if (l.extra) return "extra";
  if (l.recib == null) return "pend";
  if (l.precioReal != null && l.precio != null && Math.abs(l.precioReal - l.precio) > 0.004) return "precio";
  if (l.recib < (l.cant || 0)) return "falta";
  if (l.recib > (l.cant || 0)) return "sobra";
  return "ok";
}
const ST_LABEL = { pend: "Pendiente", ok: "Correcto", falta: "Falta", sobra: "Sobra", precio: "Precio distinto", extra: "No está en albarán" };
function stats(alb) {
  const c = { pend: 0, ok: 0, falta: 0, sobra: 0, precio: 0, extra: 0 };
  let impAlb = 0, impRec = 0;
  alb.lineas.forEach(l => {
    c[status(l)]++;
    if (!l.extra) impAlb += (l.cant || 0) * (l.precio || 0);
    impRec += (l.recib || 0) * (l.precioReal ?? l.precio ?? 0);
  });
  return { c, impAlb, impRec, total: alb.lineas.length, revisadas: alb.lineas.length - c.pend };
}
function mkLine(o = {}) {
  return {
    id: uid(), codigo: String(o.codigo ?? "").trim(), ean: String(o.ean ?? "").trim(), desc: String(o.descripcion ?? o.desc ?? "").trim(),
    cant: parseNum(o.cantidad ?? o.cant) ?? 0, inhalt: parseNum(o.uds_caja ?? o.inhalt), precio: parseNum(o.precio), recib: null, precioReal: null, nota: "", extra: !!o.extra
  };
}

/* ---------- estado de la interfaz ---------- */
const UI = { mode: "cotejo", filter: "todas", selected: null, matches: null, msg: "", msgType: "", draft: null, conteo: lsGet("cotejo-conteo") === "1", confirmDel: false, confirmWipe: false };
function flash(t, type = "") { UI.msg = t; UI.msgType = type; const m = $("#msg"); if (m) { m.textContent = t; m.className = "msg " + type; } }
function fmtDate(f) { if (!f) return "Sin fecha"; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f); return m ? `${m[3]}/${m[2]}/${m[1]}` : f; }
function setActive(id) { S.active = id; lsSet("cotejo-activo", id); Object.assign(UI, { mode: "cotejo", selected: null, matches: null, filter: "todas", confirmDel: false }); flash(""); render(); }

function render() {
  const sel = $("#albSel");
  const albs = [...S.albs.values()].sort((a, b) => (b.creado || 0) - (a.creado || 0));
  sel.innerHTML = albs.length ? albs.map(a => `<option value="${a.id}" ${a.id === S.active ? "selected" : ""}>${esc(a.proveedor || "Sin proveedor")} · ${esc(a.numero || "s/n")}${a.ejemplo ? " (ejemplo)" : ""}</option>`).join("") + `<option value="__list">Ver todos los albaranes…</option>` : `<option>Sin albaranes</option>`;
  sel.disabled = !albs.length;
  $("#dock").hidden = !(UI.mode === "cotejo" && cur());
  $("#conteo").checked = UI.conteo;
  if (UI.mode === "nuevo") return renderNew();
  if (UI.mode === "lista") return renderList(albs);
  if (UI.mode === "ajustes") return renderSettings();
  if (!cur()) return renderEmpty();
  renderCotejo();
}

function renderEmpty() {
  $("#view").innerHTML = `<section class="sheet empty">
    <h2>Todavía no hay albaranes</h2>
    <p>Sube la foto o el PDF de un albarán y la app sacará cada línea: código, descripción, cantidad y precio. Luego escaneas o escribes el código de cada artículo que llega y anotas lo que has recibido de verdad.</p>
    <div class="row"><button class="btn primary" id="eNew" type="button">Subir un albarán</button>
    <button class="btn" id="eDemo" type="button">Probar con un albarán de ejemplo</button></div>
  </section>`;
  $("#eNew").onclick = startNew;
  $("#eDemo").onclick = loadDemo;
}

function renderList(albs) {
  $("#view").innerHTML = `<section class="sheet"><div class="albhead"><h2>Todos los albaranes</h2>
    <button class="btn ghost" id="lBack" type="button">Volver</button></div>
    <div class="list">${albs.map(a => {
      const s = stats(a); const pc = s.total ? Math.round(s.revisadas / s.total * 100) : 0;
      const inc = s.c.falta + s.c.sobra + s.c.precio + s.c.extra;
      return `<div class="it"><div style="min-width:0">
        <strong>${esc(a.proveedor || "Sin proveedor")}</strong> <span class="mono muted">Nº ${esc(a.numero || "s/n")}</span>${a.ejemplo ? ' <span class="pill s-extra">Ejemplo</span>' : ""}
        <div class="muted" style="font-size:13px">${esc(fmtDate(a.fecha))} · ${s.total} líneas · ${s.revisadas} revisadas${inc ? ` · <span style="color:var(--bad)">${inc} incidencias</span>` : ""}</div></div>
        <div style="display:flex;gap:10px;align-items:center"><div class="bar" aria-label="${pc}% revisado"><i style="width:${pc}%"></i></div>
        <button class="btn" data-open="${a.id}" type="button">Abrir</button></div></div>`;
    }).join("")}</div></section>`;
  $("#lBack").onclick = () => { UI.mode = "cotejo"; render(); };
  $("#view").querySelectorAll("[data-open]").forEach(b => b.onclick = () => setActive(b.dataset.open));
}

/* ---------- cotejo ---------- */
function renderCotejo() {
  const a = cur(); const s = stats(a);
  const lines = a.lineas.filter(l => UI.filter === "todas" || status(l) === UI.filter);
  const chip = (k, label, n) => `<button type="button" class="chip s-${k}" data-f="${k}" aria-pressed="${UI.filter === k}"><span class="dot"></span>${label} <b>${n}</b></button>`;
  const diffImp = s.impRec - s.impAlb;
  $("#view").innerHTML = `
  <div class="scanbar">
    <div class="scanrow">
      <div class="field">${ICON.bars}<input id="q" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" placeholder="Escribe el código" aria-label="Código del artículo"></div>
    </div>
    <div id="msg" class="msg ${UI.msgType}" role="status">${esc(UI.msg)}</div>
  </div>
  <div id="cardSlot"></div>
  <section class="sheet">
    <div class="albhead">
      <h2>${esc(a.proveedor || "Sin proveedor")} <span class="mono muted" style="font-size:15px;font-weight:400">Nº ${esc(a.numero || "s/n")}</span></h2>
      <span class="muted">${esc(fmtDate(a.fecha))}</span>
      ${a.ejemplo ? '<span class="pill s-extra">Albarán de ejemplo</span>' : ""}
    </div>
    <div class="summary">
      ${chip("todas", "Todas", s.total)}${chip("pend", "Pendientes", s.c.pend)}${chip("ok", "Correctas", s.c.ok)}
      ${chip("falta", "Faltan", s.c.falta)}${chip("sobra", "Sobran", s.c.sobra)}${chip("precio", "Precio distinto", s.c.precio)}${s.c.extra ? chip("extra", "Fuera de albarán", s.c.extra) : ""}
    </div>
    <div class="totals">
      <div><span class="label">Revisadas</span><span class="v">${s.revisadas} / ${s.total}</span></div>
      <div><span class="label">Importe albarán</span><span class="v">${eur(s.impAlb)}</span></div>
      <div><span class="label">Importe recibido</span><span class="v">${eur(s.impRec)}</span></div>
      <div><span class="label">Diferencia</span><span class="v" style="color:${Math.abs(diffImp) < 0.005 ? "var(--ok)" : "var(--bad)"}">${s.revisadas ? (diffImp > 0 ? "+" : "") + eur(diffImp) : "—"}</span></div>
    </div>
    <div class="lines">${lines.map(l => {
      const st = status(l); return `<button type="button" class="line s-${st}${UI.selected === l.id ? " sel" : ""}" data-id="${l.id}">
        <span class="lt"><span class="ldesc">${esc(l.desc || "Sin descripción")}</span><span class="pill s-${st}"><span class="dot"></span>${ST_LABEL[st]}</span></span>
        <span class="lcode">${esc(l.codigo || "—")}${l.ean && l.ean !== l.codigo ? ` · ${esc(l.ean)}` : ""}</span>
        <span class="lnums"><span>Pedido<b>${l.extra ? "—" : num(l.cant)}</b></span><span>Recibido<b>${l.recib == null ? "—" : num(l.recib)}</b></span>
        <span>Precio<b>${l.precioReal != null && status(l) === "precio" ? eur(l.precioReal) : eur(l.precio)}</b></span></span>
        ${l.nota ? `<span class="lnote">${esc(l.nota)}</span>` : ""}
      </button>`;
    }).join("") || `<p class="muted">No hay líneas con este filtro.</p>`}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="btnExport" type="button">Exportar a Excel (CSV)</button>
      <button class="btn ghost" id="btnAddLine" type="button">Añadir línea a mano</button>
      <span style="flex:1"></span>
      ${UI.confirmDel ? `<span class="muted">¿Borrar este albarán?</span><button class="btn danger" id="btnDelYes" type="button">Sí, borrar</button><button class="btn ghost" id="btnDelNo" type="button">Cancelar</button>` : `<button class="btn ghost" id="btnDel" type="button">Borrar albarán</button>`}
    </div>
  </section>`;
  renderCard();
  const q = $("#q");
  q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(q.value); } });
  $("#view").querySelectorAll("[data-f]").forEach(b => b.onclick = () => { UI.filter = UI.filter === b.dataset.f ? "todas" : b.dataset.f; renderCotejo(); });
  $("#view").querySelectorAll(".line[data-id]").forEach(el => el.onclick = () => { UI.selected = el.dataset.id; UI.matches = null; renderCotejo(); scrollTo({ top: 0, behavior: "smooth" }); });
  $("#btnExport").onclick = exportCsv;
  $("#btnAddLine").onclick = () => { const l = mkLine({ descripcion: "Artículo nuevo", extra: true }); l.recib = 1; a.lineas.push(l); persist(a); UI.selected = l.id; renderCotejo(); };
  if ($("#btnDel")) $("#btnDel").onclick = () => { UI.confirmDel = true; renderCotejo(); };
  if ($("#btnDelYes")) $("#btnDelYes").onclick = () => { UI.confirmDel = false; removeAlb(a.id); };
  if ($("#btnDelNo")) $("#btnDelNo").onclick = () => { UI.confirmDel = false; renderCotejo(); };
}

function renderCard() {
  const slot = $("#cardSlot"); if (!slot) return;
  const a = cur();
  if (UI.matches) {
    slot.innerHTML = `<section class="card"><div class="top"><h3>Varias coincidencias: elige el artículo</h3><button class="iconbtn" id="cClose" aria-label="Cerrar" type="button">${ICON.x}</button></div>
      <div class="picklist">${UI.matches.map(l => `<button type="button" data-pick="${l.id}"><span><span class="mono">${esc(l.codigo || l.ean)}</span> · ${esc(l.desc)}</span><span class="pill s-${status(l)}">${ST_LABEL[status(l)]}</span></button>`).join("")}</div></section>`;
    slot.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { UI.matches = null; selectLine(b.dataset.pick, UI.conteo); });
    $("#cClose").onclick = () => { UI.matches = null; renderCard(); };
    return;
  }
  const l = a.lineas.find(x => x.id === UI.selected);
  if (!l) { slot.innerHTML = ""; return; }
  const st = status(l);
  slot.innerHTML = `<section class="card s-${st}" aria-live="polite">
    <div class="top">
      <div style="min-width:0;flex:1">
        ${l.extra ? `<input id="cDesc" value="${esc(l.desc)}" aria-label="Descripción" style="width:100%;font:700 18px var(--f-display);border:1px solid var(--rule);background:var(--paper);border-radius:8px;padding:6px 10px">` : `<div class="desc">${esc(l.desc || "Sin descripción")}</div>`}
        <div class="codes">${l.extra ? `<label>Código <input id="cCode" class="mono" value="${esc(l.codigo)}" style="border:1px solid var(--rule);background:var(--paper);border-radius:6px;padding:3px 6px;width:150px"></label>` : `<span>Ref. ${esc(l.codigo || "—")}</span>${l.ean ? `<span>EAN ${esc(l.ean)}</span>` : ""}`}</div>
      </div>
      <span class="pill s-${st}"><span class="dot"></span>${ST_LABEL[st]}</span>
      <button class="iconbtn" id="cClose" aria-label="Cerrar ficha" type="button">${ICON.x}</button>
    </div>
    <div class="cmp">
      <div class="cmpbox"><span class="label">Cantidad recibida</span>
        <span class="exp">${l.extra ? "No figura en el albarán" : `En albarán: <b>${num(l.cant)}</b>${l.inhalt ? ` uds · caja de ${num(l.inhalt)}` : ""}`}</span>
        <div class="stepper"><button type="button" id="cMinus" aria-label="Restar uno">−</button>
        <input id="cRecib" inputmode="decimal" value="${comma(l.recib)}" placeholder="${l.extra ? "0" : comma(l.cant)}" aria-label="Cantidad recibida">
        <button type="button" id="cPlus" aria-label="Sumar uno">+</button></div>
        <div class="diff" id="dQty"></div>
      </div>
      <div class="cmpbox"><span class="label">Precio unitario real</span>
        <span class="exp">${l.extra ? "Sin precio de albarán" : `En albarán: <b>${eur(l.precio)}</b>`}</span>
        <input id="cPrecio" inputmode="decimal" value="${comma(l.precioReal)}" placeholder="${l.precio == null ? "0,00" : l.precio.toFixed(2).replace(".", ",")}" aria-label="Precio unitario real">
        <div class="diff" id="dPrice"></div>
      </div>
    </div>
    <textarea id="cNota" placeholder="Nota (por ejemplo: caja dañada, cambio de referencia)" aria-label="Nota">${esc(l.nota)}</textarea>
    <div class="actions">
      <button class="btn primary" id="cOk" type="button">${l.recib == null && !l.extra ? `Todo correcto (${num(l.cant)} a ${eur(l.precio)})` : "Hecho"}</button>
      <button class="btn ghost" id="cReset" type="button">Dejar pendiente</button>
      ${l.extra ? `<button class="btn ghost danger" id="cDelLine" type="button">Quitar línea</button>` : ""}
    </div>
  </section>`;
  const diffs = () => {
    const dq = $("#dQty"), dp = $("#dPrice");
    if (l.recib == null || l.extra) dq.textContent = "";
    else { const d = l.recib - (l.cant || 0); dq.textContent = d === 0 ? "Cantidad correcta" : (d < 0 ? `Faltan ${num(-d)}` : `Sobran ${num(d)}`); dq.style.color = d === 0 ? "var(--ok)" : "var(--warn)"; }
    if (l.precioReal == null || l.precio == null) { dp.textContent = l.precioReal == null && !l.extra ? "Vacío = mismo precio que el albarán" : ""; dp.style.color = "var(--muted)"; }
    else { const d = l.precioReal - l.precio; const bad = Math.abs(d) > 0.004; dp.textContent = bad ? `${d > 0 ? "+" : ""}${eur(d)} por unidad · ${eur(d * (l.recib ?? l.cant ?? 0))} en total` : "Precio correcto"; dp.style.color = bad ? "var(--bad)" : "var(--ok)"; }
  };
  const upd = () => {
    l.recib = parseNum($("#cRecib").value); l.precioReal = parseNum($("#cPrecio").value); l.nota = $("#cNota").value;
    if (l.extra) { l.desc = $("#cDesc").value; l.codigo = $("#cCode").value.trim(); }
    persist(a); diffs();
  };
  diffs();
  ["cRecib", "cPrecio", "cNota", "cDesc", "cCode"].forEach(id => { const el = $("#" + id); if (el) { el.addEventListener("input", upd); el.addEventListener("change", () => { upd(); refreshKeepFocus(); }); } });
  $("#cMinus").onclick = () => { l.recib = Math.max(0, (l.recib ?? (l.extra ? 0 : l.cant)) - 1); persist(a); renderCotejo(); };
  $("#cPlus").onclick = () => { l.recib = (l.recib ?? 0) + 1; persist(a); renderCotejo(); };
  $("#cOk").onclick = () => { if (l.recib == null) l.recib = l.extra ? 1 : l.cant; persist(a); UI.selected = null; flash(`Anotado: ${l.desc}`, "ok"); renderCotejo(); };
  $("#cReset").onclick = () => { l.recib = null; l.precioReal = null; persist(a); renderCotejo(); };
  $("#cClose").onclick = () => { UI.selected = null; renderCotejo(); };
  if ($("#cDelLine")) $("#cDelLine").onclick = () => { a.lineas = a.lineas.filter(x => x !== l); persist(a); UI.selected = null; renderCotejo(); };
}
function refreshKeepFocus() { const y = scrollY; renderCotejo(); scrollTo(0, y); }

/* ---------- búsqueda ---------- */
function findIn(alb, raw) {
  const q = norm(raw); if (!q) return [];
  const qz = stripZ(q);
  const exact = alb.lineas.filter(l => [l.codigo, l.ean].some(c => { const n = norm(c); return n && (n === q || stripZ(n) === qz); }));
  if (exact.length) return exact;
  if (q.length < 3) return [];
  return alb.lineas.filter(l => norm(l.codigo).includes(q) || norm(l.ean).includes(q) || norm(l.desc).includes(q));
}
/* devuelve true si encontró el artículo */
function search(raw) {
  const a = cur(); const code = String(raw || "").trim();
  if (!a || !code) return false;
  if ($("#q")) $("#q").value = "";
  const m = findIn(a, code);
  if (m.length === 1) { selectLine(m[0].id, UI.conteo); if (!UI.conteo) flash(`Encontrado: ${code}`, "ok"); return true; }
  if (m.length > 1) { UI.selected = null; UI.matches = m; flash(`${m.length} artículos coinciden con «${code}»`); renderCard(); return true; }
  const other = [...S.albs.values()].find(x => x.id !== a.id && x.lineas.some(l => [l.codigo, l.ean].some(c => c && stripZ(norm(c)) === stripZ(norm(code)))));
  UI.matches = null; UI.selected = null;
  $("#cardSlot").innerHTML = `<section class="card s-extra"><div class="top"><div><div class="desc">«${esc(code)}» no está en este albarán</div>
    <div class="muted" style="font-size:14px">${other ? `Aparece en el albarán de ${esc(other.proveedor || "otro proveedor")} Nº ${esc(other.numero || "s/n")}.` : "Puede ser un artículo que no os facturan o un código distinto en la etiqueta."}</div></div>
    <button class="iconbtn" id="nfClose" aria-label="Cerrar" type="button">${ICON.x}</button></div>
    <div class="actions">${other ? `<button class="btn primary" id="nfGo" type="button">Ir a ese albarán</button>` : ""}
    <button class="btn" id="nfAdd" type="button">Anotar como recibido fuera de albarán</button></div></section>`;
  flash(`Sin coincidencias para «${code}»`, "err");
  $("#nfClose").onclick = () => { $("#cardSlot").innerHTML = ""; };
  if (other) $("#nfGo").onclick = () => { setActive(other.id); search(code); };
  $("#nfAdd").onclick = () => { const l = mkLine({ codigo: code, descripcion: "Artículo sin descripción", extra: true }); l.recib = 1; a.lineas.push(l); persist(a); UI.selected = l.id; renderCotejo(); };
  return false;
}
function selectLine(id, count) {
  const a = cur(); const l = a.lineas.find(x => x.id === id); if (!l) return;
  if (count) { l.recib = (l.recib ?? 0) + 1; persist(a); }
  UI.selected = id; renderCotejo(); scrollTo({ top: 0 });
  if (count) flash(`+1 ${l.desc} → ${num(l.recib)} de ${num(l.cant)}`, l.recib > l.cant ? "err" : "ok");
}

/* ---------- lectura de códigos de barras ---------- */
let zxReader = null;
function zx() {
  if (zxReader || !window.ZXing) return zxReader;
  const Z = window.ZXing, hints = new Map();
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX]);
  zxReader = new Z.MultiFormatReader(); zxReader.setHints(hints);
  return zxReader;
}
function decodeCanvas(c) {
  const r = zx(); if (!r) return null;
  const Z = window.ZXing;
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const lum = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = (d[i] * 306 + d[i + 1] * 601 + d[i + 2] * 117) >> 10;
  try { return r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height)))).getText(); }
  catch { return null; } finally { r.reset(); }
}
let nativeDetector;
async function getNativeDetector() {
  if (nativeDetector !== undefined) return nativeDetector;
  nativeDetector = null;
  if ("BarcodeDetector" in window) {
    try {
      const fm = await BarcodeDetector.getSupportedFormats();
      const want = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"].filter(f => fm.includes(f));
      if (want.length) nativeDetector = new BarcodeDetector({ formats: want });
    } catch { }
  }
  return nativeDetector;
}
async function loadBitmap(file) {
  try { return await createImageBitmap(file); } catch {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
}
async function decodePhoto(file) {
  const bmp = await loadBitmap(file);
  const nd = await getNativeDetector();
  if (nd) { try { const r = await nd.detect(bmp); if (r.length) return r[0].rawValue; } catch { } }
  for (const max of [1400, 900, 2000]) for (const rot of [0, 90]) {
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
    const c = document.createElement("canvas"); c.width = rot ? h : w; c.height = rot ? w : h;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (rot) { x.translate(h, 0); x.rotate(Math.PI / 2); }
    x.drawImage(bmp, 0, 0, w, h);
    const t = decodeCanvas(c); if (t) return t;
  }
  return null;
}
$("#camInput").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  flash("Leyendo el código de la foto…");
  try {
    const code = await decodePhoto(f);
    if (code) search(code); else flash("No he podido leer el código. Acerca la cámara con buena luz o escríbelo a mano.", "err");
  } catch { flash("No he podido abrir la foto. Prueba otra vez o escribe el código.", "err"); }
});

/* escáner en vivo con la cámara */
const SC = { stream: null, timer: null, last: "", lastAt: 0, torch: false, audio: null, busy: false };
function beep() {
  try {
    const ctx = SC.audio; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1400; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.09);
  } catch { }
  try { navigator.vibrate?.(60); } catch { }
}
async function openScanner() {
  if (!navigator.mediaDevices?.getUserMedia) { $("#camInput").click(); return; }
  try { SC.audio = SC.audio || new (window.AudioContext || window.webkitAudioContext)(); SC.audio.resume?.(); } catch { }
  $("#scanner").hidden = false; $("#smsg").textContent = "Abriendo la cámara…";
  try {
    SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    closeScanner();
    flash(e?.name === "NotAllowedError" ? "No hay permiso para usar la cámara. Actívalo en los ajustes del navegador, o haz una foto del código." : "No se pudo abrir la cámara. Haz una foto del código.", "err");
    $("#camInput").click(); return;
  }
  const v = $("#video"); v.srcObject = SC.stream;
  try { await v.play(); } catch { }
  const track = SC.stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  $("#sTorch").hidden = !caps.torch;
  try { if (caps.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { }
  $("#smsg").textContent = UI.conteo ? "Modo conteo: cada lectura suma 1. Pulsa Cerrar al acabar." : "Apunta al código de barras";
  const nd = await getNativeDetector();
  const canvas = document.createElement("canvas");
  const tick = async () => {
    if (!SC.stream) return;
    if (!SC.busy && v.readyState >= 2 && v.videoWidth) {
      SC.busy = true;
      let code = null;
      try {
        if (nd) { const r = await nd.detect(v); code = r[0]?.rawValue || null; }
        else {
          // recorte de la franja central donde está el marco
          const vw = v.videoWidth, vh = v.videoHeight;
          const cw = Math.round(vw * 0.9), ch = Math.round(vh * 0.4);
          const sc = Math.min(1, 1000 / cw);
          canvas.width = Math.round(cw * sc); canvas.height = Math.round(ch * sc);
          canvas.getContext("2d", { willReadFrequently: true }).drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
          code = decodeCanvas(canvas);
        }
      } catch { }
      SC.busy = false;
      if (code) onLiveCode(code);
    }
    SC.timer = setTimeout(tick, nd ? 120 : 180);
  };
  tick();
}
function onLiveCode(code) {
  const now = Date.now();
  if (code === SC.last && now - SC.lastAt < 1800) return;
  SC.last = code; SC.lastAt = now;
  beep();
  if (UI.conteo) {
    const found = search(code);
    $("#smsg").textContent = found ? UI.msg : `«${code}» no está en este albarán`;
  } else { closeScanner(); search(code); }
}
function closeScanner() {
  clearTimeout(SC.timer); SC.timer = null;
  SC.stream?.getTracks().forEach(t => t.stop()); SC.stream = null; SC.torch = false;
  $("#video").srcObject = null; $("#scanner").hidden = true;
}
$("#sClose").onclick = closeScanner;
$("#sTorch").onclick = async () => {
  const t = SC.stream?.getVideoTracks()[0]; if (!t) return;
  SC.torch = !SC.torch;
  try { await t.applyConstraints({ advanced: [{ torch: SC.torch }] }); } catch { }
};
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scanner").hidden) closeScanner(); });

/* ---------- ajustes ---------- */
const MODELS = [["claude-sonnet-5-5", "Claude Sonnet 5.5 (recomendado)"], ["claude-haiku-5-5", "Claude Haiku 5.5 (más barato y rápido)"], ["claude-opus-5-5", "Claude Opus 5.5 (más preciso)"]];
const getKey = () => lsGet("cotejo-api-key") || "";
const getModel = () => lsGet("cotejo-modelo") || MODELS[0][0];
function renderSettings() {
  const key = getKey();
  $("#view").innerHTML = `<section class="sheet" style="display:flex;flex-direction:column;gap:18px">
    <div class="albhead"><h2>Ajustes</h2><button class="btn ghost" id="sBack" type="button">Volver</button></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <h3>Lectura automática de albaranes</h3>
      <p class="muted" style="margin:0;font-size:14px">Para leer las fotos y PDF se usa la API de Anthropic con tu propia clave. Se crea en console.anthropic.com → API Keys y se paga por uso (un albarán de una página cuesta unos céntimos). La clave se guarda solo en este navegador y se envía únicamente a api.anthropic.com.</p>
      <div class="row">
        <label style="flex:2 1 260px"><span class="label">Clave de API</span><input id="sKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(key)}"></label>
        <label><span class="label">Modelo</span><select id="sModel">${MODELS.map(([v, t]) => `<option value="${v}" ${v === getModel() ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <div class="row"><button class="btn primary" id="sSave" type="button">Guardar</button><button class="btn ghost" id="sShow" type="button">Mostrar clave</button>${key ? `<button class="btn ghost danger" id="sForget" type="button">Borrar clave</button>` : ""}</div>
      <div id="sMsg" class="msg" role="status"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--rule);padding-top:16px">
      <h3>Copia de seguridad</h3>
      <p class="muted" style="margin:0;font-size:14px">Los albaranes se guardan en este móvil. Descarga una copia de vez en cuando, o para pasarlos a un móvil nuevo.</p>
      <div class="row"><button class="btn" id="sExport" type="button">Descargar copia (${S.albs.size} albaranes)</button><button class="btn" id="sImport" type="button">Cargar una copia</button></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--rule);padding-top:16px">
      <h3>Borrar todo</h3>
      <div class="row">${UI.confirmWipe ? `<span class="muted">Se borrarán todos los albaranes de este dispositivo.</span><button class="btn danger" id="sWipeYes" type="button">Sí, borrar todo</button><button class="btn ghost" id="sWipeNo" type="button">Cancelar</button>` : `<button class="btn ghost danger" id="sWipe" type="button">Borrar todos los albaranes</button>`}</div>
    </div>
  </section>`;
  const sm = (t, c = "ok") => { const m = $("#sMsg"); m.textContent = t; m.className = "msg " + c; };
  $("#sBack").onclick = () => { UI.mode = "cotejo"; UI.confirmWipe = false; render(); };
  $("#sSave").onclick = () => {
    const k = $("#sKey").value.trim();
    if (k && !k.startsWith("sk-")) return sm("La clave debería empezar por «sk-». Revisa que la has copiado entera.", "err");
    lsSet("cotejo-api-key", k); lsSet("cotejo-modelo", $("#sModel").value); sm("Guardado.");
  };
  $("#sShow").onclick = () => { const i = $("#sKey"); i.type = i.type === "password" ? "text" : "password"; $("#sShow").textContent = i.type === "password" ? "Mostrar clave" : "Ocultar clave"; };
  if ($("#sForget")) $("#sForget").onclick = () => { try { localStorage.removeItem("cotejo-api-key"); } catch { } renderSettings(); };
  $("#sExport").onclick = () => downloadFile(`albaranes_copia_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "cotejo-albaranes", version: 1, albaranes: [...S.albs.values()] }, null, 1), "application/json");
  $("#sImport").onclick = () => $("#importInput").click();
  if ($("#sWipe")) $("#sWipe").onclick = () => { UI.confirmWipe = true; renderSettings(); };
  if ($("#sWipeNo")) $("#sWipeNo").onclick = () => { UI.confirmWipe = false; renderSettings(); };
  if ($("#sWipeYes")) $("#sWipeYes").onclick = () => { S.albs.clear(); S.active = null; persist(); UI.confirmWipe = false; render(); };
}
$("#importInput").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.albaranes;
    if (!Array.isArray(list)) throw 0;
    let n = 0;
    list.forEach(a => { if (a && a.id && Array.isArray(a.lineas)) { const prev = S.albs.get(a.id); if (!prev || (a.actualizado || 0) >= (prev.actualizado || 0)) { S.albs.set(a.id, a); n++; } } });
    persist(); if (!S.active) S.active = newest();
    render(); const m = $("#sMsg"); if (m) { m.textContent = `Cargados ${n} albaranes.`; m.className = "msg ok"; }
  } catch { const m = $("#sMsg"); if (m) { m.textContent = "Ese archivo no es una copia de esta app."; m.className = "msg err"; } }
});

/* ---------- nuevo albarán ---------- */
function startNew() { UI.mode = "nuevo"; UI.draft = { files: [], proveedor: "", numero: "", fecha: "", lineas: [], phase: "pick", error: "", note: "" }; render(); }

function renderNew() {
  const d = UI.draft;
  if (d.phase === "review") return renderReview();
  const hasKey = !!getKey();
  const reading = d.phase === "reading";
  const showPhotos = hasKey || d.files.length || d.showPhotos;
  $("#view").innerHTML = `<section class="sheet" style="display:flex;flex-direction:column;gap:14px">
    <div class="albhead"><h2>Nuevo albarán</h2><button class="btn ghost" id="nBack" type="button">Cancelar</button></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <h3>Desde Excel</h3>
      <p class="muted" style="margin:0;font-size:14px">Elige el Excel del albarán. Lo más fácil es rellenar la plantilla: código, EAN, descripción, cantidad y precio por unidad.</p>
      <button class="btn primary" id="nExcel" type="button" style="min-height:56px" ${reading ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12l4 5M13 12l-4 5"/></svg>Importar Excel</button>
      <a class="btn ghost" href="plantilla_albaran.xlsx" download="plantilla_albaran.xlsx">Descargar plantilla de Excel</a>
    </div>
    ${d.error ? `<p class="msg err" style="margin:0">${esc(d.error)}</p>` : ""}
    <div style="display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--rule);padding-top:14px">
      <h3>Desde foto o PDF</h3>
      ${showPhotos ? `
      <p class="muted" style="margin:0;font-size:14px">Una foto por página, recta y con buena luz. ${hasKey ? "" : "Necesita una clave de API en Ajustes."}</p>
      <div class="pickbtns">
        <button class="btn" id="nPhoto" type="button" ${reading ? "disabled" : ""}>${ICON.cam}${d.files.length ? "Otra página" : "Hacer foto"}</button>
        <button class="btn" id="nFiles" type="button" ${reading ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>Elegir PDF o fotos</button>
      </div>
      ${d.files.length ? `<div class="files">${d.files.map((f, i) => `<div class="f"><span>${/pdf/i.test(f.type) || /\.pdf$/i.test(f.name) ? "PDF" : "Página " + (i + 1)} · ${esc(f.name)}</span>${reading ? "" : `<button class="iconbtn" data-rm="${i}" type="button" aria-label="Quitar">${ICON.x}</button>`}</div>`).join("")}</div>` : ""}
      ${reading ? `<div class="progress"><span class="spin"></span><span>${esc(d.note)}</span><button class="btn ghost" id="nStop" type="button">Parar</button></div>` : ""}
      <button class="btn" id="nRead" type="button" ${!d.files.length || reading ? "disabled" : ""}>Leer con Claude</button>`
      : `<p class="muted" style="margin:0;font-size:14px">Leer la foto automáticamente necesita una clave de API de Anthropic, que se paga aparte. <button class="btn ghost" id="nShowPhotos" type="button" style="min-height:0;padding:2px 8px">Ver opciones</button></p>`}
    </div>
    <button class="btn ghost" id="nManual" type="button">Escribir las líneas a mano</button>
  </section>`;
  $("#nBack").onclick = () => { d.ctl?.abort(); UI.mode = "cotejo"; render(); };
  if (!reading) $("#nExcel").onclick = () => $("#xlsInput").click();
  if ($("#nShowPhotos")) $("#nShowPhotos").onclick = () => { d.showPhotos = true; renderNew(); };
  if ($("#nPhoto") && !reading) {
    $("#nPhoto").onclick = () => $("#docPhoto").click();
    $("#nFiles").onclick = () => $("#docFiles").click();
  }
  $("#view").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { d.files.splice(+b.dataset.rm, 1); renderNew(); });
  if ($("#nRead")) $("#nRead").onclick = readWithClaude;
  $("#nManual").onclick = () => { d.lineas = [mkLine()]; d.phase = "review"; renderNew(); };
  if ($("#nStop")) $("#nStop").onclick = () => d.ctl?.abort();
}
function addDocFiles(files) {
  const d = UI.draft; if (!d) return;
  d.files = [...d.files, ...[...files].filter(f => /^image\//.test(f.type) || /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name))];
  d.error = ""; renderNew();
}

/* ---------- importar Excel / CSV ---------- */
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return xlsxLoading ||= new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = XLSX_URL; sc.onload = res; sc.onerror = () => { xlsxLoading = null; rej(new Error("xlsx")); }; document.head.appendChild(sc); });
}
const plain = v => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const COLS = [ // orden de prioridad al asignar columnas; dentro de cada una, de patrón más claro a más vago
  ["ean", [/\b(ean|gtin|upc)\b|cod(igo)?\.? ?(de )?barras/]],
  ["importe", [/importe|^total|subtotal/]],
  ["precio", [/precio|p\.? ?unit|\bpvp\b|\bvk\b|preis|coste|tarifa/]],
  ["inhalt", [/karton|inhalt|uds? ?(\/|por|x) ?caja|unid.*caja|por caja|^u\/c$/]],
  ["cant", [/cant|menge|uds|unid|\bqty\b|piezas|^u\.?$/]],
  ["desc", [/desc|denomin|bezeichnung/, /producto|nombre|concepto|articulo/]],
  ["codigo", [/cod|ref|sku|pos\.? ?nr|artikel ?nr|art\.? ?nr/, /art\.?$|articulo|^n[º°o]? ?art/]]
];
function fmtCellDate(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(String(v ?? "").trim());
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : "";
}
function parseSheet(rows) {
  rows = rows.map(r => (r || []).map(c => c instanceof Date ? c : (c == null ? "" : c)));
  // fila de cabecera: la primera con al menos 2 columnas reconocidas, una de ellas cantidad
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 30) && hi < 0; i++) {
    const m = {}; const used = new Set();
    for (const [k, res] of COLS) for (const re of res) {
      const j = rows[i].findIndex((c, idx) => !used.has(idx) && typeof c === "string" && re.test(plain(c)));
      if (j >= 0) { m[k] = j; used.add(j); break; }
    }
    if (Object.keys(m).length >= 2 && m.cant != null) { hi = i; map = m; }
  }
  if (hi < 0) { hi = -1; map = { codigo: 0, desc: 1, cant: 2, precio: 3, ean: 4 }; }
  // datos de cabecera del albarán encima de la tabla: "Proveedor | X"
  const head = { proveedor: "", numero: "", fecha: "" };
  for (let i = 0; i < Math.max(hi, 0); i++) rows[i].forEach((c, j) => {
    const k = plain(c); const val = rows[i].slice(j + 1).find(x => x !== "" && x != null);
    if (val == null || /total|importe|unidades|summe/.test(k)) return;
    if (!head.proveedor && /proveedor|^empresa|lieferant/.test(k)) head.proveedor = String(val).trim();
    else if (!head.numero && /albar|lieferschein|^n[º°o]?\.? ?(de )?doc|^numero/.test(k)) head.numero = String(val).trim();
    else if (!head.fecha && /fecha|datum/.test(k)) head.fecha = fmtCellDate(val);
  });
  const lineas = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; const g = k => map[k] == null ? "" : r[map[k]];
    const cant = parseNum(g("cant"));
    const desc = String(g("desc") ?? "").trim();
    const codigo = String(g("codigo") ?? "").trim();
    const ean = String(g("ean") ?? "").replace(/\.0+$/, "").trim();
    if (cant == null || (!desc && !codigo && !ean)) continue;
    if (/^ejemplo/i.test(desc) || /^total/i.test(plain(codigo + desc))) continue;
    let precio = parseNum(g("precio"));
    const imp = parseNum(g("importe"));
    if (precio == null && imp != null && cant) precio = Math.round(imp / cant * 10000) / 10000;
    lineas.push(mkLine({ codigo, ean, descripcion: desc, cantidad: cant, precio, inhalt: parseNum(g("inhalt")) }));
  }
  return { ...head, lineas };
}
async function importExcel(file) {
  const d = UI.draft; if (!d) return;
  d.error = ""; flash("");
  try {
    await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    let best = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
      const r = parseSheet(rows);
      if (!best || r.lineas.length > best.lineas.length) best = r;
    }
    if (!best || !best.lineas.length) { d.error = "No he encontrado líneas en ese Excel. Revisa que tenga una columna de cantidad, o usa la plantilla."; return renderNew(); }
    Object.assign(d, { proveedor: best.proveedor || d.proveedor, numero: best.numero || d.numero, fecha: best.fecha || d.fecha, lineas: best.lineas, phase: "review", warn: "" });
    if (!d.proveedor && !d.numero) d.proveedor = file.name.replace(/\.(xlsx|xlsm|xls|csv|ods)$/i, "");
  } catch (e) {
    console.warn(e);
    d.error = e?.message === "xlsx" ? "No se pudo cargar el lector de Excel. Comprueba la conexión a internet y vuelve a intentarlo." : "No he podido abrir ese archivo. Guárdalo como .xlsx o .csv y vuelve a intentarlo.";
  }
  renderNew();
}
$("#xlsInput").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importExcel(f); });
["docPhoto", "docFiles"].forEach(id => $("#" + id).addEventListener("change", e => { addDocFiles(e.target.files); e.target.value = ""; }));

const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });
async function imageToJpeg(file) {
  const bmp = await loadBitmap(file);
  const sc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
}

const PROMPT = `Lee este albarán de entrega (documento de proveedor, normalmente en español) y extrae TODAS las líneas de producto.
Responde SOLO con JSON válido, sin texto adicional ni bloques de código, con esta forma exacta:
{"proveedor":"","numero":"","fecha":"AAAA-MM-DD","lineas":[{"codigo":"","ean":"","descripcion":"","cantidad":0,"uds_caja":null,"precio":0,"importe":0}]}
Reglas:
- "codigo": referencia o código de artículo del proveedor tal como aparece. "ean": código de barras EAN/UPC si aparece en la línea; si no, "".
- "cantidad": unidades servidas, tal como figuran en el albarán. "uds_caja": unidades por caja si hay esa columna (solo informativo), si no null.
- Albaranes de TEDi (Lieferschein, en alemán): "codigo" = POS NR completo (si el último dígito aparece en la línea de abajo, júntalo: 191465 y 3 debajo = "1914653"); "descripcion" = BEZEICHNUNG; "cantidad" = MENGE (unidades); "uds_caja" = KARTON-INHALT; "precio" = VK (precio de venta por unidad); "numero" = Lieferschein Nr.; "fecha" = Belegdatum. Ignora AUFTRAG, WGR y DNP.
- "precio": precio unitario NETO por unidad, después de descuentos si los hay. Si solo hay importe de línea, precio = importe / cantidad.
- Números con punto decimal, sin símbolo de moneda. Si un dato no aparece, usa "" o null; no inventes nada.
- No incluyas líneas de totales, bases imponibles, IVA, portes, envases ni observaciones.
- "numero": número de albarán. "fecha": fecha del albarán en formato AAAA-MM-DD, o "" si no aparece.
- Si hay varias páginas o archivos, junta todas las líneas en orden.`;

async function readWithClaude() {
  const d = UI.draft; const key = getKey();
  if (!key) { d.error = "Falta la clave de API. Añádela en Ajustes, o pega las líneas desde Excel."; return renderNew(); }
  d.phase = "reading"; d.error = ""; d.note = "Preparando los archivos…"; renderNew();
  d.ctl = new AbortController();
  try {
    const content = [];
    for (const f of d.files) {
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        if (f.size > 30 * 1024 * 1024) throw { code: "too_big" };
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: await blobToB64(f) } });
      } else {
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToB64(await imageToJpeg(f)) } });
      }
    }
    content.push({ type: "text", text: PROMPT });
    d.note = `Leyendo ${d.files.length} archivo${d.files.length === 1 ? "" : "s"} con Claude… suele tardar menos de un minuto.`; renderNew();
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: d.ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: getModel(), max_tokens: 16000, messages: [{ role: "user", content }] })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw { code: "http", status: resp.status, detail: body?.error?.message || "" };
    const text = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s < 0 || e < s) throw { code: "empty" };
    const out = JSON.parse(text.slice(s, e + 1));
    const lineas = (out.lineas || []).map(mkLine).filter(l => l.desc || l.codigo);
    if (!lineas.length) throw { code: "empty" };
    Object.assign(d, { proveedor: out.proveedor || "", numero: String(out.numero || ""), fecha: out.fecha || "", lineas, phase: "review",
      warn: body.stop_reason === "max_tokens" ? "El albarán es muy largo y puede que falten las últimas líneas. Compruébalo con el papel." : "" });
  } catch (e) {
    d.phase = "pick";
    if (e?.name === "AbortError") d.error = "Lectura cancelada.";
    else if (e?.code === "http") d.error = ({
      401: "La clave de API no es válida. Revísala en Ajustes.",
      403: "La clave no tiene permiso para usar este modelo. Prueba otro en Ajustes.",
      404: "Ese modelo no está disponible para tu clave. Elige otro en Ajustes.",
      413: "Los archivos pesan demasiado. Prueba con menos páginas.",
      429: "Has llegado al límite de uso de la API. Espera un minuto o revisa tu saldo en console.anthropic.com.",
      529: "Claude está saturado ahora mismo. Vuelve a intentarlo en un momento."
    }[e.status]) || `La API respondió con un error (${e.status}). ${e.detail}`;
    else if (e?.code === "empty") d.error = "No he encontrado líneas de producto. Prueba con una foto más nítida y recta.";
    else if (e?.code === "too_big") d.error = "El PDF pesa más de 30 MB. Divídelo o haz fotos de las páginas.";
    else if (e instanceof SyntaxError) d.error = "La respuesta no se pudo interpretar. Vuelve a intentarlo.";
    else if (e instanceof TypeError) d.error = "No hay conexión con la API de Anthropic. Revisa internet.";
    else d.error = "No he podido leer el albarán. Prueba con una foto más nítida o vuelve a intentarlo.";
    console.warn(e);
  }
  renderNew();
}

function renderReview() {
  const d = UI.draft;
  const total = () => eur(d.lineas.reduce((s, l) => s + (l.cant || 0) * (l.precio || 0), 0));
  $("#view").innerHTML = `<section class="sheet" style="display:flex;flex-direction:column;gap:14px">
    <div class="albhead"><h2>Revisa lo leído</h2><button class="btn ghost" id="rBack" type="button">Cancelar</button></div>
    <p class="muted" style="margin:0;font-size:14px">Compara con el papel y corrige lo que haga falta. ${d.lineas.length} líneas · <span class="mono" id="rTot">${total()}</span></p>
    ${d.warn ? `<p class="msg err" style="margin:0">${esc(d.warn)}</p>` : ""}
    <div class="row">
      <label style="flex-basis:100%"><span class="label">Proveedor</span><input id="rProv" value="${esc(d.proveedor)}"></label>
      <label><span class="label">Nº albarán</span><input id="rNum" class="mono" value="${esc(d.numero)}"></label>
      <label><span class="label">Fecha</span><input id="rFecha" type="date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? d.fecha : "")}"></label>
    </div>
    <div class="rlines">${d.lineas.map((l, i) => `<div class="rline" data-i="${i}">
      <label class="full"><span class="label">Descripción</span><input data-k="desc" value="${esc(l.desc)}"></label>
      <label><span class="label">Código</span><input data-k="codigo" class="mono" value="${esc(l.codigo)}"></label>
      <label><span class="label">EAN</span><input data-k="ean" class="mono" inputmode="numeric" value="${esc(l.ean)}"></label>
      <label><span class="label">Cantidad</span><input data-k="cant" class="n" inputmode="decimal" value="${comma(l.cant)}"></label>
      <label><span class="label">Uds por caja</span><input data-k="inhalt" class="n" inputmode="decimal" placeholder="—" value="${comma(l.inhalt)}"></label>
      <label><span class="label">Precio ud.</span><input data-k="precio" class="n" inputmode="decimal" value="${comma(l.precio)}"></label>
      <div class="rfoot"><span class="muted">Importe <span class="mono imp">${eur((l.cant || 0) * (l.precio || 0))}</span></span>
      <button class="btn ghost danger" data-del="${i}" type="button" style="min-height:36px;padding:4px 10px">Quitar</button></div>
    </div>`).join("")}</div>
    <button class="btn ghost" id="rAdd" type="button">Añadir línea</button>
    <button class="btn primary" id="rSave" type="button" style="min-height:52px">Guardar y empezar a cotejar</button>
  </section>`;
  const sync = () => { d.proveedor = $("#rProv").value; d.numero = $("#rNum").value; d.fecha = $("#rFecha").value; };
  ["rProv", "rNum", "rFecha"].forEach(id => $("#" + id).oninput = sync);
  $("#view").querySelectorAll(".rline").forEach(box => {
    const l = d.lineas[+box.dataset.i];
    box.querySelectorAll("input").forEach(inp => inp.oninput = () => {
      const k = inp.dataset.k; l[k] = (k === "cant" || k === "precio" || k === "inhalt") ? parseNum(inp.value) : inp.value;
      box.querySelector(".imp").textContent = eur((l.cant || 0) * (l.precio || 0));
      $("#rTot").textContent = total();
    });
  });
  $("#view").querySelectorAll("[data-del]").forEach(b => b.onclick = () => { sync(); d.lineas.splice(+b.dataset.del, 1); renderReview(); });
  $("#rAdd").onclick = () => { sync(); d.lineas.push(mkLine()); renderReview(); const last = $("#view .rline:last-child input"); last?.focus(); last?.scrollIntoView({ block: "center" }); };
  $("#rBack").onclick = () => { UI.mode = "cotejo"; render(); };
  $("#rSave").onclick = () => {
    sync();
    const lineas = d.lineas.filter(l => (l.codigo + l.ean + l.desc).trim()).map(l => ({ ...l, codigo: String(l.codigo).trim(), ean: String(l.ean).trim(), desc: String(l.desc).trim(), cant: l.cant ?? 0 }));
    if (!lineas.length) return;
    const alb = { id: uid(), proveedor: d.proveedor.trim(), numero: d.numero.trim(), fecha: d.fecha, creado: Date.now(), lineas };
    S.albs.set(alb.id, alb); persist(alb); UI.draft = null; setActive(alb.id);
  };
}

/* ---------- exportar CSV ---------- */
function exportCsv() {
  const a = cur(); const s = stats(a);
  const q = v => { const t = String(v ?? ""); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const f = n => n == null ? "" : String(Math.round(n * 1000) / 1000).replace(".", ",");
  const rows = [["Proveedor", a.proveedor], ["Albarán", a.numero], ["Fecha", fmtDate(a.fecha)], [],
    ["Código", "EAN", "Descripción", "Uds/caja", "Cant. albarán", "Cant. recibida", "Diferencia cant.", "Precio albarán", "Precio real", "Diferencia precio ud.", "Diferencia importe", "Estado", "Nota"]];
  a.lineas.forEach(l => {
    const pr = l.precioReal ?? l.precio;
    const dImp = ((l.recib ?? 0) * (pr ?? 0) - (l.extra ? 0 : (l.cant || 0) * (l.precio || 0)));
    rows.push([l.codigo, l.ean, l.desc, f(l.inhalt), l.extra ? "" : f(l.cant), f(l.recib), l.recib == null || l.extra ? "" : f(l.recib - l.cant), f(l.precio), f(l.precioReal),
      l.precioReal == null || l.precio == null ? "" : f(l.precioReal - l.precio), l.recib == null ? "" : f(dImp), ST_LABEL[status(l)], l.nota]);
  });
  rows.push([], ["Importe albarán", "", "", "", f(s.impAlb)], ["Importe recibido", "", "", "", f(s.impRec)], ["Diferencia", "", "", "", f(s.impRec - s.impAlb)]);
  const csv = "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n");
  const safe = t => String(t || "").replace(/[^\w\-]+/g, "_");
  downloadFile(`cotejo_${safe(a.proveedor) || "albaran"}_${safe(a.numero) || "sn"}.csv`, csv, "text/csv;charset=utf-8");
}

/* ---------- ejemplo ---------- */
function loadDemo() {
  const L = [
    ["70412", "4062213041207", "Vela perfumada vainilla 120 g", 24, 0.85], ["70415", "4062213041504", "Vela perfumada canela 120 g", 24, 0.85],
    ["81203", "4062213812036", "Taza cerámica Navidad 350 ml", 12, 1.40], ["81210", "4062213812104", "Plato postre estrella dorado", 18, 0.95],
    ["55018", "4062213550181", "Pilas alcalinas AA pack 8", 30, 1.65], ["60231", "4062213602316", "Guirnalda LED 20 luces", 10, 2.10],
    ["60240", "4062213602408", "Bola de Navidad roja 6 cm (6 uds)", 20, 1.20], ["30117", "4062213301172", "Bolsa regalo kraft mediana", 50, 0.32]];
  const alb = { id: uid(), ejemplo: true, proveedor: "Distribuciones Ejemplo S.L.", numero: "A-2026-01482", fecha: new Date().toISOString().slice(0, 10), creado: Date.now(),
    lineas: L.map(r => mkLine({ codigo: r[0], ean: r[1], descripcion: r[2], cantidad: r[3], precio: r[4] })) };
  alb.lineas[0].recib = 24; alb.lineas[1].recib = 20; alb.lineas[2].recib = 12; alb.lineas[2].precioReal = 1.55; alb.lineas[2].nota = "Precio de la factura distinto";
  S.albs.set(alb.id, alb); persist(alb); setActive(alb.id);
  flash("Prueba a escribir 60231 o 55018 en la casilla de arriba.");
}

/* ---------- arranque ---------- */
$("#btnNew").onclick = startNew;
$("#btnSettings").onclick = () => { UI.mode = "ajustes"; render(); };
$("#albSel").onchange = e => { if (e.target.value === "__list") { UI.mode = "lista"; render(); } else setActive(e.target.value); };
$("#btnScan").onclick = openScanner;
$("#conteo").onchange = e => { UI.conteo = e.target.checked; lsSet("cotejo-conteo", UI.conteo ? "1" : "0"); };
load();
render();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
