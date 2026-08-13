// 数据存储（JSON 文件，避免 native 依赖）
const fs = require('node:fs');
const path = require('node:path');

let file = null;
let scanFile = null; // 扫描结果单独存，避免拖慢 data.json 的频繁写入
const data = {
  cleanList: [],      // 清理名单：{path, sizeMB, category, risk, note, addedAt}
  whitelist: [],      // 白名单（永不删）：{path, note}
  settings: {
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
    searchEngine: 'bing',
    minSizeMB: 1,
    externalUninstaller: '',   // 外部卸载器 exe 路径（如 IObit）
  },
  history: [],        // 扫描历史
  lastScan: null,     // 最后一次扫描结果（byRule + hits + treemap + meta），用于恢复
};

function init(userDataDir) {
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}
  file = path.join(userDataDir, 'disk-cleaner-data.json');
  scanFile = path.join(userDataDir, 'disk-cleaner-lastscan.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.cleanList = raw.cleanList || data.cleanList;
    data.whitelist = raw.whitelist || data.whitelist;
    data.settings = { ...data.settings, ...(raw.settings || {}) };  // 深合并，保留新增字段默认值
    data.history = raw.history || data.history;
  } catch {}
  return data;
}

function persist() {
  if (!file) return;
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

function get() { return data; }

function addToCleanList(item) {
  if (!data.cleanList.some((i) => i.path === item.path)) {
    data.cleanList.unshift({ ...item, addedAt: new Date().toISOString() });
  }
  return data.cleanList;
}

// 批量加入（自动去重），用于扫描后 safe 项自动入名单
function batchAddToCleanList(items) {
  let added = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    if (!data.cleanList.some((i) => i.path === it.path)) {
      data.cleanList.unshift({ ...it, addedAt: now });
      added++;
    }
  }
  if (added > 0) persist();
  return { total: data.cleanList.length, added };
}

function removeFromCleanList(p) {
  data.cleanList = data.cleanList.filter((i) => i.path !== p);
  persist();
  return data.cleanList;
}
function addToWhitelist(item) {
  if (!data.whitelist.some((i) => i.path === item.path)) {
    data.whitelist.unshift({ ...item, addedAt: new Date().toISOString() });
    persist();
  }
  return data.whitelist;
}
function removeFromWhitelist(p) {
  data.whitelist = data.whitelist.filter((i) => i.path !== p);
  persist();
  return data.whitelist;
}
function saveSettings(s) {
  data.settings = { ...data.settings, ...s };
  persist();
  return data.settings;
}

// 保存最后一次扫描结果（独立文件，用于切换/重启后恢复）
function saveLastScan(result) {
  try { fs.writeFileSync(scanFile, JSON.stringify(result)); } catch {}
  return result;
}
function getLastScan() {
  try { return JSON.parse(fs.readFileSync(scanFile, 'utf8')); } catch { return null; }
}

module.exports = {
  init, get, persist,
  addToCleanList, batchAddToCleanList, removeFromCleanList,
  addToWhitelist, removeFromWhitelist, saveSettings, saveLastScan, getLastScan,
};
