import { describe, expect, it } from 'vitest';
import { routeOrthogonal } from '../../src/panels/_diagram/ortho';
import { GRID_GAP, gridLayout, resolveCells } from '../../src/panels/_diagram/place';
import {
  flatten,
  headPoints,
  pathOf,
  pointAlong,
  polylineCrossings,
  polylineHitsRect,
  reversed,
  segmentHitsRect,
  tidy,
  withHead,
} from '../../src/panels/_diagram/route';

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

describe('route geometry', () => {
  it('joins right-angle points with rounded corners and ends exactly at the last point', () => {
    const d = pathOf(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      'orthogonal',
    );
    expect(d).toBe('M0,0 L91,0 Q100,0 100,9 L100,100');
  });

  it('never rounds more than half a segment', () => {
    const d = pathOf(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      'orthogonal',
      9,
    );
    expect(d).toContain('L5,0 Q10,0 10,5');
  });

  it('draws a smooth curve through every point, and a cubic from four', () => {
    const through = pathOf(
      [
        { x: 0, y: 0 },
        { x: 50, y: 40 },
        { x: 100, y: 0 },
      ],
      'curved',
    );
    expect(through.match(/C/g)).toHaveLength(2);
    expect(
      pathOf(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 10 },
          { x: 30, y: 10 },
        ],
        'bezier',
      ),
    ).toBe('M0,0 C10,0 20,10 30,10');
  });

  it('puts the arrowhead on the last segment and stops the line where the head starts', () => {
    const got = withHead(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      10,
    )!;
    expect(got.head.tip).toEqual({ x: 100, y: 100 });
    expect([got.head.ux, got.head.uy]).toEqual([1, 0]);
    expect(got.line.at(-1)).toEqual({ x: 90, y: 100 });
    const corners = headPoints(got.head).split(' ');
    expect(corners[0]).toBe('100,100');
  });

  it('tests a segment against the inside of a rectangle only', () => {
    const r = box(10, 10);
    expect(segmentHitsRect({ x: 0, y: 30 }, { x: 200, y: 30 }, r)).toBe(true);
    // Along the border or beside it is not through it.
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 200, y: 10 }, r)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 5 }, { x: 200, y: 5 }, r)).toBe(false);
    expect(
      polylineHitsRect(
        [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 60 },
        ],
        r,
      ),
    ).toBe(true);
  });

  it('counts proper crossings between polylines and samples curves', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    const b = [
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(polylineCrossings(a, b)).toBe(1);
    expect(
      polylineCrossings(a, [
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ).toBe(0);
    expect(
      flatten(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 9 },
          { x: 10, y: 9 },
        ],
        'bezier',
      ),
    ).toHaveLength(17);
    expect(
      pointAlong(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        0.5,
      ),
    ).toEqual({ x: 5, y: 0 });
    expect(
      reversed([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ])[0],
    ).toEqual({ x: 2, y: 2 });
    expect(
      tidy([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toHaveLength(2);
  });
});

describe('grid placement', () => {
  const n = (id: string, extra: object = {}) => ({ id, width: 100, height: 40, ...extra });

  it('derives column widths and row heights from the nodes in them', () => {
    const grid = gridLayout(
      [
        n('a', { cell: [0, 0], width: 200 }),
        n('b', { cell: [1, 0] }),
        n('c', { cell: [0, 1], height: 80 }),
      ],
      [],
      'RIGHT',
    );
    expect(grid.positions.b!.x).toBe(200 + GRID_GAP.x);
    expect(grid.positions.c!.y).toBe(40 + GRID_GAP.y);
    // A narrower node is centred in the wider column.
    expect(grid.positions.c!.x).toBe(50);
    expect(grid.width).toBe(200 + GRID_GAP.x + 100);
  });

  it('cell numbers only order: empty columns take no room, and base 0 or 1 is the same picture', () => {
    const from0 = gridLayout([n('a', { cell: [0, 0] }), n('b', { cell: [1, 1] })], [], 'RIGHT');
    const from1 = gridLayout([n('a', { cell: [1, 1] }), n('b', { cell: [2, 2] })], [], 'RIGHT');
    const gap = gridLayout([n('a', { cell: [0, 0] }), n('b', { cell: [9, 9] })], [], 'RIGHT');
    expect(from1.positions).toEqual(from0.positions);
    expect(gap.positions).toEqual(from0.positions);
  });

  it('resolves rightOf, below and alignWith to cells', () => {
    const { cells, problems } = resolveCells(
      [
        n('a', { cell: [2, 3] }),
        n('b', { rightOf: 'a' }),
        n('c', { below: 'a' }),
        n('d', { rightOf: 'a', below: 'c' }),
        n('e', { alignWith: 'a' }),
      ],
      [],
      'RIGHT',
    );
    expect(problems).toEqual([]);
    expect(cells.get('b')).toMatchObject({ col: 3, row: 3 });
    expect(cells.get('c')).toMatchObject({ col: 2, row: 4 });
    expect(cells.get('d')).toMatchObject({ col: 3, row: 5 });
    // Same row as a; the column is the first free one.
    expect(cells.get('e')!.row).toBe(3);
  });

  it('takes a span, and moves a node out of a cell that is already held, saying so', () => {
    const { cells, problems } = resolveCells(
      [n('a', { cell: [0, 0], span: [2, 1] }), n('b', { cell: [1, 0] })],
      [],
      'RIGHT',
    );
    expect(cells.get('b')).toMatchObject({ col: 1, row: 1 });
    expect(problems.map((p) => p.rule)).toEqual(['cell-taken']);
    expect(problems[0]!.other).toBe('a');
  });

  it('finds a cycle, and a name that is not a sibling', () => {
    const cycle = resolveCells([n('a', { rightOf: 'b' }), n('b', { rightOf: 'a' })], [], 'RIGHT');
    expect(cycle.problems.map((p) => p.rule)).toEqual(['placement-cycle', 'placement-cycle']);
    const lost = resolveCells([n('a', { below: 'zz' })], [], 'RIGHT');
    expect(lost.problems.map((p) => p.rule)).toEqual(['unknown-anchor']);
  });

  it('puts a node with no cell one column past its predecessor, in the first free cell', () => {
    const { cells } = resolveCells(
      [n('a', { cell: [0, 0] }), n('b'), n('c'), n('x', { cell: [1, 0] })],
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
      'RIGHT',
    );
    // x holds [1, 0], so b and c stack in column 1 below it.
    expect(cells.get('b')).toMatchObject({ col: 1, row: 1 });
    expect(cells.get('c')).toMatchObject({ col: 1, row: 2 });
  });

  it('runs downward when asked: layers are rows', () => {
    const { cells } = resolveCells(
      [n('a', { cell: [0, 0] }), n('b')],
      [{ source: 'a', target: 'b' }],
      'DOWN',
    );
    expect(cells.get('b')).toMatchObject({ col: 0, row: 1 });
  });
});

describe('the right-angle router', () => {
  const boxes = new Map([
    ['a', box(0, 100)],
    ['b', box(300, 100)],
    ['wall', box(150, 60, 100, 120)],
    ['c', box(300, 300)],
  ]);

  it('goes round a node that is in the way, in right angles, and never through one', () => {
    const routes = routeOrthogonal(
      boxes,
      ['a', 'b', 'wall', 'c'],
      [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'ac', from: 'a', to: 'c' },
      ],
    );
    for (const id of ['ab', 'ac']) {
      const points = routes.get(id)!;
      expect(points.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < points.length - 1; i += 1) {
        expect(points[i]!.x === points[i + 1]!.x || points[i]!.y === points[i + 1]!.y).toBe(true);
      }
      for (const [name, rect] of boxes) {
        if (name === 'a' || name === (id === 'ab' ? 'b' : 'c')) continue;
        expect(polylineHitsRect(points, rect), `${id} through ${name}`).toBe(false);
      }
    }
    // It really went round: longer than the straight run.
    expect(routes.get('ab')!.length).toBeGreaterThan(2);
  });

  it('a plain neighbour is one straight line', () => {
    const routes = routeOrthogonal(
      new Map([
        ['a', box(0, 0)],
        ['b', box(200, 0)],
      ]),
      ['a', 'b'],
      [{ id: 'ab', from: 'a', to: 'b' }],
    );
    expect(routes.get('ab')).toEqual([
      { x: 100, y: 20 },
      { x: 200, y: 20 },
    ]);
  });

  it('honours the side an edge must leave and arrive by', () => {
    const routes = routeOrthogonal(
      new Map([
        ['a', box(0, 0)],
        ['b', box(300, 0)],
      ]),
      ['a', 'b'],
      [{ id: 'ab', from: 'a', to: 'b', fromSide: 'bottom', toSide: 'bottom' }],
    );
    const points = routes.get('ab')!;
    expect(points[0]).toEqual({ x: 50, y: 40 });
    expect(points[1]!.x).toBe(50);
    expect(points[1]!.y).toBeGreaterThan(40);
    expect(points.at(-1)).toEqual({ x: 350, y: 40 });
  });

  it('is deterministic, and spreads two edges between the same boxes over different lines', () => {
    const request = [
      { id: 'one', from: 'a', to: 'b' },
      { id: 'two', from: 'a', to: 'b' },
    ];
    const first = routeOrthogonal(boxes, ['a', 'b', 'wall', 'c'], request);
    const second = routeOrthogonal(boxes, ['a', 'b', 'wall', 'c'], request);
    expect([...first]).toEqual([...second]);
    expect(first.get('one')).not.toEqual(first.get('two'));
  });
});
