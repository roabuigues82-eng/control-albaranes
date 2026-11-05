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
const UI = { mode: "cotejo", filter: "todas", selected: null, matches: null, msg: "", msgType: "", draft: null, conteo: false, confirmDel: false, confirmWipe: false };
function flash(t, type = "") { UI.msg = t; UI.msgType = type; const m = $("#msg"); if (m) { m.textContent = t; m.className = "msg " + type; } }
function fmtDate(f) { if (!f) return "Sin fecha"; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f); return m ? `${m[3]}/${m[2]}/${m[1]}` : f; }
function setActive(id) { S.active = id; lsSet("cotejo-activo", id); Object.assign(UI, { mode: "cotejo", selected: null, matches: null, filter: "todas", confirmDel: false }); flash(""); render(); }

function render() {
  const sel = $("#albSel");
  const albs = [...S.albs.values()].sort((a, b) => (b.creado || 0) - (a.creado || 0));
  sel.innerHTML = albs.length ? albs.map(a => `<option value="${a.id}" ${a.id === S.active ? "selected" : ""}>${esc(a.proveedor || "Sin proveedor")} · ${esc(a.numero || "s/n")}${a.ejemplo ? " (ejemplo)" : ""}</option>`).join("") + `<option value="__list">Ver todos los albaranes (${albs.length})…</option>` : `<option>Sin albaranes</option>`;
  sel.disabled = !albs.length;
  $("#dock").hidden = !(UI.mode === "cotejo" && cur());
  if (UI.mode === "nuevo") return renderNew();
  if (UI.mode === "lista") return renderList(albs);
  if (UI.mode === "ajustes") return renderSettings();
  if (!cur()) return renderEmpty();
  renderCotejo();
}

function renderEmpty() {
  $("#view").innerHTML = `<section class="sheet empty">
    <h2>Todavía no hay albaranes</h2>
    <p>Importa el PDF o el Excel del albarán (o varios a la vez). Luego escanea cada artículo que llega y se irá marcando en la lista.</p>
    <div class="row"><button class="btn primary" id="eNew" type="button">Importar albarán</button>
    <button class="btn" id="eDemo" type="button">Probar con un albarán de ejemplo</button></div>
  </section>`;
  $("#eNew").onclick = startNew;
  $("#eDemo").onclick = loadDemo;
}

function renderList(albs) {
  let F = 0, T = 0, neto = 0;
  albs.forEach(x => { const st = stats(x); F += st.revisadas; T += st.total; neto += diffs(x).neto; });
  $("#view").innerHTML = `<section class="sheet"><div class="albhead"><h2>Albaranes cargados</h2>
    <button class="btn ghost" id="lBack" type="button">Volver</button></div>
    <p class="muted" style="margin:6px 0 0;font-size:14px">Al escanear, la app busca el artículo en todos estos albaranes y lo marca en el suyo.</p>
    <div class="difsum" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="pos"><span class="label">Vistos</span><b>${F} / ${T}</b><span>${albs.length} albaranes</span></div>
      <div class="${neto < 0 ? "neg" : "pos"}"><span class="label">Diferencias</span><b>${sgn(neto, eur)}</b><span>&nbsp;</span></div>
    </div>
    <div class="list">${albs.map(a => {
      const s = stats(a); const pc = s.total ? Math.round(s.revisadas / s.total * 100) : 0;
      const D = diffs(a);
      return `<div class="it"><div style="min-width:0">
        <strong>${esc(a.proveedor || "Sin proveedor")}</strong> <span class="mono muted">Nº ${esc(a.numero || "s/n")}</span>${a.ejemplo ? ' <span class="pill s-extra">Ejemplo</span>' : ""}
        <div class="muted" style="font-size:13px">${esc(fmtDate(a.fecha))} · ${s.revisadas} / ${s.total} vistos${D.rows.length ? ` · <span style="color:var(--bad)">${D.rows.length} con diferencia (${sgn(D.neto, eur)})</span>` : ""}</div></div>
        <div style="display:flex;gap:10px;align-items:center"><div class="bar" aria-label="${pc}% visto"><i style="width:${pc}%"></i></div>
        <button class="btn" data-open="${a.id}" type="button">Abrir</button></div></div>`;
    }).join("")}</div>
    <button class="btn" id="lDifAll" type="button" style="width:100%;margin-top:12px">Descargar diferencias de todos (Excel)</button>
  </section>`;
  $("#lBack").onclick = () => { UI.mode = "cotejo"; render(); };
  $("#lDifAll").onclick = () => exportDiffXlsx(albs);
  $("#view").querySelectorAll("[data-open]").forEach(b => b.onclick = () => setActive(b.dataset.open));
}

