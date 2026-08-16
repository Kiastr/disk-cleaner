import { useMemo, useState } from 'react';
import { Button, Table, Tag, Space, Popconfirm, message, Typography, Empty, Modal, Alert } from 'antd';
import { DeleteOutlined, ClearOutlined, StopOutlined } from '@ant-design/icons';
import type { AppData, CleanItem } from '../types';

const RISK_COLOR: Record<string, string> = { safe: 'green', warning: 'orange', danger: 'red' };
const RISK_LABEL: Record<string, string> = { safe: '可删', warning: '需确认', danger: '勿删' };

export default function CleanListPage({ data, refreshData }: { data: AppData; refreshData: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [results, setResults] = useState<{ path: string; ok: boolean; error?: string }[] | null>(null);

  const doDelete = async (paths: string[]) => {
    setDeleting(true);
    setResults(null);
    try {
      const rs = await window.api.trash(paths);
      setResults(rs);
      const okCount = rs.filter((r) => r.ok).length;
      message.success(`已删除 ${okCount}/${rs.length} 项（走回收站）`);
      // 从名单移除已删成功的
      for (const r of rs) if (r.ok) await window.api.removeFromCleanList(r.path);
      setSelected([]);
      refreshData();
    } catch (e: any) {
      message.error('删除失败: ' + (e.message || e));
    } finally {
      setDeleting(false);
    }
  };

  // 分类筛选：从现有名单动态取分类
  const categoryFilters = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of data.cleanList) {
      const c = i.category || '未分类';
      map.set(c, (map.get(c) || 0) + 1);
    }
    return [...map.entries()].map(([text, n]) => ({ text: `${text}（${n}）`, value: text }));
  }, [data.cleanList]);

  const columns = [
    { title: '路径', dataIndex: 'path', key: 'path', ellipsis: true, render: (p: string) => <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{p}</Typography.Text> },
    { title: '大小', dataIndex: 'sizeMB', key: 'sizeMB', width: 110, defaultSortOrder: 'descend' as const,
      sorter: (a: CleanItem, b: CleanItem) => (a.sizeMB || 0) - (b.sizeMB || 0), render: (m?: number) => (m ? `${m} MB` : '-') },
    { title: '分类', dataIndex: 'category', key: 'category', width: 130, filters: categoryFilters,
      onFilter: (v: any, item: CleanItem) => (item.category || '未分类') === v },
    { title: '风险', dataIndex: 'risk', key: 'risk', width: 90, render: (r: string) => <Tag color={RISK_COLOR[r]}>{RISK_LABEL[r]}</Tag> },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
    {
      title: '操作', key: 'action', width: 180,
      render: (_: any, item: CleanItem) => (
        <Space size={4}>
          <Popconfirm title="确认删除到回收站？" onConfirm={() => doDelete([item.path])}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
          <Button size="small" onClick={() => window.api.removeFromCleanList(item.path).then(refreshData)}>移除</Button>
        </Space>
      ),
    },
  ];

  const wlColumns = [
    { title: '路径', dataIndex: 'path', key: 'path', ellipsis: true, render: (p: string) => <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{p}</Typography.Text> },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
    { title: '操作', key: 'action', width: 100, render: (_: any, item: CleanItem) => <Button size="small" onClick={() => window.api.removeFromWhitelist(item.path).then(refreshData)}>移除</Button> },
  ];

  const totalMB = data.cleanList.reduce((s, i) => s + (i.sizeMB || 0), 0);

  return (
    <div>
      <h1 className="page-title">清理名单</h1>
      <p className="page-desc">勾选要清理的项，删除走回收站可恢复；白名单中的路径永不删除</p>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="默认识别：缓存目录 / 临时目录 / 系统缓存 / 缩略图缓存 四类会在扫描后自动进入名单；日志、崩溃报告、垃圾文件等其他项需在扫描结果中手动「加入名单」。不含浏览器 Cookie 与历史记录。"
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text strong>清理名单（{data.cleanList.length} 项 · 约 {Math.round(totalMB)} MB）</Typography.Text>
        <Button type="primary" danger icon={<DeleteOutlined />} loading={deleting} disabled={selected.length === 0} onClick={() => doDelete(selected)}>
          删除选中 ({selected.length})
        </Button>
        <Popconfirm title="确定删除名单中所有 safe 项？" onConfirm={() => doDelete(data.cleanList.filter((i) => i.risk === 'safe').map((i) => i.path))}>
          <Button danger icon={<ClearOutlined />}>一键清理全部可删项</Button>
        </Popconfirm>
        <Popconfirm title="清空回收站？（不可恢复）" onConfirm={() => message.info('清空回收站需系统 API，本版本暂不支持，请手动清空')}>
          <Button icon={<StopOutlined />}>清空回收站</Button>
        </Popconfirm>
      </Space>

      {data.cleanList.length === 0 ? (
        <Empty description="暂无清理名单项，去「探索清理」页扫描并加入" />
      ) : (
        <Table
          rowKey="path"
          columns={columns}
          dataSource={data.cleanList}
          size="small"
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
          pagination={{ pageSize: 50 }}
          scroll={{ y: 480 }}
        />
      )}

      {results && (
        <Modal title="删除结果" open onCancel={() => setResults(null)} footer={<Button onClick={() => setResults(null)}>关闭</Button>}>
          <ul style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
            {results.map((r) => (
              <li key={r.path} style={{ color: r.ok ? '#333' : '#c00' }}>
                {r.ok ? '✓' : '✗'} {r.path} {r.error && `— ${r.error}`}
              </li>
            ))}
          </ul>
        </Modal>
      )}

      <Typography.Title level={5} style={{ marginTop: 24 }}>白名单（永不删除）</Typography.Title>
      {data.whitelist.length === 0 ? (
        <Typography.Text type="secondary">暂无白名单项</Typography.Text>
      ) : (
        <Table rowKey="path" columns={wlColumns} dataSource={data.whitelist} size="small" pagination={false} />
      )}
    </div>
  );
}
