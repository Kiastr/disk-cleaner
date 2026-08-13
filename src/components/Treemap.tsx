import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { TreemapNode } from '../types';

interface Rect {
  x: number; y: number; w: number; h: number;
  node: TreemapNode; depth: number;
}

function expand(it: TreemapNode): TreemapNode[] {
  if (it.matched || it.children.length === 0) return [it];
  const kids = it.children.filter((c) => c.size > 0);
  const selfSize = it.size - kids.reduce((s, c) => s + c.size, 0);
  const out = [...kids];
  if (selfSize > 0) out.push({ name: '其他', path: it.path, size: selfSize, matched: false, ruleId: null, children: [] });
  return out.sort((a, b) => b.size - a.size);
}

// 正确的最差纵横比：a = size·k·total/s²，aspect = max(a, 1/a)
// k = 矩形长宽比，total = 本层面积和，s = 行面积和
function worst(row: TreemapNode[], k: number, total: number): number {
  const s = row.reduce((a, b) => a + b.size, 0);
  if (s <= 0) return Infinity;
  let wr = 0;
  for (const c of row) {
    const a = (c.size * k * total) / (s * s);
    const aspect = Math.max(a, 1 / a);
    if (aspect > wr) wr = aspect;
  }
  return wr;
}

function leafOrRecurse(it: TreemapNode, x: number, y: number, w: number, h: number, depth: number, out: Rect[], minArea: number) {
  if (w * h < minArea) return;
  const kids = expand(it);
  if (kids.length > 1) squarify(kids, x, y, w, h, depth + 1, out, minArea);
  else out.push({ x, y, w, h, node: it, depth });
}

// squarified treemap
function squarify(items: TreemapNode[], x: number, y: number, w: number, h: number, depth: number, out: Rect[], minArea: number) {
  if (items.length === 0) return;
  if (w * h < minArea) return;

  if (depth >= 6) {
    const sum = items.reduce((s, c) => s + c.size, 0);
    out.push({ x, y, w, h, node: { name: items.length + ' 项', path: items[0]?.path || '', size: sum, matched: false, ruleId: null, children: [] }, depth });
    return;
  }

  if (items.length === 1) {
    leafOrRecurse(items[0], x, y, w, h, depth, out, minArea);
    return;
  }

  const total = items.reduce((s, c) => s + c.size, 0);
  if (total <= 0) return;

  // 合并小项（<2%）
  const big: TreemapNode[] = [];
  const small: TreemapNode[] = [];
  for (const it of items) (it.size >= total * 0.02 ? big : small).push(it);
  const work: TreemapNode[] = big;
  if (small.length > 0) {
    const smallSum = small.reduce((s, c) => s + c.size, 0);
    work.push({ name: small.length + ' 项小文件', path: small[0]?.path || '', size: smallSum, matched: false, ruleId: null, children: [] });
  }
  work.sort((a, b) => b.size - a.size);

  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  const k = longSide / shortSide;
  const horizontal = w >= h;

  // 贪心分行
  const row: TreemapNode[] = [work[0]];
  let i = 1;
  while (i < work.length) {
    if (worst([...row, work[i]], k, total) <= worst(row, k, total)) { row.push(work[i]); i++; } else break;
  }

  const rowSum = row.reduce((s, c) => s + c.size, 0);
  const thickness = (rowSum / total) * (w * h) / longSide;
  let offset = 0;

  if (horizontal) {
    for (const it of row) {
      const cw = (it.size / rowSum) * longSide;
      leafOrRecurse(it, x + offset, y, cw, thickness, depth, out, minArea);
      offset += cw;
    }
    squarify(work.slice(row.length), x, y + thickness, w, h - thickness, depth, out, minArea);
  } else {
    for (const it of row) {
      const ch = (it.size / rowSum) * longSide;
      leafOrRecurse(it, x, y + offset, thickness, ch, depth, out, minArea);
      offset += ch;
    }
    squarify(work.slice(row.length), x + thickness, y, w - thickness, h, depth, out, minArea);
  }
}

