// @vitest-environment jsdom
/**
 * The table primitive as a surface: search, sort, paging, per-row actions, the confirmation a
 * destructive one demands, and the same rows as cards below the desktop breakpoint. Rows here are
 * plain objects because the subject is the table, not any one screen's data.
 */
import React from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; name: string; team: string; points: number };

const ROWS: Row[] = [
  { id: 'r1', name: 'Nada', team: 'M&C', points: 40 },
  { id: 'r2', name: 'Karim', team: 'T&E', points: 90 },
  { id: 'r3', name: 'Salma', team: 'M&C', points: 10 },
  { id: 'r4', name: 'Adel', team: 'DES', points: 70 },
  { id: 'r5', name: 'Youssef', team: 'T&E', points: 20 },
  { id: 'r6', name: 'Hana', team: 'MKT', points: 60 },
  { id: 'r7', name: 'Mazen', team: 'DES', points: 30 },
  { id: 'r8', name: 'Rana', team: 'T&E', points: 80 },
  { id: 'r9', name: 'Dina', team: 'M&C', points: 50 },
  { id: 'r10', name: 'Fares', team: 'MKT', points: 100 },
  { id: 'r11', name: 'Lulu', team: 'DES', points: 110 },
];

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let DataTable: typeof import('./DataTable')['DataTable'];
type DataTableAction<T> = import('./DataTable').DataTableAction<T>;

beforeEach(async () => {
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  DataTable = (await import('./DataTable')).DataTable;
});

afterEach(() => TL.cleanup());

