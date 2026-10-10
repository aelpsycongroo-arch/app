import Papa from 'papaparse';

export interface ParsedSheet {
  name: string;
  rows: string[][];
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function parseCsvText(text: string): ParsedSheet[] {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  return [{ name: 'CSV', rows: result.data.map((r) => r.map((c) => String(c ?? ''))) }];
}

/** Parses .xlsx/.xls. The xlsx library is loaded lazily so CSV-only users never download it. */
export async function parseWorkbook(data: ArrayBuffer): Promise<ParsedSheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: false, cellHTML: false, cellFormula: false });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
    return { name, rows: rows.map((r) => r.map((c) => String(c ?? ''))) };
  });
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet[]> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 10 MB.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return parseCsvText(await file.text());
  if (ext === 'xlsx' || ext === 'xls') return parseWorkbook(await file.arrayBuffer());
  throw new Error('Unsupported file type. Use .xlsx, .xls or .csv.');
}
