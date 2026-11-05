import { useEffect, useRef, type RefObject } from 'react';

/**
 * The keyboard half of a dialog: focus enters when it opens, cannot leave while it is up, and goes
 * back to the control that opened it when it closes.
 *
 * This lives outside `ModalShell` because both of its shapes need it — the centred modal and the
 * drawer that the dashboard's mobile navigation slides in from the left — and a drawer that a
 * keyboard user can tab straight out of is the same bug wearing different clothes.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * jsdom never lays anything out, so an empty rect list there means "unknown", not "invisible" —
 * `documentElement` has no rects either. Checking it keeps the filter honest in a browser without
 * turning the test environment into a dialog with no focusable controls at all.
 */
const layoutIsUnknown = () => document.documentElement.getClientRects().length === 0;

function visible(el: HTMLElement): boolean {
  if (el.closest('[hidden]') || el.getAttribute('aria-hidden') === 'true') return false;
  if (layoutIsUnknown()) return true;
  return el.getClientRects().length > 0 || el === document.activeElement;
}

/*
 * Which control the user was on before a dialog took focus. It has to be remembered rather than read
 * at open time: by the time an effect runs, a dialog with `autoFocus` has already moved focus into
 * itself, and the trigger is gone from `document.activeElement`. Tracking the focus events themselves
 * does not work for the same reason — the field inside the dialog is one of them.
 *
 * So what is remembered is the last thing the user actually activated: the press or the key that
 * opened the dialog. That lands before React renders it, and nothing inside the dialog can overwrite
 * it while the dialog is up.
 *
 * One pair of listeners for the whole app, refcounted — the dashboard keeps a dozen shells mounted
 * with their `open` flag false, and each asking for its own subscription would be a dozen listeners
 * doing the same job.
 */
let lastActivated: HTMLElement | null = null;
let subscriptions = 0;
let handlers: Array<[string, (event: Event) => void]> | null = null;

function retainActivationTracker(): () => void {
  if (subscriptions === 0) {
    const record = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // A press usually lands on the icon inside the button, not the button.
      lastActivated = target.closest<HTMLElement>(FOCUSABLE) ?? target;
    };
    handlers = [
      ['pointerdown', record],
      ['keydown', record],
    ];
    for (const [type, handler] of handlers) document.addEventListener(type, handler, true);
  }
  subscriptions += 1;
  return () => {
    subscriptions -= 1;
    if (subscriptions === 0 && handlers) {
      for (const [type, handler] of handlers) document.removeEventListener(type, handler, true);
      handlers = null;
    }
  };
}

export function useDialogA11y(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(retainActivationTracker, []);

  // The handler is held in a ref instead of joining the dependency list below, because every screen
  // passes a fresh inline `() => setOpen(false)`. As a dependency, that identity changes on every
  // keystroke in the form, the effect re-runs, its cleanup fires, and focus is walked out of the field
  // the user is typing into and back to the button that opened the dialog. The handler has to be
  // current; the subscription must not be.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    if (!panel) return;

    // Snapshotted here, not read at close time: the user may have pressed keys inside the dialog in
    // the meantime, and the last of those is not the control that opened it.
    const opener = lastActivated;

    // The panel takes focus rather than the first control inside it: a dialog that opens with its name
    // already announced is a dialog the user knows the purpose of, and the first Tab press then walks
    // into the content from the top instead of starting halfway through a form.
    //
    // Unless the screen already chose where to land — an `autoFocus` on a search field is a decision,
    // and stealing it back turns "type to search" into "tab, then type".
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !panel.contains(focused)) {
      panel.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Deliberately not stopped: a screen that also listens for Escape — to clear a search box, to
        // close the panel behind this one — is doing its own job, and swallowing the key here would
        // break behaviour no reviewer would think to look for.
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (active && !panel.contains(active)) {
        // Reachable only if something moved focus out from under us (a focus-restoring effect in a
        // child screen, for instance). Pull it back rather than letting the tab order escape.
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore to whatever opened this, but only while focus is still ours to move. If the close came
      // from a flow that already relocated focus — a toast, the next screen — dragging it back to the
      // button that opened the dialog would undo that decision.
      const stillOurs = document.activeElement === panel || panel.contains(document.activeElement);
      if (stillOurs && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
