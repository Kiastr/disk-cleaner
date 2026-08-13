const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 扫描
  scan: (params) => ipcRenderer.invoke('scan', params),
  // 删除到回收站
  trash: (paths) => ipcRenderer.invoke('trash', paths),
  // LLM 询问
  askLLM: (params) => ipcRenderer.invoke('ask-llm', params),
  // 联网搜索
  searchWeb: (keyword, engine) => ipcRenderer.invoke('search-web', { keyword, engine }),
  // 采样目录内容
  sampleDir: (p) => ipcRenderer.invoke('sample-dir', p),
  // 选择扫描目录
  selectRoots: () => ipcRenderer.invoke('select-roots'),
  getDrives: () => ipcRenderer.invoke('get-drives'),
  getSpecialDirs: () => ipcRenderer.invoke('get-special-dirs'),
  // 数据存取
  getData: () => ipcRenderer.invoke('get-data'),
  getLastScan: () => ipcRenderer.invoke('get-last-scan'),
  addToCleanList: (item) => ipcRenderer.invoke('add-clean', item),
  removeFromCleanList: (p) => ipcRenderer.invoke('remove-clean', p),
  addToWhitelist: (item) => ipcRenderer.invoke('add-whitelist', item),
  removeFromWhitelist: (p) => ipcRenderer.invoke('remove-whitelist', p),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  // 卸载模块
  listPrograms: () => ipcRenderer.invoke('list-programs'),
  uninstall: (uninstallString) => ipcRenderer.invoke('uninstall', uninstallString),
  scanResidue: (program) => ipcRenderer.invoke('scan-residue', program),
  scanAllResidue: (programs) => ipcRenderer.invoke('scan-all-residue', programs),
  openExternalUninstaller: () => ipcRenderer.invoke('open-external-uninstaller'),
  // 进度事件
  onProgress: (cb) => ipcRenderer.on('scan-progress', (_e, d) => cb(d)),
});
