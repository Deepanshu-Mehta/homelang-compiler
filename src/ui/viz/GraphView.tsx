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

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Cytoscape takes plain values, so the design tokens are read when it draws. */
function graphStyle() {
  const [ink, sheet, graphite, film] = [token('--ink'), token('--sheet'), token('--edge-plain'), token('--film')];
  const [green, red, error] = [token('--edge-true'), token('--edge-false'), token('--error')];
  const font = token('--font-code');
  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle', 'background-color': sheet, 'border-color': ink, 'border-width': 1.5,
        label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
        'font-family': font, 'font-size': 14, color: ink, width: 'label', height: 'label', padding: '10px',
      },
    },
    { selector: 'node.bad', style: { 'border-color': error, 'border-width': 3 } },
    {
      selector: 'edge',
      style: {
        width: 1.5, 'line-color': graphite, 'target-arrow-color': graphite, 'target-arrow-shape': 'triangle',
        'curve-style': 'bezier', label: 'data(label)', 'font-size': 14, color: ink, 'font-family': font,
        'text-background-color': film, 'text-background-opacity': 1, 'text-background-padding': '2px',
      },
    },
    { selector: 'edge.green', style: { 'line-color': green, 'target-arrow-color': green, width: 2 } },
    { selector: 'edge.red', style: { 'line-color': red, 'target-arrow-color': red, width: 2 } },
    { selector: 'edge.dashed', style: { 'line-style': 'dashed' } },
  ];
}

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
      style: graphStyle() as cytoscape.StylesheetJson,
      layout: { name: 'dagre', rankDir: 'TB', nodeSep: 30, rankSep: 40 } as cytoscape.LayoutOptions,
      userZoomingEnabled: false,
      autoungrabify: true,
    });
    return () => graph.destroy();
  }, [nodes, edges]);

  return <div class="graph" ref={host} style={{ height: `${height}px` }} data-testid="graph" />;
}
