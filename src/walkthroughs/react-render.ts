import { defineWalkthrough } from '../core';

const CART = `import { memo, useEffect, useState } from 'react';

export default function App() {
  const [items, setItems] = useState([
    { id: 'tea', name: 'Tea', price: 10, qty: 1 },
    { id: 'mug', name: 'Mug', price: 15, qty: 2 },
  ]);

  function addOne(id) {
    setItems(items.map((item) =>
      item.id === id ? { ...item, qty: item.qty + 1 } : item,
    ));
  }

  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  return (
    <>
      <Header count={count} />
      <CartList items={items} onAdd={addOne} />
      <CartTotal total={total} />
      <Footer />
    </>
  );
}

function Header({ count }) {
  return <header><CartBadge count={count} /></header>;
}

function CartBadge({ count }) {
  useEffect(() => {
    document.title = \`Cart (\${count})\`;
  }, [count]);
  return <span className="badge">{count}</span>;
}

function CartList({ items, onAdd }) {
  return (
    <ul>
      {items.map((item) => (
        <CartItem key={item.id} item={item} onAdd={onAdd} />
      ))}
    </ul>
  );
}

function CartItem({ item, onAdd }) {
  return (
    <li>
      {item.name} × <b>{item.qty}</b>
      <button onClick={() => onAdd(item.id)}>+</button>
    </li>
  );
}

function CartTotal({ total }) {
  return <p className="total">\${total}</p>;
}

const Footer = memo(function Footer() {
  return <footer>Free returns</footer>;
});`;

/**
 * One state update in React, from the click to the screen.
 * Follows the trigger, render, commit model of react.dev ("Render and Commit").
 */
