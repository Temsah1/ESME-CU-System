import type { Workbook as WorkbookInstance } from 'exceljs';
import { sanitizeCell, type ReportSheet } from '../domain/reports';

/**
 * Spec I, part two: the bytes.
 *
 * exceljs is loaded only when a download is actually pressed — the initial bundle stays free of a
 * spreadsheet engine, and a workbook exists because somebody asked for one. Cells are written as
 * text or number and never as a formula: the sanitisation applied when the sheet was built already
 * neutralised a leading '=', '+', '-', '@' or tab, and it is applied again here so this writer is
 * safe even if it is handed rows that did not come through the report builder.
 */

const NAVY = 'FF123B60';
const SLATE = 'FF475569';
const GRID = 'FFCBD5E1';

type WorkbookCtor = new () => WorkbookInstance;

/** The browser build of exceljs is a UMD bundle, so the constructor may arrive named or under default. */
function workbookConstructor(mod: typeof import('exceljs')): WorkbookCtor {
  if (mod.Workbook) return mod.Workbook as unknown as WorkbookCtor;
  const wrapped = mod as unknown as { default?: { Workbook?: WorkbookCtor } };
  if (!wrapped.default?.Workbook) throw new Error('exceljs loaded without a Workbook constructor.');
  return wrapped.default.Workbook;
}

export async function buildWorkbook(sheets: ReportSheet[], title: string): Promise<WorkbookInstance> {
  const Workbook = workbookConstructor(await import('exceljs'));
  const workbook = new Workbook();
  workbook.title = title;
  workbook.creator = 'ESME CU chapter platform';
  workbook.description = `Exported from live records. ${sheets.length} sheet(s).`;
  workbook.created = new Date();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);

    const headline = ws.addRow([title]);
    headline.font = { bold: true, size: 13, color: { argb: NAVY } };
    for (const note of sheet.notes) {
      const row = ws.addRow([String(sanitizeCell(note))]);
      row.font = { size: 9, color: { argb: SLATE } };
    }
    ws.addRow([]);

    const header = ws.addRow(sheet.columns.map((c) => String(sanitizeCell(c))));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    ws.views = [{ state: 'frozen', ySplit: header.number }];

    for (const row of sheet.rows) {
      const added = ws.addRow(row.map(sanitizeCell));
      added.eachCell((cell) => {
        if (typeof cell.value === 'string') cell.numFmt = '@';
        cell.alignment = { vertical: 'top', wrapText: false };
        cell.border = { bottom: { style: 'thin', color: { argb: GRID } } };
      });
    }

    sheet.columns.forEach((column, index) => {
      const letter = ws.getColumn(index + 1);
      const widest = sheet.rows.reduce((n, row) => Math.max(n, String(row[index] ?? '').length), column.length);
      letter.width = Math.min(56, Math.max(14, widest + 2));
    });

    if (sheet.rows.length > 0) {
      ws.autoFilter = {
        from: { row: header.number, column: 1 },
        to: { row: header.number, column: sheet.columns.length },
      };
    }

    ws.addRow(['']);
    const provenance = ws.addRow([
      `Row count ${sheet.rows.length}. Gated by capability ${sheet.capability}. Exporting this file does not grant anybody access to more records than this account already holds.`,
    ]);
    provenance.font = { size: 9, color: { argb: SLATE } };
  }

  return workbook;
}

export async function xlsxBlob(sheets: ReportSheet[], title: string): Promise<Blob> {
  const workbook = await buildWorkbook(sheets, title);
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer;
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Object URLs live only for the click that uses them, then the memory is released. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
