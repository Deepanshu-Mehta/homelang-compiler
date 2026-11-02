import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useEffect, useRef } from 'preact/hooks';

cytoscape.use(dagre);

export interface GraphNode {
  id: string;
  label: string;
  tone?: 'bad';
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  tone?: 'green' | 'red' | 'dashed';
}

const COLORS = { ink: '#1f1e1d', edge: '#8b8880', card: '#fffefb', red: '#b3261e', green: '#2f7d4f' };

const STYLE = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle', 'background-color': COLORS.card, 'border-color': COLORS.ink, 'border-width': 1,
      label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
      'font-family': 'JetBrains Mono, monospace', 'font-size': 11, color: COLORS.ink,
      width: 'label', height: 'label', padding: '9px',
    },
  },
  { selector: 'node.bad', style: { 'border-color': COLORS.red, 'border-width': 2, color: COLORS.red } },
  {
    selector: 'edge',
    style: {
      width: 1.3, 'line-color': COLORS.edge, 'target-arrow-color': COLORS.edge, 'target-arrow-shape': 'triangle',
      'curve-style': 'bezier', label: 'data(label)', 'font-size': 9, color: COLORS.ink,
      'font-family': 'JetBrains Mono, monospace', 'text-background-color': '#faf9f5', 'text-background-opacity': 1,
      'text-background-padding': '1px',
    },
  },
  { selector: 'edge.green', style: { 'line-color': COLORS.green, 'target-arrow-color': COLORS.green } },
  { selector: 'edge.red', style: { 'line-color': COLORS.red, 'target-arrow-color': COLORS.red, width: 2 } },
  { selector: 'edge.dashed', style: { 'line-style': 'dashed' } },
];

/** A node-link diagram, laid out by dagre, for the CFG and the rule graph. */
export function GraphView({ nodes, edges, height = 260 }: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; height?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elements: ElementDefinition[] = [
      ...nodes.map((n) => ({ data: { id: n.id, label: n.label }, classes: n.tone ?? '' })),
      ...edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.from, target: e.to, label: e.label ?? '' },
        classes: e.tone ?? '',
      })),
    ];
    const graph: Core = cytoscape({
      container: host.current,
      elements,
      style: STYLE as cytoscape.StylesheetJson,
      layout: { name: 'dagre', rankDir: 'TB', nodeSep: 30, rankSep: 40 } as cytoscape.LayoutOptions,
      userZoomingEnabled: false,
      autoungrabify: true,
    });
    return () => graph.destroy();
  }, [nodes, edges]);

  return <div class="graph" ref={host} style={{ height: `${height}px` }} data-testid="graph" />;
}
