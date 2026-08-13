export interface TreemapNode {
  name: string;
  path: string;
  size: number;
  matched: boolean;
  ruleId: string | null;
  children: TreemapNode[];
}

export interface RuleRow {
  ruleId: string;
  risk: 'safe' | 'warning' | 'danger';
  category: string;
  description: string;
  count: number;
  sizeMB: number;
  samples: string[];
}

export interface Hit {
  path: string;
  size: number;
  sizeMB: number;
  isDir: boolean;
  ruleId: string;
  risk: 'safe' | 'warning' | 'danger';
  category: string;
}

export interface ScanResult {
  scanTime: string;
  roots: string[];
  filesScanned: number;
  elapsedSec: string;
  totalMB: number;
  byRisk: { safe: number; warning: number; danger: number };
  byRule: RuleRow[];
  hits: Hit[];
  treemap: TreemapNode;
  autoAdded?: number;
}

export interface CleanItem {
  path: string;
  sizeMB?: number;
  category?: string;
  risk?: string;
  note?: string;
  addedAt: string;
}

export interface Settings {
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  searchEngine: string;
  minSizeMB: number;
  externalUninstaller: string;
}

export interface AppData {
  cleanList: CleanItem[];
  whitelist: CleanItem[];
  settings: Settings;
  history: any[];
}

export interface LLMResult {
  ok: boolean;
  verdict?: 'safe' | 'warning' | 'danger';
  reason?: string;
  method?: string;
  error?: string;
}

export interface Program {
  name: string;
  version: string;
  publisher: string;
  uninstallString: string;
  installLocation: string;
  estimatedSizeKB: number;
  icon: string;
  installDate: string;
}

export interface Residue {
  path: string;
  size: number;
  sizeMB: number;
  reason: string;
}

declare global {
  interface Window {
    api: {
      scan: (p: { roots: string[]; customRegexes: string[]; minSizeMB?: number }) => Promise<ScanResult>;
      trash: (paths: string[]) => Promise<{ path: string; ok: boolean; error?: string }[]>;
      askLLM: (p: { targetPath: string; isDir: boolean; samples: string[] }) => Promise<LLMResult>;
      searchWeb: (keyword: string, engine?: string) => Promise<{ opened: string }>;
      sampleDir: (p: string) => Promise<string[]>;
      selectRoots: () => Promise<string[]>;
      getDrives: () => Promise<string[]>;
      getSpecialDirs: () => Promise<{ appData: string }>;
      getData: () => Promise<AppData>;
      getLastScan: () => Promise<ScanResult | null>;
      addToCleanList: (item: CleanItem) => Promise<CleanItem[]>;
      removeFromCleanList: (p: string) => Promise<CleanItem[]>;
      addToWhitelist: (item: CleanItem) => Promise<CleanItem[]>;
      removeFromWhitelist: (p: string) => Promise<CleanItem[]>;
      saveSettings: (s: Partial<Settings>) => Promise<Settings>;
      listPrograms: () => Promise<Program[]>;
      uninstall: (uninstallString: string) => Promise<{ ok: boolean; note?: string; error?: string }>;
      scanResidue: (program: Program) => Promise<Residue[]>;
      scanAllResidue: (programs: Program[]) => Promise<Record<string, { residueSize: number; totalSize: number; installSize: number }>>;
      openExternalUninstaller: () => Promise<{ ok: boolean; note?: string; error?: string }>;
      onProgress: (cb: (d: { files: number; current: string }) => void) => void;
    };
  }
}

export {};
