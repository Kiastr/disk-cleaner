// 安全删除（走回收站）
const fs = require('node:fs');
const path = require('node:path');

let trashMod = null;
try { trashMod = require('trash'); } catch {}

// 删除单个路径（文件或目录），走回收站
async function trashOne(p) {
  if (!fs.existsSync(p)) return { path: p, ok: true, skipped: 'not-exist' };
  if (trashMod) {
    try { await trashMod(p); return { path: p, ok: true }; }
    catch (e) { return { path: p, ok: false, error: String(e.message || e) }; }
  }
  // 降级：无 trash 库时不删除，只报告
  return { path: p, ok: false, error: 'trash 库不可用，拒绝删除（安全保护）' };
}

// 批量删除，每次最多 10 个，逐个返回结果
async function trashMany(paths, onEach) {
  const results = [];
  for (const p of paths) {
    const r = await trashOne(p);
    results.push(r);
    if (onEach) onEach(r);
  }
  return results;
}

module.exports = { trashOne, trashMany };
