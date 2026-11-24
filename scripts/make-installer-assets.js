// Erzeugt die pNotes-Installer-Grafiken mit Electron (offscreen):
//   <out>/icon.ico              Windows-Icon (16, 24, 32, 48, 64, 128, 256 px; PNG-komprimiert, Vista+)
//   <out>/installerSidebar.bmp  164×314 px, 24 Bit (NSIS-Assistent: Willkommens-/Abschlussseite)
// Aufruf: npx electron make-installer-assets.js <out-Ordner>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = process.argv[process.argv.length - 1];
const LOGO = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="#D92632"/>
  <path d="M12 10.5 V26" stroke="#F2F3F5" stroke-width="3.4" stroke-linecap="round"/>
  <circle cx="17.2" cy="15.4" r="4.9" fill="none" stroke="#F2F3F5" stroke-width="3.4"/>
</svg>`;

async function render(html, w, h) {
  const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;overflow:hidden;background:transparent">${html}</body></html>`));
  await new Promise((r) => setTimeout(r, 350));
  const img = (await win.webContents.capturePage()).resize({ width: w, height: h, quality: 'best' });
  win.destroy();
  return img;
}

/** ICO mit PNG-Einträgen */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/** 24-Bit-BMP (unten nach oben, Zeilen auf 4 Byte aufgefüllt) aus BGRA-Rohdaten */
function bmp24(bgra, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowSize * h, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const src = y * w * 4;
    const dst = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      b[dst + x * 3] = bgra[src + x * 4];
      b[dst + x * 3 + 1] = bgra[src + x * 4 + 1];
      b[dst + x * 3 + 2] = bgra[src + x * 4 + 2];
    }
  }
  return b;
}

app.disableHardwareAcceleration();
// nicht beenden, wenn ein Render-Fenster geschlossen wird (es folgen weitere)
app.on('window-all-closed', () => undefined);
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const big = await render(LOGO(512), 512, 512);
  const pngs = sizes.map((s) => ({ size: s, data: big.resize({ width: s, height: s, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));

  // Seitengrafik: Slate-800-Hintergrund, Logo, Name, Untertitel, Crimson-Akzentlinie
  const W = 164;
  const H = 314;
  const sidebar = `<div style="width:${W}px;height:${H}px;background:linear-gradient(180deg,#1F242A 0%,#12161A 100%);position:relative;font-family:'Segoe UI Variable Display','Segoe UI',sans-serif;color:#F2F3F5">
    <div style="position:absolute;left:0;top:0;width:6px;height:${H}px;background:#D92632"></div>
    <div style="position:absolute;left:34px;top:46px">${LOGO(96)}</div>
    <div style="position:absolute;left:0;width:${W}px;top:160px;text-align:center;font-size:30px;font-weight:700;letter-spacing:-0.5px">pNotes</div>
    <div style="position:absolute;left:14px;width:${W - 28}px;top:204px;text-align:center;font-size:12.5px;line-height:17px;color:#C5CBD3">Notizen mit Stift,<br>Formen &amp; PDF</div>
    <div style="position:absolute;left:0;width:${W}px;bottom:16px;text-align:center;font-size:10.5px;color:#6E7781">Version ${process.env.PN_VERSION || ''}</div>
  </div>`;
  const img = await render(sidebar, W, H);
  fs.writeFileSync(path.join(out, 'installerSidebar.bmp'), bmp24(img.toBitmap(), W, H));
  fs.writeFileSync(path.join(out, 'installerSidebar-preview.png'), img.toPNG());
  console.log('geschrieben:', fs.readdirSync(out).join(', '));
  app.exit(0);
});
