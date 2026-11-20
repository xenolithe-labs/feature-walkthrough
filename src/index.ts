/**
 * The package's public surface: the engine, the page component and the
 * registry of built-in panels. Import `feature-walkthrough/style.css` once
 * alongside it.
 */
export * from './core';
export * from './recorder';
export { createRegistry } from './registry';
export { Problems, Walkthrough } from './shell/Walkthrough';

export * from './review';
