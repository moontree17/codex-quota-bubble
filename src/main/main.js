const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } = require("electron");
const path = require("node:path");
const zlib = require("node:zlib");
const { getQuota } = require("./quota-service");

let mainWindow;
let tray;
let latestQuota = null;
let latestError = null;
let refreshTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 156,
    height: 58,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    placeWindow();
    mainWindow.showInactive();
    refreshQuota();
  });
}

function placeWindow() {
  if (!mainWindow) return;
  const display = screen.getPrimaryDisplay();
  const bounds = mainWindow.getBounds();
  const { workArea } = display;
  mainWindow.setBounds({
    x: workArea.x + workArea.width - bounds.width - 10,
    y: workArea.y + workArea.height - bounds.height - 10,
    width: bounds.width,
    height: bounds.height
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Codex 额度读取中");
  tray.setContextMenu(buildMenu());
  tray.on("click", toggleWindow);
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    placeWindow();
    mainWindow.showInactive();
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "显示/隐藏", click: toggleWindow },
    { label: "刷新", click: refreshQuota },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
}

function createTrayIcon() {
  return nativeImage.createFromBuffer(createPngIconBuffer());
}

function createPngIconBuffer() {
  const size = 32;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const offset = 1 + x * 4;
      const dx = x - 15.5;
      const dy = y - 15.5;
      const inside = dx * dx + dy * dy <= 15 * 15;
      const mark =
        (x >= 9 && x <= 23 && y >= 10 && y <= 13) ||
        (x >= 9 && x <= 23 && y >= 19 && y <= 22);
      row[offset] = mark ? 255 : 38;
      row[offset + 1] = mark ? 255 : 132;
      row[offset + 2] = mark ? 255 : 92;
      row[offset + 3] = inside ? 255 : 0;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.from([0, 0, 0, size, 0, 0, 0, size, 8, 6, 0, 0, 0])),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function refreshQuota() {
  try {
    latestQuota = await getQuota();
    latestError = null;
  } catch (error) {
    latestError = error.message || String(error);
  }

  updateUi();
  return latestError ? { ok: false, error: latestError } : { ok: true, quota: latestQuota };
}

function updateUi() {
  const payload = latestError ? { ok: false, error: latestError } : { ok: true, quota: latestQuota };
  mainWindow?.webContents.send("quota:update", payload);

  if (tray) {
    tray.setToolTip(buildTooltip());
    tray.setContextMenu(buildMenu());
  }
}

function buildTooltip() {
  if (latestError) return `Codex 额度读取失败\n${latestError}`;
  if (!latestQuota) return "Codex 额度读取中";

  const lines = [`${latestQuota.limitName} · ${latestQuota.planType}`];
  for (const item of latestQuota.windows || []) {
    lines.push(`${item.label}: 剩余 ${item.remainingPercent}% · 重置 ${formatTooltipTime(item.resetsAt)}`);
  }
  return lines.join("\n");
}

function formatTooltipTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

app.whenReady().then(() => {
  createTray();
  createWindow();
  ipcMain.handle("quota:get", refreshQuota);
  ipcMain.handle("quota:refresh", refreshQuota);
  ipcMain.handle("app:close", () => app.quit());

  refreshTimer = setInterval(refreshQuota, 60 * 1000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
