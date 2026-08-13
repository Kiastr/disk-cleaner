import { useEffect, useState } from 'react';
import { Layout, Menu, ConfigProvider, theme } from 'antd';
import { SearchOutlined, DeleteOutlined, SettingOutlined, CloseCircleOutlined, AppstoreOutlined } from '@ant-design/icons';
import ScanPage from './pages/ScanPage';
import CleanListPage from './pages/CleanListPage';
import SettingsPage from './pages/SettingsPage';
import UninstallPage from './pages/UninstallPage';
import type { AppData } from './types';

const { Sider, Content } = Layout;

export default function App() {
  const [page, setPage] = useState('scan');
  const [data, setData] = useState<AppData>({ cleanList: [], whitelist: [], settings: { llmBaseUrl: '', llmApiKey: '', llmModel: '', searchEngine: 'bing', minSizeMB: 1, externalUninstaller: '' }, history: [] });

  const refreshData = async () => {
    const d = await window.api.getData();
    setData(d);
  };

  useEffect(() => { refreshData(); }, []);

  const items = [
    { key: 'scan', icon: <SearchOutlined />, label: '探索清理' },
    { key: 'cleanlist', icon: <DeleteOutlined />, label: `清理名单 (${data.cleanList.length})` },
    { key: 'uninstall', icon: <CloseCircleOutlined />, label: '卸载程序' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6e63f6',
          borderRadius: 10,
          colorBgBase: '#0e111d',
        },
      }}
    >
      <Layout style={{ height: '100vh', background: '#0e111d' }}>
        <Sider theme="dark" width={216} style={{ background: '#141a2b', borderRight: '1px solid #232a42' }}>
          <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid #232a42' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AppstoreOutlined style={{ fontSize: 22, color: '#6e63f6' }} />
              <div>
                <div style={{ color: '#eef0ff', fontWeight: 600, fontSize: 15, letterSpacing: 0.5 }}>磁盘清理大师</div>
                <div style={{ color: '#8b93b3', fontSize: 11, marginTop: 2 }}>Disk Cleaner</div>
              </div>
            </div>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[page]}
            items={items}
            onClick={(e) => setPage(e.key)}
            style={{ background: 'transparent', border: 'none', padding: '12px 10px' }}
          />
        </Sider>
        <Layout style={{ background: '#0e111d' }}>
          <Content style={{ padding: 20, overflow: 'auto', background: '#0e111d' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              {page === 'scan' && <ScanPage data={data} refreshData={refreshData} />}
              {page === 'cleanlist' && <CleanListPage data={data} refreshData={refreshData} />}
              {page === 'uninstall' && <UninstallPage />}
              {page === 'settings' && <SettingsPage data={data} refreshData={refreshData} />}
            </div>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
