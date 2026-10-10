import { create } from 'zustand';

export type Page = 'map' | 'products' | 'import' | 'route' | 'worker' | 'settings';
export const PAGES: { id: Page; label: string }[] = [
  { id: 'map', label: 'Warehouse Map' },
  { id: 'products', label: 'Products' },
  { id: 'import', label: 'Import Picking List' },
  { id: 'route', label: 'Picking Route' },
  { id: 'worker', label: 'Worker Mode' },
  { id: 'settings', label: 'Settings' },
];

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

interface UiState {
  page: Page;
  selectedPickListId: string | null;
  activeSessionId: string | null;
  toasts: Toast[];
  navigate(page: Page): void;
  setSelectedPickList(id: string | null): void;
  setActiveSession(id: string | null): void;
  toast(text: string, tone?: Toast['tone']): void;
}

const pageFromHash = (): Page => {
  const h = typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === h) ? (h as Page) : 'map';
};

let toastId = 0;

export const useUi = create<UiState>()((set, get) => ({
  page: pageFromHash(),
  selectedPickListId: null,
  activeSessionId: null,
  toasts: [],
  navigate(page) {
    if (location.hash !== `#/${page}`) location.hash = `#/${page}`;
    set({ page });
  },
  setSelectedPickList(id) {
    set({ selectedPickListId: id });
  },
  setActiveSession(id) {
    set({ activeSessionId: id });
  },
  toast(text, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === 'error' ? 5000 : 3000);
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => useUi.setState({ page: pageFromHash() }));
}
