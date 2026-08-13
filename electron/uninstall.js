// 程序卸载 + 残留扫描（安全：只扫描不自动删，残留匹配严格 + 完整路径展示）
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 读注册表列出已安装程序
function listPrograms() {
  const roots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const programs = [];
  const seen = new Set();
  for (const root of roots) {
    let out;
    try {
      // chcp 65001 让 cmd 用 UTF-8 输出，避免中文程序名乱码
      out = execSync(`chcp 65001 >nul & reg query "${root}" /s`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    } catch {
      continue; // 无权限或不存在
    }
    // 每个子键之间以空行分隔
    const blocks = out.split(/\r?\n\s*\r?\n/);
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const keyLine = lines[0] ? lines[0].trim() : '';
      if (!/^HKEY/i.test(keyLine)) continue;
      const p = {};
      for (const line of lines.slice(1)) {
        const m = line.match(/^\s{2,}(\w+)\s+REG_[A-Z_]+\s+(.*)$/);
        if (m) p[m[1]] = m[2].trim();
      }
      if (!p.DisplayName || !p.DisplayName.trim()) continue;
      const id = (p.DisplayName + '|' + (p.DisplayVersion || '')).toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      programs.push({
        name: p.DisplayName.trim(),
        version: p.DisplayVersion || '',
        publisher: p.Publisher || '',
        uninstallString: p.UninstallString || p.QuietUninstallString || '',
        installLocation: (p.InstallLocation || '').replace(/^"|"$/g, ''),
        estimatedSizeKB: parseSize(p.EstimatedSize),
        icon: p.DisplayIcon || '',
        installDate: p.InstallDate || '',
      });
    }
  }
  programs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return programs;
}

function parseSize(v) {
  if (!v) return 0;
  const n = parseInt(v, 10);
  if (!isNaN(n)) return n;
  const h = parseInt(v, 16);
  return isNaN(h) ? 0 : h;
}

// 启动卸载程序（不阻塞主进程）
function runUninstaller(uninstallString) {
  if (!uninstallString) return { ok: false, error: '该程序没有注册卸载命令' };
  try {
    const child = spawn('cmd', ['/c', uninstallString], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true, note: '卸载程序已启动，请在弹窗中完成卸载' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// 目录大小（迭代，跳过 junction）
function du(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      const full = path.join(d, e.name);
      let ls;
      try { ls = fs.lstatSync(full); } catch { continue; }
      if (ls.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(full);
      else total += ls.size;
    }
  }
  return total;
}

// 从程序名提取匹配关键词（保守：只取主名+长单词，不用厂商名，避免误伤）
function extractKeywords(displayName) {
  const kw = new Set();
  let n = displayName || '';
  n = n.replace(/\s*[\(\[（].*?[\)\]）]\s*/g, ' ');      // 去括号
  n = n.replace(/\s+v?\d+(\.\d+)*[^\s]*\s*$/i, '');      // 去末尾版本号
  n = n.replace(/[\s\-–—:：]+$/g, '').trim();
  if (n.length >= 2) kw.add(n);
  for (const w of n.split(/[\s\-–—]+/)) {
    if (w.length >= 4 && !/^\d/.test(w)) kw.add(w);      // 只取 >=4 的长单词，过滤短词/数字
  }
  return [...kw].filter((k) => !/^(the|for|and|inc|llc|ltd|corp|software|studio)$/i.test(k));
}

// 扫描残留（只读，返回候选清单）
function scanResidue(program, username) {
  const results = [];
  const keywords = extractKeywords(program.name);
  const userDirs = [
    `C:\\Users\\${username}\\AppData\\Local`,
    `C:\\Users\\${username}\\AppData\\Roaming`,
    `C:\\Users\\${username}\\AppData\\LocalLow`,
  ];

  // 1. 安装目录仍在
  const loc = (program.installLocation || '').replace(/[\\/]+$/, '');
  if (loc && loc.length > 3 && fs.existsSync(loc)) {
    results.push({ path: loc, size: du(loc), reason: '安装目录仍存在' });
  }

  // 2. AppData / ProgramData 下目录名匹配关键词（不扫 Program Files，避免误伤）
  const scanDirs = [...userDirs, 'C:\\ProgramData'];
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const nl = name.toLowerCase();
      const hit = keywords.find((k) => nl === k.toLowerCase() || nl.includes(k.toLowerCase()));
      if (hit) {
        const full = path.join(dir, name);
        let ls;
        try { ls = fs.lstatSync(full); } catch { continue; }
        if (ls.isSymbolicLink()) continue; // 跳过 junction
        if (ls.isDirectory()) {
          results.push({ path: full, size: du(full), reason: `目录名匹配「${hit}」` });
        }
      }
    }
  }

  // 去重
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = r.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, sizeMB: Math.round((r.size / 1048576) * 10) / 10 });
  }
  return out;
}

// 批量扫描所有程序的残留（用于判断应用真实大小，不删除）
// 一次遍历文件系统，按关键词匹配到各程序，返回每个程序的安装大小 + 残留大小
function scanAllResidue(programs, username) {
  const dirs = [
    `C:\\Users\\${username}\\AppData\\Local`,
    `C:\\Users\\${username}\\AppData\\Roaming`,
    `C:\\Users\\${username}\\AppData\\LocalLow`,
    'C:\\ProgramData',
  ];
  // 1. 一次遍历，算所有顶层目录大小
  const topDirs = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = path.join(dir, name);
      let ls;
      try { ls = fs.lstatSync(full); } catch { continue; }
      if (ls.isSymbolicLink()) continue;
      if (ls.isDirectory()) topDirs.push({ name, size: du(full) });
    }
  }
  // 2. 每个程序匹配关键词，累加残留
  const residueMap = new Map(); // name -> {residue, total}
  for (const program of programs) {
    const keywords = extractKeywords(program.name);
    let residue = 0;
    for (const d of topDirs) {
      const nl = d.name.toLowerCase();
      if (keywords.some((k) => nl === k.toLowerCase() || nl.includes(k.toLowerCase()))) {
        residue += d.size;
      }
    }
    const install = (program.estimatedSizeKB || 0) * 1024;
    residueMap.set(program.name, {
      residueSize: residue,
      totalSize: install + residue,
      installSize: install,
    });
  }
  return residueMap;
}

module.exports = { listPrograms, runUninstaller, scanResidue, scanAllResidue };
