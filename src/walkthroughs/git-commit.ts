import { defineWalkthrough } from '../core';
import { blobs, commitText, commits, files, short, treeText, trees } from './git-facts';
import type { TreeEntry } from './git-facts';

/**
 * What git stores when you add, commit and push one changed file.
 *
 * Every object, id and protocol line is from a real repository (git 2.50);
 * see git-facts.ts. Elements are named by short object id, so a commit is the
 * same element in the object store and in the history graph.
 */
const link = (hash: string) => ({ $ref: short(hash), text: short(hash) });

const blob = (hash: string, title: string, content: string, initial = true) => ({
  id: short(hash),
  title: `blob ${short(hash)}`,
  sub: title,
  value: content,
  initial,
});

const tree = (item: { hash: string; entries: TreeEntry[] }, title: string, initial = true) => ({
  id: short(item.hash),
  title: `tree ${short(item.hash)}`,
  sub: title,
  value: {
    entries: item.entries.map((entry) => ({
      mode: entry.mode,
      type: entry.type,
      hash: link(entry.hash),
      name: entry.name,
    })),
  },
  raw: { label: 'cat-file -p', text: treeText(item.entries) },
  initial,
});

const commit = (item: (typeof commits)['first'], initial = true) => ({
  id: short(item.hash),
  title: `commit ${short(item.hash)}`,
  sub: item.message,
  value: {
    tree: link(item.tree),
    ...(item.parent === undefined ? {} : { parent: link(item.parent) }),
    author: item.author,
    committer: item.committer,
    message: item.message,
  },
  raw: { label: 'cat-file -p', text: commitText(item) },
  initial,
});

const c1 = short(commits.first.hash);
const c2 = short(commits.second.hash);
const rootAfter = short(trees.rootAfter.hash);
const srcAfter = short(trees.srcAfter.hash);
const readme = short(blobs.readme);
const greetBefore = short(blobs.greetBefore);
const greetAfter = short(blobs.greetAfter);

