import { it } from 'vitest';
import { layout } from '../../src/panels/_diagram/layout';

it('probe', async () => {
  const n = (id: string, parent?: string, extra = {}) => ({
    id,
    width: 120,
    height: 40,
    parent,
    ...extra,
  });
  const nodes = [
    n('vpc'),
    n('a', 'vpc'),
    n('b', 'vpc'),
    n('x', 'a'),
    n('y', 'b'),
    n('z'),
    n('m', 'a', { parents: ['a', 'b'] }),
  ];
  const edges = [
    { id: 'z.x', source: 'z', target: 'x' },
    { id: 'x.y', source: 'x', target: 'y' },
    { id: 'z.vpc', source: 'z', target: 'vpc' },
    { id: 'vpc.x', source: 'vpc', target: 'x' },
    { id: 'x.m', source: 'x', target: 'm' },
  ];
  console.log(JSON.stringify(await layout(nodes, edges, 'RIGHT')));
});
