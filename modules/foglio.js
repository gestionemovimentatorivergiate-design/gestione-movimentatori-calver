// ── modules/foglio.js ────────────────────────────────────────────────────────
// Stampa del "Modulo consegna materiali a reparto" (senza logo e senza sigla del modulo)
// per una missione. Il foglio è un A4 orizzontale generato qui (nessun file esterno:
// le immagini sono incorporate) e viene aperto in una finestra con la stampa già pronta.
//
// Dati compilati automaticamente dalla missione:
//   • #### - GG - MMAAAA  → ID della missione (es. 0001 - 15 - 102026)
//   • GG – MM - AAAA      → data di creazione della missione
//   • HH:MM               → ora di creazione della missione
//   • "Da:"               → ID del Building dell'ubicazione di partenza
//   • "A:"                → ubicazione di destinazione
// "alla C.A.", "nr. colli" restano da compilare a mano.

import { esc, showToast } from '../shared-utils.js';

const IMG = {
  cal:    'data:image/png;base64,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',
  clock:  'data:image/png;base64,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',
  truck:  'data:image/png;base64,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',
  box1:   'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAABDCAIAAAC0vQTuAAAAAXNSR0IArs4c6QAAAAlwSFlzAAAOwwAADsMBx2+oZAAAA3tJREFUaEPtW71OG0EQ3j0KhGILZKQQoAHFiAZqCkSBZCei5RmcJ0CiShq6OBa0iIaCN6CGDmEj4QdIZAshy0cFQgghxM9tZu/OPxffBc/g9e1Zd5rqNDO738zc7n67e1wIwQb34UR4tZrY32e1GuMcERyMrnRrWQjnhiH1PyT51y9sbc01BHjYx/rz25qdhZb1lXzeAcWw2EDfyuX0BeYEPZEQ9Tp01UBkv6larVKs+mlzfy8uL6FBEryhoX52ldIWjAjwKRLhtTdYKMDoRBfTZKmU6w/6BFIqEb21u2r0kJQ9SjzDsYnhKY274kVFnD2l2VPsPM6e4gArdR9nT2l4FTsPO3soPvX/WPjNMWHDG/DsKYbXYOtds2++tyeyWXZ05HYMltQbG/ROXl2JhQV2cyM9OIVaLPKlJYpD0xSLiy1Xjh9JTzHsW+pnMi06WygQCHHLxDStVMr1xrkFUioRHdbrHle2H/vby/9iFxeUgGlvY8PTn31T42jD0599dwPPb47pmBjeYt/dNITQGXBCNDXFr6/d3QfL4iC0YTMgovG0jig17VTj7GmXEkSH4uwhghWqauQJEay/T05EsegReFOpBMU1SsUpDg/ZygpbXvYIvMn/bBEOL9AowXMYk5z62wVqMviUM3rwfOrQPgzyfSIFDz9yxfDwMdPHIlLZe3nxD9zT00B8e2NjLP1ZzM97JJ1m09PK4AWPWj0vUb6+zs/L/PzcI+Uy//5DtqVk1fL62nMYgQ6Hh9noKEsmPQJvRkaCTOQ+J3bfUmQy7PjY9TjxiX2cYPBVBG2nN4P6psJ74mRw9vzMqhXmhBvaau1zIvctrdVV3a/twM2d01PqtZ25ufcEuh+2ySSfmYGGSBPD5iaD8UrnZ2uLTU7KIiV8exIXbOgfHLg3ArH3/NTFRd4ITLBslsPo4Dw9PjMgng+oMiMVp7rwt3uGAhkfF5xLMQxxdkZoNlR4ePaNRhhicVq7u3KCcc69mgJvvuVksf5zNkY6GAs1e3j2jc1e+PB8ety7dWyo8LC5wOvH8PAx08ci1Ozh2Tc2cKHCw7NvLLyORdn2tqoFUqffx0dxeyvu7jwCbx4epK7fRQ5s3zqypzf7xmbPZgwRYt9YfHJRFh32TSrO6LBvbPLsoaVSsdJprbdPdnaweXP0GzcCo8K+kemj/p6IbCYs9b+O9rcLvz7X2QAAAABJRU5ErkJggg==',
  box2:   'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAAAxCAIAAAAEHi28AAAAAXNSR0IArs4c6QAAAAlwSFlzAAAOwwAADsUBkTUP4gAAAjZJREFUaEPtWcFOwkAQ3YWDMdJgelADF4g1fgJnE9TwH/gzhMCVGwe+wxuB/oKmHEjTeiIhxhgDuOts2SpNWmRpl7ahmzltZmdeX2dndncwpRSlZ2AO1zRpv49ME2EsAF5El5klRMB4Lsf0zxT8+IAaDb4Q4JLXF1KtgqXkSqsFOBmzDG6zmVygaxILBWpZADXHSJ5MBP5RLKofH3Q6Bc8O3Hw+FgwCTmFHQShzuJvr2m3YffuLbSNV5fbAB4iu72lt05SL0GE3PePI4UouOkfOruRtkLErk+CM3TSxK3T+3P5hfjkxC4Y0BYNMrH4nMsn+QprPYjckgVuXJ5hdv5wYNdyUHSBLJTyb8dsOIRikVoswOqJmN0JofqYyuDIJztg9UnYTd4B8e6PDIR2PPQIzhhH4h9gLZL3+9wLZbq+fJg8wSK/H/GLsEZh5ajLvtk1UlQMDHV13XyBlRts2206ZZaVkUyAGgl+tY80MQTcl57HRd8QKV/yvZnDFOdt9Razsrlb+QBeLRMbu+TnSruntrUc0DZXLO+fdTucAGZe7+Pqi8zl9f/cIzHx+MgXL2iHvfn/vHklhNU9OULGIFMUjMHN6GmSZdS1pvY6en7nG5RW6uEQQVUFJ8beU/6sQ5mtyGC2XaGKgNX3gazxmFxNWhO/ukt4GhMo8GrlF+OYmDBGHWKsouFJhjhi7hkE0LdEEd7vr3el23G2bDga84y7aR5dHL+u4F9D9PYbd5QwXrjyXkVr+AYzzAQXb55IwAAAAAElFTkSuQmCC',
};
const FABBRICA = 'M3.8 71.5L3.0 73.2L3.0 223.2L4.8 226.5L7.5 227.8L223.2 227.8L226.5 226.0L227.8 223.2L227.8 129.8L224.8 126.0L116.2 69.2L112.2 70.2L110.8 72.5L110.0 93.8L62.5 69.2L59.0 70.0L57.0 72.2L56.5 93.8L10.2 69.8L7.0 69.2ZM12.8 83.2L14.0 82.8L59.0 106.8L62.2 107.2L64.5 106.5L66.5 103.5L66.5 83.5L67.8 82.8L112.8 106.8L116.2 107.2L117.8 106.8L120.2 103.2L120.2 83.2L121.5 82.8L217.2 133.2L218.0 134.2L218.0 217.2L217.2 218.0L13.5 218.0L12.8 217.2ZM181.5 3.0L179.5 3.8L177.0 7.5L173.2 91.0L174.2 93.0L177.0 94.8L181.2 93.8L182.8 91.5L186.8 13.5L187.5 12.8L207.2 12.8L208.0 13.5L212.5 110.2L213.0 112.8L214.8 114.8L218.0 115.5L221.8 113.0L222.2 106.5L217.5 7.2L216.8 5.2L213.2 3.0Z';   // sagoma della fabbrica (vettoriale, nitida in stampa)

