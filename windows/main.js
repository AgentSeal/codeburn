const { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, Menu, shell } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

app.setName('CodeBurn');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let tray = null;
let popupWin = null;
let refreshTimer = null;
let currentPeriod = 'today';
let isPinned = false;
let isCompact = false;

const CODEBURN_BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'codeburn.cmd');
const SIZE_FULL    = [340, 500];
const SIZE_COMPACT = [290, 76];

function makeIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size);
    const p = i * 4;
    if (Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2) < 7) {
      buf[p] = 233; buf[p+1] = 69; buf[p+2] = 96; buf[p+3] = 255;
    } else {
      buf[p] = buf[p+1] = buf[p+2] = buf[p+3] = 0;
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
  let y = tb.y < wa.y + wa.height / 2
    ? Math.round(tb.y + tb.height + 8)
    : Math.round(tb.y - h - 8);

  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
  win.setPosition(x, y);
}

function createPopup() {
  popupWin = new BrowserWindow({
    width: SIZE_FULL[0], height: SIZE_FULL[1],
    frame: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  popupWin.loadFile(path.join(__dirname, 'renderer.html'));
  popupWin.on('blur', () => {
    if (!isPinned && popupWin && !popupWin.isDestroyed()) popupWin.hide();
  });
  popupWin.webContents.on('did-finish-load', loadData);
}

async function loadData() {
  try {
    const data = await fetchData(currentPeriod);
    tray.setToolTip(`CodeBurn  $${(data.current?.cost ?? 0).toFixed(2)}  ${data.current?.label ?? ''}`);
    if (popupWin && !popupWin.isDestroyed())
      popupWin.webContents.send('data', { data, period: currentPeriod });
  } catch (e) {
    tray.setToolTip('CodeBurn — error');
    if (popupWin && !popupWin.isDestroyed())
      popupWin.webContents.send('error', e.message);
  }
}

function openPopup() {
  if (!popupWin || popupWin.isDestroyed()) createPopup();
  if (popupWin.isVisible()) { if (!isPinned) popupWin.hide(); return; }
  positionWindow(popupWin);
  popupWin.show();
  popupWin.focus();
  loadData();
}

// Always opens in full mode (used by tray context menu "Open")
function openFull() {
  if (!popupWin || popupWin.isDestroyed()) createPopup();
  if (isCompact) {
    isCompact = false;
    popupWin.setResizable(true);
    popupWin.setSize(SIZE_FULL[0], SIZE_FULL[1], false);
    popupWin.setResizable(false);
    if (!popupWin.isDestroyed()) popupWin.webContents.send('exit-compact');
  }
  positionWindow(popupWin);
  popupWin.show();
  popupWin.focus();
  loadData();
}

app.whenReady().then(() => {
  tray = new Tray(makeIcon());
  tray.setToolTip('CodeBurn — loading…');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open',     click: openFull  },
    { type: 'separator' },
    { label: 'Today',    click: () => { currentPeriod = 'today';  loadData(); } },
    { label: 'Week',     click: () => { currentPeriod = 'week';   loadData(); } },
    { label: 'Month',    click: () => { currentPeriod = 'month';  loadData(); } },
    { label: 'All time', click: () => { currentPeriod = 'all';    loadData(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', openPopup);
  createPopup();
  refreshTimer = setInterval(loadData, 30_000);
  loadData();
});

ipcMain.on('set-period', (_, p) => { currentPeriod = p; loadData(); });

ipcMain.on('set-pinned', (_, pinned) => {
  isPinned = pinned;
  if (popupWin && !popupWin.isDestroyed()) popupWin.setAlwaysOnTop(true); // always on top either way
});

ipcMain.on('set-compact', (_, compact) => {
  isCompact = compact;
  if (!popupWin || popupWin.isDestroyed()) return;
  const [w, h] = compact ? SIZE_COMPACT : SIZE_FULL;
  // setSize then reposition so window stays near tray
  popupWin.setResizable(true);
  popupWin.setSize(w, h, false);
  popupWin.setResizable(false);
  positionWindow(popupWin);
});

ipcMain.on('set-opacity', (_, v) => {
  if (popupWin && !popupWin.isDestroyed()) popupWin.setOpacity(Math.max(0.1, Math.min(1, v)));
});

ipcMain.on('close', () => { if (popupWin) popupWin.hide(); });

ipcMain.handle('fetch-hourly', async () => {
  const today  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const hours  = Array.from({length: 24}, (_, i) => ({ hour: i, cost: 0 }));
  let hasData  = false;
  const cutoff = Date.now() - 25 * 3_600_000;
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  function scan(dir, depth) {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { scan(full, depth + 1); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      try {
        if (fs.statSync(full).mtimeMs < cutoff) continue;
        for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            const ts  = obj.timestamp || obj.ts || obj.created_at;
            if (!ts || !String(ts).startsWith(today)) continue;
            const h = new Date(ts).getHours();
            let cost = obj.costUSD ?? obj.cost_usd ?? obj.cost ?? 0;
            if (!cost && obj.message?.usage) {
              const u = obj.message.usage;
              cost = (u.input_tokens||0)*3e-6
                   + (u.output_tokens||0)*15e-6
                   + (u.cache_read_input_tokens||0)*3e-7;
            }
            hours[h].cost += Number(cost) || 0;
            if (hours[h].cost > 0) hasData = true;
          } catch {}
        }
      } catch {}
    }
  }

  if (fs.existsSync(claudeDir)) scan(claudeDir, 0);
  return hasData ? hours : null;
});

ipcMain.handle('fetch-yield', async () => new Promise(resolve => {
  exec(`"${CODEBURN_BIN}" yield`, { timeout: 30000 }, (err, stdout) => {
    if (err || !stdout.trim()) return resolve(null);
    try { resolve(JSON.parse(stdout)); }
    catch { resolve({ raw: stdout }); }
  });
}));

ipcMain.on('export-data', (_, { format, data, period }) => {
  try {
    const dir   = path.join(os.homedir(), 'Downloads');
    const fname = `codeburn-${period}-${Date.now()}.${format}`;
    const fpath = path.join(dir, fname);
    fs.writeFileSync(fpath, data, 'utf8');
    shell.showItemInFolder(fpath);
  } catch (e) { console.error('export failed:', e.message); }
});

ipcMain.on('open-report', () => {
  exec(`cmd /c start cmd /k "${CODEBURN_BIN}" report`, { shell: false });
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => clearInterval(refreshTimer));
