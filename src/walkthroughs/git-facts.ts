/**
 * The repository the git demo walks through, taken from a real one. Nothing
 * here is made up: a test rebuilds every object from these contents and checks
 * that it hashes to the id written below.
 */
const WHO = 'Ada Example <ada@example.com>';

export const files = {
  readme: '# Greeter\n',
  greetBefore: 'export const greet = (name) => `Hello, ${name}`;\n',
  greetAfter: 'export const greet = (name) => `Hello, ${name}!`;\n',
};

export const blobs = {
  readme: 'c6707f32c62c913afc80f60f8dad4cb89d265e6c',
  greetBefore: '1ad927dd9ae0ff82d1d03c9d6032b86f60c87832',
  greetAfter: 'f7a2382708ef3da320bb2710951bf60b03eb1823',
};

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  hash: string;
  name: string;
}

export const trees = {
  srcBefore: {
    hash: 'dbfe0eeede8198f6fab8f7e4fbb2fbdb06e7a50a',
    entries: [{ mode: '100644', type: 'blob', hash: blobs.greetBefore, name: 'greet.js' }],
  },
  rootBefore: {
    hash: '42872417ae3c0dbf690bbbbff946205c89880646',
    entries: [
      { mode: '100644', type: 'blob', hash: blobs.readme, name: 'README.md' },
      {
        mode: '040000',
        type: 'tree',
        hash: 'dbfe0eeede8198f6fab8f7e4fbb2fbdb06e7a50a',
        name: 'src',
      },
    ],
  },
  srcAfter: {
    hash: 'bbf8c0bcdb245ed68a01899ed91d385a41c09cf2',
    entries: [{ mode: '100644', type: 'blob', hash: blobs.greetAfter, name: 'greet.js' }],
  },
  rootAfter: {
    hash: '953db5902eacaf045d9f369dc1499de6ca15a935',
    entries: [
      { mode: '100644', type: 'blob', hash: blobs.readme, name: 'README.md' },
      {
        mode: '040000',
        type: 'tree',
        hash: 'bbf8c0bcdb245ed68a01899ed91d385a41c09cf2',
        name: 'src',
      },
    ],
  },
} satisfies Record<string, { hash: string; entries: TreeEntry[] }>;

export const commits = {
  first: {
    hash: 'fdc907bdce78276fddffadd756241a26270afeea',
    tree: trees.rootBefore.hash,
    parent: undefined as string | undefined,
    author: `${WHO} 1767268800 +0000`,
    committer: `${WHO} 1767268800 +0000`,
    message: 'Add greeter',
  },
  second: {
    hash: '4fa6696c5aeac6895143bee55415296550725fd9',
    tree: trees.rootAfter.hash,
    parent: 'fdc907bdce78276fddffadd756241a26270afeea' as string | undefined,
    author: `${WHO} 1767272400 +0000`,
    committer: `${WHO} 1767272400 +0000`,
    message: 'Add an exclamation mark',
  },
};

/** The text of a commit object, which is also what `git cat-file -p` prints. */
export function commitText(commit: (typeof commits)['first']): string {
  return [
    `tree ${commit.tree}`,
    ...(commit.parent === undefined ? [] : [`parent ${commit.parent}`]),
    `author ${commit.author}`,
    `committer ${commit.committer}`,
    '',
    commit.message,
    '',
  ].join('\n');
}

/** What `git cat-file -p` prints for a tree. */
export function treeText(entries: readonly TreeEntry[]): string {
  return entries.map((e) => `${e.mode} ${e.type} ${e.hash}\t${e.name}`).join('\n');
}

/** The short form of an object id, as git prints it. */
export const short = (hash: string) => hash.slice(0, 7);
