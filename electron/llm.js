// LLM 询问 + 联网搜索
const { shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 采样目录内部文件名，用于给 LLM 提供上下文
function sampleDir(p, max = 8, depth = 2) {
  const names = [];
  function walk(d, d2) {
    if (names.length >= max || d2 < 0) return;
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (names.length >= max) return;
      if (e.isDirectory()) { names.push(e.name + '/'); if (d2 > 0) walk(path.join(d, e.name), d2 - 1); }
      else names.push(e.name);
    }
  }
  walk(p, depth);
  return names;
}

// 联网搜索：打开默认浏览器
function searchWeb(keyword, engine = 'bing') {
  const q = encodeURIComponent(keyword + ' 缓存 临时文件 删除');
  const urls = {
    bing: 'https://www.bing.com/search?q=',
    baidu: 'https://www.baidu.com/s?wd=',
    google: 'https://www.google.com/search?q=',
  };
  const base = urls[engine] || urls.bing;
  shell.openExternal(base + q);
  return { opened: base + q };
}

// 调用 LLM 判断（OpenAI 兼容 /chat/completions）
async function askLLM({ baseUrl, apiKey, model, targetPath, isDir, samples }) {
  if (!baseUrl || !apiKey || !model) {
    return { ok: false, error: '未配置 LLM（请在设置里填写 baseUrl/apiKey/model）' };
  }
  const name = path.basename(targetPath);
  const prompt = `你是 Windows 磁盘清理助手。判断下面这个${isDir ? '目录' : '文件'}是否可以安全删除。

路径: ${targetPath}
名称: ${name}
${isDir ? `内部文件采样: ${samples.join(', ')}` : ''}

请只回答 JSON，格式: {"verdict":"safe|warning|danger","reason":"一句话理由","method":"建议的删除方式"}。
verdict 含义: safe=纯缓存/临时/日志，可安全删除；warning=可删但有副作用或需确认；danger=含配置/存档/用户数据，不要删。`;

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
    });
  } catch (e) {
    return { ok: false, error: 'LLM 请求失败: ' + (e.message || e) };
  }
  if (!resp.ok) return { ok: false, error: `LLM HTTP ${resp.status}` };
  try {
    const j = await resp.json();
    const content = j.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : content);
    return { ok: true, ...parsed };
  } catch (e) {
    return { ok: false, error: 'LLM 返回解析失败: ' + (e.message || e) };
  }
}

module.exports = { sampleDir, searchWeb, askLLM };
