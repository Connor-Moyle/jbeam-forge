import { join } from 'node:path';
import { app, dialog, net, type BrowserWindow } from 'electron';
import { initLogging, scoped, setDebugLogging } from './log';
import { installMainCrashHandlers } from './crash';
import { SettingsService } from './services/settings';
import { UserTaxonomyService } from './services/userTaxonomy';
import { UserLibrary } from './library/userLibrary';
import { MaterialLibraryService } from './services/materialLibrary';
import { resolveContentRoot } from './content/paths';
import { Packs } from './content/packs';
import { ContentService } from './content/service';
import { UpdateService } from './content/updates';
import { checkOnStartup, contentHooks, registerContentHandlers, type ContentContext } from './content/ipc';
import { ScriptLibrary } from './scripts/library';
import { registerScriptHandlers } from './scripts/ipc';
import { ExtensionService } from './extensions/service';
import { registerExtensionHandlers } from './extensions/ipc';
import { ExtensionFiles } from './extensions/files';
import type { FetchFn } from './content/github';
import { LayoutService } from './services/layout';
import { RecentService } from './services/recent';
import { ProjectFiles } from './services/projectFiles';
import { FolderTrust } from './import/access';
import { BeamngService, rootsFromEnv } from './beamng/service';
import { registerIpcHandlers } from './ipc/handlers';
import { sendEvent, setTrustedUrlPredicate } from './ipc/register';
import { buildAppMenu } from './menu';
import { applyDisplay, initialBounds, loadBounds, saveBounds } from './display';
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
  let loaded = await settings.load();
  // The harness's scenarios start from the home screen; the first-run tour only when asked for.
  if (harness && !loaded.tutorialSeen && process.env.JBFORGE_TUTORIAL !== '1') loaded = await settings.update({ tutorialSeen: true });
  setDebugLogging(loaded.debugLogging);
  logger.info(`starting JBeam Forge ${app.getVersion()} (electron ${process.versions.electron})`, harness ? '[harness]' : '');

  hardenSessions();
  setTrustedUrlPredicate(makeTrustedUrlPredicate(devServerUrl));
  const beamng = new BeamngService(rootsFromEnv(), scoped('beamng'));
  const recent = new RecentService(join(userData, 'recent-projects.json'), join(userData, 'thumbnails'), scoped('recent'));
  await recent.load();
  recent.setLimit(loaded.recentLimit);
  const projects = new ProjectFiles();
  const windowState = { dirty: false };
  const trust = new FolderTrust(join(userData, 'trusted-folders.json'));
  await trust.load();
  const userTaxonomy = new UserTaxonomyService(join(userData, 'user-taxonomy.json'), scoped('taxonomy'));
  await userTaxonomy.load();
  const materialLibrary = new MaterialLibraryService(join(userData, 'material-library'), scoped('materials'));
  await materialLibrary.load();
  projects.grantRoot(materialLibrary.root); // its texture copies load like any other texture
  // Packs bundled with older installs (the resources folder; the repo's packs/ folder in development).
  const packDir = app.isPackaged ? join(process.resourcesPath, 'materials-pack') : join(app.getAppPath(), 'packs', 'materials');
  const objectsDir = app.isPackaged ? join(process.resourcesPath, 'objects-pack') : join(app.getAppPath(), 'packs', 'objects');
  projects.grantRoot(packDir);
  projects.grantRoot(objectsDir);
  // Downloaded textures and meshes: beside the program (Settings → Downloads can move them).
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || undefined;
  // The harness keeps downloads in its temp folder (JBFORGE_CONTENT_DIR), never in the repository.
  const contentPaths = (override: string | null) => ({ override: process.env.JBFORGE_CONTENT_DIR || override, isPackaged: app.isPackaged, portableDir, execPath: process.execPath, appPath: app.getAppPath(), userData });
  let where = await resolveContentRoot(contentPaths(loaded.contentDir));
  if (where.fallback) logger.warn(`content folder ${where.preferred} isn't writable; using ${where.root}`);
  projects.grantRoot(where.root);
  let content: ContentService | null = null;
  const packs = new Packs({ bundledMaterials: packDir, bundledObjects: objectsDir, textures: () => join(where.root, 'textures'), meshes: () => join(where.root, 'meshes') }, scoped('packs'));
  const hooks = contentHooks({ packs, getWindow: () => mainWindow });
  const fetchFn: FetchFn = (url, init) => net.fetch(url, init);
  content = new ContentService(where.root, fetchFn, scoped('content'), hooks);
  const updates = new UpdateService(join(userData, 'updates'), fetchFn, scoped('updates'));
  const contentCtx: ContentContext = { settings, updates, packs, logger: scoped('content'), getWindow: () => mainWindow, content: () => content!, where: () => where, portableDir };
  registerContentHandlers(contentCtx);
  registerExtensionHandlers(new ExtensionService(join(userData, 'extensions'), scoped('extensions'), app.isPackaged ? join(process.resourcesPath, 'example-extensions') : join(app.getAppPath(), 'examples', 'extensions')), new ExtensionFiles(join(userData, 'extension-grants.json'), join(userData, 'extension-models'), scoped('extensions')), projects);
  registerScriptHandlers(new ScriptLibrary(join(userData, 'scripts'), () => join(where.root, 'scripts'), scoped('scripts')));
  let contentDir = loaded.contentDir;
  let lastSettings = settings.get();
  const moveContent = async (next: string | null) => {
    content?.cancelAll();
    where = await resolveContentRoot(contentPaths(next));
    projects.grantRoot(where.root);
    content = new ContentService(where.root, fetchFn, scoped('content'), hooks);
    packs.reload('all');
    hooks.onChange('textures');
    hooks.onChange('meshes');
    hooks.onChange('scripts');
    logger.info(`content folder: ${where.root}${where.fallback ? ` (fell back from ${where.preferred})` : ''}`);
  };
  // Your own library folders: scanned in the background once the window is up (see below).
  const userLibrary = new UserLibrary(join(userData, 'library-scan'), scoped('library'), (dir) => projects.grantRoot(dir));
  registerIpcHandlers({ settings, layout, beamng, recent, projects, windowState, trust, userTaxonomy, materialLibrary, packs, userLibrary, kn5Cache: join(userData, 'kn5-textures'), paintedTextures: join(userData, 'painted-textures'), harness });
  const scanLibrary = () => {
    const s = settings.get();
    if (!s.materialFolders.length && !s.objectFolders.length && !s.beamngInstallDir && !userLibrary.items.folders.length) return;
    void userLibrary.scan({ materials: s.materialFolders, objects: s.objectFolders, beamngInstall: s.beamngInstallDir }).then(() => {
      const { folders, scanning } = userLibrary.items;
      if (mainWindow && !mainWindow.isDestroyed()) sendEvent(mainWindow.webContents, 'library:changed', { folders, scanning });
    });
  };
  const rebuildMenu = () => buildAppMenu({ getWindow: () => mainWindow, settings, isDev: Boolean(devServerUrl) });
  rebuildMenu();

  let libraryFolders = JSON.stringify([settings.get().materialFolders, settings.get().objectFolders, settings.get().beamngInstallDir]);
  settings.onChange((s) => {
    setDebugLogging(s.debugLogging);
    const folders = JSON.stringify([s.materialFolders, s.objectFolders, s.beamngInstallDir]);
    if (folders !== libraryFolders) {
      libraryFolders = folders;
      scanLibrary();
    }
    recent.setLimit(s.recentLimit);
    if (s.contentDir !== contentDir) {
      contentDir = s.contentDir;
      void moveContent(s.contentDir);
    }
    if (mainWindow && !harness) applyDisplay(mainWindow, s, lastSettings);
    lastSettings = s;
    rebuildMenu(); // keep the Debug Logging checkbox in sync
    if (mainWindow) sendEvent(mainWindow.webContents, 'settings:changed', s);
  });

  // Window size, start mode and interface zoom from Settings → Window & display (the harness keeps its fixed size).
  const boundsFile = join(userData, 'window-bounds.json');
  const start0 = harness ? null : initialBounds(settings.get(), await loadBounds(boundsFile));
  mainWindow = createMainWindow({ devServerUrl, harness, ...(start0 ? { bounds: start0.bounds } : {}) });
  const win0 = mainWindow;
  win0.once('ready-to-show', () => {
    if (!start0) return;
    if (settings.get().startMode === 'fullscreen') win0.setFullScreen(true);
    else if (start0.maximize) win0.maximize();
  });
  win0.webContents.on('did-finish-load', () => applyDisplay(win0, settings.get(), null));
  win0.on('close', () => void saveBounds(boundsFile, win0).catch(() => undefined));
  mainWindow.webContents.once('did-finish-load', scanLibrary);
  // Newer app version or content out? Say so (quietly skipped offline).
  if (!harness)
    mainWindow.webContents.once('did-finish-load', () => {
      void checkOnStartup(contentCtx, (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) sendEvent(mainWindow.webContents, 'status:message', { text, tone: 'info' });
      });
    });
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
