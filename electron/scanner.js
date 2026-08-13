// 扫描引擎（CommonJS，Electron 主进程用）
// 输出：聚合结果 byRule + treemap 目录树（每个节点含 size + matched 标记）
const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['$Recycle.Bin', 'System Volume Information', '.git']);

function compile(doc) {
  return {
    rules: (doc.rules || []).map((r) => ({ ...r, re: new RegExp(r.pattern, 'i') })),
    protect: (doc.protect_list || []).map((p) => new RegExp(p.pattern, 'i')),
  };
}

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

function scan({ roots, rulesDoc, customRegexes = [], minSizeMB = 0, whitelist = [], onProgress }) {
  const { rules, protect } = compile(rulesDoc);
  const customs = customRegexes.map((s) => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
  const protectPlus = [...protect, /pagefile\.sys$/, /swapfile\.sys$/i];
  const wl = whitelist.map((w) => path.normalize(w).toLowerCase());
  const isWhitelisted = (p) => {
    const q = path.normalize(p).toLowerCase();
    return wl.some((w) => q === w || q.startsWith(w + path.sep));
  };

  const stats = new Map();
  const hits = []; // 命中项明细（size>=minBytes），供 UI 逐项展示
  const MAX_HITS = 8000;
  function record(ruleId, risk, category, desc, p, size, isDir) {
    if (!stats.has(ruleId)) stats.set(ruleId, { ruleId, risk, category, description: desc, count: 0, size: 0, samples: [] });
    const s = stats.get(ruleId);
    s.count += 1;
    s.size += size;
    if (s.samples.length < 10) s.samples.push(p + (isDir ? '\\*' : ''));
    if (hits.length < MAX_HITS) {
      hits.push({ path: p, size, isDir, ruleId, risk, category });
    }
  }

  // 匹配目录：内置 dirname/path 规则 或 自定义正则
  function matchDir(name, full) {
    for (const r of rules) {
      if (r.scope === 'dirname' && r.re.test(name)) return r;
    }
    for (const r of rules) {
      if (r.scope === 'path' && r.re.test(full + path.sep)) return r;
    }
    for (const re of customs) if (re.test(full) || re.test(name)) return { id: 'custom', risk: 'warning', category: '自定义正则', description: '自定义正则命中' };
    return null;
  }
  function matchFile(name, full) {
    for (const r of rules) {
      if (r.scope === 'filename' && r.re.test(name)) return r;
    }
    for (const r of rules) {
      if (r.scope === 'path' && r.re.test(full)) return r;
    }
    for (const re of customs) if (re.test(full) || re.test(name)) return { id: 'custom', risk: 'warning', category: '自定义正则', description: '自定义正则命中' };
    return null;
  }

  const minBytes = minSizeMB * 1048576;
  let filesScanned = 0;
  let lastEmit = 0; // 进度事件时间限流（避免高频 IPC 卡 UI）
  const start = Date.now();

  // 递归扫描 + 构建树
  function scanDir(dir, node, depth) {
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (protectPlus.some((re) => re.test(full))) continue;
      if (isWhitelisted(full)) continue;

      if (e.isDirectory()) {
        const r = matchDir(e.name, full);
        if (r) {
          const size = du(full);
          node.children.push({ name: e.name, path: full, size, matched: true, ruleId: r.id, children: [] });
          node.size += size; // 累计到父节点，保证 treemap 面积正确
          if (size >= minBytes) record(r.id, r.risk, r.category, r.description, full, size, true);
          continue;
        }
        if (SKIP_DIRS.has(e.name)) continue;
        const child = { name: e.name, path: full, size: 0, matched: false, ruleId: null, children: [] };
        scanDir(full, child, depth + 1);
        if (child.size > 0 || child.children.length > 0) { node.children.push(child); node.size += child.size; }
      } else {
        filesScanned++;
        let size = 0;
        try { size = fs.lstatSync(full).size; } catch {}
        node.size += size;
        const r = matchFile(e.name, full);
        if (r) {
          if (size >= minBytes) record(r.id, r.risk, r.category, r.description, full, size, false);
          node.matched = true;
          node.ruleId = node.ruleId || r.id;
        }
        if (onProgress) {
          const now = Date.now();
          if (now - lastEmit > 300) { lastEmit = now; onProgress(filesScanned, full); }
        }
      }
    }
  }

  const tree = { name: 'ROOT', path: '', size: 0, matched: false, ruleId: null, children: [] };
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const rootNode = { name: root, path: root, size: 0, matched: false, ruleId: null, children: [] };
    scanDir(root, rootNode, 0);
    if (rootNode.size > 0 || rootNode.children.length > 0) tree.children.push(rootNode);
  }

  const byRule = [...stats.values()].sort((a, b) => b.size - a.size);
  const total = byRule.reduce((a, b) => a + b.size, 0);
  const byRisk = { safe: 0, warning: 0, danger: 0 };
  byRule.forEach((r) => { byRisk[r.risk] = (byRisk[r.risk] || 0) + r.size; });

  const hitsSorted = hits.sort((a, b) => b.size - a.size).map((h) => ({ ...h, sizeMB: Math.round((h.size / 1048576) * 10) / 10 }));

  return {
    scanTime: new Date().toISOString(),
    roots, filesScanned,
    elapsedSec: ((Date.now() - start) / 1000).toFixed(1),
    totalMB: Math.round((total / 1048576) * 10) / 10,
    byRisk,
    byRule: byRule.map((r) => ({ ...r, sizeMB: Math.round((r.size / 1048576) * 10) / 10, size: undefined })),
    hits: hitsSorted,
    treemap: tree,
  };
}

module.exports = { scan, du };