export const gitCommit = defineWalkthrough({
  id: 'git-commit',
  title: 'Git: what add, commit and push store',
  lead: 'Change one line in one file and follow it through git: which objects get written, which are reused, what a branch really is, and what travels to the remote.',
  tags: ['git', 'content-addressed storage'],

  lanes: [
    { id: 'you', title: 'You' },
    { id: 'local', title: 'Local repository' },
    { id: 'remote', title: 'Remote (origin)' },
  ],

  layout: {
    panes: [
      {
        id: 'objects',
        panel: 'payload',
        title: 'Index and object store',
        content: {
          payloads: [
            {
              id: 'index',
              title: '.git/index',
              sub: 'the staging area: what the next commit will contain',
              value: {
                entries: [
                  { mode: '100644', hash: link(blobs.readme), path: 'README.md' },
                  { mode: '100644', hash: link(blobs.greetBefore), path: 'src/greet.js' },
                ],
              },
            },
            commit(commits.second, false),
            tree(trees.rootAfter, 'the top directory, after', false),
            tree(trees.srcAfter, 'src/, after', false),
            blob(blobs.greetAfter, 'src/greet.js, after', files.greetAfter, false),
            commit(commits.first),
            tree(trees.rootBefore, 'the top directory, before'),
            tree(trees.srcBefore, 'src/, before'),
            blob(blobs.greetBefore, 'src/greet.js, before', files.greetBefore),
            blob(blobs.readme, 'README.md', files.readme),
          ],
        },
      },
      {
        id: 'history',
        panel: 'graph',
        title: 'History and refs',
        content: {
          initial: true,
          direction: 'DOWN',
          nodes: [
            { id: 'HEAD', label: 'HEAD', sub: 'what is checked out', kind: 'terminal' },
            { id: 'main', label: 'main', sub: 'refs/heads/main', kind: 'terminal' },
            {
              id: 'origin-main',
              label: 'origin/main',
              sub: 'last known remote main',
              kind: 'terminal',
            },
            { id: c2, label: `commit ${c2}`, sub: commits.second.message, initial: false },
            { id: c1, label: `commit ${c1}`, sub: commits.first.message },
          ],
          edges: [
            { from: 'HEAD', to: 'main' },
            { id: 'main-new', from: 'main', to: c2, initial: false },
            { id: 'main-old', from: 'main', to: c1 },
            { id: 'origin-new', from: 'origin-main', to: c2, initial: false },
            { id: 'origin-old', from: 'origin-main', to: c1 },
            { id: 'parent', from: c2, to: c1, label: 'parent', initial: false },
          ],
        },
      },
      {
        id: 'areas',
        panel: 'boxes',
        role: 'focus',
        title: 'Three versions of every file',
        content: {
          boxes: [
            { id: 'worktree', label: 'Working tree', sub: 'the files on disk' },
            { id: 'wt-readme', parent: 'worktree', label: 'README.md', sub: readme },
            { id: 'wt-greet', parent: 'worktree', label: 'src/greet.js', sub: greetBefore },
            { id: 'staged', label: 'Index', sub: 'the next commit' },
            { id: 'ix-readme', parent: 'staged', label: 'README.md', sub: readme },
            { id: 'ix-greet', parent: 'staged', label: 'src/greet.js', sub: greetBefore },
            { id: 'committed', label: 'HEAD', sub: 'the last commit' },
            { id: 'head-readme', parent: 'committed', label: 'README.md', sub: readme },
            { id: 'head-greet', parent: 'committed', label: 'src/greet.js', sub: greetBefore },
          ],
        },
      },
      {
        id: 'model',
        panel: 'schema',
        role: 'focus',
        title: 'Object model',
        content: {
          tables: [
            {
              id: 'ref',
              label: 'ref',
              sub: 'a name for a commit',
              columns: [
                { id: 'name', type: 'path' },
                { id: 'target', key: 'FK', type: 'hash' },
              ],
            },
            {
              id: 'commit',
              label: 'commit',
              sub: 'a snapshot and where it came from',
              columns: [
                { id: 'tree', key: 'FK', type: 'hash' },
                { id: 'parent', key: 'FK', type: 'hash', note: '0 or more' },
                { id: 'author', type: 'who, when' },
                { id: 'committer', type: 'who, when' },
                { id: 'message', type: 'text' },
              ],
            },
            {
              id: 'tree',
              label: 'tree',
              sub: 'one directory: a list of entries',
              columns: [
                { id: 'mode', type: 'file type, exec bit' },
                { id: 'name', type: 'text' },
                { id: 'hash', key: 'FK', type: 'hash' },
              ],
            },
            {
              id: 'entry',
              label: 'index entry',
              sub: 'one staged file',
              columns: [
                { id: 'path', type: 'text' },
                { id: 'mode', type: 'file type, exec bit' },
                { id: 'hash', key: 'FK', type: 'hash' },
              ],
            },
            {
              id: 'blob',
              label: 'blob',
              sub: 'the contents of one file',
              columns: [{ id: 'content', type: 'bytes' }],
            },
          ],
          relations: [
            { from: 'ref.target', to: 'commit' },
            { from: 'commit.tree', to: 'tree' },
            { from: 'commit.parent', to: 'commit' },
            { id: 'tree-subdir', from: 'tree.hash', to: 'tree', label: 'directory' },
            { id: 'tree-file', from: 'tree.hash', to: 'blob', label: 'file' },
            { from: 'entry.hash', to: 'blob' },
          ],
        },
      },
      {
        id: 'refs',
        panel: 'table',
        role: 'focus',
        title: 'Refs',
        content: {
          columns: [
            { id: 'name', label: 'Name', mono: true },
            { id: 'where', label: 'Where' },
            { id: 'value', label: 'Holds', mono: true },
          ],
          rows: [
            { id: 'HEAD', cells: { where: 'Local', name: 'HEAD', value: 'ref: refs/heads/main' } },
            { id: 'main', cells: { where: 'Local', name: 'refs/heads/main', value: c1 } },
            {
              id: 'origin-main',
              cells: { where: 'Local', name: 'refs/remotes/origin/main', value: c1 },
            },
            {
              id: 'remote-main',
              cells: { where: 'Remote', name: 'refs/heads/main (on origin)', value: c1 },
            },
          ],
        },
      },
      { id: 'wire', panel: 'sequence', role: 'focus', title: 'Commands and the push exchange' },
    ],
  },

  steps: [
    {
      id: 'edit',
      title: 'Edit',
      text: 'One commit exists and has been pushed. Then a file changes on disk.',
      calls: [
        {
          id: 'start',
          label: 'Where things stand',
          show: 'areas',
          text: 'Every file has three versions that git compares: the one on disk, the one in the index and the one in the last commit. Right now all three agree, so `git status` has nothing to report. Each box shows the id of the blob that holds that version.',
          effects: {
            objects: [
              { read: 'index' },
              { read: c1, paths: ['tree'] },
              { read: short(trees.rootBefore.hash) },
            ],
            history: [{ read: 'HEAD' }, { read: 'HEAD.main' }, { read: 'main' }, { read: c1 }],
          },
        },
        {
          id: 'change',
          label: 'Change src/greet.js on disk',
          text: 'An exclamation mark is added to the greeting. Only the file on disk changes. Git has stored nothing yet: the index entry still names the old blob, which is how `git status` knows the file is modified.',
          effects: {
            areas: [
              { update: 'wt-greet', fields: { sub: 'modified, not stored', tone: 'warn' } },
              { read: 'ix-greet' },
            ],
            objects: [{ read: 'index', paths: ['entries.1.hash'] }, { read: greetBefore }],
          },
        },
      ],
    },
    {
      id: 'add',
      title: 'git add',
      text: 'Staging a file stores its contents and records them in the index. No commit exists yet.',
      calls: [
        {
          id: 'add-cmd',
          label: 'git add src/greet.js',
          from: 'you',
          to: 'local',
          show: 'model',
          text: 'Git keeps file contents as blobs. A blob is only the bytes: it has no name and no path. Those live in whatever points at it.',
          effects: {
            model: [{ read: 'blob' }, { read: 'blob.content' }],
          },
        },
        {
          id: 'hash',
          label: 'Hash the contents and store a blob',
          where: `.git/objects/${blobs.greetAfter.slice(0, 2)}/${blobs.greetAfter.slice(2)}`,
          text: 'The id of an object is the SHA-1 of a short header and its contents. The same contents always get the same id, so identical files are stored once. The blob is compressed with zlib and written under a directory named by the first two characters of its id. The old blob is untouched.',
          blocks: [
            {
              title: 'What is hashed',
              text: `"blob 50\\0" + the 50 bytes of the file\n= ${blobs.greetAfter}`,
            },
          ],
          effects: {
            objects: [{ add: greetAfter }, { read: greetBefore }],
            model: [{ read: 'blob' }, { read: 'blob.content' }],
          },
        },
        {
          id: 'stage',
          label: 'Point the index entry at the new blob',
          show: 'areas',
          where: '.git/index',
          text: 'The index is a flat list: one entry per file, with its path and the id of its blob. Staging replaces one id. Now the disk and the index agree, and the index differs from the last commit: the change is "staged".',
          effects: {
            objects: [
              { update: 'index', fields: { 'entries.1.hash': link(blobs.greetAfter) } },
              { read: greetAfter },
            ],
            areas: [
              { update: 'wt-greet', fields: { sub: greetAfter, tone: 'none' } },
              { update: 'ix-greet', fields: { sub: greetAfter, tone: 'warn' } },
            ],
            model: [{ read: 'entry' }, { read: 'entry.hash' }, { read: 'entry.hash:blob' }],
          },
        },
      ],
    },
    {
      id: 'commit',
      title: 'git commit',
      text: 'A commit turns the index into trees, then writes one commit object that points at the top tree.',
      calls: [
        {
          id: 'commit-cmd',
          label: 'git commit -m "Add an exclamation mark"',
          from: 'you',
          to: 'local',
          show: 'model',
          text: 'The index is flat, but a commit stores directories. So git first builds a tree for each directory from the index entries, starting with the innermost.',
          effects: {
            objects: [{ read: 'index' }],
            model: [{ read: 'entry' }, { read: 'tree' }],
          },
        },
        {
          id: 'tree-src',
          label: 'Write a tree for src/',
          text: 'A tree is one directory listing: for each entry a mode, a name and the id of its contents. The listing for src/ changed, because greet.js has a new id, so it is a new tree with a new id of its own.',
          effects: {
            objects: [{ add: srcAfter, paths: ['entries.0.hash'] }, { read: greetAfter }],
            model: [
              { read: 'tree' },
              { read: 'tree.hash' },
              { read: 'tree-file' },
              { read: 'blob' },
            ],
          },
        },
        {
          id: 'tree-root',
          label: 'Write a tree for the top directory',
          text: 'The top directory lists README.md and src. Its src entry names the new tree, so this tree is new as well. Its README.md entry names the same blob as before: an unchanged file costs nothing, and the old and new snapshots share it.',
          effects: {
            objects: [
              { add: rootAfter, paths: ['entries.1'] },
              { read: rootAfter, paths: ['entries.0'] },
              { read: readme },
              { read: srcAfter },
            ],
            model: [{ read: 'tree' }, { read: 'tree.hash' }, { read: 'tree-subdir' }],
          },
        },
        {
          id: 'commit-obj',
          label: 'Write the commit',
          text: 'A commit names one top tree (the whole snapshot), its parent commit, who made it and when, and the message. Its id covers all of that. Because the tree id covers every file under it, and the parent id covers all earlier history, one commit id pins down everything.',
          effects: {
            objects: [{ add: c2, paths: ['tree', 'parent'] }, { read: rootAfter }, { read: c1 }],
            history: [{ add: c2 }, { add: 'parent' }, { read: c1 }],
            model: [
              { read: 'commit' },
              { read: 'commit.tree' },
              { read: 'commit.parent' },
              { read: 'commit.tree:tree' },
              { read: 'commit.parent:commit' },
            ],
          },
        },
        {
          id: 'move-ref',
          label: 'Move main to the new commit',
          show: 'refs',
          where: '.git/refs/heads/main',
          text: 'A branch is a file that holds one commit id. Committing ends by writing the new id into it. HEAD is not touched: it holds the name of the branch, not a commit. origin/main still holds the old id, which is why `git status` now says the branch is ahead by one commit.',
          effects: {
            refs: [{ update: 'main', fields: { value: c2 } }, { read: 'HEAD' }],
            history: [
              { remove: 'main-old' },
              { add: 'main-new' },
              { update: 'main' },
              { read: c2 },
            ],
            areas: [
              { update: 'head-greet', fields: { sub: greetAfter } },
              { update: 'ix-greet', fields: { tone: 'none' } },
            ],
            model: [{ read: 'ref' }, { read: 'ref.target' }, { read: 'ref.target:commit' }],
          },
        },
      ],
    },
    {
      id: 'push',
      title: 'git push',
      text: 'Pushing sends the objects the remote lacks, then asks it to move its branch.',
      calls: [
        {
          id: 'push-cmd',
          label: 'git push origin main',
          from: 'you',
          to: 'local',
          show: 'wire',
          text: 'The local repository opens a connection to the remote and starts its receiving program, `git receive-pack`.',
          effects: {
            refs: [{ read: 'main' }, { read: 'remote-main' }],
          },
        },
        {
          id: 'advertise',
          label: 'Here are my refs',
          from: 'remote',
          to: 'local',
          text: 'The remote speaks first. It lists every ref it has and the commit each one holds, followed by the features it supports.',
          response: `${commits.first.hash} refs/heads/main`,
          effects: {
            refs: [{ read: 'remote-main', cells: ['value'] }],
            history: [{ read: c1 }],
          },
        },
        {
          id: 'missing',
          label: 'Work out what the remote lacks',
          text: 'Starting at the new commit, git walks back until it reaches a commit the remote already has. Everything reachable on the way that the remote cannot already have is missing: one commit, two trees and one blob. The README.md blob is not sent, because the remote has it through the first commit.',
          effects: {
            objects: [{ read: c2 }, { read: rootAfter }, { read: srcAfter }, { read: greetAfter }],
            history: [{ read: c2 }, { read: 'parent' }, { read: c1 }],
          },
        },
        {
          id: 'send',
          label: 'Move main, and here are 4 objects',
          from: 'local',
          to: 'remote',
          text: 'One line asks for the update: the id the client believes the branch holds, the id it should hold, and the name of the ref. The four objects follow in a single pack file.',
          request: `${commits.first.hash} ${commits.second.hash} refs/heads/main\nPACK (4 objects)`,
          effects: {
            objects: [{ read: c2 }, { read: rootAfter }, { read: srcAfter }, { read: greetAfter }],
            refs: [
              { read: 'main', cells: ['value'] },
              { read: 'remote-main', cells: ['value'] },
            ],
          },
        },
        {
          id: 'accept',
          label: 'Remote unpacks and moves its main',
          text: 'The remote stores the objects and writes the new id into its own refs/heads/main. The new commit has the old one as its parent, so this is a fast-forward: the branch moves ahead and nothing it pointed at is left behind.',
          effects: {
            refs: [{ update: 'remote-main', fields: { value: c2 } }],
            history: [{ read: c2 }, { read: 'parent' }, { read: c1 }],
          },
        },
        {
          id: 'report',
          label: 'unpack ok, ok refs/heads/main',
          from: 'remote',
          to: 'local',
          text: 'The remote reports on the pack and on each ref it was asked to move.',
          response: 'unpack ok\nok refs/heads/main',
          effects: {
            refs: [{ read: 'remote-main' }],
          },
        },
        {
          id: 'track',
          label: 'Record where the remote is now',
          show: 'refs',
          where: '.git/refs/remotes/origin/main',
          text: 'origin/main is the local note of where the remote branch was last seen. It moves to the new commit. Local main, origin/main and the remote now all hold the same id.',
          effects: {
            refs: [
              { update: 'origin-main', fields: { value: c2 } },
              { read: 'main', cells: ['value'] },
              { read: 'remote-main', cells: ['value'] },
            ],
            history: [
              { remove: 'origin-old' },
              { add: 'origin-new' },
              { update: 'origin-main' },
              { read: c2 },
            ],
          },
        },
      ],
    },
  ],
});
