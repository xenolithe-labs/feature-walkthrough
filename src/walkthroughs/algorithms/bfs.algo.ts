// The algorithm as it runs, with the recorder's calls (the lines that start with `rec.`) in it.
// Take those lines out and what is left is the source the walkthrough shows; a test checks that.
// It is plain JavaScript, so the test can also run the shown text on its own.
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
let rec;

export function setRecorder(recorder) {
  rec = recorder;
}

//#region algorithm
function bfs(graph, start, queue = []) {
  rec.step('Start with ' + start);
  rec.at(2, 'new Set([start])', {
    label: 'Mark the start as seen',
    text: 'visited holds every node that has been put in the queue. A node is marked the moment it is queued, not when it is taken out, so it can never be queued twice.',
  });
  const visited = new Set([start]);
  rec.tone('map', start, 'warn');
  rec.at(3, 'queue.push(start)', {
    label: 'Queue the start',
    text: 'The queue holds the nodes that are waiting for their turn. It starts with the node we begin from.',
  });
  queue.push(start);
  rec.at(4, 'let head = 0', {
    text: 'Instead of removing nodes from the front of the array, head marks the front. Everything before head has been taken out already.',
  });
  let head = 0;
  rec.point('head', head);
  while (head < queue.length) {
    rec.step('Visit ' + rec.silently(() => queue[head]));
    rec.at(5, 'head < queue.length', {
      expr: true,
      label: 'Is anyone waiting?',
      text: 'While the queue has nodes at or after head, there is still work to do.',
    });
    rec.at(6, 'queue[head]', {
      expr: true,
      label: 'Take the front of the queue',
      text: 'The node that has waited longest goes first. This is what makes the search spread out one ring at a time.',
    });
    const node = queue[head];
    rec.set('node', node);
    rec.read('map', node);
    rec.at(7, 'head++', { changes: true, label: 'Move head past it' });
    head++;
    rec.point('head', head);
    rec.tone('queue', head - 1, 'muted');
    for (const next of graph[node]) {
      rec.at(8, 'next of graph[node]', {
        expr: true,
        label: 'Look at the edge to ' + next,
        text: 'Each edge leaving ' + node + ' leads to a neighbour.',
      });
      rec.set('next', next);
      rec.read('map', node + '.' + next);
      rec.at(9, '!visited.has(next)', {
        expr: true,
        label: 'Seen before?',
        text: () =>
          visited.has(next)
            ? next + ' is already in visited: it is queued, or done. Skip it.'
            : next + ' is new.',
      });
      if (!visited.has(next)) {
        rec.at(10, 'visited.add(next)', { changes: true, label: 'Mark ' + next + ' as seen' });
        visited.add(next);
        rec.tone('map', next, 'warn');
        rec.at(11, 'queue.push(next)', {
          changes: true,
          label: 'Queue ' + next,
          text: next + ' goes to the back of the queue, behind everything found earlier.',
        });
        queue.push(next);
      }
    }
    rec.at(13, '}', {
      label: 'Done with ' + node,
      text: 'Every edge of ' + node + ' has been looked at.',
    });
    rec.tone('map', node, 'good');
  }
  rec.step('The queue is empty');
  rec.at(5, 'head < queue.length', {
    expr: true,
    label: 'Is anyone waiting?',
    text: 'head has caught up with the end of the queue: nothing is waiting, so every reachable node has been visited.',
  });
  rec.at(15, 'return queue', {
    label: 'Return the order',
    text: 'The queue, from front to back, is the order the nodes were found in: nearest first.',
  });
  return queue;
}
//#endregion

export { bfs };
