import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { AGENT_DEFS, computeStatus } from '../constants.js';

const agentColorMap = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.color]));

function nodeRadius(d) {
  if (d.type === 'definition') return 7;
  if (d.type === 'postulate' || d.type === 'common_notion') return 10;
  return 14;
}

function nodeFill(d) {
  if (d.type === 'definition') return '#374151';
  if (d.type === 'postulate' || d.type === 'common_notion') return '#4b5563';
  return agentColorMap[d.author] || '#9ca3af';
}

function statusColor(d) {
  const s = computeStatus(d);
  if (s === 'axiom') return '#9ca3af';
  if (s === 'accepted') return '#22c55e';
  if (s === 'disputed') return '#ef4444';
  return '#f59e0b';
}

export default function ForceGraph({ graph, selectedNode, onSelectNode, highlightNodes }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const nodeSelRef = useRef(null);

  const { nodes, links } = useMemo(() => {
    const ns = Object.values(graph).map(n => ({ ...n }));
    const ls = [];
    for (const n of ns) {
      for (const cid of (n.cites || [])) {
        if (graph[cid]) ls.push({ source: cid, target: n.id });
      }
    }
    return { nodes: ns, links: ls };
  }, [graph]);

  // Build/update simulation when nodes or links change
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 700;
    const height = svgRef.current.clientHeight || 420;
    svg.selectAll('*').remove();

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20).attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .append('path').attr('d', 'M 0,-5 L 10,0 L 0,5').attr('fill', '#555');

    const g = svg.append('g');

    svg.call(
      d3.zoom().scaleExtent([0.2, 5]).on('zoom', (e) => g.attr('transform', e.transform))
    );

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(d => {
        const src = graph[typeof d.source === 'object' ? d.source.id : d.source];
        if (src && src.type === 'definition') return 40;
        return 80;
      }))
      .force('charge', d3.forceManyBody().strength(d => d.type === 'definition' ? -60 : -200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d.type === 'definition' ? 12 : 25));

    const link = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', '#555')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrowhead)');

    const node = g.append('g').selectAll('g').data(nodes, d => d.id).join('g')
      .call(
        d3.drag()
          .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on('click', (e, d) => { e.stopPropagation(); onSelectNode(d.id); });

    node.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', nodeFill)
      .attr('stroke', statusColor)
      .attr('stroke-width', 2.5)
      .attr('opacity', d => d.type === 'definition' ? 0.7 : 0.92);

    node.append('text')
      .text(d => d.id)
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('font-size', d => d.type === 'definition' ? '7px' : '9px')
      .attr('fill', '#fff').attr('font-weight', '600')
      .attr('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    simRef.current = simulation;
    nodeSelRef.current = node;

    svg.on('click', () => onSelectNode(null));

    return () => simulation.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, links.length]);

  // Update stroke appearance when selectedNode or highlightNodes changes (no rebuild)
  useEffect(() => {
    if (!nodeSelRef.current) return;
    nodeSelRef.current.selectAll('circle')
      .attr('stroke', d => {
        if (highlightNodes && highlightNodes.has(d.id)) return '#ffffff';
        return statusColor(d);
      })
      .attr('stroke-width', d => {
        if (d.id === selectedNode) return 4.5;
        if (highlightNodes && highlightNodes.has(d.id)) return 4;
        return 2.5;
      })
      .attr('opacity', d => {
        if (highlightNodes && highlightNodes.size > 0 && !highlightNodes.has(d.id)) {
          return d.type === 'definition' ? 0.3 : 0.4;
        }
        return d.type === 'definition' ? 0.7 : 0.92;
      });
  }, [selectedNode, highlightNodes]);

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', background: '#111216', borderRadius: 8, cursor: 'crosshair' }}
    />
  );
}
