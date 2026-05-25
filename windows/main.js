const { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, Menu } = require('electron');
const { exec } = require('child_process');
const path = require('path');

app.setName('CodeBurn');
// Prevent multiple instances
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let tray = null;
let popupWin = null;
let refreshTimer = null;
let currentPeriod = 'today';

const CODEBURN_BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'codeburn.cmd');

// 16x16 flame-red icon via raw RGBA buffer
function makeIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const inCircle = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2) < 7;
    const p = i * 4;
    if (inCircle) {
      buf[p] = 233; buf[p+1] = 69; buf[p+2] = 96; buf[p+3] = 255;
    } else {
      buf[p] = 0; buf[p+1] = 0; buf[p+2] = 0; buf[p+3] = 0;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function fetchData(period) {
  return new Promise((resolve, reject) => {
    exec(`"${CODEBURN_BIN}" status --format menubar-json --period ${period}`,
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (!stdout) return reject(new Error(stderr || (err && err.message) || 'No output'));
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(new Error('Parse error: ' + stdout.slice(0, 200))); }
      }
    );
  });
}

function positionWindow(win) {
  const tb = tray.getBounds();
  const [w, h] = win.getSize();
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
  const wa = display.workArea;

  let x = Math.round(tb.x + tb.width / 2 - w / 2);
  let y = Math.round(tb.y - h - 8);

  // If tray is at bottom, popup goes up; if at top, popup goes down
  if (tb.y < wa.y + wa.height / 2) y = Math.round(tb.y + tb.height + 8);

  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));

  win.setPosition(x, y);
}

function createPopup() {
  popupWin = new BrowserWindow({
    width: 340,
    height: 500,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  popupWin.loadFile(path.join(__dirname, 'renderer.html'));

  // Hide on blur (click outside)
  popupWin.on('blur', () => { if (popupWin && !popupWin.isDestroyed()) popupWin.hide(); });

  popupWin.webContents.on('did-finish-load', () => { loadData(); });
}

async function loadData() {
  try {
    const data = await fetchData(currentPeriod);
    const cost = data.current?.cost ?? 0;
    tray.setToolTip(`CodeBurn  $${cost.toFixed(2)}  ${data.current?.label ?? ''}`);
    if (popupWin && !popupWin.isDestroyed()) {
      popupWin.webContents.send('data', { data, period: currentPeriod });
    }
  } catch (e) {
    tray.setToolTip('CodeBurn — error fetching data');
    if (popupWin && !popupWin.isDestroyed()) {
      popupWin.webContents.send('error', e.message);
    }
  }
}

app.whenReady().then(() => {
  tray = new Tray(makeIcon());
  tray.setToolTip('CodeBurn — loading…');

  // Right-click context menu
  const ctxMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => { openPopup(); } },
    { type: 'separator' },
    { label: 'Today',  click: () => { currentPeriod = 'today';  loadData(); } },
    { label: 'Week',   click: () => { currentPeriod = 'week';   loadData(); } },
    { label: 'Month',  click: () => { currentPeriod = 'month';  loadData(); } },
    { label: 'All time', click: () => { currentPeriod = 'all'; loadData(); } },
    { type: 'separator' },
    { label: 'Quit CodeBurn', click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(ctxMenu);

  tray.on('click', openPopup);

  createPopup();

  // Background refresh every 30s
  refreshTimer = setInterval(loadData, 30_000);

  // Initial tooltip load (no popup visible)
  loadData();
});

function openPopup() {
  if (!popupWin || popupWin.isDestroyed()) createPopup();
  if (popupWin.isVisible()) { popupWin.hide(); return; }
  positionWindow(popupWin);
  popupWin.show();
  popupWin.focus();
  loadData();
}

ipcMain.on('set-period', (_, period) => {
  currentPeriod = period;
  loadData();
});

ipcMain.on('close', () => { if (popupWin) popupWin.hide(); });

app.on('window-all-closed', e => e.preventDefault()); // keep tray alive
app.on('before-quit', () => { clearInterval(refreshTimer); });
