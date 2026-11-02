import { hierarchy, tree as treeLayout, type HierarchyPointNode } from 'd3-hierarchy';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MinusIcon, PlusIcon } from '../icons';
import { SpanLink } from '../SpanLink';
import { countNodes, pathToPosition, type TreeKind, type TreeNode } from '../trees';

const BOX_HEIGHT = 32;
const TAGGED_BOX_HEIGHT = 48;
const ROW_GAP = 32;
const SIBLING_GAP = 14;
const CHAR_WIDTH_EM = 0.62;
const BOX_PADDING = 20;
const MAX_VISIBLE_NODES = 240;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.25;

interface DrawNode extends TreeNode {
  hiddenCount: number;
  children: DrawNode[];
}

interface LegendEntry {
  kind: TreeKind;
  label: string;
}

const LEGENDS: Record<'ast' | 'parse', readonly LegendEntry[]> = {
  ast: [
    { kind: 'structure', label: 'Structure' },
    { kind: 'trigger', label: 'Trigger' },
    { kind: 'condition', label: 'Condition' },
    { kind: 'action', label: 'Action' },
    { kind: 'value', label: 'Value' },
  ],
  parse: [
    { kind: 'rule', label: 'Grammar rule' },
    { kind: 'token', label: 'Token' },
  ],
};

function visibleTree(node: TreeNode, collapsed: ReadonlySet<string>): DrawNode {
  if (collapsed.has(node.id)) return { ...node, hiddenCount: countNodes(node) - 1, children: [] };
  return { ...node, hiddenCount: 0, children: node.children.map((c) => visibleTree(c, collapsed)) };
}

/**
 * Folds anything marked to start folded, then, on a very large tree, folds
 * level by level so that the page opens quickly and the top stays readable.
 */
function initiallyCollapsed(root: TreeNode): Set<string> {
  const collapsed = new Set<string>();
  const walk = (n: TreeNode): void => {
    if (n.startCollapsed) collapsed.add(n.id);
    n.children.forEach(walk);
  };
  walk(root);

  let shown = 0;
  let level: TreeNode[] = [root];
  while (level.length) {
    shown += level.length;
    const next: TreeNode[] = [];
    for (const node of level) {
      if (collapsed.has(node.id)) continue;
      if (shown + next.length + node.children.length > MAX_VISIBLE_NODES && node.children.length) collapsed.add(node.id);
      else next.push(...node.children);
    }
    level = next;
  }
  return collapsed;
}

function rootFontSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

interface TreeViewProps {
  root: TreeNode;
  legend: 'ast' | 'parse';
}

/**
 * A top-down tree: d3-hierarchy gives each node a horizontal position, and depth
 * gives the vertical one. Node boxes are as wide as their labels, so a wide tree
 * scrolls or zooms instead of squashing its text.
 */