/* ---------- cotejo ---------- */
function renderCotejo() {
  const a = cur(); const s = stats(a);
  const found = s.revisadas, total = s.total, pend = total - found;
  const inc = s.c.falta + s.c.sobra + s.c.precio + s.c.extra;
  const f = ["pend", "hechos", "dif"].includes(UI.filter) ? UI.filter : "todas";
  const D = diffs(a);
  const lines = a.lineas.filter(l => f === "todas" || (f === "pend" ? l.recib == null : l.recib != null));
  const pc = total ? Math.round(found / total * 100) : 0;
  const seg = (k, label) => `<button type="button" data-f="${k}" aria-pressed="${f === k}">${label}</button>`;
  $("#view").innerHTML = `
  <div class="scanbar">
    <div class="scanrow">
      <div class="field">${ICON.bars}<input id="q" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" placeholder="Escribe el código" aria-label="Código del artículo"></div>
    </div>
    <div class="progress-line"><div class="pbar"><i style="width:${pc}%"></i></div><span class="mono"><b>${found}</b> / ${total}</span></div>
    ${S.albs.size > 1 ? `<div class="allalb">Escaneando en ${S.albs.size} albaranes · <button type="button" id="goList">ver todos</button></div>` : ""}
    <div id="msg" class="msg ${UI.msgType}" role="status">${esc(UI.msg)}</div>
  </div>
  <div id="cardSlot"></div>
  <section class="sheet" style="padding:12px">
    <div class="albhead" style="padding:0 4px">
      <h2>${esc(a.proveedor || "Sin proveedor")} <span class="mono muted" style="font-size:14px;font-weight:400">Nº ${esc(a.numero || "s/n")}</span></h2>
      ${a.ejemplo ? '<span class="pill s-extra">Ejemplo</span>' : ""}
    </div>
    <div class="seg">${seg("todas", `Todos<b>${total}</b>`)}${seg("pend", `Pendientes<b>${pend}</b>`)}${seg("hechos", `Vistos<b>${found}</b>`)}${seg("dif", `Diferencias<b>${D.rows.length}</b>`)}</div>
    ${f === "dif" ? renderDiffs(D, pend) : `<ul class="checklist">${lines.map(l => {
      const st = status(l); const done = l.recib != null;
      return `<li class="ck${done ? " done" : ""}${UI.flashId === l.id ? " flash" : ""}" data-id="${l.id}">
        <button type="button" class="ckbtn" data-tog="${l.id}" aria-pressed="${done}" aria-label="${done ? "Desmarcar" : "Marcar"} ${esc(l.desc)}">
          <span class="box">${done ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ""}</span>
          <span class="txt"><span class="d">${esc(l.desc || "Sin descripción")}</span>
          <span class="m"><span class="mono">${esc(l.codigo || "—")}</span> · ${l.extra ? "fuera de albarán" : `${num(l.cant)} uds`} · ${eur(l.precio)}${st === "falta" ? ` · <span class="pill s-falta">Faltan ${num(l.cant - l.recib)}</span>` : st === "sobra" ? ` · <span class="pill s-sobra">Sobran ${num(l.recib - l.cant)}</span>` : st === "precio" ? ` · <span class="pill s-precio">Precio distinto</span>` : ""}</span>
          ${l.nota ? `<span class="m">${esc(l.nota)}</span>` : ""}</span>
        </button>
        <button type="button" class="more" data-edit="${l.id}" aria-label="Cambiar cantidad de ${esc(l.desc)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>
      </li>`;
    }).join("") || `<li class="muted" style="padding:16px">${f === "pend" ? "¡Todo visto! No queda nada pendiente." : "Nada por aquí todavía."}</li>`}</ul>`}
    <details class="extras"${UI.confirmDel ? " open" : ""}><summary>Más opciones</summary>
      <div class="totals">
        <div><span class="label">Con diferencias</span><span class="v">${inc}</span></div>
        <div><span class="label">Importe albarán</span><span class="v">${eur(s.impAlb)}</span></div>
        <div><span class="label">Importe visto</span><span class="v">${eur(s.impRec)}</span></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="btnExport" type="button">Exportar a Excel (CSV)</button>
        <button class="btn ghost" id="btnAddLine" type="button">Añadir artículo a mano</button>
        ${UI.confirmDel ? `<span class="muted">¿Borrar este albarán?</span><button class="btn danger" id="btnDelYes" type="button">Sí, borrar</button><button class="btn ghost" id="btnDelNo" type="button">Cancelar</button>` : `<button class="btn ghost" id="btnDel" type="button">Borrar albarán</button>`}
      </div>
    </details>
  </section>`;
  renderCard();
  const q = $("#q");
  q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(q.value); q.blur(); } });
  $("#view").querySelectorAll("[data-f]").forEach(b => b.onclick = () => { UI.filter = b.dataset.f; renderCotejo(); });
  if ($("#btnDifXlsx")) $("#btnDifXlsx").onclick = () => exportDiffXlsx([a]);
  if ($("#goList")) $("#goList").onclick = () => { UI.mode = "lista"; render(); };
  $("#view").querySelectorAll("[data-tog]").forEach(el => el.onclick = () => toggleLine(el.dataset.tog));
  $("#view").querySelectorAll("[data-edit]").forEach(el => el.onclick = () => { UI.selected = el.dataset.edit; UI.matches = null; renderCotejo(); scrollTo({ top: 0, behavior: "smooth" }); });
  $("#btnExport").onclick = exportCsv;
  $("#btnAddLine").onclick = () => { const l = mkLine({ descripcion: "Artículo nuevo", extra: true }); l.recib = 1; a.lineas.push(l); persist(a); UI.selected = l.id; renderCotejo(); scrollTo({ top: 0 }); };
  if ($("#btnDel")) $("#btnDel").onclick = () => { UI.confirmDel = true; renderCotejo(); };
  if ($("#btnDelYes")) $("#btnDelYes").onclick = () => { UI.confirmDel = false; removeAlb(a.id); };
  if ($("#btnDelNo")) $("#btnDelNo").onclick = () => { UI.confirmDel = false; renderCotejo(); };
  if (UI.flashId) {
    const el = $(`.ck[data-id="${UI.flashId}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const id = UI.flashId; setTimeout(() => { if (UI.flashId === id) { UI.flashId = null; $(`.ck[data-id="${id}"]`)?.classList.remove("flash"); } }, 2500);
  }
}
function toggleLine(id) {
  const a = cur(); const l = a.lineas.find(x => x.id === id); if (!l) return;
  if (l.recib == null) { l.recib = l.extra ? 1 : l.cant; flash(`✓ ${l.desc}`, "ok"); }
  else { l.recib = null; l.precioReal = null; flash(`Desmarcado: ${l.desc}`); }
  persist(a);
  const y = scrollY; renderCotejo(); scrollTo(0, y);
}

/* ---------- diferencias ---------- */
function diffs(a) {
  const rows = [];
  let faltaU = 0, faltaE = 0, sobraU = 0, sobraE = 0, precioE = 0;
  a.lineas.forEach(l => {
    if (l.recib == null) return;
    const pAlb = l.precio || 0, pReal = l.precioReal ?? pAlb;
    const du = l.extra ? l.recib : l.recib - (l.cant || 0);
    const qtyE = du * pAlb;
    const prE = l.recib * (pReal - pAlb);
    if (Math.abs(du) < 1e-9 && Math.abs(prE) < 0.005) return;
    const tipo = l.extra ? "Fuera de albarán" : du < 0 ? "Falta" : du > 0 ? "Sobra" : "Precio distinto";
    if (du < 0) { faltaU += -du; faltaE += qtyE; } else if (du > 0) { sobraU += du; sobraE += qtyE; }
    precioE += prE;
    rows.push({ l, du, euros: qtyE + prE, prE, tipo });
  });
  return { rows, faltaU, faltaE, sobraU, sobraE, precioE, neto: faltaE + sobraE + precioE };
}
const sgn = (n, f) => (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n));
function renderDiffs(D, pend) {
  const row = r => `<li class="dif ${r.du < 0 || r.euros < 0 ? "neg" : "pos"}"><button type="button" data-edit="${r.l.id}">
      <span class="txt"><span class="d">${esc(r.l.desc)}</span>
      <span class="m"><span class="mono">${esc(r.l.codigo || "—")}</span> · ${r.l.extra ? "no está en el albarán" : `albarán ${num(r.l.cant)} → llegan ${num(r.l.recib)}`}${Math.abs(r.prE) >= 0.005 ? ` · precio ${eur(r.l.precioReal)} (albarán ${eur(r.l.precio)})` : ""}</span>
      ${r.l.nota ? `<span class="m">${esc(r.l.nota)}</span>` : ""}</span>
      <span class="amt"><b>${r.du ? sgn(r.du, num) + " uds" : r.tipo}</b><span>${sgn(r.euros, eur)}</span></span>
    </button></li>`;
  return `<div class="difsum">
      <div class="neg"><span class="label">Faltan</span><b>${num(D.faltaU)} uds</b><span>${sgn(D.faltaE, eur)}</span></div>
      <div class="pos"><span class="label">Sobran</span><b>${num(D.sobraU)} uds</b><span>${sgn(D.sobraE, eur)}</span></div>
      <div class="${D.neto < 0 ? "neg" : "pos"}"><span class="label">Total</span><b>${sgn(D.neto, eur)}</b><span>${D.precioE ? `precios ${sgn(D.precioE, eur)}` : "&nbsp;"}</span></div>
    </div>
    ${pend ? `<p class="muted" style="font-size:13px;margin:8px 4px 0">Quedan ${pend} artículos sin marcar. Si no aparecen, también faltarán.</p>` : ""}
    <ul class="checklist">${D.rows.map(row).join("") || `<li class="muted" style="padding:16px">Sin diferencias por ahora. Cuando cambies una cantidad con el lápiz ✎, aparecerá aquí.</li>`}</ul>
    <button class="btn" id="btnDifXlsx" type="button" style="width:100%;margin-top:10px">Descargar hoja de diferencias (Excel)</button>`;
}
async function exportDiffXlsx(albs) {
  flash("Preparando el Excel…");
  try { await loadXlsx(); } catch { flash("No se pudo preparar el Excel. Revisa la conexión a internet.", "err"); return; }
  const r2 = n => Math.round(n * 100) / 100;
  const many = albs.length > 1;
  const cols = [...(many ? ["Albarán"] : []), "Código", "Descripción", "Cant. albarán", "Cant. recibida", "Diferencia uds", "Precio albarán", "Precio real", "Diferencia €", "Tipo", "Nota"];
  const pre = x => many ? [x.numero || ""] : [];
  let body = [], pend = [], T = { faltaU: 0, faltaE: 0, sobraU: 0, sobraE: 0, precioE: 0, neto: 0 };
  albs.forEach(x => {
    const D = diffs(x);
    D.rows.forEach(r => body.push([...pre(x), r.l.codigo, r.l.desc, r.l.extra ? "" : r.l.cant, r.l.recib, r.du, r.l.precio ?? "", r.l.precioReal ?? "", r2(r.euros), r.tipo, r.l.nota || ""]));
    for (const k in T) T[k] += D[k];
    x.lineas.filter(l => l.recib == null).forEach(l => pend.push([...pre(x), l.codigo, l.desc, l.cant, l.precio ?? "", r2((l.cant || 0) * (l.precio || 0))]));
  });
  const head = many ? [["Albaranes", albs.map(x => x.numero || "s/n").join(", ")], ["Fecha del informe", new Date().toLocaleDateString("es-ES")], []]
    : [["Albarán", albs[0].numero || ""], ["Proveedor", albs[0].proveedor || ""], ["Fecha", fmtDate(albs[0].fecha)], []];
  const pad = many ? [""] : [];
  const foot = [[], ["Faltan", ...pad, "", "", "", -T.faltaU, "", "", r2(T.faltaE)], ["Sobran", ...pad, "", "", "", T.sobraU, "", "", r2(T.sobraE)], ["Diferencia de precios", ...pad, "", "", "", "", "", "", r2(T.precioE)], ["TOTAL", ...pad, "", "", "", T.sobraU - T.faltaU, "", "", r2(T.neto)]];
  const ws = XLSX.utils.aoa_to_sheet([...head, cols, ...body, ...foot]);
  ws["!cols"] = [...(many ? [{ wch: 11 }] : []), { wch: 13 }, { wch: 36 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 12 }, { wch: 16 }, { wch: 30 }];
  const ws2 = XLSX.utils.aoa_to_sheet([["Artículos sin marcar (aún no encontrados)"], [], [...(many ? ["Albarán"] : []), "Código", "Descripción", "Cant. albarán", "Precio", "Importe"], ...pend]);
  ws2["!cols"] = [...(many ? [{ wch: 11 }] : []), { wch: 13 }, { wch: 36 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Diferencias");
  XLSX.utils.book_append_sheet(wb, ws2, "Sin marcar");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const safe = t => String(t || "").replace(/[^\w\-]+/g, "_");
  downloadFile(many ? `diferencias_${albs.length}_albaranes.xlsx` : `diferencias_${safe(albs[0].numero) || "albaran"}.xlsx`, out, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  flash("Hoja de diferencias descargada.", "ok");
}

function renderCard() {
  const slot = $("#cardSlot"); if (!slot) return;
  const a = cur();
  if (UI.matches) {
    slot.innerHTML = `<section class="card"><div class="top"><h3>Varias coincidencias: elige el artículo</h3><button class="iconbtn" id="cClose" aria-label="Cerrar" type="button">${ICON.x}</button></div>
      ${UI.matchAlb && UI.matchAlb !== S.active ? `<p class="muted" style="margin:0">Del albarán ${esc(albName(S.albs.get(UI.matchAlb)))}</p>` : ""}
      <div class="picklist">${UI.matches.map(l => `<button type="button" data-pick="${l.id}"><span><span class="mono">${esc(l.codigo || l.ean)}</span> · ${esc(l.desc)}</span><span class="pill s-${status(l)}">${ST_LABEL[status(l)]}</span></button>`).join("")}</div></section>`;
    slot.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { UI.matches = null; selectLine(b.dataset.pick, false); });
    $("#cClose").onclick = () => { UI.matches = null; UI.matchAlb = null; renderCard(); };
    return;
  }
  const l = a.lineas.find(x => x.id === UI.selected);
  if (!l) { slot.innerHTML = ""; return; }
  const start = l.recib ?? (l.extra ? 1 : l.cant);
  slot.innerHTML = `<section class="card" aria-live="polite">
    <div class="top">
      <div style="min-width:0;flex:1">
        ${l.extra ? `<input id="cDesc" value="${esc(l.desc)}" aria-label="Descripción" class="cin" style="font:700 17px var(--f-display)">` : `<div class="desc">${esc(l.desc || "Sin descripción")}</div>`}
        <div class="codes">${l.extra ? `<label>Código <input id="cCode" class="mono cin" value="${esc(l.codigo)}" style="width:160px;padding:3px 6px;min-height:0"></label>` : `<span>${esc(l.codigo || "—")}</span>`}</div>
      </div>
      <button class="iconbtn" id="cClose" aria-label="Cerrar" type="button">${ICON.x}</button>
    </div>
    <div class="qty">
      <div class="qlab">${l.extra ? "No está en el albarán" : `En el albarán: <b>${num(l.cant)} uds</b>${l.inhalt ? ` · caja de ${num(l.inhalt)}` : ""}`}</div>
      <div class="label" style="margin-top:6px">Han llegado</div>
      <div class="stepper big"><button type="button" id="cMinus" aria-label="Una menos">−</button>
      <input id="cRecib" inputmode="decimal" value="${comma(start)}" aria-label="Unidades que han llegado">
      <button type="button" id="cPlus" aria-label="Una más">+</button></div>
      <div class="diff" id="dQty"></div>
    </div>
    <details class="extras" style="margin-top:0;padding-top:8px"${l.precioReal != null || l.nota ? " open" : ""}><summary>Precio distinto o nota</summary>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <label class="label">Precio real por unidad ${l.precio != null ? `(albarán: ${eur(l.precio)})` : ""}
        <input id="cPrecio" class="cin mono" inputmode="decimal" value="${comma(l.precioReal)}" placeholder="${l.precio == null ? "0,00" : l.precio.toFixed(2).replace(".", ",")}"></label>
        <textarea id="cNota" class="cin" placeholder="Nota (caja dañada, otro artículo…)" aria-label="Nota">${esc(l.nota)}</textarea>
      </div>
    </details>
    <div class="actions">
      <button class="btn primary" id="cOk" type="button" style="flex:1;min-height:50px">Guardar</button>
      ${l.recib != null && !l.extra ? `<button class="btn ghost" id="cReset" type="button">Desmarcar</button>` : ""}
      ${l.extra ? `<button class="btn ghost danger" id="cDelLine" type="button">Quitar</button>` : ""}
    </div>
  </section>`;
  const inp = $("#cRecib");
  const diff = () => {
    const v = parseNum(inp.value), dq = $("#dQty");
    if (v == null || l.extra) { dq.textContent = ""; return; }
    const d = v - (l.cant || 0);
    dq.textContent = d === 0 ? "✓ Cantidad correcta" : (d < 0 ? `Faltan ${num(-d)}` : `Sobran ${num(d)}`);
    dq.style.color = d === 0 ? "var(--ok)" : "var(--warn)";
  };
  diff();
  inp.addEventListener("input", diff);
  inp.addEventListener("focus", () => inp.select());
  $("#cMinus").onclick = () => { inp.value = comma(Math.max(0, (parseNum(inp.value) ?? 0) - 1)); diff(); };
  $("#cPlus").onclick = () => { inp.value = comma((parseNum(inp.value) ?? 0) + 1); diff(); };
  $("#cOk").onclick = () => {
    l.recib = parseNum(inp.value) ?? 0;
    l.precioReal = parseNum($("#cPrecio").value);
    l.nota = $("#cNota").value.trim();
    if (l.extra) { l.desc = $("#cDesc").value.trim() || "Artículo"; l.codigo = $("#cCode").value.trim(); }
    persist(a);
    const d = l.extra ? 0 : l.recib - (l.cant || 0);
    flash(`Guardado: ${l.desc} · ${num(l.recib)} uds${d < 0 ? ` (faltan ${num(-d)})` : d > 0 ? ` (sobran ${num(d)})` : ""}`, d ? "err" : "ok");
    UI.selected = null; UI.flashId = l.id; renderCotejo();
  };
  if ($("#cReset")) $("#cReset").onclick = () => { l.recib = null; l.precioReal = null; persist(a); UI.selected = null; flash(`Desmarcado: ${l.desc}`); renderCotejo(); };
  $("#cClose").onclick = () => { UI.selected = null; renderCotejo(); };
  if ($("#cDelLine")) $("#cDelLine").onclick = () => { a.lineas = a.lineas.filter(x => x !== l); persist(a); UI.selected = null; renderCotejo(); };
}
function refreshKeepFocus() { const y = scrollY; renderCotejo(); scrollTo(0, y); }

/* ---------- búsqueda ---------- */
/* El código de barras de la etiqueta lleva más números: el código del artículo son los 10 primeros. */
function scanCandidates(raw) {
  const q = norm(raw); if (!q) return [];
  const out = [];
  if (/^\d{11,}$/.test(q)) out.push(q.slice(0, 10));
  out.push(q);
  return out;
}
/* coincidencia exacta (o código de barras que empieza por el código) */
function findStrict(alb, raw) {
  for (const q of scanCandidates(raw)) {
    const qz = stripZ(q);
    const m = alb.lineas.filter(l => [l.codigo, l.ean, l.pos].some(c => { const n = norm(c); return n && (n === q || stripZ(n) === qz); }));
    if (m.length) return m;
  }
  const q = norm(raw);
  if (q.length >= 11) {
    const m = alb.lineas.filter(l => [l.codigo, l.ean].some(c => { const n = norm(c); return n.length >= 8 && (q.startsWith(n) || q.includes(n)); }));
    if (m.length) return m;
  }
  return [];
}
/* búsqueda escrita: también por parte del código o de la descripción */
function findLoose(alb, raw) {
  const q = norm(raw); if (q.length < 3) return [];
  return alb.lineas.filter(l => norm(l.codigo).includes(q) || norm(l.ean).includes(q) || norm(l.desc).includes(q));
}
const albName = x => `Nº ${x.numero || "s/n"}`;
/* devuelve true si encontró el artículo (en este albarán o en cualquier otro cargado) */
function search(raw) {
  const a = cur(); const code = String(raw || "").trim();
  if (!a || !code) return false;
  if ($("#q")) $("#q").value = "";
  let alb = a, m = findStrict(a, code);
  if (!m.length) for (const x of S.albs.values()) { if (x.id === a.id) continue; const mm = findStrict(x, code); if (mm.length) { alb = x; m = mm; break; } }
  if (!m.length) m = findLoose(a, code);
  if (m.length === 1) { UI.matches = null; selectLine(m[0].id, false, alb); return true; }
  if (m.length > 1) { UI.selected = null; UI.matches = m; UI.matchAlb = alb.id; flash(`${m.length} artículos coinciden con «${code}»`); renderCard(); return true; }
  UI.matches = null; UI.selected = null;
  const shown = scanCandidates(code)[0];
  $("#cardSlot").innerHTML = `<section class="card s-extra"><div class="top" style="flex-wrap:nowrap"><div style="min-width:0;flex:1"><div class="desc">«${esc(shown)}» no está en ${S.albs.size > 1 ? "ningún albarán cargado" : "este albarán"}</div>
    <div class="muted" style="font-size:14px">Puede ser un artículo que no os facturan o un código distinto en la etiqueta.${shown !== norm(code) ? ` Código leído completo: ${esc(code)}` : ""}</div></div>
    <button class="iconbtn" id="nfClose" aria-label="Cerrar" type="button">${ICON.x}</button></div>
    <div class="actions"><button class="btn" id="nfAdd" type="button">Anotar como recibido fuera de albarán</button></div></section>`;
  flash(`Sin coincidencias para «${shown}»`, "err");
  $("#nfClose").onclick = () => { $("#cardSlot").innerHTML = ""; };
  $("#nfAdd").onclick = () => { const l = mkLine({ codigo: shown, descripcion: "Artículo sin descripción", extra: true }); l.recib = 1; a.lineas.push(l); persist(a); UI.selected = l.id; renderCotejo(); };
  return false;
}
function selectLine(id, count, alb) {
  alb = alb || S.albs.get(UI.matchAlb) || cur();
  const l = alb.lineas.find(x => x.id === id); if (!l) return;
  const other = alb.id !== S.active ? ` · del albarán ${albName(alb)}` : "";
  if (l.recib == null) { l.recib = l.extra ? 1 : l.cant; flash(`✓ ${l.desc} · ${num(l.cant)} uds · ${eur(l.precio)}${other}`, "ok"); }
  else flash(`Ya estaba marcado: ${l.desc}${other}`);
  persist(alb);
  UI.selected = null; UI.matches = null; UI.matchAlb = null; UI.flashId = id;
  renderCotejo();
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
  $("#smsg").textContent = "Ve escaneando: cada artículo se marca solo. Pulsa Cerrar al acabar.";
  $("#smsg").style.color = "";
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
  // la cámara sigue abierta para ir escaneando un artículo tras otro
  const found = search(code);
  const st = cur() ? stats(cur()) : null;
  $("#smsg").textContent = (found ? UI.msg : `✗ «${code}» no está en este albarán`) + (st ? `  ·  ${st.revisadas} / ${st.total}` : "");
  $("#smsg").style.color = found ? "#9ff0b8" : "#ffb4ab";
  if (!found) try { navigator.vibrate?.([80, 60, 80]); } catch { }
}
function closeScanner() {
  if (UI.flashId) { const el = $(`.ck[data-id="${UI.flashId}"]`); setTimeout(() => el?.scrollIntoView({ block: "center" }), 50); }
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
function renderSettings() {
  $("#view").innerHTML = `<section class="sheet" style="display:flex;flex-direction:column;gap:18px">
    <div class="albhead"><h2>Ajustes</h2><button class="btn ghost" id="sBack" type="button">Volver</button></div>
    <div id="sMsg" class="msg" role="status"></div>
    <div style="display:flex;flex-direction:column;gap:10px">
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
  const reading = d.phase === "reading";
  $("#view").innerHTML = `<section class="sheet" style="display:flex;flex-direction:column;gap:14px">
    <div class="albhead"><h2>Nuevo albarán</h2><button class="btn ghost" id="nBack" type="button">Cancelar</button></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <p class="muted" style="margin:0;font-size:14px">Elige el PDF o el Excel del albarán. Puedes elegir varios a la vez: al escanear, la app busca en todos.</p>
      <button class="btn primary" id="nExcel" type="button" style="min-height:56px" ${reading ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12l4 5M13 12l-4 5"/></svg>${reading ? "Leyendo…" : "Importar PDF o Excel"}</button>
      <a class="btn ghost" href="plantilla_albaran.xlsx" download="plantilla_albaran.xlsx">Descargar plantilla de Excel</a>
    </div>
    ${reading ? `<div class="progress"><span class="spin"></span><span>${esc(d.note || "")}</span></div>` : ""}
    ${d.error ? `<p class="msg err" style="margin:0;white-space:pre-line">${esc(d.error)}</p>` : ""}
  </section>`;
  $("#nBack").onclick = () => { d.ctl?.abort(); UI.mode = "cotejo"; render(); };
  if (!reading) $("#nExcel").onclick = () => $("#xlsInput").click();
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
  ["nota", [/^nota|observ|anotaci|bemerk|^aviso/]],
  ["inhalt", [/karton|inhalt|uds? ?(\/|por|x) ?caja|unid.*caja|por caja|^u\/c$/]],
  ["cant", [/^cant|cantidad|menge|\bqty\b|piezas/, /\buds\b|^unidades$|^u\.?$/]],
  ["desc", [/desc|denomin|bezeichnung/, /producto|nombre|concepto|articulo/]],
  ["codigo", [/cod|ref|sku|pedido|auftrag|artikel ?nr|art\.? ?nr/, /pos\.? ?nr/, /art\.?$|articulo|^n[º°o]? ?art/]]
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
    if (/^ejemplo/i.test(desc) || /^total/i.test(plain(codigo + desc)) || /^anzahl/i.test(plain(desc))) continue;
    let precio = parseNum(g("precio"));
    const imp = parseNum(g("importe"));
    if (precio == null && imp != null && cant) precio = Math.round(imp / cant * 10000) / 10000;
    const ln = mkLine({ codigo, ean, descripcion: desc, cantidad: cant, precio, inhalt: parseNum(g("inhalt")) });
    ln.nota = String(g("nota") ?? "").trim();
    lineas.push(ln);
  }
  return { ...head, lineas };
}
/* ---------- importar PDF ---------- */
const PDF_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
function loadScript(src) { return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
let pdfLoading = null;
function loadPdf() {
  if (window.pdfjsLib) return Promise.resolve();
  return pdfLoading ||= (async () => {
    await loadScript(PDF_BASE + "pdf.worker.min.js");
    await loadScript(PDF_BASE + "pdf.min.js");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + "pdf.worker.min.js";
  })().catch(() => { pdfLoading = null; throw new Error("pdf"); });
}
/* filas de texto del PDF, con la posición de cada palabra */
async function pdfRows(buf) {
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const toks = [], cells = [];
    tc.items.forEach(it => {
      const str = it.str; if (!str || !str.trim()) return;
      const x0 = it.transform[4], y = it.transform[5], cw = (it.width || 0) / str.length;
      cells.push({ x: x0, y, s: str.trim() });
      const re = /\S+/g; let m;
      while ((m = re.exec(str))) toks.push({ x: x0 + m.index * cw, y, s: m[0] });
    });
    const group = list => {
      list.sort((a, b) => b.y - a.y || a.x - b.x);
      const out = []; let cur = null;
      for (const t of list) { if (cur && Math.abs(cur.y - t.y) <= 2.5) cur.items.push(t); else { cur = { page: p, y: t.y, items: [t] }; out.push(cur); } }
      out.forEach(r => r.items.sort((a, b) => a.x - b.x));
      return out;
    };
    const rt = group(toks), rc = group(cells);
    rt.forEach((r, i) => { const c = (rc.find(c => Math.abs(c.y - r.y) <= 2.5) || { items: [] }).items; rows.push({ page: p, y: r.y, toks: r.items, cells: c.map(c => c.s), cellsX: c }); });
  }
  return rows;
}
/* cualquier tabla de PDF: busca la cabecera y reparte cada palabra en su columna según su posición */
function parsePdfTable(rows) {
  const all = rows.map(r => r.toks.map(t => t.s).join(" ")).join("\n");
  let cols = null, hi = -1;
  for (let i = 0; i < rows.length && !cols; i++) {
    const cells = rows[i].cellsX || []; const m = {}; const used = new Set();
    for (const [k, res] of COLS) for (const re of res) {
      const j = cells.findIndex((c, idx) => !used.has(idx) && re.test(plain(c.s)));
      if (j >= 0) { m[k] = j; used.add(j); break; }
    }
    if (m.cant != null && (m.codigo != null || m.desc != null)) { hi = i; cols = cells.map((c, idx) => ({ x: c.x, key: Object.keys(m).find(k => m[k] === idx) || null })); }
  }
  if (!cols) return { lineas: [] };
  const hpage = rows[hi].page;
  const lineas = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (i === hi || (r.page === hpage && r.y >= rows[hi].y)) continue;
    if (r.toks.some(t => /^(cantidad|menge)$/i.test(t.s))) continue; // cabecera repetida en otra página
    const v = {};
    r.toks.forEach(t => {
      let c = 0; for (let j = 0; j < cols.length; j++) if (cols[j].x <= t.x + 6) c = j;
      const k = cols[c].key; if (k) v[k] = v[k] ? v[k] + " " + t.s : t.s;
    });
    const cant = parseNum(v.cant);
    if (cant == null || !(v.codigo || v.desc)) continue;
    if (/^(total|summe|anzahl)/i.test(plain(v.desc || ""))) continue;
    const l = mkLine({ codigo: (v.codigo || "").replace(/\s+/g, ""), ean: v.ean || "", descripcion: v.desc || "", cantidad: cant, precio: parseNum(v.precio), inhalt: parseNum(v.inhalt) });
    l.nota = (v.nota || "").replace(/^\*\s*/, "").trim();
    lineas.push(l);
  }
  const fm = /(?:Fecha|Belegdatum|Datum)\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(all);
  const unidad = (/Unidad\s+(\d+)/i.exec(all) || [])[1], tienda = (/Tienda\s*:?\s*(\d+)/i.exec(all) || [])[1];
  const ls = (/Lieferschein\s*Nr\.?\s*(\d+)/i.exec(all) || /Albar[aá]n\s*(?:N[º°o]\.?)?\s*:?\s*([\w\-\/]+)/i.exec(all) || [])[1];
  return {
    proveedor: tienda ? `Inventario Tienda ${tienda}` : "",
    numero: ls || (unidad ? `Unidad ${unidad}` : ""),
    fecha: fm ? `${fm[3]}-${fm[2].padStart(2, "0")}-${fm[1].padStart(2, "0")}` : "",
    lineas
  };
}
/* albarán de TEDi (Lieferschein): LFD, POS NR, AUFTRAG, BEZEICHNUNG, WGR, DNP, MENGE, KARTON-INHALT, VK.
   Debajo de POS NR y AUFTRAG va un dígito más: el código del artículo = AUFTRAG (9) + ese dígito = 10 cifras. */
