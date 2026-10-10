import { create } from 'zustand';
import type { ColumnMapping, RowOverride } from '../domain/matching';
import type { ParsedSheet } from '../domain/spreadsheet';

/** In-progress picking-list import. Kept in memory so it survives page switches. */
export interface ImportDraft {
  fileName: string;
  sheets: ParsedSheet[];
  sheetIndex: number;
  hasHeader: boolean;
  mapping: ColumnMapping;
  overrides: Record<number, RowOverride>;
  listName: string;
}

interface ImportState extends ImportDraft {
  patch(p: Partial<ImportDraft>): void;
  setOverride(rowNumber: number, o: RowOverride | ((prev: RowOverride) => RowOverride)): void;
  reset(): void;
}

const INITIAL: ImportDraft = {
  fileName: '',
  sheets: [],
  sheetIndex: 0,
  hasHeader: true,
  mapping: { sku: null, name: null, quantity: null },
  overrides: {},
  listName: '',
};

export const useImportDraft = create<ImportState>()((set, get) => ({
  ...INITIAL,
  patch(p) {
    set(p);
  },
  setOverride(rowNumber, o) {
    const prev = get().overrides[rowNumber] ?? {};
    set({ overrides: { ...get().overrides, [rowNumber]: typeof o === 'function' ? o(prev) : o } });
  },
  reset() {
    set(INITIAL);
  },
}));
