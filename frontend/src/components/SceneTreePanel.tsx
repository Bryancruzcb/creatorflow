import {
  Box,
  Boxes,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { SceneTreeNode } from './HeavyAssetViewer';

const ROW_HEIGHT = 38;
const VIEWPORT_HEIGHT = 342;
const OVERSCAN_ROWS = 5;

interface SceneTreePanelProps {
  nodes: SceneTreeNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

interface IndexedSceneNode {
  id: string;
  name: string;
  kind: string;
  depth: number;
  childCount: number;
  matchCount: number;
  triangleCount?: number;
  parentId: string | null;
  ancestorIds: string[];
}

function readNode(source: SceneTreeNode) {
  return {
    id: source.id,
    name: source.name || 'Unnamed node',
    kind: source.type,
    depth: Math.max(0, source.depth),
    childCount: Math.max(0, source.childCount),
    matchCount: Math.max(0, source.matchCount),
    triangleCount: Number.isFinite(source.triangleCount)
      ? Math.max(0, source.triangleCount ?? 0)
      : undefined,
    parentId: source.parentId ?? null,
  };
}

function formatTriangles(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m tris`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k tris`;
  return `${count} tris`;
}

function focusTreeRow(nodeId: string) {
  requestAnimationFrame(() => {
    document.getElementById(`scene-tree-node-${nodeId}`)?.focus({ preventScroll: true });
  });
}

export function SceneTreePanel({ nodes, selectedNodeId, onSelectNode }: SceneTreePanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);

  const indexedNodes = useMemo<IndexedSceneNode[]>(() => {
    const records = nodes.map(readNode);
    const byId = new Map(records.map((node) => [node.id, node]));
    return records.map((node) => {
      const ancestorIds: string[] = [];
      let parentId = node.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        ancestorIds.unshift(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return { ...node, ancestorIds };
    });
  }, [nodes]);

  useEffect(() => {
    setExpandedIds((current) => {
      const availableIds = new Set(indexedNodes.map((node) => node.id));
      const preserved = new Set(Array.from(current).filter((id) => availableIds.has(id)));
      if (preserved.size > 0) return preserved;
      return new Set(
        indexedNodes
          .filter((node) => node.childCount > 0 && node.depth < 2)
          .map((node) => node.id),
      );
    });
  }, [indexedNodes]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const selected = indexedNodes.find((node) => node.id === selectedNodeId);
    if (!selected?.ancestorIds.length) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      selected.ancestorIds.forEach((id) => next.add(id));
      return next;
    });
  }, [indexedNodes, selectedNodeId]);

  const visibleNodes = useMemo(() => {
    if (deferredQuery) {
      const matchingIds = new Set<string>();
      indexedNodes.forEach((node) => {
        if (`${node.name} ${node.kind}`.toLocaleLowerCase().includes(deferredQuery)) {
          matchingIds.add(node.id);
          node.ancestorIds.forEach((id) => matchingIds.add(id));
        }
      });
      return indexedNodes.filter((node) => matchingIds.has(node.id));
    }

    return indexedNodes.filter((node) => (
      node.ancestorIds.every((ancestorId) => expandedIds.has(ancestorId))
    ));
  }, [deferredQuery, expandedIds, indexedNodes]);

  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [deferredQuery]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const endIndex = Math.min(
    visibleNodes.length,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const renderedNodes = visibleNodes.slice(startIndex, endIndex);
  const hasVisibleSelection = visibleNodes.some((node) => node.id === selectedNodeId);

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const moveFocus = useCallback((index: number) => {
    const boundedIndex = Math.min(Math.max(index, 0), visibleNodes.length - 1);
    const next = visibleNodes[boundedIndex];
    if (!next) return;
    const viewport = viewportRef.current;
    if (viewport) {
      const top = boundedIndex * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + VIEWPORT_HEIGHT) {
        viewport.scrollTop = bottom - VIEWPORT_HEIGHT;
      }
    }
    focusTreeRow(next.id);
  }, [visibleNodes]);

  const handleRowKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, node: IndexedSceneNode, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveFocus(visibleNodes.length - 1);
    } else if (event.key === 'ArrowRight' && node.childCount > 0) {
      event.preventDefault();
      if (!expandedIds.has(node.id)) toggleExpanded(node.id);
      else moveFocus(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (node.childCount > 0 && expandedIds.has(node.id)) toggleExpanded(node.id);
      else if (node.parentId) {
        const parentIndex = visibleNodes.findIndex((candidate) => candidate.id === node.parentId);
        if (parentIndex >= 0) moveFocus(parentIndex);
      }
    }
  }, [expandedIds, moveFocus, toggleExpanded, visibleNodes]);

  const matchedNodeCount = deferredQuery
    ? indexedNodes.filter((node) => `${node.name} ${node.kind}`.toLocaleLowerCase().includes(deferredQuery)).length
    : indexedNodes.length;

  return (
    <section className="scene-tree-panel" aria-labelledby="scene-tree-title">
      <header className="scene-tree-header">
        <div>
          <span id="scene-tree-title">Scene tree</span>
          <strong>{indexedNodes.length.toLocaleString()} nodes</strong>
        </div>
        <span className="scene-tree-result-count" aria-live="polite">
          {deferredQuery ? `${matchedNodeCount} found` : `${visibleNodes.length} visible`}
        </span>
      </header>

      <label className="scene-tree-search">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">Search scene nodes</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find mesh or group…"
          autoComplete="off"
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear scene search">
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
      </label>

      <div
        ref={viewportRef}
        className="scene-tree-viewport"
        role="tree"
        aria-label="GLB scene hierarchy"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}
      >
        {visibleNodes.length ? (
          <div className="scene-tree-spacer" style={{ height: visibleNodes.length * ROW_HEIGHT, position: 'relative' }}>
            <div
              className="scene-tree-window"
              style={{ position: 'absolute', insetInline: 0, top: startIndex * ROW_HEIGHT }}
            >
              {renderedNodes.map((node, windowIndex) => {
                const absoluteIndex = startIndex + windowIndex;
                const isSelected = node.id === selectedNodeId;
                const isExpanded = node.childCount > 0 && (deferredQuery ? true : expandedIds.has(node.id));
                const isMesh = node.kind.toLocaleLowerCase().includes('mesh');
                return (
                  <div
                    className={`scene-tree-row${isSelected ? ' selected' : ''}`}
                    key={node.id}
                    role="treeitem"
                    aria-level={node.depth + 1}
                    aria-selected={isSelected}
                    aria-expanded={node.childCount > 0 ? isExpanded : undefined}
                    style={{ height: ROW_HEIGHT, paddingInlineStart: `${10 + node.depth * 17}px` }}
                  >
                    {node.childCount > 0 ? (
                      <button
                        className="scene-tree-toggle"
                        type="button"
                        onClick={() => toggleExpanded(node.id)}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
                        disabled={Boolean(deferredQuery)}
                      >
                        <ChevronRight size={13} aria-hidden="true" className={isExpanded ? 'expanded' : ''} />
                      </button>
                    ) : <span className="scene-tree-toggle-placeholder" aria-hidden="true" />}

                    <button
                      id={`scene-tree-node-${node.id}`}
                      className="scene-tree-node"
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, node, absoluteIndex)}
                      tabIndex={isSelected || (!hasVisibleSelection && absoluteIndex === 0) ? 0 : -1}
                      title={node.name}
                    >
                      <span className={`scene-tree-kind kind-${isMesh ? 'mesh' : 'group'}`} aria-hidden="true">
                        {isMesh ? <Box size={13} /> : <Boxes size={13} />}
                      </span>
                      <span className="scene-tree-name">{node.name}</span>
                      {node.triangleCount !== undefined ? (
                        <small className="scene-tree-triangles">{formatTriangles(node.triangleCount)}</small>
                      ) : null}
                      {node.matchCount > 0 ? (
                        <span
                          className="scene-tree-match-count"
                          aria-label={`${node.matchCount} similarity ${node.matchCount === 1 ? 'match' : 'matches'}`}
                          title={`${node.matchCount} similarity ${node.matchCount === 1 ? 'match' : 'matches'}`}
                        >
                          {node.matchCount}
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="scene-tree-empty">
            <Search size={17} aria-hidden="true" />
            <strong>{indexedNodes.length ? 'No nodes found' : 'No scene hierarchy'}</strong>
            <span>{indexedNodes.length ? 'Try a shorter mesh or group name.' : 'Load a GLB to inspect its component tree.'}</span>
          </div>
        )}
      </div>

      <footer className="scene-tree-help">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>←</kbd><kbd>→</kbd> collapse / expand</span>
      </footer>
    </section>
  );
}
