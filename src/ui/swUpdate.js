// A cache-first service worker serves the PREVIOUS build for one full page load
// after a deploy: the page and every module come out of the old cache while the
// new worker installs behind them. The first reload after an update therefore
// shows the old app and the second one shows the new app. Measured in Chromium
// across a real v26 -> v27 deploy; it took two reloads.
//
// The worker already calls skipWaiting() and clients.claim(), so the new one
// takes control the moment it activates, which fires 'controllerchange' in the
// page. Reloading there collapses the two reloads into one.
//
// Not unconditionally, though — a reload throws away whatever is typed and this
// app has entry masks with unsaved state. Two guards:
//
//   wasControlled  Only reload after an update, never on a first-ever visit. A
//                  page that loaded uncontrolled fetched its assets from the
//                  network, so they are already current; clients.claim() would
//                  otherwise reload every first visit for nothing.
//   interacted     Only reload before the user has touched anything. Past that
//                  point a stale screen is the lesser harm, and the update
//                  lands on the next visit anyway.
//
// The watcher decides, the caller reloads. That keeps the rule testable without
// a DOM: this module never reads navigator or calls location.reload() itself.
export function updateWatcher({ wasControlled }) {
  let interacted = false;
  let reloaded = false;

  return {
    // Called from the first pointerdown/keydown. Idempotent by nature.
    noteInteraction() {
      interacted = true;
    },

    // Returns whether the caller should reload now. One-shot: a second
    // controllerchange never reloads twice, so a worker that keeps re-claiming
    // cannot put the page in a reload loop.
    controllerChanged() {
      if (reloaded || interacted || !wasControlled) return false;
      reloaded = true;
      return true;
    },
  };
}
