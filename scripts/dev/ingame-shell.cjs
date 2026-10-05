// A bare window for scripts/dev/ingame-check.mjs: loads the given URL the way the game's UI would.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1600, height: 900, show: true, backgroundColor: '#1a1d22', webPreferences: { contextIsolation: true, sandbox: true } });
  win.loadURL(process.argv[process.argv.length - 1]);
});
app.on('window-all-closed', () => app.quit());
