// htm bound to Preact — the single tagged-template entry for all UI modules.
import { h, render, Fragment } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);
export { render, Fragment };
