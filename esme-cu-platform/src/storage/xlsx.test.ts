// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { buildSheet, type ReportInput } from '../domain/reports';
import { xlsxBlob } from './xlsx';

/**
 * The claim "this is a real spreadsheet" is checked by reading the bytes back, not by trusting the
 * extension. These tests also pin the injection defence at the layer that writes the workbook: a
 * hostile cell must arrive as text, never as a formula the reader would evaluate.
 */

const input: ReportInput = {
  actor: { id: 'u1', name: 'Kareem Tamer', role: 'super_admin', committeeId: undefined },
  period: { label: 'Autumn term', from: '2026-09-01', to: '2026-12-01' },
  generatedAt: '2026-10-16T09:00:00.000Z',
  users: [
    {
      id: 'u1',
      name: '=HYPERLINK("http://evil","click")',
      email: 'evil@esme.example',
      username: 'evil',
      role: 'member',
      committeeId: 'c1',
      status: 'active',
      totalPoints: 120,
      approvedTasksCount: 7,
      joinedDate: '2026-09-01',
      lastActive: '2026-10-01',
    },
  ],
  committees: [],
  tasks: [],
  submissions: [],
  ledger: [],
  assessments: [],
  applications: [],
  audit: [],
  seasons: [],
  rollups: () => [],
};

const sheets = [buildSheet('members', input)!, buildSheet('tasks', input)!];

const reload = async () => {
  const workbook = new Workbook();
  await workbook.xlsx.load((await xlsxBlob(sheets, 'ESME CU chapter report')) as unknown as ArrayBuffer);
  return workbook;
};

const columnOne = (name: string, workbook: Awaited<ReturnType<typeof reload>>) =>
  (workbook.getWorksheet(name)!.getColumn(1).values as unknown as unknown[]).filter((v) => typeof v === 'string');

describe('xlsx writer', () => {
  it('produces an OOXML workbook, not a text file wearing an extension', async () => {
    const blob = await xlsxBlob(sheets, 'ESME CU chapter report');
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // A .xlsx is a zip container: PK\3\4 at offset 0 is what Excel actually opens on.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('round-trips both sheets with their header and provenance lines', async () => {
    const workbook = await reload();
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Members', 'Tasks']);

    const provenance = columnOne('Members', workbook);
    expect(provenance.some((v) => v.startsWith('Generated'))).toBe(true);
    expect(provenance.some((v) => v.includes('Gated by capability users.read'))).toBe(true);
    expect(provenance.filter((v) => v === 'Name')).toHaveLength(1);
  });

  it('writes a hostile name as text, so opening the file cannot run anything', async () => {
    const members = (await reload()).getWorksheet('Members')!;
    const hostile: { type: number; value: unknown }[] = [];
    members.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.text.includes('HYPERLINK')) hostile.push({ type: cell.type, value: cell.value });
      })
    );

    expect(hostile).toHaveLength(1);
    // 3 is exceljs' String type; 2 would be a Formula, which is exactly what must not happen.
    expect(hostile[0].type).toBe(3);
    expect(String(hostile[0].value).startsWith("'=")).toBe(true);
  });

  it('keeps a points column numeric so the sheet can still be summed', async () => {
    const members = (await reload()).getWorksheet('Members')!;
    const numbers: number[] = [];
    members.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') numbers.push(cell.value);
      })
    );
    expect(numbers).toContain(120);
    expect(numbers).toContain(7);
  });

  it('freezes the header row so a printed export stays readable', async () => {
    const members = (await reload()).getWorksheet('Members')!;
    const frozen = members.views?.[0] as { state?: string; ySplit?: number } | undefined;
    expect(frozen?.state).toBe('frozen');
    expect(typeof frozen?.ySplit).toBe('number');
  });
});
