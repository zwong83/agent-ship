import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { FlowStage } from './api';
import { dependencyIssue } from './workflow-model';

export function useWorkflowConnection(stages: FlowStage[], onConnect?: (source: string, target: string) => void) {
  const svg = useRef<SVGSVGElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const pointer = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);

  function cancel() {
    setSourceId(null); setPoint(null); setHoverId(null); setDragging(false); pointer.current = null;
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!sourceId) return;
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [sourceId]);

  useEffect(() => {
    if (!onConnect || (sourceId && !stages.some(stage => stage.nodes.some(node => node.id === sourceId)))) cancel();
  }, [onConnect, sourceId, stages]);

  function updatePoint(x: number, y: number) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    const local = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    setPoint({ x: local.x, y: local.y });
    const port = document.elementFromPoint(x, y)?.closest('[data-input-node]');
    setHoverId(port && svg.current?.contains(port) ? port.getAttribute('data-input-node') : null);
  }

  // Continue scrolling while a dragged cable is held near the network's edge.
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    function tick() {
      const current = pointer.current;
      const element = scroller.current;
      if (current?.moved && element) {
        const bounds = element.getBoundingClientRect();
        const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
        const direction = current.y < top + 20 ? -1 : current.y > bottom - 20 ? 1 : 0;
        if (direction && current.x >= bounds.left && current.x <= bounds.right) {
          element.scrollTop += direction * 7;
          updatePoint(current.x, current.y);
        }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  function finish(targetId: string) {
    if (!sourceId || !onConnect) return;
    const issue = dependencyIssue(stages, sourceId, targetId);
    if (!issue) onConnect(sourceId, targetId);
    const nodes = stages.flatMap(stage => stage.nodes);
    setNotice({ text: issue ?? `${nodes.find(node => node.id === sourceId)?.name} → ${nodes.find(node => node.id === targetId)?.name} connected. Save the workflow to apply.`, error: Boolean(issue) });
    cancel();
  }

  function startDrag(event: PointerEvent<SVGGElement>, id: string) {
    if (!onConnect || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    suppressClickUntil.current = 0;
    pointer.current = { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
    setSourceId(id); setDragging(true); setPoint(null); setNotice(null);
    svg.current?.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const current = pointer.current;
    if (!current) return;
    current.x = event.clientX; current.y = event.clientY;
    current.moved ||= Math.hypot(current.x - current.startX, current.y - current.startY) > 5;
    if (current.moved) updatePoint(current.x, current.y);
  }

  function release(event: PointerEvent<SVGSVGElement>) {
    const current = pointer.current;
    if (!current) return;
    svg.current?.releasePointerCapture(event.pointerId);
    pointer.current = null; setDragging(false);
    if (current.moved) {
      suppressClickUntil.current = Date.now() + 250;
      const port = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-input-node]');
      const target = port && svg.current?.contains(port) ? port.getAttribute('data-input-node') : null;
      if (target) finish(target);
      else cancel();
    }
  }

  function chooseOutput(id: string) {
    if (Date.now() < suppressClickUntil.current) return;
    setSourceId(id); setPoint(null); setNotice(null);
  }

  return { svg, scroller, sourceId, point, hoverId, notice, cancel, finish, startDrag, move, release, chooseOutput, dismiss: () => setNotice(null) };
}
