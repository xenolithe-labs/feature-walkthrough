/**
 * A node that holds other nodes: a labelled container drawn around them. React Flow draws the
 * children on top of it, at positions relative to it. The handles are invisible, as in a plain
 * box: floating edges do not use them, but an edge is only drawn if both of its ends have some.
 */
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { IconGlyph } from './IconGlyph';
import type { ResolvedIcon } from './icons';
import './groups.css';

export type GroupData = {
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  boundary?: boolean | undefined;
  icon?: ResolvedIcon | undefined;
};

export const GroupNode = memo(function GroupNode({ data }: NodeProps<Node<GroupData>>) {
  return (
    <div className="fw-group" data-tone={data.tone} data-boundary={data.boundary ? '' : undefined}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="fw-group-head">
        {data.icon !== undefined && <IconGlyph icon={data.icon} />}
        <span className="fw-group-label">{data.label}</span>
        {data.sub !== undefined && <span className="fw-group-sub">{data.sub}</span>}
        {data.boundary === true && <span className="fw-group-tag">boundary</span>}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});