function parseTedi(rows) {
  const all = rows.map(r => r.toks.map(t => t.s).join(" ")).join("\n");
  const numero = (/Lieferschein\s*Nr\.?\s*(\d+)/i.exec(all) || [])[1] || "";
  const von = (/von\s+(\d{3,5})\s+an\s+(\d{3,5})/i.exec(all) || [])[1] || "";
  const fm = /Belegdatum:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(all);
  const fecha = fm ? `${fm[3]}-${fm[2].padStart(2, "0")}-${fm[1].padStart(2, "0")}` : "";
  const isInt = s => /^\d+$/.test(s), isPrice = s => /^\d{1,4},\d{2}$/.test(s);
  let wgrX = null; const lineas = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], tk = r.toks.map(t => t.s);
    const h = r.toks.find(t => /^WGR$/i.test(t.s));
    if (h && r.toks.some(t => /^MENGE$/i.test(t.s))) { wgrX = h.x; continue; }
    if (!/^\d{1,4}$/.test(tk[0] || "")) continue;
    // final de la fila: precio y EUR
    let k = tk.length - 1;
    if (/^EUR$/i.test(tk[k])) k--;
    let vk = null;
    if (isPrice(tk[k])) { vk = parseNum(tk[k]); k--; } else if (/^\d{1,4},\d{2}EUR$/i.test(tk[k])) { vk = parseNum(tk[k].replace(/EUR/i, "")); k--; }
    const mainRow = /^\d{6,7}$/.test(tk[1] || "") && /^\d{9,10}$/.test(tk[2] || "");
    const noArt = tk[1] === "0" && isInt(tk[2] || "");
    if (!mainRow && !noArt) continue;
    const start = mainRow ? 3 : 2;
    const mid = r.toks.slice(start, k + 1);
    // números del final: [WGR] [DNP] MENGE KARTON
    let descToks, ints;
    if (wgrX != null) {
      const cut = mid.findIndex(t => t.x >= wgrX - 12 && isInt(t.s));
      descToks = cut < 0 ? mid : mid.slice(0, cut); ints = cut < 0 ? [] : mid.slice(cut).map(t => t.s).filter(isInt);
    } else {
      let j = mid.length; while (j > 0 && isInt(mid[j - 1].s) && mid.length - j < 4) j--;
      let tail = mid.slice(j).map(t => t.s);
      if (tail.length === 4 && !/^\d{3}$/.test(tail[0])) { j++; tail = tail.slice(1); }
      descToks = mid.slice(0, j); ints = tail;
    }
    let wgr = "", menge = null, karton = null;
    if (mainRow) {
      if (ints.length >= 4) { wgr = ints[0]; menge = +ints[2]; karton = +ints[3]; }
      else if (ints.length === 3) { wgr = ints[0]; menge = +ints[1]; karton = +ints[2]; }
      else if (ints.length === 2) { menge = +ints[0]; karton = +ints[1]; }
      else if (ints.length === 1) menge = +ints[0];
    } else { wgr = ints[0] || tk[2]; menge = ints.length >= 2 ? +ints[1] : null; karton = ints.length >= 3 ? +ints[2] : null; }
    if (menge == null) continue;
    let desc = descToks.map(t => t.s).join(" ");
    let pos = mainRow ? tk[1] : "", auf = mainRow ? tk[2] : "";
    // fila de abajo: dígitos de control (y a veces el resto de la descripción)
    const nx = rows[i + 1];
    if (mainRow && nx && nx.page === r.page && r.y - nx.y < 20) {
      const nt = nx.toks.map(t => t.s);
      const looksMain = /^\d{1,4}$/.test(nt[0] || "") && /^\d{6,7}$/.test(nt[1] || "");
      if (!looksMain && /^\d$/.test(nt[0] || "")) {
        let used = 1;
        if (/^\d$/.test(nt[1] || "")) { if (pos.length === 6) pos += nt[0]; if (auf.length === 9) auf += nt[1]; used = 2; }
        else if (auf.length === 9) auf += nt[0];
        const rest = nt.slice(used).join(" ");
        if (rest && !/^Seite|^Anzahl/i.test(rest)) desc += " " + rest;
        i++;
      }
    }
    const l = mkLine({ codigo: mainRow ? auf : "", descripcion: mainRow ? desc : `Sin nº de artículo (WGR ${wgr})`, cantidad: menge, precio: vk, inhalt: karton });
    if (pos) l.pos = pos;
    if (!mainRow) l.nota = "Línea sin artículo en el albarán";
    lineas.push(l);
  }
  return { proveedor: von ? `TEDi (${von})` : "TEDi", numero, fecha, lineas };
}
async function readFile(file) {
  const name = file.name || "archivo";
  if (/\.pdf$/i.test(name) || /pdf/i.test(file.type || "")) {
    await loadPdf();
    const rows = await pdfRows(await file.arrayBuffer());
    if (!rows.length) throw new Error("scan");
    let r = parseTedi(rows);
    if (!r.lineas.length) r = parsePdfTable(rows);
    if (!r.lineas.length) { const g = parseSheet(rows.map(x => x.cells)); if (g.lineas.length) r = g; }
    return r;
  }
  if (/\.(xlsx|xlsm|xls|csv|ods)$/i.test(name) || /sheet|excel|csv/i.test(file.type || "")) {
    await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    let best = null;
    for (const sh of wb.SheetNames) {
      const r = parseSheet(XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true, defval: "" }));
      if (!best || r.lineas.length > best.lineas.length) best = r;
    }
    return best;
  }
  throw new Error("tipo");
}
async function importFiles(files) {
  if (!UI.draft) UI.draft = { files: [], lineas: [], phase: "pick", error: "" };
  const d = UI.draft; UI.mode = "nuevo";
  d.error = ""; d.phase = "reading"; d.note = files.length > 1 ? `Leyendo ${files.length} archivos…` : "Leyendo el albarán…"; renderNew();
  const ok = [], fails = [], dup = [];
  for (const file of files) {
    const fname = file.name || "archivo";
    try {
      const r = await readFile(file);
      if (!r || !r.lineas.length) { fails.push(`${fname}: no he encontrado líneas de artículos`); continue; }
      let { proveedor, numero, fecha } = r;
      if (!proveedor && !numero) proveedor = fname.replace(/\.(xlsx|xlsm|xls|csv|ods|pdf)$/i, "");
      const prev = numero && [...S.albs.values()].find(x => x.numero === numero);
      if (prev && prev.lineas.some(l => l.recib != null)) { dup.push(numero); continue; }
      if (prev) S.albs.delete(prev.id);
      const alb = { id: uid(), proveedor, numero, fecha, creado: Date.now(), lineas: r.lineas };
      S.albs.set(alb.id, alb); persist(alb); ok.push(alb);
    } catch (e) {
      console.warn(e);
      fails.push(`${fname}: ` + ({ pdf: "no se pudo cargar el lector de PDF (revisa internet)", xlsx: "no se pudo cargar el lector de Excel (revisa internet)", scan: "es un PDF escaneado (una foto), no tiene texto que leer", tipo: "no es un Excel ni un PDF" }[e?.message] || "no se pudo abrir"));
    }
  }
  d.phase = "pick";
  if (!ok.length) {
    d.error = [...fails, ...dup.map(n => `El albarán ${n} ya estaba cargado.`)].join("\n") || "No se pudo importar.";
    if (dup.length && !fails.length) { const prev = [...S.albs.values()].find(x => x.numero === dup[0]); UI.draft = null; setActive(prev.id); flash(`«${dup[0]}» ya estaba cargado con artículos marcados: lo he abierto sin cambiarlo. Si quieres volver a importarlo, bórralo antes (Más opciones → Borrar albarán).`, "err"); return; }
    return renderNew();
  }
  UI.draft = null;
  setActive(ok[ok.length - 1].id);
  const n = ok.reduce((t, x) => t + x.lineas.length, 0);
  let msg = ok.length === 1 ? `Albarán ${ok[0].numero || ""} importado: ${n} artículos.` : `${ok.length} albaranes importados (${n} artículos). Al escanear se buscan en todos.`;
  if (dup.length) msg += ` Ya estaban cargados: ${dup.join(", ")}.`;
  if (fails.length) msg += ` No se pudo: ${fails.join("; ")}.`;
  flash(msg, fails.length ? "err" : "ok");
}
$("#xlsInput").addEventListener("change", e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) importFiles(fs); });
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
load();
render();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });
