// Africa Sportfishing, part of the app (public/js/exports.js): PDFs and Excel workbooks for the club.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// PDFs for the club (leaderboard, members, tournament sheets): jsPDF 2.5.2 and
// jspdf-autotable 3.8.4, kept in public/vendor, loaded the first time one is made.
let pdfLib = null;
function loadPdf() {
  const script = (src) => new Promise((resolve, reject) => {
    const js = document.createElement('script');
    js.src = src; js.onload = resolve; js.onerror = reject;
    document.head.append(js);
  });
  pdfLib ??= script('/vendor/jspdf/jspdf.umd.min.js').then(() => script('/vendor/jspdf/jspdf.plugin.autotable.min.js'))
    .then(() => window.jspdf.jsPDF)
    .catch(() => { pdfLib = null; throw new Error("The PDF maker couldn't load. Check your connection and try again."); });
  return pdfLib;
}
const imageData = (url) => fetch(url).then((r) => r.blob()).then((b) => new Promise((done) => {
  const fr = new FileReader(); fr.onload = () => done(fr.result); fr.readAsDataURL(b);
}));
// One A4 PDF: the logos and title on top, then a table per section, page numbers at the foot.
// sections: [{ heading, head: [...], body: [[...]], widths?: {col: pt} }]
async function savePdf({ title, subtitle = '', sections, file }) {
  const JsPdf = await loadPdf();
  const [logo, crest] = await Promise.all([imageData('/logo-mark.png'), imageData('/jhmmc-logo.png')]).catch(() => []);
  const doc = new JsPdf({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const NAVY = [0, 26, 67];
  if (logo) doc.addImage(logo, 'PNG', 40, 28, 44, 44, 'logo', 'FAST');
  if (crest) doc.addImage(crest, 'PNG', W - 92, 32, 52, 44, 'crest', 'FAST');
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...NAVY).text('AFRICA SPORTFISHING', 92, 47);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90, 100, 120).text('JHMMC · Jim Holder Memorial Marine Club', 92, 62);
  const made = new Date().toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY).text(title, 40, 112, { maxWidth: W - 80 });
  let y = 112 + (doc.splitTextToSize(title, W - 80).length - 1) * 22;
  if (subtitle) {
    doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(90, 100, 120).text(subtitle, 40, y + 18, { maxWidth: W - 80 });
    y += 18 + (doc.splitTextToSize(subtitle, W - 80).length - 1) * 14;
  }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...NAVY).text(`Generated ${made}`, 40, y + 16);
  y += 16;
  y += 22;
  for (const s of sections) {
    if (s.newPage) { doc.addPage(); y = 50; continue; }
    if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 50; }
    if (s.heading) { doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...NAVY).text(s.heading, 40, y + 4); y += 12; }
    // A bar chart: one bar per row, the value at its end (bars grow from zero; a negative one points left).
    if (s.bars) {
      const labelW = 130; const x0 = 40 + labelW; const full = W - 40 - x0 - 50;
      const lo = Math.min(0, ...s.bars.map((b) => b.value)); const hi = Math.max(0, ...s.bars.map((b) => b.value));
      const at = (v) => x0 + ((v - lo) / (hi - lo || 1)) * full;
      y += 10;
      for (const b of s.bars) {
        doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(20, 30, 50).text(doc.splitTextToSize(b.label, labelW - 10)[0], 40, y + 10);
        const [a, z] = [Math.min(at(0), at(b.value)), Math.max(at(0), at(b.value))];
        doc.setFillColor(...(b.value < 0 ? [198, 40, 40] : NAVY)).roundedRect(a, y, Math.max(z - a, 1.5), 13, 2, 2, 'F');
        doc.setFont('helvetica', 'bold').text(String(b.value), b.value < 0 ? a - 4 : z + 5, y + 10, { align: b.value < 0 ? 'right' : 'left' });
        y += 21;
      }
      doc.setDrawColor(200, 208, 220).line(at(0), y - 21 * s.bars.length - 3, at(0), y - 6);
      y += 18;
      continue;
    }
    doc.autoTable({
      startY: y, head: [s.head], body: s.body.length ? s.body : [[{ content: s.none || 'None.', colSpan: s.head.length }]],
      margin: { left: 40, right: 40, bottom: 50 }, theme: 'striped',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 5, textColor: [20, 30, 50] },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [242, 245, 250] },
      columnStyles: s.widths || {},
      // Number columns: the heading lines up with the numbers.
      didParseCell: (d) => {
        if (d.section === 'head' && s.widths?.[d.column.index]?.halign) d.cell.styles.halign = s.widths[d.column.index].halign;
        s.paint?.(d);
      },
    });
    y = doc.lastAutoTable.finalY + 30;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(130, 140, 155);
    doc.text(`Generated ${made} · africasportfishing.com`, 40, doc.internal.pageSize.getHeight() - 24);
    doc.text(`Page ${i} of ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
  }
  doc.save(file);
}
const fileName = (s) => `${s.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-')}.pdf`;
// A "Download PDF" button: shows it's working, says what went wrong.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-pdf]');
  if (!btn || !btn.pdf) return;
  const was = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Making the PDF…';
  try { await savePdf(await btn.pdf()); } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.innerHTML = was; }
});
const pdfButton = (label = 'Download PDF') => `<button type="button" class="btn pdf-btn" data-pdf>${icon('download')} ${esc(label)}</button>`;