export const reactRender = defineWalkthrough({
  id: 'react-render',
  title: 'React: one setState, from click to screen',
  lead: 'A click changes one number. React calls most of the components again, yet touches only three text nodes on the page.',
  tags: ['react', 'rendering'],

  layout: {
    panes: [
      {
        id: 'tree',
        panel: 'boxes',
        title: 'Component tree',
        content: {
          boxes: [
            { id: 'App', label: 'App', sub: 'state: items' },
            { id: 'Header', label: 'Header', parent: 'App', sub: 'count=3' },
            { id: 'CartBadge', label: 'CartBadge', parent: 'Header', sub: 'count=3' },
            { id: 'CartList', label: 'CartList', parent: 'App', sub: 'items' },
            { id: 'item-tea', label: 'CartItem', parent: 'CartList', sub: 'Tea × 1' },
            { id: 'item-mug', label: 'CartItem', parent: 'CartList', sub: 'Mug × 2' },
            { id: 'CartTotal', label: 'CartTotal', parent: 'App', sub: 'total=40' },
            { id: 'Footer', label: 'Footer', parent: 'App', sub: 'memo, no props' },
          ],
        },
      },
      {
        id: 'phases',
        panel: 'flow',
        title: 'Phases',
        content: {
          nodes: [
            { id: 'trigger', label: 'Trigger', sub: 'state is set', kind: 'terminal' },
            { id: 'render', label: 'Render', sub: 'call the components' },
            { id: 'compare', label: 'Compare', sub: 'new output against old' },
            { id: 'commit', label: 'Commit', sub: 'change the DOM' },
            { id: 'effects', label: 'Effects', sub: 'run useEffect', kind: 'terminal' },
            { id: 'paint', label: 'Paint', sub: 'the browser draws', kind: 'terminal' },
          ],
          edges: [
            { from: 'trigger', to: 'render' },
            { from: 'render', to: 'compare' },
            { from: 'compare', to: 'commit' },
            { from: 'commit', to: 'paint' },
            { from: 'commit', to: 'effects' },
          ],
        },
      },
      {
        id: 'source',
        panel: 'code',
        title: 'Source',
        role: 'focus',
        content: { sources: [{ id: 'cart', title: 'Cart.jsx', lang: 'jsx', text: CART }] },
      },
      {
        id: 'dom',
        panel: 'table',
        title: 'The page (DOM)',
        role: 'focus',
        content: {
          columns: [
            { id: 'node', label: 'Node', mono: true },
            { id: 'text', label: 'Text', mono: true },
            { id: 'from', label: 'Rendered by' },
          ],
          rows: [
            { id: 'dom-badge', cells: { node: 'span.badge', text: '3', from: 'CartBadge' } },
            { id: 'dom-tea', cells: { node: 'li (tea) b', text: '1', from: 'CartItem' } },
            { id: 'dom-mug', cells: { node: 'li (mug) b', text: '2', from: 'CartItem' } },
            { id: 'dom-total', cells: { node: 'p.total', text: '$40', from: 'CartTotal' } },
            { id: 'dom-footer', cells: { node: 'footer', text: 'Free returns', from: 'Footer' } },
            {
              id: 'dom-title',
              cells: { node: 'document.title', text: 'Cart (3)', from: 'CartBadge effect' },
            },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'trigger',
      title: 'Trigger',
      text: 'Something asks React for a new render. Here it is a click.',
      calls: [
        {
          id: 'click',
          label: 'Click + on Tea',
          text: 'The button’s click handler runs. It calls the onAdd function that App passed down through CartList.',
          show: 'source',
          effects: {
            tree: [{ read: 'item-tea' }],
            phases: [{ read: 'trigger' }],
            source: [{ read: 'cart', lines: [53] }],
          },
        },
        {
          id: 'set-state',
          label: 'addOne calls setItems',
          text: 'setItems does not change items. It hands React a new array and asks for a render. The handler keeps running with the old array; React starts rendering once the handler has finished.',
          where: 'react.dev: State as a Snapshot',
          effects: {
            tree: [
              { read: 'App' },
              { update: 'App', fields: { sub: 'state: items (update queued)', tone: 'warn' } },
            ],
            phases: [{ read: 'trigger' }],
            source: [{ read: 'cart', lines: [[9, 13]] }],
          },
        },
      ],
    },
    {
      id: 'render',
      title: 'Render',
      text: 'React calls the component whose state changed, then every component it returns, and so on down. “Rendering” here means calling functions. Nothing on the page changes yet.',
      calls: [
        {
          id: 'render-app',
          label: 'Call App()',
          text: 'useState now returns the new array: Tea has qty 2. App computes count = 4 and total = 50 and returns its four children.',
          where: 'react.dev: Render and Commit, step 2',
          effects: {
            tree: [{ update: 'App', fields: { sub: 'state: items (tea qty 2)', tone: 'none' } }],
            phases: [{ read: 'render' }, { read: 'trigger.render' }],
            source: [
              {
                read: 'cart',
                lines: [
                  [3, 7],
                  [15, 16],
                  [18, 25],
                ],
              },
            ],
          },
        },
        {
          id: 'render-header',
          label: 'Call Header({ count: 4 })',
          text: 'First child. React goes all the way down this branch before it moves to the next one.',
          effects: {
            tree: [{ update: 'Header', fields: { sub: 'count=4' } }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[28, 30]] }],
          },
        },
        {
          id: 'render-badge',
          label: 'Call CartBadge({ count: 4 })',
          text: 'Returns a span containing 4. The effect inside it is noted, not run: effects wait until after the commit.',
          effects: {
            tree: [{ update: 'CartBadge', fields: { sub: 'count=4' } }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[32, 37]] }],
          },
        },
        {
          id: 'render-list',
          label: 'Call CartList({ items })',
          text: 'Back up, then into the second branch. The list returns one CartItem per item, each with a key.',
          effects: {
            tree: [{ update: 'CartList' }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[39, 47]] }],
          },
        },
        {
          id: 'render-tea',
          label: 'Call CartItem (Tea)',
          text: 'Its item prop is a new object with qty 2, so it returns different output.',
          effects: {
            tree: [{ update: 'item-tea', fields: { sub: 'Tea × 2' } }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[49, 56]] }],
          },
        },
        {
          id: 'render-mug',
          label: 'Call CartItem (Mug)',
          text: 'Its item is the very same object as before, but React calls it anyway: by default a component re-renders whenever its parent does. It returns exactly what it returned last time.',
          effects: {
            tree: [{ read: 'item-mug' }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[49, 56]] }],
          },
        },
        {
          id: 'render-total',
          label: 'Call CartTotal({ total: 50 })',
          text: 'Third branch. Returns a paragraph containing $50.',
          effects: {
            tree: [{ update: 'CartTotal', fields: { sub: 'total=50' } }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[58, 60]] }],
          },
        },
        {
          id: 'skip-footer',
          label: 'Skip Footer',
          text: 'Footer is wrapped in memo and its props are the same as last time (it has none), so React does not call it and reuses its previous output.',
          where: 'react.dev: memo',
          effects: {
            tree: [{ read: 'Footer' }, { update: 'Footer', fields: { tone: 'muted' } }],
            phases: [{ read: 'render' }],
            source: [{ read: 'cart', lines: [[62, 64]] }],
          },
        },
      ],
    },
    {
      id: 'compare',
      title: 'Compare',
      text: 'React now has the new output of every component it called, and compares it with the output from the previous render.',
      calls: [
        {
          id: 'diff',
          label: 'Find what differs',
          text: 'Seven components were called and one was skipped. Only three pieces of text came out different. Mug was called but produced the same thing, so there is nothing to do for it.',
          show: 'dom',
          blocks: [
            {
              title: 'Differences',
              text: 'span.badge     "3"   ->  "4"\nli (tea) b     "1"   ->  "2"\np.total        "$40" ->  "$50"',
            },
          ],
          effects: {
            tree: [{ read: 'CartBadge' }, { read: 'item-tea' }, { read: 'CartTotal' }],
            phases: [{ read: 'compare' }, { read: 'render.compare' }],
            dom: [
              { read: 'dom-badge', cells: ['text'] },
              { read: 'dom-tea', cells: ['text'] },
              { read: 'dom-total', cells: ['text'] },
            ],
          },
        },
      ],
    },
    {
      id: 'commit',
      title: 'Commit',
      text: 'React applies the differences to the page, and nothing else.',
      calls: [
        {
          id: 'commit-badge',
          label: 'Set the badge text to 4',
          text: 'The span itself is kept. Only its text is changed.',
          where: 'react.dev: Render and Commit, step 3',
          effects: {
            phases: [{ read: 'commit' }, { read: 'compare.commit' }],
            dom: [{ update: 'dom-badge', fields: { text: '4' } }],
            tree: [{ read: 'CartBadge' }],
          },
        },
        {
          id: 'commit-tea',
          label: 'Set the Tea quantity to 2',
          text: 'The list item, its button and the Mug item beside it are left exactly as they were.',
          effects: {
            phases: [{ read: 'commit' }],
            dom: [{ update: 'dom-tea', fields: { text: '2' } }],
            tree: [{ read: 'item-tea' }],
          },
        },
        {
          id: 'commit-total',
          label: 'Set the total to $50',
          text: 'Third and last change. The DOM now matches what the components returned.',
          effects: {
            phases: [{ read: 'commit' }],
            dom: [{ update: 'dom-total', fields: { text: '$50' } }],
            tree: [{ read: 'CartTotal' }],
          },
        },
      ],
    },
    {
      id: 'after',
      title: 'Effects and paint',
      text: 'React is done with the page. What is left is the effects and the browser.',
      calls: [
        {
          id: 'effect',
          label: 'Run the CartBadge effect',
          text: 'Effects never run during rendering; they run once the commit is done. count is in this effect’s dependency list and it changed from 3 to 4, so the effect runs and sets the tab title. Effects whose dependencies did not change are not run.',
          where: 'react.dev: Synchronizing with Effects',
          show: 'source',
          effects: {
            tree: [{ read: 'CartBadge' }],
            phases: [{ read: 'effects' }, { read: 'commit.effects' }],
            source: [{ read: 'cart', lines: [[33, 35]] }],
            dom: [{ update: 'dom-title', fields: { text: 'Cart (4)' } }],
          },
        },
        {
          id: 'paint',
          label: 'The browser paints',
          text: 'The browser redraws the places that changed. This is the first moment the user sees anything different.',
          show: 'dom',
          effects: {
            phases: [{ read: 'paint' }, { read: 'commit.paint' }],
            dom: [
              { read: 'dom-badge' },
              { read: 'dom-tea' },
              { read: 'dom-total' },
              { read: 'dom-title' },
            ],
          },
        },
      ],
    },
  ],
});
