// Electron 主进程入口
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const scanner = require('./scanner');
const cleaner = require('./cleaner');
const llm = require('./llm');
const store = require('./store');
const uninstall = require('./uninstall');

let mainWindow = null;

// 中文菜单
function setupMenu() {
  const template = [
    {
      label: '文件',
      submenu: [{ label: '退出', role: 'quit' }],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: '关于磁盘清理大师', click: () => dialog.showMessageBox(mainWindow, { message: '磁盘清理大师\n正则匹配疑似文件 + AI 确认 + Treemap 视图 + 安全清理\n\n作者邮箱：2652816003@qq.com', title: '关于' }) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(devPort) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '磁盘清理大师',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devPort) {
    mainWindow.loadURL(`http://localhost:${devPort}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// 开发模式：主进程内启动 vite dev server，自动选可用端口（避免 5173 冲突）
async function startVite() {
  try {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { port: 5173, strictPort: false } });
    await vite.listen();
    const addr = vite.httpServer.address();
    return typeof addr === 'object' && addr ? addr.port : 5173;
  } catch (e) {
    console.error('vite dev server 启动失败:', e);
    return null;
  }
}

app.whenReady().then(async () => {
  store.init(app.getPath('userData'));
  setupMenu();

  // 动态返回当前用户 AppData 根路径（避免源码写死用户名）
  ipcMain.handle('get-special-dirs', () => ({ appData: path.dirname(app.getPath('appData')) }));

  // ---- IPC handlers ----
  ipcMain.handle('scan', async (_e, params) => {
    const rulesDoc = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'rules', 'cleanup_rules.json'), 'utf8')
    );
    const result = scanner.scan({
      roots: params.roots,
      rulesDoc,
      customRegexes: params.customRegexes || [],
      minSizeMB: params.minSizeMB || 0,
      whitelist: (store.get().whitelist || []).map((w) => w.path),
      onProgress: (files, current) => {
        if (mainWindow) mainWindow.webContents.send('scan-progress', { files, current });
      },
    });
    // 内置规则命中的 safe 项自动加入清理名单（相当于 CCleaner 默认勾选的清理项），无需二次点击
    const safeHits = (result.hits || []).filter((h) => h.risk === 'safe').map((h) => ({
      path: h.path, sizeMB: h.sizeMB, category: h.category, risk: 'safe', note: '内置规则命中（常见清理）',
    }));
    const auto = store.batchAddToCleanList(safeHits);
    result.autoAdded = auto.added;
    // 持久化扫描结果，切换页面/重启可恢复
    store.saveLastScan(result);
    return result;
  });

  ipcMain.handle('trash', async (_e, paths) => {
    // 删除前安全检查：保护名单 + 系统关键目录 + 白名单
    const rulesDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules', 'cleanup_rules.json'), 'utf8'));
    const protect = (rulesDoc.protect_list || []).map((p) => new RegExp(p.pattern, 'i'));
    const extraProtect = [
      /^[A-Z]:[\\/]?$/,                                                                          // 盘符根
      /[\\/]Windows[\\/](System32|SysWOW64|WinSxS|boot|Fonts|System|servicing|Inf|Installer)[\\/]?/i, // 系统目录
      /[\\/]Users[\\/][^\\/]+[\\/](Desktop|Documents|Downloads|Pictures|Videos|Music|OneDrive)([\\/]|$)/i, // 用户关键目录及其子项
      /[\\/]AppData[\\/]Roaming[\\/]Microsoft[\\/]Windows[\\/](Start Menu|SendTo|Startup)[\\/]/i,   // 开始菜单等
      /[\\/]ProgramData[\\/]Microsoft[\\/]Windows[\\/](Start Menu|Startup)[\\/]/i,
    ];
    const wl = (store.get().whitelist || []).map((w) => path.normalize(w.path).toLowerCase());

    const toDelete = [];
    const blocked = [];
    for (const p of paths) {
      const norm = path.normalize(String(p)).replace(/[\\/]+$/, '');
      const hitProtect = protect.some((re) => re.test(norm)) || extraProtect.some((re) => re.test(norm));
      const hitWl = wl.some((w) => norm.toLowerCase() === w || norm.toLowerCase().startsWith(w + path.sep));
      if (hitProtect) blocked.push({ path: p, ok: false, error: '保护名单拦截：系统/关键目录' });
      else if (hitWl) blocked.push({ path: p, ok: false, error: '白名单中，已跳过' });
      else toDelete.push(p);
    }

    const results = await cleaner.trashMany(toDelete, (r) => {
      if (mainWindow) mainWindow.webContents.send('trash-progress', r);
    });
    return [...results, ...blocked];
  });

  ipcMain.handle('ask-llm', async (_e, params) => {
    const s = store.get().settings;
    return llm.askLLM({
      baseUrl: params.baseUrl || s.llmBaseUrl,
      apiKey: params.apiKey || s.llmApiKey,
      model: params.model || s.llmModel,
      targetPath: params.targetPath,
      isDir: params.isDir,
      samples: params.samples,
    });
  });

  ipcMain.handle('search-web', (_e, { keyword, engine }) => {
    const s = store.get().settings;
    return llm.searchWeb(keyword, engine || s.searchEngine);
  });

  ipcMain.handle('sample-dir', (_e, p) => llm.sampleDir(p));

  ipcMain.handle('select-roots', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  // 检测存在的盘符（快捷添加扫描区域用）
  ipcMain.handle('get-drives', () => {
    const drives = [];
    for (let c = 65; c <= 90; c++) {
      const d = String.fromCharCode(c) + ':\\';
      try { if (fs.existsSync(d)) drives.push(d); } catch {}
    }
    return drives;
  });

  ipcMain.handle('get-data', () => store.get());
  ipcMain.handle('get-last-scan', () => store.getLastScan());
  ipcMain.handle('add-clean', (_e, item) => store.addToCleanList(item));
  ipcMain.handle('remove-clean', (_e, p) => store.removeFromCleanList(p));
  ipcMain.handle('add-whitelist', (_e, item) => store.addToWhitelist(item));
  ipcMain.handle('remove-whitelist', (_e, p) => store.removeFromWhitelist(p));
  ipcMain.handle('save-settings', (_e, s) => store.saveSettings(s));

  // ---- 卸载模块 ----
  ipcMain.handle('list-programs', () => uninstall.listPrograms());
  ipcMain.handle('uninstall', (_e, uninstallString) => uninstall.runUninstaller(uninstallString));
  ipcMain.handle('scan-residue', (_e, program) => {
    const username = require('node:os').userInfo().username;
    return uninstall.scanResidue(program, username);
  });

  // 一键批量扫描所有程序残留（用于判断真实大小）
  ipcMain.handle('scan-all-residue', (_e, programs) => {
    const username = require('node:os').userInfo().username;
    return uninstall.scanAllResidue(programs, username);
  });

  // 打开外部卸载器（如 IObit）
  ipcMain.handle('open-external-uninstaller', async () => {
    const exe = store.get().settings.externalUninstaller;
    if (!exe) return { ok: false, error: '未配置外部卸载器路径（请在设置里填写）' };
    const err = await shell.openPath(exe);
    if (err) return { ok: false, error: '打开失败: ' + err };
    return { ok: true, note: '已打开外部卸载器' };
  });

  // 开发模式起 vite，生产加载 dist
  let devPort = null;
  if (!app.isPackaged) devPort = await startVite();
  createWindow(devPort);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
});
