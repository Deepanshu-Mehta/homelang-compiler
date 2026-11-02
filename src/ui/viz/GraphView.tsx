import cytoscape, { type ElementDefinition } from 'cytoscape';
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
function graphStyle(fontPx: number) {
  const [ink, sheet, graphite, film] = [token('--ink'), token('--sheet'), token('--edge-plain'), token('--film')];
  const [green, red, error] = [token('--edge-true'), token('--edge-false'), token('--error')];
  const font = token('--font-code');
  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle', 'background-color': sheet, 'border-color': ink, 'border-width': 1.5,
        label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
        'font-family': font, 'font-size': fontPx, color: ink, width: 'label', height: 'label', padding: '10px',
      },
    },
    { selector: 'node.bad', style: { 'border-color': error, 'border-width': 3 } },
    {
      selector: 'edge',
      style: {
        width: 1.5, 'line-color': graphite, 'target-arrow-color': graphite, 'target-arrow-shape': 'triangle',
        'curve-style': 'bezier', label: 'data(label)', 'font-size': fontPx, color: ink, 'font-family': font,
        'text-background-color': film, 'text-background-opacity': 1, 'text-background-padding': '2px',
      },
    },
    { selector: 'edge.green', style: { 'line-color': green, 'target-arrow-color': green, width: 2 } },
    { selector: 'edge.red', style: { 'line-color': red, 'target-arrow-color': red, width: 2 } },
    { selector: 'edge.dashed', style: { 'line-style': 'dashed' } },
  ];
}

const PADDING = 24;

/**
 * A top-to-bottom node-link diagram, laid out by dagre. It always draws at true
 * size so that no label shrinks: the box takes the graph's height, and a graph
 * wider than the page scrolls sideways.
 */
export function GraphView({ nodes, edges }: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current!;
    const fontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.875;
    const elements: ElementDefinition[] = [
      ...nodes.map((n) => ({ data: { id: n.id, label: n.label }, classes: n.tone ?? '' })),
      ...edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.from, target: e.to, label: e.label ?? '' },
        classes: e.tone ?? '',
      })),
    ];
    const graph = cytoscape({
      container: element,
      elements,
      style: graphStyle(fontPx) as cytoscape.StylesheetJson,
      layout: { name: 'dagre', rankDir: 'TB', nodeSep: 40, rankSep: 56, fit: false } as cytoscape.LayoutOptions,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
    });
    const box = graph.elements().boundingBox();
    element.style.height = `${box.h + 2 * PADDING}px`;
    element.style.minWidth = `${box.w + 2 * PADDING}px`;
    graph.resize();
    graph.zoom(1);
    graph.pan({
      x: Math.max(PADDING, (element.clientWidth - box.w) / 2) - box.x1,
      y: PADDING - box.y1,
    });
    return () => graph.destroy();
  }, [nodes, edges]);

  return (
    <div class="graph-scroll">
      <div class="graph" ref={host} data-testid="graph" />
    </div>
  );
}