/** jsdom reports no media queries, so the breakpoint the table switches on has to be stated. */
const stubViewport = (desktop: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

const COLUMNS = [
  {
    key: 'name',
    label: 'Member',
    cardTitle: true,
    sortValue: (r: Row) => r.name,
    render: (r: Row) => <span className="font-bold">{r.name}</span>,
  },
  { key: 'team', label: 'Committee', sortValue: (r: Row) => r.team, render: (r: Row) => <span>{r.team}</span> },
  {
    key: 'points',
    label: 'Points',
    align: 'center' as const,
    sortValue: (r: Row) => r.points,
    render: (r: Row) => <span>{r.points}</span>,
  },
];

function renderTable(over: Partial<import('./DataTable').DataTableProps<Row>> = {}) {
  const props: import('./DataTable').DataTableProps<Row> = {
    rows: ROWS,
    columns: COLUMNS,
    rowKey: (r) => r.id,
    searchText: (r) => `${r.name} ${r.team}`,
    searchPlaceholder: 'Search members',
    noMatchesLabel: 'Nothing matches this search.',
    empty: { title: 'No rows', description: 'Nothing was recorded.' },
    ...over,
  };
  TL.render(<DataTable<Row> {...props} />);
}

const namesInRows = () =>
  Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td')?.textContent ?? '');

describe('the table on a desktop viewport', () => {
  beforeEach(() => stubViewport(true));

  it('pages, and the footer names the slice actually shown', () => {
    renderTable({ pageSize: 4 });
    expect(namesInRows()).toEqual(['Nada', 'Karim', 'Salma', 'Adel']);
    expect(TL.screen.getByText('Showing 1–4 of 11')).toBeTruthy();
    expect(TL.screen.getByText('Page 1 of 3')).toBeTruthy();
    expect((TL.screen.getByLabelText('Previous page') as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks the pages and stops at the end', async () => {
    const user = await userEvent.setup();
    renderTable({ pageSize: 4 });
    await user.click(TL.screen.getByLabelText('Next page'));
    expect(TL.screen.getByText('Showing 5–8 of 11')).toBeTruthy();
    await user.click(TL.screen.getByLabelText('Next page'));
    expect(TL.screen.getByText('Showing 9–11 of 11')).toBeTruthy();
    expect((TL.screen.getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(true);
  });

  it('searches across the fields the caller declares', async () => {
    const user = await userEvent.setup();
    renderTable({ pageSize: 0 });
    await user.type(TL.screen.getByRole('searchbox', { name: 'Search members' }), 'Karim');
    expect(namesInRows()).toEqual(['Karim']);
    expect(TL.screen.queryByText('Showing')).toBeNull();
  });

  it('says so when the search matches nothing, without pretending the table is empty', async () => {
    const user = await userEvent.setup();
    renderTable();
    await user.type(TL.screen.getByRole('searchbox', { name: 'Search members' }), 'nobody here');
    expect(await TL.screen.findByText('Nothing matches this search.')).toBeTruthy();
    expect(TL.screen.queryByText('No rows')).toBeNull();
  });

  it('sorts a column ascending, then descending, then not at all', async () => {
    const user = await userEvent.setup();
    renderTable({ pageSize: 0 });

    await user.click(TL.screen.getByRole('button', { name: 'Points' }));
    expect(namesInRows()[0]).toBe('Salma');
    await user.click(TL.screen.getByRole('button', { name: 'Points' }));
    expect(namesInRows()[0]).toBe('Lulu');
    await user.click(TL.screen.getByRole('button', { name: 'Points' }));
    expect(namesInRows()).toEqual(['Nada', 'Karim', 'Salma', 'Adel', 'Youssef', 'Hana', 'Mazen', 'Rana', 'Dina', 'Fares', 'Lulu']);
  });

  it('keeps a filter that empties the list on the same page it was on', async () => {
    const user = await userEvent.setup();
    const { rerender } = TL.render(
      <DataTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        searchText={(r) => r.name}
        searchPlaceholder="Search members"
        noMatchesLabel="Nothing matches this search."
        empty={{ title: 'No rows', description: 'Nothing was recorded.' }}
        pageSize={4}
      />
    );
    await user.click(TL.screen.getByLabelText('Next page'));
    expect(TL.screen.getByText('Showing 5–8 of 11')).toBeTruthy();

    rerender(
      <DataTable<Row>
        rows={ROWS.slice(0, 3)}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        searchText={(r) => r.name}
        searchPlaceholder="Search members"
        noMatchesLabel="Nothing matches this search."
        empty={{ title: 'No rows', description: 'Nothing was recorded.' }}
        pageSize={4}
      />
    );
    // Three rows now fit on one page, so the list falls back to it instead of showing a blank one.
    expect(namesInRows()).toEqual(['Nada', 'Karim', 'Salma']);
    expect(TL.screen.queryByText(/Showing/)).toBeNull();
  });

  it('renders the empty state only when the collection itself has no rows', () => {
    renderTable({ rows: [] });
    expect(TL.screen.getByText('No rows')).toBeTruthy();
    expect(TL.screen.getByText('Nothing was recorded.')).toBeTruthy();
    expect(TL.screen.queryByRole('searchbox')).toBeNull();
  });
});

describe('row actions', () => {
  beforeEach(() => stubViewport(true));

  it('fires an action that needs no confirmation immediately', async () => {
    const user = await userEvent.setup();
    const edit = vi.fn();
    renderTable({
      actions: [{ key: 'edit', label: 'Open record', icon: Pencil, onClick: edit }],
      pageSize: 4,
    });
    await user.click(TL.screen.getAllByLabelText('Open record')[0]);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ id: 'r1' });
  });

  it('holds a destructive action until the dialog confirms it', async () => {
    const user = await userEvent.setup();
    const remove = vi.fn();
    const actions: DataTableAction<Row>[] = [
      {
        key: 'remove',
        label: 'Remove this row',
        icon: Trash2,
        danger: true,
        confirm: {
          title: 'Remove this row?',
          body: (r) => `${r.name} leaves the list.`,
          confirmLabel: 'Remove permanently',
        },
        onClick: remove,
      },
    ];
    renderTable({ actions, pageSize: 1 });

    await user.click(TL.screen.getByLabelText('Remove this row'));
    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Nada leaves the list.');
    expect(remove).not.toHaveBeenCalled();

    await user.click(TL.screen.getByRole('button', { name: 'Remove permanently' }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toMatchObject({ id: 'r1' });
  });

  it('writes nothing when the confirmation is refused', async () => {
    const user = await userEvent.setup();
    const remove = vi.fn();
    renderTable({
      actions: [
        {
          key: 'remove',
          label: 'Remove this row',
          icon: Trash2,
          danger: true,
          confirm: { title: 'Remove this row?', body: (r) => `${r.name} leaves the list.` },
          onClick: remove,
        },
      ],
      pageSize: 1,
    });

    await user.click(TL.screen.getByLabelText('Remove this row'));
    const dialog = await TL.screen.findByRole('dialog');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('drops an action a per-row rule hides and disables one a rule blocks', () => {
    renderTable({
      actions: [
        { key: 'edit', label: 'Open record', icon: Pencil, hidden: (r) => r.team === 'M&C', onClick: vi.fn() },
        { key: 'remove', label: 'Remove', icon: Trash2, disabled: (r) => r.id === 'r1', onClick: vi.fn() },
      ],
      pageSize: 4,
    });
    // First page rows: Nada (M&C, r1), Karim (T&E), Salma (M&C), Adel (DES).
    expect(TL.screen.getAllByLabelText('Open record')).toHaveLength(2);
    const removes = TL.screen.getAllByLabelText('Remove') as HTMLButtonElement[];
    expect(removes).toHaveLength(4);
    expect(removes[0]?.disabled).toBe(true);
    expect(removes[1]?.disabled).toBe(false);
  });
});

describe('the narrow layout', () => {
  beforeEach(() => stubViewport(false));

  it('turns every row into a card that keeps its labels', async () => {
    const user = await userEvent.setup();
    const edit = vi.fn();
    renderTable({
      pageSize: 2,
      actions: [{ key: 'edit', label: 'Open record', icon: Pencil, onClick: edit }],
    });
    expect(document.querySelector('table')).toBeNull();
    const cards = document.querySelectorAll('ul > li');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Nada');
    // The card prints the column labels a table would have put in its header.
    expect(TL.screen.getAllByText('Committee').length).toBeGreaterThan(0);
    expect(TL.screen.getAllByText('Points').length).toBeGreaterThan(0);
    await user.click(TL.screen.getAllByLabelText('Open record')[0]);
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ id: 'r1' });
  });

  it('still searches across the cards', async () => {
    const user = await userEvent.setup();
    renderTable({ pageSize: 2 });
    await user.type(TL.screen.getByRole('searchbox', { name: 'Search members' }), 'Karim');
    const cards = document.querySelectorAll('ul > li');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain('Karim');
  });
});