function fmtSize(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

const MATCHED_COLORS = ['#c62828', '#d84315', '#ad1457'];
const NORMAL_COLORS = ['#1a5276', '#21618c', '#2e86c1', '#3a7ca5', '#4a90b8'];
const BORDER = '#0b1a2a';

interface Props {
  tree: TreemapNode;
  onOpenPath: (path: string) => void;
  onAskAI: (path: string, isDir: boolean) => void;
  onSearch: (path: string) => void;
  onAddToList: (path: string) => void;
}

export default function Treemap({ tree, onOpenPath, onAskAI, onSearch, onAddToList }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [root, setRoot] = useState<TreemapNode>(tree);
  const [hover, setHover] = useState<{ x: number; y: number; info: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreemapNode } | null>(null);
  const [W, setW] = useState(1000);
  const [H, setH] = useState(600);

  useEffect(() => { setRoot(tree); }, [tree]);

  useEffect(() => {
    const onResize = () => {
      const el = canvasRef.current?.parentElement;
      if (el) setW(el.clientWidth || 1000);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rects = useMemo(() => {
    const out: Rect[] = [];
    const minArea = (W * H) / 8000;
    const roots = tree.children.filter((c) => c.size > 0).sort((a, b) => b.size - a.size);
    squarify(roots, 0, 0, W, H, 0, out, minArea);
    return out;
  }, [root, W, H, tree]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (const r of rects) {
      if (r.w < 1 || r.h < 1) continue;
      const color = r.node.matched
        ? MATCHED_COLORS[r.depth % MATCHED_COLORS.length]
        : NORMAL_COLORS[Math.min(r.depth, NORMAL_COLORS.length - 1)];
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (r.w > 64 && r.h > 24) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        const label = `${r.node.name} · ${fmtSize(r.node.size)}`;
        const tw = ctx.measureText(label).width;
        if (tw < r.w - 8) ctx.fillText(label, r.x + 4, r.y + 16);
      }
    }
  }, [rects, W, H]);

  useEffect(() => { draw(); }, [draw]);

  const hitTest = (mx: number, my: number): Rect | undefined => {
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return undefined;
  };

  const onMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      setHover({
        x: e.clientX - rect.left, y: e.clientY - rect.top,
        info: `${hit.node.path}\n${fmtSize(hit.node.size)}${hit.node.matched ? ' · 已命中规则(' + (hit.node.ruleId || 'custom') + ')' : ''}`,
      });
    } else setHover(null);
  };

  const onClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      if (hit.node.children.length > 0) setRoot(hit.node);
      else onOpenPath(hit.node.path);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      setHover(null);
      setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, node: hit.node });
    } else setMenu(null);
  };

  const isDir = (n: TreemapNode) => n.matched || n.children.length > 0;

  const menuItems = [
    { label: '问 AI', onClick: () => menu && onAskAI(menu.node.path, isDir(menu.node)) },
    { label: '搜索', onClick: () => menu && onSearch(menu.node.path) },
    { label: '加清理名单', onClick: () => menu && onAddToList(menu.node.path) },
  ];

  return (
    <div>
      <div style={{ marginBottom: 10, fontSize: 12, color: '#a8aec9' }}>
        <span style={{ color: '#ff6b6b' }}>■ 已命中规则（疑似垃圾）</span>
        <span style={{ marginLeft: 12, color: '#3f7fd9' }}>■ 正常文件</span>
        <span style={{ marginLeft: 12 }}>当前: {root.path || '根'}</span>
        {root.path && (
          <a style={{ marginLeft: 12, cursor: 'pointer', color: '#8477ff' }} onClick={() => setRoot(tree)}>← 返回根</a>
        )}
        <span style={{ marginLeft: 12, color: '#6b7291' }}>右键块可操作</span>
      </div>

      <div style={{ position: 'relative' }} onClick={() => setMenu(null)}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onMouseMove={onMove}
          onClick={onClick}
          onContextMenu={onContextMenu}
          onMouseLeave={() => setHover(null)}
          style={{ width: '100%', height: H, cursor: 'pointer', borderRadius: 10, background: '#161b2e', border: '1px solid #232a42' }}
        />
        {hover && !menu && (
          <div
            style={{
              position: 'absolute', left: hover.x + 12, top: hover.y + 12,
              background: '#222', color: '#fff', fontSize: 12, padding: '6px 10px',
              borderRadius: 6, maxWidth: 500, whiteSpace: 'pre-wrap', pointerEvents: 'none', zIndex: 10,
            }}
          >
            {hover.info}
          </div>
        )}
        {menu && (
        <div
          onMouseEnter={() => setHover(null)}
          style={{
            position: 'absolute', left: menu.x, top: menu.y,
            background: '#1c2238', border: '1px solid #2a3350', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.45)', zIndex: 20, overflow: 'hidden',
          }}
        >
          <div style={{ padding: '5px 12px', fontSize: 12, color: '#8b93b3', borderBottom: '1px solid #2a3350', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {menu.node.path || menu.node.name}
          </div>
          {menuItems.map((m) => (
            <div
              key={m.label}
              onClick={(e) => { e.stopPropagation(); setMenu(null); m.onClick(); }}
              style={{ padding: '7px 16px', fontSize: 13, cursor: 'pointer', color: '#d8dcf0' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#2a3350')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {m.label}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
