import { useEffect, useState } from 'react';
import { Button, Input, Table, Space, Modal, Typography, message, Tag, Empty, Popconfirm, Checkbox } from 'antd';
import { ReloadOutlined, CloseCircleOutlined, ScanOutlined, DeleteOutlined } from '@ant-design/icons';
import type { Program, Residue } from '../types';

function fmtSizeKB(kb: number): string {
  if (!kb || kb <= 0) return '-';
  if (kb >= 1048576) return (kb / 1048576).toFixed(1) + ' GB';
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
  return kb + ' KB';
}

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

export default function UninstallPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [residueModal, setResidueModal] = useState<{ program: Program; items: Residue[] } | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [residueMap, setResidueMap] = useState<Record<string, { residueSize: number; totalSize: number; installSize: number }> | null>(null);
  const [scanningAll, setScanningAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await window.api.listPrograms();
      setPrograms(list);
      message.success(`已读取 ${list.length} 个已安装程序`);
    } catch (e: any) {
      message.error('读取失败: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openExternal = async () => {
    const r = await window.api.openExternalUninstaller();
    if (r.ok) message.info(r.note || '已打开');
    else message.warning(r.error || '打开失败');
  };

  // 一键扫描所有程序残留，用于判断真实大小（不删除）
  const scanAllResidue = async () => {
    if (programs.length === 0) { message.warning('请先刷新程序列表'); return; }
    setScanningAll(true);
    try {
      const map = await window.api.scanAllResidue(programs);
      setResidueMap(map);
      message.success('残留扫描完成，已按真实大小更新');
    } catch (e: any) {
      message.error('扫描失败: ' + (e.message || e));
    } finally {
      setScanningAll(false);
    }
  };

  const doUninstall = async (p: Program) => {
    const r = await window.api.uninstall(p.uninstallString);
    if (r.ok) message.info(r.note || '已启动卸载');
    else message.error(r.error || '卸载失败');
  };

  const scanResidue = async (p: Program) => {
    const items = await window.api.scanResidue(p);
    setChecked([]); // 默认全不勾选
    setResidueModal({ program: p, items });
  };

  const deleteResidue = async () => {
    if (checked.length === 0) { message.warning('请先勾选要删除的残留项'); return; }
    setDeleting(true);
    try {
      const rs = await window.api.trash(checked);
      const okCount = rs.filter((r) => r.ok).length;
      const blocked = rs.filter((r) => !r.ok);
      message.success(`已删除 ${okCount}/${rs.length} 项（走回收站）`);
      if (blocked.length) message.warning(`${blocked.length} 项被安全门拦截`);
      // 刷新残留
      if (residueModal) {
        const remain = await window.api.scanResidue(residueModal.program);
        setResidueModal({ program: residueModal.program, items: remain });
      }
      setChecked([]);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = keyword ? programs.filter((p) => p.name.toLowerCase().includes(keyword.toLowerCase())) : programs;

  const columns = [
    { title: '程序', dataIndex: 'name', key: 'name', ellipsis: true, render: (n: string) => <Typography.Text strong>{n}</Typography.Text> },
    { title: '版本', dataIndex: 'version', key: 'version', width: 100, ellipsis: true },
    { title: '厂商', dataIndex: 'publisher', key: 'publisher', width: 130, ellipsis: true },
    { title: '安装', dataIndex: 'estimatedSizeKB', key: 'size', width: 85, render: (kb: number) => fmtSizeKB(kb) },
    { title: '残留', key: 'residue', width: 85, render: (_: any, p: Program) => fmtSize(residueMap?.[p.name]?.residueSize || 0) },
    {
      title: '真实大小', key: 'total', width: 105,
      defaultSortOrder: 'descend' as const,
      sorter: (a: Program, b: Program) => (residueMap?.[a.name]?.totalSize || a.estimatedSizeKB * 1024) - (residueMap?.[b.name]?.totalSize || b.estimatedSizeKB * 1024),
      render: (_: any, p: Program) => {
        const t = residueMap?.[p.name]?.totalSize;
        return t ? <Typography.Text strong style={{ color: '#1890ff' }}>{fmtSize(t)}</Typography.Text> : <span>{fmtSizeKB(p.estimatedSizeKB)}</span>;
      },
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, p: Program) => (
        <Space size={4}>
          <Popconfirm title={`确定卸载「${p.name}」？`} description="将启动该程序的卸载向导" onConfirm={() => doUninstall(p)}>
            <Button size="small" icon={<CloseCircleOutlined />}>卸载</Button>
          </Popconfirm>
          <Button size="small" icon={<ScanOutlined />} onClick={() => scanResidue(p)}>扫残留</Button>
        </Space>
      ),
    },
  ];

  const residueColumns = [
    { title: '残留路径', dataIndex: 'path', key: 'path', ellipsis: true, render: (p: string) => <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{p}</Typography.Text> },
    { title: '大小', dataIndex: 'sizeMB', key: 'size', width: 90, render: (m: number) => `${m} MB` },
    { title: '匹配原因', dataIndex: 'reason', key: 'reason', width: 160, render: (r: string) => <Tag>{r}</Tag> },
  ];

  const totalMB = residueModal ? residueModal.items.reduce((s, i) => s + i.sizeMB, 0) : 0;

  return (
    <div>
      <h1 className="page-title">卸载程序</h1>
      <p className="page-desc">列出已安装程序，点「一键扫大小」查看真实占用，卸载后可扫残留（需确认才删）</p>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search placeholder="搜索程序名" allowClear style={{ width: 320 }} onChange={(e) => setKeyword(e.target.value)} />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新列表</Button>
        <Button icon={<ScanOutlined />} loading={scanningAll} onClick={scanAllResidue}>一键扫大小</Button>
        <Button icon={<CloseCircleOutlined />} onClick={openExternal}>调用外部卸载器</Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {programs.length} 个程序</Typography.Text>
      </Space>

      <Table rowKey="name" columns={columns} dataSource={filtered} size="small" loading={loading} pagination={{ pageSize: 50, showSizeChanger: false }} scroll={{ y: 560 }} />

      <Modal
        title={residueModal ? `「${residueModal.program.name}」残留扫描（${residueModal.items.length} 项 · ${Math.round(totalMB)} MB）` : '残留扫描'}
        open={!!residueModal}
        onCancel={() => setResidueModal(null)}
        width={760}
        footer={[
          <Button key="close" onClick={() => setResidueModal(null)}>关闭</Button>,
          <Button key="del" danger icon={<DeleteOutlined />} loading={deleting} disabled={checked.length === 0} onClick={deleteResidue}>
            删除勾选 ({checked.length})
          </Button>,
        ]}
      >
        {residueModal && residueModal.items.length === 0 ? (
          <Empty description="未发现残留（可能已卸载干净）" />
        ) : (
          <>
            <Typography.Paragraph type="warning" style={{ fontSize: 12 }}>
              以下为疑似残留，<b>默认全不勾选</b>，请核对路径后再勾选删除。删除走回收站，可恢复。
            </Typography.Paragraph>
            <Table
              rowKey="path"
              columns={residueColumns}
              dataSource={residueModal?.items}
              size="small"
              pagination={false}
              scroll={{ y: 380 }}
              rowSelection={{
                selectedRowKeys: checked,
                onChange: (keys) => setChecked(keys as string[]),
              }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
