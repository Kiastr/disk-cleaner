import { useEffect, useState } from 'react';
import { Button, Input, Space, Table, Tag, Modal, Progress, message, Typography, Tooltip, Segmented } from 'antd';
import { SearchOutlined, PlayCircleOutlined, QuestionCircleOutlined, GlobalOutlined, PlusOutlined, AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons';
import Treemap from '../components/Treemap';
import type { AppData, ScanResult, Hit, LLMResult } from '../types';

const DEFAULT_PROGRAMDATA = 'C:\\ProgramData';

const RISK_COLOR: Record<string, string> = { safe: 'green', warning: 'orange', danger: 'red' };
const RISK_LABEL: Record<string, string> = { safe: '可删', warning: '需确认', danger: '勿删' };

export default function ScanPage({ data, refreshData }: { data: AppData; refreshData: () => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  const [appDataPath, setAppDataPath] = useState<string>('');
  const [regexInput, setRegexInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ files: number; current: string } | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [tab, setTab] = useState('hits');
  const [drives, setDrives] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiModal, setAiModal] = useState<{ path: string; isDir: boolean; sizeMB?: number; res: LLMResult } | null>(null);

  useEffect(() => {
    window.api.onProgress((d) => setProgress(d));
    // 恢复上次扫描结果（切换页面/重启后不丢）
    window.api.getLastScan().then((r) => { if (r) setResult(r); });
    // 检测盘符
    window.api.getDrives().then((d) => setDrives(d));
    // 动态取当前用户 AppData 路径（避免源码写死用户名），并设为默认扫描根
    window.api.getSpecialDirs().then((d) => {
      setAppDataPath(d.appData);
      setRoots((prev) => (prev.length ? prev : [d.appData, DEFAULT_PROGRAMDATA]));
    }).catch(() => {
      setRoots((prev) => (prev.length ? prev : [DEFAULT_PROGRAMDATA]));
    });
  }, []);

  const customRegexes = regexInput.split('\n').map((s) => s.trim()).filter(Boolean);

  const startScan = async () => {
    if (roots.length === 0) { message.warning('请先选择扫描目录'); return; }
    setScanning(true);
    setProgress(null);
    try {
      const r = await window.api.scan({ roots, customRegexes, minSizeMB: data.settings.minSizeMB || 1 });
      setResult(r);
      const autoMsg = (r as any).autoAdded ? `，${(r as any).autoAdded} 项常见清理已自动加入名单` : '';
      message.success(`扫描完成：${r.filesScanned} 文件，命中 ${r.totalMB} MB${autoMsg}`);
      refreshData();
    } catch (e: any) {
      message.error('扫描失败: ' + (e.message || e));
    } finally {
      setScanning(false);
    }
  };

  const pickRoots = async () => {
    const r = await window.api.selectRoots();
    if (r.length) setRoots((prev) => [...new Set([...prev, ...r])]);
  };

  // 快捷添加（去重）
  const addRoot = (p: string) => {
    setRoots((prev) => (prev.includes(p) ? prev : [...prev, p]));
  };

  const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

  const askAI = async (path: string, isDir: boolean, sizeMB?: number) => {
    setAiLoading((m) => ({ ...m, [path]: true }));
    try {
      const samples = isDir ? await window.api.sampleDir(path) : [];
      const res = await window.api.askLLM({ targetPath: path, isDir, samples });
      setAiModal({ path, isDir, sizeMB, res });
    } catch (e: any) {
      message.error('AI 询问失败: ' + (e.message || e));
    } finally {
      setAiLoading((m) => ({ ...m, [path]: false }));
    }
  };

  const search = (p: string) => {
    window.api.searchWeb(basename(p), data.settings.searchEngine);
  };

  const addToList = (p: string, sizeMB?: number, category?: string, risk?: string) => {
    window.api.addToCleanList({ path: p, sizeMB, category: category || '手动添加', risk: risk || 'warning', addedAt: new Date().toISOString() });
    refreshData();
    message.success('已加入清理名单');
  };

  // treemap 右键加名单：从结果里查详情，查不到用通用项
  const addFromTreemap = (p: string) => {
    const hit = result?.hits.find((h) => h.path === p);
    addToList(p, hit?.sizeMB, hit?.category, hit?.risk);
  };

  const adoptAI = () => {
    if (!aiModal) return;
    window.api.addToCleanList({ path: aiModal.path, sizeMB: aiModal.sizeMB, category: 'AI 确认', risk: aiModal.res.verdict || 'warning', note: aiModal.res.reason, addedAt: new Date().toISOString() });
    refreshData();
    setAiModal(null);
    message.success('已按 AI 建议加入名单');
  };

  const columns = [
    { title: '路径', dataIndex: 'path', key: 'path', ellipsis: true, render: (p: string) => <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{p}</Typography.Text> },
    { title: '大小', dataIndex: 'sizeMB', key: 'sizeMB', width: 90, sorter: (a: Hit, b: Hit) => a.size - b.size, render: (m: number) => `${m} MB` },
    { title: '类型', dataIndex: 'isDir', key: 'isDir', width: 70, render: (d: boolean) => (d ? <Tag>目录</Tag> : <Tag color="default">文件</Tag>) },
    { title: '风险', dataIndex: 'risk', key: 'risk', width: 90, render: (r: string) => <Tag color={RISK_COLOR[r]}>{RISK_LABEL[r]}</Tag> },
    { title: '分类', dataIndex: 'category', key: 'category', width: 110 },
    {
      title: '操作', key: 'action', width: 250,
      render: (_: any, hit: Hit) => (
        <Space size={4}>
          <Tooltip title="询问 AI 能否删除">
            <Button size="small" icon={<QuestionCircleOutlined />} loading={!!aiLoading[hit.path]} onClick={() => askAI(hit.path, hit.isDir, hit.sizeMB)}>问AI</Button>
          </Tooltip>
          <Tooltip title="联网搜索这个名字">
            <Button size="small" icon={<GlobalOutlined />} onClick={() => search(hit.path)}>搜索</Button>
          </Tooltip>
          <Tooltip title="加入清理名单">
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => addToList(hit.path, hit.sizeMB, hit.category, hit.risk)}>加名单</Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const byRuleColumns = [
    { title: '规则', dataIndex: 'ruleId', key: 'ruleId' },
    { title: '分类', dataIndex: 'category', key: 'category' },
    { title: '风险', dataIndex: 'risk', key: 'risk', render: (r: string) => <Tag color={RISK_COLOR[r]}>{RISK_LABEL[r]}</Tag> },
    { title: '数量', dataIndex: 'count', key: 'count', sorter: (a: any, b: any) => a.count - b.count },
    { title: '大小', dataIndex: 'sizeMB', key: 'sizeMB', sorter: (a: any, b: any) => a.sizeMB - b.sizeMB, render: (m: number) => `${m} MB` },
    { title: '示例', dataIndex: 'samples', key: 'samples', render: (s: string[]) => <Typography.Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.slice(0, 2).join('  |  ')}</Typography.Text> },
  ];

  return (
    <div>
      <h1 className="page-title">探索清理</h1>
      <p className="page-desc">按规则与正则匹配疑似垃圾文件，AI 确认后安全清理</p>
      <div className="card">
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space wrap>
          <Input.TextArea
            value={roots.join('\n')}
            onChange={(e) => setRoots(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            placeholder="扫描目录，每行一个"
            autoSize={{ minRows: 1, maxRows: 3 }}
            style={{ width: 480, fontFamily: 'monospace', fontSize: 12 }}
          />
          <Button onClick={pickRoots}>选择目录…</Button>
        </Space>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
          <span style={{ color: '#8b93b0', fontSize: 12, whiteSpace: 'nowrap' }}>快捷添加：</span>
          <Space wrap style={{ border: '1px dashed #2e3654', borderRadius: 8, padding: '6px 8px', flex: 1, minWidth: 0 }}>
            {drives.map((d) => (
              <Button key={d} size="small" onClick={() => addRoot(d)}>{d}</Button>
            ))}
            <Button size="small" disabled={!appDataPath} onClick={() => addRoot(appDataPath)}>AppData</Button>
            <Button size="small" onClick={() => addRoot('C:\\ProgramData')}>ProgramData</Button>
            <Button size="small" onClick={() => addRoot('C:\\Windows\\Temp')}>Windows临时</Button>
            <Button size="small" onClick={() => addRoot('C:\\Windows\\SoftwareDistribution\\Download')}>更新缓存</Button>
          </Space>
        </div>
        <Space wrap>
          <Input.TextArea
            value={regexInput}
            onChange={(e) => setRegexInput(e.target.value)}
            placeholder={'自定义正则（每行一个，命中即标为疑似），例：\n\\.log$\ncache'}
            autoSize={{ minRows: 2, maxRows: 4 }}
            style={{ width: 480, fontFamily: 'monospace', fontSize: 12 }}
          />
          <Button type="primary" icon={<PlayCircleOutlined />} loading={scanning} onClick={startScan} style={{ alignSelf: 'flex-start' }}>
            {scanning ? '扫描中…' : '开始扫描'}
          </Button>
        </Space>

        {scanning && progress && <Progress percent={0} status="active" />}
        {scanning && progress && (
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            已扫描 {progress.files} 文件 … {progress.current}
          </Typography.Text>
        )}
      </Space>
      </div>

        {result && (
          <div className="card" style={{ marginTop: 16 }}>
            <Typography.Text style={{ marginRight: 16 }}>
              共命中 <b>{result.totalMB} MB</b>（可删 {((result.byRisk.safe || 0) / 1048576).toFixed(1)} MB / 需确认 {((result.byRisk.warning || 0) / 1048576).toFixed(1)} MB）· {result.filesScanned} 文件 · {result.elapsedSec}s
            </Typography.Text>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { label: `疑似项 (${result.hits.length})`, value: 'hits', icon: <UnorderedListOutlined /> },
                { label: '按规则汇总', value: 'rules', icon: <SearchOutlined /> },
                { label: 'Treemap 视图', value: 'treemap', icon: <AppstoreOutlined /> },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              {tab === 'hits' && (
                <Table rowKey="path" columns={columns} dataSource={result.hits} size="small" pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ y: 520 }} />
              )}
              {tab === 'rules' && (
                <Table rowKey="ruleId" columns={byRuleColumns} dataSource={result.byRule} size="small" pagination={false} />
              )}
              {tab === 'treemap' && (
                <Treemap
                  tree={result.treemap}
                  onOpenPath={(p) => message.info('路径: ' + p)}
                  onAskAI={(p, isDir) => askAI(p, isDir)}
                  onSearch={(p) => search(p)}
                  onAddToList={addFromTreemap}
                />
              )}
            </div>
          </div>
        )}

      <Modal
        title="AI 判断结果"
        open={!!aiModal}
        onCancel={() => setAiModal(null)}
        footer={
          aiModal?.res.ok ? [
            <Button key="cancel" onClick={() => setAiModal(null)}>关闭</Button>,
            <Button key="adopt" type="primary" onClick={adoptAI}>采纳并加入名单</Button>,
          ] : [
            <Button key="close" onClick={() => setAiModal(null)}>关闭</Button>,
          ]
        }
      >
        {aiModal && (
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{aiModal.path}</p>
            {aiModal.res.ok ? (
              <>
                <p>判定：<Tag color={RISK_COLOR[aiModal.res.verdict || 'warning']}>{RISK_LABEL[aiModal.res.verdict || 'warning']}</Tag></p>
                <p>理由：{aiModal.res.reason}</p>
                {aiModal.res.method && <p>建议：{aiModal.res.method}</p>}
              </>
            ) : (
              <p style={{ color: 'red' }}>{aiModal.res.error}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
