import { hierarchy, tree as treeLayout } from 'd3-hierarchy';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ViewNode } from '../../compiler/index';

const ROW_HEIGHT = 36;
const BOX_HEIGHT = 28;
const CHAR_WIDTH = 6.8;
const COLUMN_GAP = 34;

interface DrawNode extends ViewNode {
  /** Stable address: "0.2.1" is child 1 of child 2 of the root. */
  path: string;
  hiddenCount: number;
}

function countNodes(node: ViewNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function visibleTree(node: ViewNode, path: string, collapsed: ReadonlySet<string>): DrawNode {
  if (collapsed.has(path)) return { ...node, path, hiddenCount: countNodes(node) - 1, children: [] };
  return {
    ...node, path, hiddenCount: 0,
    children: node.children.map((child, i) => visibleTree(child, `${path}.${i}`, collapsed)),
  };
}

/** Paths of the nodes that ask to start folded. */
function initiallyCollapsed(node: ViewNode, path: string, found: Set<string>): Set<string> {
  if (node.startCollapsed) found.add(path);
  node.children.forEach((child, i) => initiallyCollapsed(child, `${path}.${i}`, found));
  return found;
}

function boxWidth(node: DrawNode): number {
  const count = node.hiddenCount > 0 ? ` +${node.hiddenCount}` : '';
  return Math.max(node.label.length + count.length, node.tag?.length ?? 0) * CHAR_WIDTH + 16;
}

/**
 * A collapsible tree drawn left to right. d3-hierarchy assigns each node a row;
 * each depth gets a column as wide as its widest label, so the tree stays narrow
 * enough to read at projector resolution.
 */
export function TreeView({ root }: { root: ViewNode }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => initiallyCollapsed(root, '0', new Set()));

  // A new program brings a new tree, whose folds start afresh.
  useEffect(() => setCollapsed(initiallyCollapsed(root, '0', new Set())), [root]);

  const layout = useMemo(() => {
    const data = visibleTree(root, '0', collapsed);
    const positioned = treeLayout<DrawNode>().nodeSize([ROW_HEIGHT, 1])(
      hierarchy<DrawNode>(data, (d) => d.children as DrawNode[]),
    );
    const nodes = positioned.descendants();

    const columnWidth: number[] = [];
    for (const node of nodes) {
      columnWidth[node.depth] = Math.max(columnWidth[node.depth] ?? 0, boxWidth(node.data));
    }
    const columnX: number[] = [0];
    columnWidth.forEach((width, depth) => { columnX[depth + 1] = columnX[depth]! + width + COLUMN_GAP; });

    const minRow = Math.min(...nodes.map((n) => n.x));
    const maxRow = Math.max(...nodes.map((n) => n.x));
    return {
      nodes,
      links: positioned.links(),
      columnX,
      offsetY: 6 - minRow,
      width: columnX[columnX.length - 1]! + 8,
      height: maxRow - minRow + BOX_HEIGHT + 12,
    };
  }, [root, collapsed]);

  function toggle(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  }

  return (
    <div class="tree-scroll" data-testid="tree">
      <svg class="tree" width={layout.width} height={layout.height}>
        <g transform={`translate(6, ${layout.offsetY})`}>
          {layout.links.map((link, i) => {
            const x1 = layout.columnX[link.source.depth]! + boxWidth(link.source.data);
            const x2 = layout.columnX[link.target.depth]!;
            const y1 = link.source.x + BOX_HEIGHT / 2;
            const y2 = link.target.x + BOX_HEIGHT / 2;
            const middle = x2 - COLUMN_GAP / 2;
            return <path key={i} class="tree-link" d={`M ${x1} ${y1} H ${middle} C ${middle + 8} ${y1}, ${middle + 4} ${y2}, ${x2} ${y2}`} />;
          })}
          {layout.nodes.map((node) => {
            const { data } = node;
            const width = boxWidth(data);
            const isLeaf = data.children.length === 0 && data.hiddenCount === 0;
            return (
              <g key={data.path} class={`tree-node ${isLeaf ? 'is-leaf' : ''}`}
                transform={`translate(${layout.columnX[node.depth]}, ${node.x})`}
                onClick={isLeaf ? undefined : () => toggle(data.path)}>
                <rect width={width} height={BOX_HEIGHT} rx={5} />
                <text x={8} y={data.tag ? 12 : 18}>
                  {data.label}
                  {data.hiddenCount > 0 && <tspan class="tree-hidden"> +{data.hiddenCount}</tspan>}
                </text>
                {data.tag && <text class="tree-tag" x={8} y={23}>{data.tag}</text>}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