// Data/ora di creazione nel fuso di Roma
function _parti(t) {
  const d = t ? (t.toDate ? t.toDate() : new Date(t)) : new Date();
  const dt = isNaN(d) ? new Date() : d;
  const p = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(dt);
  const g = k => p.find(x => x.type === k).value;
  return { gg: g('day'), mm: g('month'), aaaa: g('year'), hh: g('hour'), mi: g('minute') };
}

// Corpo del testo che entra nella sagoma: il font si riduce se la scritta è lunga
function _pt(testo, larghMm, max, min) {
  const n = Math.max(String(testo).length, 1);
  const pt = (larghMm / (n * 0.66)) / 0.3528;
  return Math.max(min, Math.min(max, Math.round(pt)));
}

function _fabbrica(left, top, w, h, etichetta, etLeft, etTop, contenuto, boxTop, boxH, extra) {
  const pt = _pt(contenuto, 78, 46, 16);
  return `
  <div class="fab" style="left:${left}mm;top:${top}mm;width:${w}mm;height:${h}mm">
    <svg viewBox="0 0 231 231" preserveAspectRatio="none" width="100%" height="100%">
      <path d="${FABBRICA}" fill="#000" fill-rule="evenodd" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>
    <div class="et" style="left:${etLeft}mm;top:${etTop}mm">${etichetta}</div>
    <div class="val" style="left:7mm;width:${w - 14}mm;top:${boxTop}mm;height:${boxH}mm;font-size:${pt}pt">${esc(contenuto)}</div>
    ${extra || ''}
  </div>`;
}

