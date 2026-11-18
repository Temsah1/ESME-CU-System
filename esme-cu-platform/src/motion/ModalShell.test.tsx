// @vitest-environment jsdom
/**
 * The dialog keyboard contract, tested where it is implemented. Sixteen dashboard screens open one of
 * these, and none of them can be asked to get focus handling right on their own — so the shell either
 * does it or nobody does.
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrawerShell, ModalShell } from './ModalShell';

afterEach(cleanup);

function Harness({
  kind = 'modal',
  onClose,
}: {
  kind?: 'modal' | 'drawer';
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Shell = kind === 'modal' ? ModalShell : DrawerShell;
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Outside before</button>
      <Shell open={open} onClose={() => { setOpen(false); onClose?.(); }} ariaLabel="Add a committee">
        <button type="button">First</button>
        <input aria-label="Name" autoFocus />
        <button type="button">Last</button>
      </Shell>
      <button type="button">Outside after</button>
    </div>
  );
}

const active = () => document.activeElement as HTMLElement;
const text = (el: Element | null) => el?.textContent ?? '';

describe.each(['modal', 'drawer'] as const)('%s', (kind) => {
  it(`names the ${kind} and does not steal focus from a field that asked for it`, async () => {
    const user = userEvent.setup();
    render(<Harness kind={kind} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a committee' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // The form's own `autoFocus` wins: a search dialog that makes you tab before you can type is a
    // regression dressed up as accessibility.
    expect(dialog.contains(active())).toBe(true);
    expect(active().getAttribute('aria-label')).toBe('Name');
  });

  it('keeps the tab order inside and returns it to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness kind={kind} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(text(active())).toBe('First');

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(text(active())).toBe('Last');

    // A Tab that somehow lands outside — a child screen restoring focus mid-render — is pulled back
    // rather than allowed to wander into the page behind the dialog.
    screen.getByRole('button', { name: 'Outside after' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(active())).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    // The node itself leaves when the exit animation finishes, which is the shell's business and not
    // keyboard behaviour — under jsdom no frames run, so asking for it here would only test the mock.
    expect(text(active())).toBe('Open');
  });
});

it('closes a drawer on Escape as well', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness kind="drawer" onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByRole('dialog', { name: 'Add a committee' })).not.toBeNull();

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

it('holds focus on the panel when the dialog contains nothing to focus', () => {
  render(
    <ModalShell open onClose={vi.fn()} ariaLabel="Confirm">
      <p>Delete this draft?</p>
    </ModalShell>
  );
  expect(screen.getByRole('dialog', { name: 'Confirm' })).toBe(document.activeElement);
});
