// @vitest-environment jsdom
/**
 * The kit is exercised as an accessibility contract, not as a screenshot. Every view is about to be
 * rebuilt on top of these components, so what has to be provable is the wiring a page cannot fix
 * later: a label that reaches its control, an error that is announced and named, a tab row a keyboard
 * can leave, a switch that says it is a switch. Colour and spacing are checked in the browser; these
 * tests pass with any palette.
 *
 * Plain DOM assertions rather than jest-dom: this suite never installed it, and an expectation that
 * reads `el.getAttribute('aria-controls')` is the same length as the matcher it would have used.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert, Badge, Card, PageHeader, ProgressBar, Skeleton, StatTile } from './Surface';
import { Pagination, Tabs, Tooltip } from './Navigation';
import { Button, IconButton } from './Button';
import { Spinner } from './Spinner';
import { Checkbox, FormField, Input, Radio, SearchInput, Select, Switch, Textarea } from './Field';

afterEach(cleanup);

const attr = (el: Element | null, name: string) => el?.getAttribute(name) ?? null;

const tabs = [
  { id: 'active' as const, label: 'Active', content: <p>Working members</p> },
  { id: 'alumni' as const, label: 'Alumni', content: <p>Graduated</p> },
  { id: 'pending' as const, label: 'Pending', content: <p>Awaiting review</p> },
];

describe('Field', () => {
  it('associates the label with the control and names the error for it', () => {
    render(<Input label="Email" error="Enter the chapter address" defaultValue="a" />);

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Enter the chapter address');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    // The error id is derived from the control id, so a screen never has to mint one by hand.
    expect(error.id).toBe(`${input.id}-error`);
  });

  it('points at the hint only while there is no error to read', () => {
    render(<Input label="Password" hint="At least 10 characters" />);
    const input = screen.getByLabelText('Password');
    const hint = document.getElementById(`${input.id}-hint`);
    expect(hint).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(hint!.id);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names a field that ships no visible label', () => {
    render(<Input srLabel="Search members" name="q" />);
    expect(screen.getByLabelText('Search members')).not.toBeNull();
  });

  it('keeps every control type on the same wiring', () => {
    render(
      <>
        <Textarea label="Notes" error="Required" />
        <Select label="Committee" error="Pick one">
          <option>TE</option>
        </Select>
        <SearchInput label="Find" />
      </>
    );
    for (const label of ['Notes', 'Committee']) {
      const control = screen.getByLabelText(label);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      const described = control.getAttribute('aria-describedby')!;
      expect(document.getElementById(described)!.textContent).toBeTruthy();
      expect(document.getElementById(described)!.getAttribute('role')).toBe('alert');
    }
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect((screen.getByLabelText('Find') as HTMLInputElement).type).toBe('search');
  });

  it('marks a required control for the browser and for the reader', () => {
    render(<Input label="Full name" required />);
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).required).toBe(true);
  });
});

describe('Choice controls', () => {
  it('uses a real input, so the keyboard and the value come from the browser', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    render(<Checkbox label="Send me the weekly" onChange={onCheck} />);

    const box = screen.getByRole('checkbox', { name: 'Send me the weekly' });
    await user.tab();
    expect(box).toBe(document.activeElement);
    await user.keyboard(' ');
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(onCheck).toHaveBeenCalled();
  });

  it('switches the tick from the box, never from the svg', () => {
    render(<Checkbox label="Newsletter" defaultChecked />);
    const svg = document.querySelector('svg')!;
    // A `peer-*` class only reaches siblings of the hidden input, so a class on the svg itself would
    // silently do nothing — the tick would never appear.
    expect(svg.getAttribute('class')).not.toContain('peer-checked');
    expect(svg.parentElement!.getAttribute('class')).toContain('peer-checked:[&_svg]:opacity-100');
  });

  it('announces a switch as a switch and a radio as a radio', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Switch label="Dark mode" />
        <Radio name="plan" label="Full member" />
      </>
    );
    const sw = screen.getByRole('switch', { name: 'Dark mode' }) as HTMLInputElement;
    await user.click(sw);
    expect(sw.checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Full member' }) as HTMLInputElement).checked).toBe(false);
  });
});

describe('FormField', () => {
  it('reaches a control the kit does not own', () => {
    const { rerender } = render(
      <FormField label="Grade" htmlFor="grade" error="Use 1 to 6" hint="As printed on the transcript">
        <input id="grade" name="grade" data-testid="grade" />
      </FormField>
    );
    const input = screen.getByTestId('grade');
    expect(screen.getByLabelText('Grade')).toBe(input);
    expect(document.getElementById('grade-error')!.textContent).toBe('Use 1 to 6');
    // An absent prop must not mint an id out of the word "undefined".
    expect(document.getElementById('undefined-error')).toBeNull();

    // The hint waits until there is no error to read: two paragraphs under one field, one of them a
    // policy line, is how a form starts talking over itself.
    expect(document.getElementById('grade-hint')).toBeNull();
    rerender(
      <FormField label="Grade" htmlFor="grade" hint="As printed on the transcript">
        <input id="grade" name="grade" data-testid="grade" />
      </FormField>
    );
    expect(document.getElementById('grade-hint')!.textContent).toBe('As printed on the transcript');
  });
});

describe('Button', () => {
  it('is a button by default, not a submit that fires a form nobody asked about', () => {
    render(<Button>Save</Button>);
    expect(attr(screen.getByRole('button', { name: 'Save' }), 'type')).toBe('button');
  });

  it('stays the same control while it waits, and says so', () => {
    render(<Button loading>Sending</Button>);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Sending');
  });

  it('turns a link action into an anchor that a new tab cannot reach back through', () => {
    render(
      <Button href="https://esme.example" target="_blank">
        Open report
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Open report' });
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.tagName).toBe('A');
  });

  it('carries the name an icon-only control cannot invent', () => {
    render(
      <IconButton aria-label="Delete event">
        <span aria-hidden="true" />
      </IconButton>
    );
    expect(screen.getByRole('button', { name: 'Delete event' })).not.toBeNull();
  });
});

describe('Spinner', () => {
  it('announces the wait when it carries a label and stays silent when the control already does', () => {
    const { rerender } = render(<Spinner label="Loading members" />);
    expect(screen.getByRole('status').textContent).toBe('Loading members');

    // `label=""` is the silent case — a button that already carries aria-busy says the same thing.
    rerender(<Spinner label="" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Surfaces', () => {
  it('gives a card that is a landmark its name', () => {
    render(
      <Card as="section" ariaLabel="Committee summary">
        <p>TE committee</p>
      </Card>
    );
    expect(screen.getByRole('region', { name: 'Committee summary' })).not.toBeNull();
  });

  it('keeps the status word in the badge, not only the colour', () => {
    render(<Badge tone="success">Approved</Badge>);
    expect(screen.getByText('Approved')).not.toBeNull();
  });

  it('types the page title as the heading the view was missing', () => {
    render(<PageHeader title="Members" subtitle="Everyone on the roster" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).not.toBeNull();
  });

  it('says which way a figure moved instead of leaving an arrow to be guessed', () => {
    render(<StatTile label="Requests" value={12} trend={{ value: '+3', direction: 'up', good: false }} />);
    const spoken = screen.getByText(/higher than last period/);
    expect(spoken.parentElement!.textContent).toContain('+3');
    expect(spoken.className).toContain('sr-only');
  });

  it('reports progress as a value a reader can hear', () => {
    render(<ProgressBar label="Onboarding" value={3} max={9} valueText="3 of 9 committees" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('9');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 of 9 committees');
    expect(bar.getAttribute('aria-label')).toBe('Onboarding');
  });

  it('interrupts for the alarming kinds of message and only murmurs for the rest', () => {
    const { unmount } = render(<Alert tone="danger">Could not reach the server</Alert>);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    unmount();

    render(<Alert tone="info">Saved as a draft</Alert>);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Saved as a draft');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('hides the placeholder shapes from the reader', () => {
    render(<Skeleton count={3} />);
    const block = document.querySelector('[aria-hidden="true"]')!;
    expect(block.querySelectorAll(':scope > div')).toHaveLength(3);
  });
});

describe('Tabs', () => {
  it('is a tablist whose panel is named by the tab that speaks', () => {
    render(<Tabs ariaLabel="Member filters" items={tabs} />);
    expect(screen.getByRole('tablist', { name: 'Member filters' })).not.toBeNull();

    const selected = screen.getByRole('tab', { selected: true });
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id);
    expect(selected.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.textContent).toBe('Working members');
  });

  it('leaves the row in one Tab press and moves inside it with arrows', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tabs ariaLabel="Member filters" items={tabs} />
        <button type="button">After the tabs</button>
      </>
    );

    // Roving tabindex: exactly one tab is in the sequence, so a four-tab row costs one stop.
    expect(screen.getAllByRole('tab').filter((t) => (t as HTMLElement).tabIndex === 0)).toHaveLength(1);

    screen.getByRole('tab', { name: 'Active' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alumni' })).toBe(document.activeElement);
    expect(screen.getByRole('tabpanel').textContent).toBe('Graduated');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Active' })).toBe(document.activeElement);

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Pending' })).toBe(document.activeElement);

    // Tab leaves the row for the panel, which is focusable because on a phone it is the scroll
    // container; a second Tab leaves the widget entirely.
    await user.tab();
    expect(screen.getByRole('tabpanel')).toBe(document.activeElement);
    await user.tab();
    expect(screen.getByRole('button', { name: 'After the tabs' })).toBe(document.activeElement);
  });

  it('counts inside the tab the number belongs to', () => {
    render(<Tabs ariaLabel="Requests" items={[{ ...tabs[2], count: 7 }]} />);
    expect(screen.getByRole('tab', { name: /Pending/ }).textContent).toContain('(7)');
  });
});

describe('Pagination', () => {
  it('marks the page you are on and refuses to leave the range', () => {
    const onChange = vi.fn();
    render(<Pagination page={3} total={12} onChange={onChange} />);

    expect(screen.getByRole('navigation', { name: 'Pagination' })).not.toBeNull();
    expect(attr(screen.getByRole('button', { name: 'Page 3' }), 'aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('has no way to step off either end', () => {
    render(<Pagination page={1} total={3} onChange={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says nothing about a page that is not offered', () => {
    render(<Pagination page={6} total={20} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Page 2' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Page 19' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Page 20' })).not.toBeNull();
  });

  it('disappears when there is only one page', () => {
    render(<Pagination page={1} total={1} onChange={vi.fn()} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('Tooltip', () => {
  it('describes the trigger from the keyboard as well as from the mouse', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Attendance counts toward the badge">
        <button type="button">Details</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button', { name: 'Details' });
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);

    await user.tab();
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('Attendance'));
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps the handler the trigger arrived with', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Tooltip label="Hidden hint">
        <button type="button" onClick={onClick}>
          Copy
        </button>
      </Tooltip>
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onClick).toHaveBeenCalled();
  });
});
