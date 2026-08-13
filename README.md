# 磁盘清理大师（disk-cleaner）

Windows 磁盘清理应用：正则匹配疑似垃圾文件 + AI/联网确认 + SpaceSniffer 式 Treemap 视图 + 安全清理（走回收站）。

## 技术栈
Electron（主进程 Node）+ React 18 + TypeScript + Vite + Ant Design。

## 功能
- **探索清理**：选择目录 + 自定义正则 → 扫描，命中项按规则/风险分级展示
  - 每个疑似项旁有「LLM 询问」「联网搜索」「加入名单」按钮
  - Treemap 视图（红色=命中规则的疑似垃圾块，蓝色=正常文件），可点击钻取
- **清理名单**：勾选删除（走回收站）、一键清理 safe 项、白名单管理
- **设置**：LLM 接口配置（OpenAI 兼容）、搜索引擎、最小记录大小

## 运行
```bash
# 开发（热更新）
npm run dev

# 生产构建 + 运行
npm run build
npm start
```

## 目录结构
```
electron/
  main.js      # 主进程入口 + IPC
  scanner.js   # 扫描引擎（递归 + junction跳过 + 规则匹配 + treemap树）
  cleaner.js   # 删除（走回收站）
  llm.js       # LLM 询问 + 联网搜索
  store.js     # JSON 存储（清理名单/白名单/设置）
  preload.js   # contextBridge
src/           # 渲染层 React
  pages/       # ScanPage(探索) / CleanListPage(名单) / SettingsPage(设置)
  components/  # Treemap
rules/cleanup_rules.json   # 内置规则库（scope: dirname/path/filename）
```

## 说明
- 数据存于 Electron userData 目录下的 `disk-cleaner-data.json`
- 删除默认走回收站（`trash` 库），不直接 rm
- 扫描自动跳过 junction/symlink（避免循环与重复计数）、pagefile/swapfile/WinSxS 等保护名单
