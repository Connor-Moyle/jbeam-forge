import { join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import { initLogging, scoped, setDebugLogging } from './log';
import { installMainCrashHandlers } from './crash';
import { SettingsService } from './services/settings';
import { UserTaxonomyService } from './services/userTaxonomy';
import { loadBundledPack, MaterialLibraryService } from './services/materialLibrary';
import { LayoutService } from './services/layout';
import { RecentService } from './services/recent';
import { ProjectFiles } from './services/projectFiles';
import { FolderTrust } from './import/access';
import { BeamngService, rootsFromEnv } from './beamng/service';
import { registerIpcHandlers } from './ipc/handlers';
import { sendEvent, setTrustedUrlPredicate } from './ipc/register';
import { buildAppMenu } from './menu';
import { createMainWindow, hardenSessions, makeTrustedUrlPredicate } from './window';

// The run-desktop harness points userData at a temp dir so tests never touch real settings.
const userDataOverride = process.env.JBFORGE_USER_DATA;
if (userDataOverride) app.setPath('userData', userDataOverride);
const harness = process.env.JBFORGE_HARNESS === '1';
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

initLogging({ debug: false });
installMainCrashHandlers();
const logger = scoped('app');

let mainWindow: BrowserWindow | null = null;

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  const settings = new SettingsService(join(userData, 'settings.json'), scoped('settings'));
  const layout = new LayoutService(join(userData, 'layouts', 'current.json'), scoped('layout'));
  const loaded = await settings.load();
  setDebugLogging(loaded.debugLogging);
  logger.info(`starting JBeam Forge ${app.getVersion()} (electron ${process.versions.electron})`, harness ? '[harness]' : '');

  hardenSessions();
  setTrustedUrlPredicate(makeTrustedUrlPredicate(devServerUrl));
  const beamng = new BeamngService(rootsFromEnv(), scoped('beamng'));
  const recent = new RecentService(join(userData, 'recent-projects.json'), join(userData, 'thumbnails'), scoped('recent'));
  await recent.load();
  const projects = new ProjectFiles();
  const windowState = { dirty: false };
  const trust = new FolderTrust(join(userData, 'trusted-folders.json'));
  await trust.load();
  const userTaxonomy = new UserTaxonomyService(join(userData, 'user-taxonomy.json'), scoped('taxonomy'));
  await userTaxonomy.load();
  const materialLibrary = new MaterialLibraryService(join(userData, 'material-library'), scoped('materials'));
  await materialLibrary.load();
  projects.grantRoot(materialLibrary.root); // its texture copies load like any other texture
  // The material pack that ships with the app (bundled as a resource; the repo's packs/ folder in development).
  const packDir = app.isPackaged ? join(process.resourcesPath, 'materials-pack') : join(app.getAppPath(), 'packs', 'materials');
  projects.grantRoot(packDir);
  const materialPack = loadBundledPack(packDir, scoped('materials'));
  registerIpcHandlers({ settings, layout, beamng, recent, projects, windowState, trust, userTaxonomy, materialLibrary, materialPack, harness });
  const rebuildMenu = () => buildAppMenu({ getWindow: () => mainWindow, settings, isDev: Boolean(devServerUrl) });
  rebuildMenu();

  settings.onChange((s) => {
    setDebugLogging(s.debugLogging);
    rebuildMenu(); // keep the Debug Logging checkbox in sync
    if (mainWindow) sendEvent(mainWindow.webContents, 'settings:changed', s);
  });

  mainWindow = createMainWindow({ devServerUrl, harness });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // Guard unsaved work (the renderer reports dirtiness via window:setDirty).
  mainWindow.on('close', (event) => {
    if (!windowState.dirty || harness || !mainWindow) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Quit without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'The project has unsaved changes.',
      detail: 'Quit anyway and lose them?',
    });
    if (choice === 1) event.preventDefault();
  });

  // First run: find BeamNG without asking when the answer is unambiguous.
  const win = mainWindow;
  beamng
    .autoConfigure(settings)
    .then((message) => {
      // The setting is already saved; the message is only a courtesy if the window is still open.
      if (!message || win.isDestroyed()) return;
      const send = () => sendEvent(win.webContents, 'status:message', { text: message, tone: 'success' });
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
      else send();
    })
    .catch((err: unknown) => logger.warn('BeamNG auto-detect failed:', err));
}

// A second launch hands focus to the running instance and exits without
// loading settings, registering IPC or creating a window. The harness skips the
// lock so its relaunch scenario never races the previous process.
const isPrimaryInstance = harness || app.requestSingleInstanceLock();

if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      logger.error('startup failed:', err);
      app.exit(1);
    });
}
