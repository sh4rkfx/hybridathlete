// The rule that decides whether a service-worker takeover reloads the page.
// The failure it exists to prevent is silent: a deploy that the user cannot see
// until they reload a second time.
import { describe, it, expect } from 'vitest';
import { updateWatcher } from '../../src/ui/swUpdate.js';

describe('updateWatcher', () => {
  it('reloads when a new worker claims a page that loaded from the old cache', () => {
    const w = updateWatcher({ wasControlled: true });
    expect(w.controllerChanged()).toBe(true);
  });

  it('does not reload on a first visit, where the assets came off the network', () => {
    const w = updateWatcher({ wasControlled: false });
    expect(w.controllerChanged()).toBe(false);
  });

  it('does not reload once the user has touched the page', () => {
    const w = updateWatcher({ wasControlled: true });
    w.noteInteraction();
    expect(w.controllerChanged()).toBe(false);
  });

  it('interaction after the reload decision is too late to stop it', () => {
    const w = updateWatcher({ wasControlled: true });
    expect(w.controllerChanged()).toBe(true);
    w.noteInteraction();
    expect(w.controllerChanged()).toBe(false);
  });

  // A worker that re-claims — or two controllerchange events racing — must not
  // put the page in a reload loop.
  it('reloads at most once', () => {
    const w = updateWatcher({ wasControlled: true });
    expect(w.controllerChanged()).toBe(true);
    expect(w.controllerChanged()).toBe(false);
    expect(w.controllerChanged()).toBe(false);
  });

  it('noteInteraction is idempotent and safe to call unbound', () => {
    const w = updateWatcher({ wasControlled: true });
    const handler = w.noteInteraction;
    handler();
    handler();
    expect(w.controllerChanged()).toBe(false);
  });
});