export function htmlFoglio({ codice, createdAt, buildingPartenza, destinazione }) {
  const d = _parti(createdAt);
  const idTxt = codice ? String(codice).replace(/-/g, ' - ') : '—';
  const css = `
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: Calibri, Carlito, Arial, Helvetica, sans-serif; color: #000;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pag { position: relative; width: 297mm; height: 209mm; overflow: hidden; page-break-after: avoid; }
    .abs { position: absolute; }
    .titolo { left: 0; width: 297mm; top: 14mm; text-align: center; font-size: 22pt; }
    .id { left: 0; width: 297mm; top: 24mm; text-align: center; font-size: 50pt; font-weight: 700; line-height: 1; letter-spacing: .5pt; }
    .rosso { color: #f00; font-style: italic; font-size: 26pt; white-space: nowrap; }
    .fab { position: absolute; }
    .fab svg { position: absolute; left: 0; top: 0; }
    .et { position: absolute; font: italic 700 24pt Arial, Helvetica, sans-serif; }
    .val { position: absolute; display: flex; align-items: center; justify-content: center;
           text-align: center; font: 700 30pt Arial, Helvetica, sans-serif; line-height: 1; word-break: break-all; }
    .ca { position: absolute; left: 8mm; top: 74mm; font: italic 700 13pt Arial, Helvetica, sans-serif; }
    .ca-riga { position: absolute; left: 7mm; width: 85mm; top: 85.5mm; border-bottom: 0.4mm solid #000; }
    .colli { font-size: 18pt; white-space: nowrap; }
    .angolo { right: 0; bottom: 0; width: 100mm; height: 40mm; }
  `;
  const fabDa = _fabbrica(32, 72, 99.5, 91.3, 'Da:', 6, 42, buildingPartenza || '—', 54, 34);
  const fabA = _fabbrica(161.5, 71, 101, 94, 'A:', 9, 41, destinazione || '—', 52, 20,
    '<div class="ca">alla C.A.:</div><div class="ca-riga"></div>');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Foglio trasferimento ${esc(idTxt)}</title><style>${css}</style></head><body>
<div class="pag">
  <div class="abs titolo">Modulo consegna materiali a reparto</div>
  <div class="abs id">${esc(idTxt)}</div>

  <img class="abs" src="${IMG.cal}" style="left:13mm;top:49mm;width:15.7mm" alt="">
  <div class="abs rosso" style="left:31mm;top:50mm">${d.gg} – ${d.mm} - ${d.aaaa}</div>
  <img class="abs" src="${IMG.clock}" style="left:187mm;top:48mm;width:15mm" alt="">
  <div class="abs rosso" style="left:206mm;top:50mm">${d.hh}:${d.mi}</div>

  ${fabDa}
  ${fabA}
  <img class="abs" src="${IMG.truck}" style="left:132mm;top:144mm;width:24.4mm" alt="">

  <img class="abs" src="${IMG.box1}" style="left:34mm;top:171mm;width:15.7mm" alt="">
  <div class="abs colli" style="left:52mm;top:172mm">nr. colli tot.: _____________</div>
  <img class="abs" src="${IMG.box2}" style="left:152mm;top:172mm;width:12.6mm" alt="">
  <div class="abs colli" style="left:168mm;top:172mm">nr. colli parziale: ___ di ___</div>

  <svg class="abs angolo" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M0 40 Q 70 36 100 0 L100 40 Z" fill="#f00"/></svg>
</div>
</body></html>`;
}

// Stampa: apre il foglio in una finestra e avvia la stampa; se i popup sono bloccati
// usa un frame nascosto.
function _stampa(html) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.open(); w.document.write(html); w.document.close();
    const go = () => { try { w.focus(); w.print(); } catch (e) {} };
    // attende il caricamento delle immagini incorporate
    if (w.document.readyState === 'complete') setTimeout(go, 300);
    else w.addEventListener('load', () => setTimeout(go, 300));
    return;
  }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} }, 400);
  setTimeout(() => f.remove(), 60000);
}

window.stampaFoglioTrasferimento = function (id) {
  const st = window.getAppState?.();
  const m = st?.missioni.find(x => x.id === id);
  if (!m) { showToast('Missione non trovata.', 'error'); return; }
  const ub = st.ubicazioni.find(x => x.id === m.origineId);
  _stampa(htmlFoglio({
    codice: m.codice || '',
    createdAt: m.createdAt,
    buildingPartenza: ub?.buildingId || '',
    destinazione: m.destinazioneNome || '',
  }));
};