export function TreeView({ root, legend }: TreeViewProps) {
  const { setHoverSpan, pickedPosition } = useContext(SpanLink);
  const scroller = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => initiallyCollapsed(root));
  const [zoom, setZoom] = useState(1);
  const [animate, setAnimate] = useState(false);
  const previousRoot = useRef(root);

  // A new tree starts afresh, without the state of the last one.
  if (previousRoot.current !== root) {
    previousRoot.current = root;
    setCollapsed(initiallyCollapsed(root));
  }

  const layout = useMemo(() => {
    const fontPx = rootFontSize() * 0.875;
    const charWidth = fontPx * CHAR_WIDTH_EM;
    const boxWidth = (n: DrawNode): number => {
      const suffix = n.hiddenCount > 0 ? ` +${n.hiddenCount}`.length : 0;
      return Math.max(n.label.length + suffix, n.tag?.length ?? 0) * charWidth + BOX_PADDING;
    };
    const scale = fontPx / 14;
    const tagged = legend === 'parse' || JSON.stringify(root).includes('"tag"');
    const boxHeight = (tagged ? TAGGED_BOX_HEIGHT : BOX_HEIGHT) * scale;
    const rowHeight = boxHeight + ROW_GAP;

    const data = visibleTree(root, collapsed);
    const positioned = treeLayout<DrawNode>()
      .nodeSize([1, rowHeight])
      .separation((a, b) => (boxWidth(a.data) + boxWidth(b.data)) / 2 + SIBLING_GAP)(
        hierarchy<DrawNode>(data, (d) => d.children),
      );
    const nodes = positioned.descendants();
    const left = Math.min(...nodes.map((n) => n.x - boxWidth(n.data) / 2));
    const right = Math.max(...nodes.map((n) => n.x + boxWidth(n.data) / 2));
    const bottom = Math.max(...nodes.map((n) => n.y));
    const margin = 16;
    return {
      nodes, links: positioned.links(), boxWidth, boxHeight, fontPx,
      offsetX: margin - left,
      width: right - left + 2 * margin,
      height: bottom + boxHeight + 2 * margin,
      margin,
    };
  }, [root, collapsed, legend]);

  const rootCentre = layout.nodes[0]!.x + layout.offsetX;

  /** Opens on the root, moved along if needed to show the start of its first open branch. */
  function homeScroll(viewWidth: number): number {
    const centred = rootCentre - viewWidth / 2;
    const branch = layout.nodes.find((n) => n.depth === 1 && n.data.children.length > 0);
    if (!branch) return centred;
    const branchLeft = branch.x + layout.offsetX - layout.boxWidth(branch.data) / 2 - SIBLING_GAP;
    const leftmostShowingRoot = rootCentre - viewWidth + SIBLING_GAP * 6;
    return Math.max(leftmostShowingRoot, Math.min(centred, branchLeft));
  }

  function reset() {
    setZoom(1);
    const element = scroller.current;
    if (element) element.scrollTo({ left: homeScroll(element.clientWidth), top: 0 });
  }

  function fit() {
    const element = scroller.current;
    if (!element) return;
    const best = Math.min(1, element.clientWidth / layout.width, element.clientHeight / layout.height);
    setZoom(Math.max(MIN_ZOOM, best));
    element.scrollTo({ left: 0, top: 0 });
  }

  function zoomBy(factor: number, focusX?: number, focusY?: number) {
    const element = scroller.current;
    if (!element) return;
    setZoom((current) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
      const x = focusX ?? element.clientWidth / 2;
      const y = focusY ?? element.clientHeight / 2;
      const ratio = next / current;
      requestAnimationFrame(() => {
        element.scrollLeft = (element.scrollLeft + x) * ratio - x;
        element.scrollTop = (element.scrollTop + y) * ratio - y;
      });
      return next;
    });
  }

  // Keep the root in view whenever a new tree arrives, including on the toggle.
  useLayoutEffect(() => {
    setAnimate(false);
    setZoom(1);
    const element = scroller.current;
    if (element) element.scrollTo({ left: homeScroll(element.clientWidth), top: 0 });
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
    // Only a new tree should recentre; folding must leave the view where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Pinch or ctrl+wheel zooms. A plain wheel scrolls, as everywhere else.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPan(event: PointerEvent) {
    const element = scroller.current;
    if (!element || (event.target as Element).closest('.tree-node')) return;
    const { clientX, clientY } = event;
    const { scrollLeft, scrollTop } = element;
    const move = (e: PointerEvent) => {
      element.scrollLeft = scrollLeft - (e.clientX - clientX);
      element.scrollTop = scrollTop - (e.clientY - clientY);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      element.classList.remove('is-panning');
    };
    element.classList.add('is-panning');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  }

  // A click in the editor selects the deepest node there, opening its branch.
  const picked = useMemo(() => {
    if (pickedPosition === null) return null;
    const path = pathToPosition(root, pickedPosition);
    return path.length > 1 ? path : null;
  }, [root, pickedPosition]);
  const pickedId = picked?.[picked.length - 1]?.id;

  useEffect(() => {
    if (!picked) return;
    const closed = picked.slice(0, -1).filter((n) => collapsed.has(n.id));
    if (closed.length) {
      const next = new Set(collapsed);
      for (const n of closed) next.delete(n.id);
      setCollapsed(next);
    }
    // Opening branches is a one-off response to the click, not to later folds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  useEffect(() => {
    const element = scroller.current;
    const node = layout.nodes.find((n) => n.data.id === pickedId);
    if (!element || !node) return;
    element.scrollTo({
      left: (node.x + layout.offsetX) * zoom - element.clientWidth / 2,
      top: node.y * zoom - element.clientHeight / 3,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedId, layout]);

  const place = (n: HierarchyPointNode<DrawNode>): { x: number; y: number } =>
    ({ x: n.x + layout.offsetX, y: n.y + layout.margin });

  return (
    <div class="tree-view">
      <div class="toolbar tree-toolbar">
        <button aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}><MinusIcon /></button>
        <span class="toolbar-note tree-zoom" data-testid="tree-zoom">{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}><PlusIcon /></button>
        <button data-testid="tree-fit" onClick={fit}>Fit to view</button>
        <button data-testid="tree-reset" onClick={reset}>Reset</button>
        <ul class="tree-legend" aria-label="Node kinds">
          {LEGENDS[legend].map(({ kind, label }) => (
            <li key={kind}><span class={`tree-swatch kind-${kind}`} /> {label}</li>
          ))}
        </ul>
      </div>
      <div class={`tree-scroll ${animate ? 'is-animated' : ''}`} ref={scroller} data-testid="tree" onPointerDown={startPan}>
        <svg class="tree" width={layout.width * zoom} height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Syntax tree, root at the top">
          {layout.links.map((link) => {
            const from = place(link.source);
            const to = place(link.target);
            const middle = from.y + layout.boxHeight + ROW_GAP / 2;
            return (
              <path key={link.target.data.morphKey} class="tree-link"
                d={`M ${from.x} ${from.y + layout.boxHeight} V ${middle} H ${to.x} V ${to.y}`} />
            );
          })}
          {layout.nodes.map((node) => {
            const { data } = node;
            const width = layout.boxWidth(data);
            const { x, y } = place(node);
            const isLeaf = data.children.length === 0 && data.hiddenCount === 0;
            const classes = [
              'tree-node', `kind-${data.kind}`, data.category && `cat-${data.category}`,
              isLeaf && 'is-leaf', data.id === pickedId && 'is-picked',
            ];
            const hasTag = data.tag !== undefined;
            const lineCentre = layout.boxHeight / 2 + layout.fontPx * 0.35;
            return (
              <g key={data.morphKey} class={classes.filter(Boolean).join(' ')}
                style={{ transform: `translate(${x - width / 2}px, ${y}px)` }}
                data-label={data.label} tabIndex={isLeaf ? undefined : 0}
                role={isLeaf ? undefined : 'button'} aria-expanded={isLeaf ? undefined : data.hiddenCount === 0}
                onClick={isLeaf ? undefined : () => toggle(data.id)}
                onKeyDown={isLeaf ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(data.id); } }}
                onMouseEnter={() => setHoverSpan(data.span ?? null)}
                onMouseLeave={() => setHoverSpan(null)}>
                <rect width={width} height={layout.boxHeight} rx={data.kind === 'value' || data.kind === 'token' ? layout.boxHeight / 2 : 3} />
                <text x={width / 2} y={hasTag ? lineCentre - layout.fontPx * 0.6 : lineCentre} text-anchor="middle">
                  {data.label}
                  {data.hiddenCount > 0 && <tspan class="tree-hidden"> +{data.hiddenCount}</tspan>}
                </text>
                {hasTag && <text class="tree-tag" x={width / 2} y={lineCentre + layout.fontPx * 0.6} text-anchor="middle">{data.tag}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