// Excel workbooks (.xlsx) for the treasurer and the secretary, made on the phone with
// no library: the sheets as XML, zipped. Each sheet: a title row, a header row (bold,
// white on navy, kept in view when scrolling), then the rows; numbers stay numbers.
// sheets: [{ name, title, note?, columns: [{ header, width }], rows: [[...]], totals?: [...] }]
function makeXlsx(sheets) {
  const enc = new TextEncoder();
  const x = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const col = (n) => { let s = ''; for (n += 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  // Styles: 0 plain, 1 header, 2 title, 3 note, 4 bold, 5 red bold.
  const cell = (v, r, c, st = 0) => {
    const ref = `${col(c)}${r}`;
    if (v == null || v === '') return st ? `<c r="${ref}" s="${st}"/>` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  };
  const sheetXml = (sh) => {
    const n = sh.columns.length;
    const rows = [];
    let r = 1;
    rows.push(`<row r="${r}" ht="26" customHeight="1">${cell(sh.title, r, 0, 2)}</row>`); r += 1;
    if (sh.note) { rows.push(`<row r="${r}">${cell(sh.note, r, 0, 3)}</row>`); r += 1; }
    r += 1;
    const headRow = r;
    rows.push(`<row r="${r}" ht="22" customHeight="1">${sh.columns.map((c, i) => cell(c.header, r, i, 1)).join('')}</row>`); r += 1;
    for (const row of sh.rows) {
      rows.push(`<row r="${r}">${row.map((v, i) => cell(v && typeof v === 'object' ? v.v : v, r, i, v && typeof v === 'object' ? v.s : 0)).join('')}</row>`);
      r += 1;
    }
    if (sh.totals) rows.push(`<row r="${r}">${sh.totals.map((v, i) => cell(v, r, i, 4)).join('')}</row>`);
    const lastRow = headRow + sh.rows.length;
    const last = `${col(n - 1)}${lastRow}`;
    sh.filterRef = sh.rows.length ? `$A$${headRow}:$${col(n - 1)}$${lastRow}` : null;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${sh.rows.length ? `<autoFilter ref="A${headRow}:${last}"/>` : ''}
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  };
  const names = new Set();
  const safeName = (s) => {
    let base = String(s).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base; let k = 2;
    while (names.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${k++}`;
    names.add(name.toLowerCase());
    return name;
  };
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${x(sh.safe = safeName(sh.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>WORKBOOK_NAMES</workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF001A43"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF56647A"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFC62828"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF001A43"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  };
  sheets.forEach((sh, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sh); });
  // Excel wants each sheet's filter range named too.
  const named = sheets.map((sh, i) => (sh.filterRef ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(sh.safe.replace(/'/g, "''"))}'!${sh.filterRef}</definedName>` : '')).join('');
  files['xl/workbook.xml'] = files['xl/workbook.xml'].replace('WORKBOOK_NAMES', named ? `<definedNames>${named}</definedNames>` : '');
  // Bold totals use the plain black bold font, not the header's white one.
  files['xl/styles.xml'] = files['xl/styles.xml'].replace('<fonts count="5">', '<fonts count="6">')
    .replace('</fonts>', '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>')
    .replace('<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>', '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>');
  // The zip: stored (no compression), which every spreadsheet app reads.
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = []; const central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255]; const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text); const nm = enc.encode(name); const crc = crc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
    parts.push(new Uint8Array(head), nm, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
    offset += head.length + nm.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length), ...u32(size), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const saveBlob = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// The officers' workbook: a summary, the members, and a sheet per tournament (or one tournament).
async function officersWorkbook(onlyTournament = null) {
  const [club, { events, season }] = await Promise.all([api('/club-members'), api('/events')]);
  const label = `${season.start.slice(0, 4)}–${season.end.slice(2, 4)}`;
  const made = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const tournaments = events.filter((e) => e.kind === 'tournament' && e.date && (!onlyTournament || String(e.id) === String(onlyTournament)));
  const sheetsData = await Promise.all(tournaments.map((t) => api(`/tournaments/${t.id}/sheet`)));
  const red = (v) => ({ v, s: 5 });
  const members = [...club.people.map((p) => [p.name, p.teamName || '', p.email || '', 'Yes', p.paid ? 'Paid' : red('Not paid')]),
    ...club.named.map((p) => [p.name, p.teamName || '', '', 'No', p.paid ? 'Paid' : red('Not paid')])]
    .sort((a, b) => a[0].localeCompare(b[0]));
  const paidN = members.filter((m) => m[4] === 'Paid').length;
  const tSheets = sheetsData.map(({ tournament, boats, fee }) => {
    const rows = [];
    let guests = 0; let owed = 0; let paidGuests = 0;
    for (const b of boats.filter((x) => x.entered)) {
      const list = [...b.anglers.filter((a) => a.member), ...b.anglers.filter((a) => !a.member)];
      if (!list.length) rows.push([b.teamName, b.division === 'river' ? 'River' : 'Ocean', b.station || '', '(no anglers listed)', '', '', '']);
      for (const a of list) {
        if (!a.member) { guests += 1; if (a.paid) paidGuests += 1; else owed += fee; }
        rows.push([b.teamName, b.division === 'river' ? 'River' : 'Ocean', b.station || '', a.name, a.member ? 'JHMMC member' : 'Guest',
          a.member ? 'Paid (season)' : a.paid ? 'Paid' : red('Not paid'), a.member ? 0 : a.paid ? 0 : fee]);
      }
    }
    const notIn = boats.filter((x) => !x.entered).map((b) => b.teamName);
    return {
      tournament, fee, guests, paidGuests, owed, boatsIn: boats.filter((x) => x.entered).length,
      sheet: {
        name: tournament.name, title: `${tournament.name}: registration`,
        note: `${fmtDays(tournament)}. Temporary membership USD ${fee}. Not in: ${notIn.join(', ') || 'none'}. Generated ${made}.`,
        columns: [{ header: 'Boat', width: 20 }, { header: 'Division', width: 10 }, { header: 'Weigh station', width: 16 }, { header: 'Angler', width: 24 },
          { header: 'Status', width: 16 }, { header: 'Paid', width: 14 }, { header: 'Still to pay (USD)', width: 18 }],
        rows, totals: ['Total', '', '', `${rows.length} anglers`, `${guests} guests`, `${paidGuests} paid`, owed],
      },
    };
  });
  const summary = {
    name: 'Summary', title: `JHMMC ${label}: treasurer and secretary`, note: `Season ${fmtDay(season.start)} to ${fmtDay(season.end)}. Generated ${made}.`,
    columns: [{ header: 'What', width: 56 }, { header: 'Boats in', width: 10 }, { header: 'Guests', width: 10 }, { header: 'Guests paid', width: 12 },
      { header: 'Still to pay (USD)', width: 18 }, { header: 'Members paid', width: 14 }, { header: 'Members not paid', width: 18 }],
    rows: [
      ...(onlyTournament ? [] : [[`Club membership ${label}`, '', '', '', '', paidN, members.length - paidN]]),
      ...tSheets.map((t) => [`${t.tournament.name} (${fmtDays(t.tournament)})`, t.boatsIn, t.guests, t.paidGuests, t.owed, '', '']),
    ],
  };
  const sheets = [summary,
    ...(onlyTournament ? [] : [{ name: 'Members', title: `JHMMC members ${label}`, note: `${members.length} members: ${paidN} paid, ${members.length - paidN} not paid. Generated ${made}.`,
      columns: [{ header: 'Name', width: 26 }, { header: 'Boat', width: 20 }, { header: 'Email', width: 30 }, { header: 'On the app', width: 12 }, { header: `Membership ${label}`, width: 18 }],
      rows: members }]),
    ...tSheets.map((t) => t.sheet)];
  const file = onlyTournament && tSheets[0] ? fileName(`${tSheets[0].tournament.name} registration`).replace(/\.pdf$/, '.xlsx')
    : `JHMMC-${label.replace('–', '-')}-treasurer-${today()}.xlsx`;
  saveBlob(makeXlsx(sheets), file);
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-xlsx]');
  if (!btn) return;
  const was = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Making the spreadsheet…';
  try { await officersWorkbook(btn.dataset.xlsx || null); } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.innerHTML = was; }
});
const xlsxButton = (label = 'Download Excel', tournament = '') => `<button type="button" class="btn pdf-btn" data-xlsx="${esc(tournament)}">${icon('download')} ${esc(label)}</button>`;
