/**
 * Erzeugt eine kleine, gültige Test-PDF (für Tests und zum Ausprobieren des Imports):
 * Seiten unterschiedlicher Größe mit Text (Standardschrift Helvetica) und farbigen Flächen.
 *   node dist-electron/electron/testPdf.js [Zieldatei]
 */
import fs from 'node:fs';

const SIZES: [number, number, string][] = [
  [595.28, 841.89, 'A4 hoch'],
  [841.89, 595.28, 'A4 quer'],
  [612, 792, 'Letter'],
];

export function makeTestPdf(pageCount = 3): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // Objektnummer
  };
  const catalogId = add(''); // Platzhalter, später gesetzt
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    const [w, h, label] = SIZES[i % SIZES.length];
    const colors = ['0.12 0.44 0.82', '0.85 0.33 0.27', '0.07 0.6 0.4'];
    const stream = [
      `${colors[i % 3]} rg 48 ${h - 160} ${w - 96} 90 re f`,
      'BT /F1 40 Tf 1 1 1 rg',
      `64 ${h - 120} Td (Testseite ${i + 1}) Tj ET`,
      'BT /F1 16 Tf 0.2 0.2 0.2 rg',
      `64 ${h - 200} Td (Format: ${label} - ${Math.round(w)} x ${Math.round(h)} pt) Tj ET`,
      'BT /F1 12 Tf 0.4 0.4 0.4 rg',
      `64 ${h - 230} Td (pNotes PDF-Import: hier mit Stift, Textmarker und Formen schreiben.) Tj ET`,
      '0.8 0.8 0.8 RG 1 w',
      ...Array.from({ length: 8 }, (_, k) => `64 ${h - 300 - k * 36} m ${w - 64} ${h - 300 - k * 36} l S`),
    ].join('\n');
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

if (typeof require !== 'undefined' && require.main === module) {
  const target = process.argv[2] ?? 'pNotes-Testdokument.pdf';
  fs.writeFileSync(target, makeTestPdf(3));
  console.log(`Test-PDF geschrieben: ${target}`);
}
