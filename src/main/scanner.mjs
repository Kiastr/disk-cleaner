// 核心扫描引擎 v3（纯 Node，无依赖）
// 支持规则 scope：dirname(目录名) / filename(文件名) / path(完整路径)
// 用法: node scanner.mjs --root "C:\Users\<用户名>\AppData" --root "C:\ProgramData" --rules rules/cleanup_rules.json --out report.json
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const roots = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--root') roots.push(args[++i]);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const rulesFile = getArg('--rules') || 'rules/cleanup_rules.json';
const outFile = getArg('--out');
const minSizeMB = Number(getArg('--min-size') || 0);

const SKIP_DIRS = new Set(['$Recycle.Bin', 'System Volume Information', '.git']);

const doc = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
const rules = doc.rules.map((r) => ({ ...r, re: new RegExp(r.pattern, 'i') }));
const protect = doc.protect_list.map((p) => new RegExp(p.pattern, 'i'));

// 目录总大小（迭代 + lstat 跳过 junction）
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

const stats = new Map();
function record(r, p, size, isDir) {
  if (!stats.has(r.id)) stats.set(r.id, { count: 0, size: 0, samples: [], risk: r.risk, category: r.category, desc: r.description });
  const s = stats.get(r.id);
  s.count += 1;
  s.size += size;
  if (s.samples.length < 12) s.samples.push(p + (isDir ? '\\*' : ''));
}

function matchEntry(name, full, isDir) {
  for (const r of rules) {
    let hit = false;
    if (r.scope === 'dirname' && isDir) hit = r.re.test(name);
    else if (r.scope === 'filename' && !isDir) hit = r.re.test(name);
    else if (r.scope === 'path') hit = r.re.test(isDir ? full + path.sep : full);
    if (hit) return r;
  }
  return null;
}

let filesScanned = 0;
function scan(dir) {
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.isSymbolicLink()) continue; // 跳过 junction/symlink
    const full = path.join(dir, e.name);
    if (protect.some((re) => re.test(full))) continue;

    if (e.isDirectory()) {
      const r = matchEntry(e.name, full, true);
      if (r) {
        const size = du(full);
        if (size >= minSizeMB * 1048576) record(r, full, size, true);
        continue; // 命中则整目录统计，不深入
      }
      if (SKIP_DIRS.has(e.name)) continue;
      scan(full);
    } else {
      filesScanned++;
      const r = matchEntry(e.name, full, false);
      if (r) {
        let size = 0;
        try { size = fs.lstatSync(full).size; } catch {}
        if (size >= minSizeMB * 1048576) record(r, full, size, false);
      }
    }
  }
}

const t0 = Date.now();
console.error(`规则 ${rules.length} 条 | 保护 ${protect.length} 条 | 扫描根: ${roots.join(' ; ')}`);
for (const root of roots) {
  if (!fs.existsSync(root)) { console.error(`跳过不存在: ${root}`); continue; }
  scan(root);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const rows = [...stats.entries()].map(([id, s]) => ({
  ruleId: id, category: s.category, risk: s.risk, description: s.desc,
  count: s.count, sizeMB: Math.round((s.size / 1048576) * 10) / 10, samples: s.samples,
})).sort((a, b) => b.sizeMB - a.sizeMB);

const total = rows.reduce((a, b) => a + b.sizeMB, 0);
const byRisk = { safe: 0, warning: 0, danger: 0 };
rows.forEach((r) => { byRisk[r.risk] = (byRisk[r.risk] || 0) + r.sizeMB; });

const report = { scanTime: new Date().toISOString(), roots, filesScanned, elapsedSec: secs, totalMB: Math.round(total * 10) / 10, byRisk, byRule: rows };
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

console.log(`\n=== 扫描完成: ${filesScanned} 文件, ${secs}s, 命中 ${Math.round(total * 10) / 10} MB ===`);
console.log(`safe ${Math.round(byRisk.safe)}MB | warning ${Math.round(byRisk.warning || 0)}MB | danger ${Math.round(byRisk.danger || 0)}MB`);
for (const r of rows) {
  console.log(`\n[${r.risk}] ${r.sizeMB}MB  x${r.count}  ${r.category} · ${r.ruleId}`);
  for (const s of r.samples.slice(0, 3)) console.log(`     ${s}`);
}
if (outFile) console.log(`\n报告已写入: ${outFile}`);
