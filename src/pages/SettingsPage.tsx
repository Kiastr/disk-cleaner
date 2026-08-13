import { useState } from 'react';
import { Form, Input, Select, InputNumber, Button, message, Typography, Space } from 'antd';
import type { AppData } from '../types';

export default function SettingsPage({ data, refreshData }: { data: AppData; refreshData: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const v = form.getFieldsValue();
    setSaving(true);
    try {
      await window.api.saveSettings(v);
      refreshData();
      message.success('已保存');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 className="page-title">设置</h1>
      <p className="page-desc">配置 AI 接口、搜索引擎与外部卸载器</p>
      <Form
        form={form}
        layout="vertical"
        initialValues={data.settings}
        onFinish={save}
      >
        <Typography.Title level={5}>LLM 配置（用于「LLM 询问」按钮）</Typography.Title>
        <Form.Item name="llmBaseUrl" label="API Base URL（OpenAI 兼容）">
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item name="llmApiKey" label="API Key">
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Form.Item name="llmModel" label="模型名">
          <Input placeholder="gpt-4o-mini / deepseek-chat 等" />
        </Form.Item>

        <Typography.Title level={5}>搜索配置</Typography.Title>
        <Form.Item name="searchEngine" label="「联网搜索」使用的搜索引擎">
          <Select
            options={[
              { value: 'bing', label: '必应 Bing' },
              { value: 'baidu', label: '百度' },
              { value: 'google', label: 'Google' },
            ]}
          />
        </Form.Item>

        <Typography.Title level={5}>扫描配置</Typography.Title>
        <Form.Item name="minSizeMB" label="最小记录大小（MB，小于此值不记录）">
          <InputNumber min={0} max={1024} />
        </Form.Item>

        <Typography.Title level={5}>外部卸载器</Typography.Title>
        <Form.Item name="externalUninstaller" label="外部卸载器 exe 路径（如 IObit Uninstaller，卸载页点「调用外部卸载器」启动）">
          <Input placeholder="例如 D:\IObit Uninstaler\IObitUninstaller.exe" />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
        </Space>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 32, fontSize: 12 }}>
        磁盘清理大师 · 作者邮箱：<a href="mailto:2652816003@qq.com">2652816003@qq.com</a>
      </Typography.Paragraph>
    </div>
  );
}
