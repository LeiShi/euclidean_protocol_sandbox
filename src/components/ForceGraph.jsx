import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { AGENT_DEFS, computeStatus } from '../constants.js';

const agentColorMap = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a.color]));

function nodeRadius(d) {
  if (d.type === 'definition') return 7;
  if (d.type === 'postulate' || d.type === 'common_notion') return 10;
  if (d.type === 'conjecture') return 12;
  return 14;
}

function nodeFill(d) {
  if (d.type === 'definition') return '#374151';
  if (d.type === 'postulate' || d.type === 'common_notion') return '#4b5563';
  const status = d._status;
  if (status === 'collapsed') return '#27272a';
  return agentColorMap[d.author] || '#9ca3af';
}

function statusStrokeColor(status) {
  if (status === 'axiom') return '#9ca3af';
  if (status === 'accepted' || status === 'proven') return '#22c55e';
  if (status === 'disputed' || status === 'disproven') return '#ef4444';
  if (status === 'conditional') return '#f59e0b';
  if (status === 'open') return '#e4e4e7';
  if (status === 'collapsed') return '#4b5563';
  return '#f59e0b'; // pending
}

function isDashed(status) {
  return status === 'conditional' || status === 'open';
}

/** Compute edge type from source/target node data */
function edgeType(sourceNode, targetId, graph) {
  if (sourceNode.resolves?.includes(targetId)) return 'resolves';
  if (sourceNode.contradicts?.includes(targetId)) return 'contradicts';
  const cited = graph[targetId];
  if (!cited) return 'support';
  if (cited.type === 'conjecture' && cited._status !== 'proven') return 'conditional';
  if (cited.type === 'theorem' && cited._status === 'conditional') return 'conditional';
  return 'support';
}

const EDGE_STYLES = {
  support:     { stroke: '#555', width: 1.5, dashed: false, marker: 'arrowhead' },
  conditional: { stroke: '#f59e0b', width: 1.5, dashed: true, marker: 'arrowhead-amber' },
  resolves:    { stroke: '#22c55e', width: 2.5, dashed: false, marker: 'arrowhead-green' },
  contradicts: { stroke: '#ef4444', width: 2.5, dashed: false, marker: 'arrowhead-red' },
};

export default function ForceGraph({ graph, selectedNode, onSelectNode, highlightNodes }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const nodeSelRef = useRef(null);
  const linkSelRef = useRef(null);

  // Pre-annotate nodes with computed status and graph reference
  const { nodes, links } = useMemo(() => {
    const ns = Object.values(graph).map(n => ({
      ...n,
      _status: computeStatus(n, graph),
    }));
    const graphById = Object.fromEntries(ns.map(n => [n.id, n]));
    const ls = [];
    for (const n of ns) {
      for (const cid of (n.cites || [])) {
        if (graph[cid]) {
          ls.push({ source: cid, target: n.id, _type: edgeType(n, cid, graphById) });
        }
      }
    }
    return { nodes: ns, links: ls };
  }, [graph]);

  // Full rebuild when structure changes
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 700;
    const height = svgRef.current.clientHeight || 420;
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    // Arrow markers for each edge type
    const markerDefs = [
      { id: 'arrowhead',       color: '#555' },
      { id: 'arrowhead-amber', color: '#f59e0b' },
      { id: 'arrowhead-green', color: '#22c55e' },
      { id: 'arrowhead-red',   color: '#ef4444' },
    ];
    for (const m of markerDefs) {
      defs.append('marker')
        .attr('id', m.id)
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 20).attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .append('path').attr('d', 'M 0,-5 L 10,0 L 0,5').attr('fill', m.color);
    }

    const g = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.2, 5]).on('zoom', (e) => g.attr('transform', e.transform)));

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(d => {
        const src = graph[typeof d.source === 'object' ? d.source.id : d.source];
        return src?.type === 'definition' ? 40 : 80;
      }))
      .force('charge', d3.forceManyBody().strength(d => d.type === 'definition' ? -60 : -200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d.type === 'definition' ? 12 : 25));

    const link = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', d => EDGE_STYLES[d._type || 'support'].stroke)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => EDGE_STYLES[d._type || 'support'].width)
      .attr('stroke-dasharray', d => EDGE_STYLES[d._type || 'support'].dashed ? '5,3' : null)
      .attr('marker-end', d => `url(#${EDGE_STYLES[d._type || 'support'].marker})`);

    const node = g.append('g').selectAll('g').data(nodes, d => d.id).join('g')
      .call(
        d3.drag()
          .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on('click', (e, d) => { e.stopPropagation(); onSelectNode(d.id); });

    // Conjecture nodes: diamond shape; others: circle
    node.each(function(d) {
      const sel = d3.select(this);
      if (d.type === 'conjecture') {
        const r = nodeRadius(d);
        sel.append('polygon')
          .attr('points', `0,${-r} ${r},0 0,${r} ${-r},0`)
          .attr('fill', nodeFill(d))
          .attr('stroke', statusStrokeColor(d._status))
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', isDashed(d._status) ? '4,2' : null)
          .attr('opacity', 0.92);
      } else {
        sel.append('circle')
          .attr('r', nodeRadius(d))
          .attr('fill', nodeFill(d))
          .attr('stroke', statusStrokeColor(d._status))
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', isDashed(d._status) ? '4,2' : null)
          .attr('opacity', d.type === 'definition' ? 0.7 : (d._status === 'collapsed' ? 0.3 : 0.92));
      }
    });

    node.append('text')
      .text(d => d.id)
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('font-size', d => d.type === 'definition' ? '7px' : '9px')
      .attr('fill', d => d._status === 'collapsed' ? '#6b7280' : '#fff')
      .attr('font-weight', '600')
      .attr('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    simRef.current = simulation;
    nodeSelRef.current = node;
    linkSelRef.current = link;

    svg.on('click', () => onSelectNode(null));

    return () => simulation.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, links.length]);

  // Update visual state when selectedNode or highlightNodes changes
  useEffect(() => {
    if (!nodeSelRef.current) return;
    nodeSelRef.current.each(function(d) {
      const sel = d3.select(this);
      const isSelected = d.id === selectedNode;
      const isHighlighted = highlightNodes && highlightNodes.has(d.id);
      const strokeColor = isHighlighted ? '#ffffff' : statusStrokeColor(d._status);
      const strokeWidth = isSelected ? 4.5 : (isHighlighted ? 4 : 2.5);
      const opacity = highlightNodes?.size > 0 && !isHighlighted
        ? (d.type === 'definition' ? 0.25 : 0.35)
        : (d.type === 'definition' ? 0.7 : (d._status === 'collapsed' ? 0.3 : 0.92));

      sel.select('circle, polygon')
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('opacity', opacity);
    });
  }, [selectedNode, highlightNodes]);

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', background: '#111216', borderRadius: 8, cursor: 'crosshair' }}
    />
  );
}
