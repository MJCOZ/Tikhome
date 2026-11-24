import { createContext, ReactNode, useContext, useState } from 'react';
import type { Listing } from './api';

export type Filters = Partial<Record<'kind' | 'city' | 'district' | 'min' | 'max' | 'beds' | 'floor' | 'entrance' | 'media', string>>;

type Ctx = { filters: Filters; setFilters: (f: Filters) => void; mapFocus: Listing | null; setMapFocus: (l: Listing | null) => void };
const FiltersContext = createContext<Ctx>(null as unknown as Ctx);
export const useFilters = () => useContext(FiltersContext);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>({});
  const [mapFocus, setMapFocus] = useState<Listing | null>(null);
  return <FiltersContext.Provider value={{ filters, setFilters, mapFocus, setMapFocus }}>{children}</FiltersContext.Provider>;
}

export const filterCount = (f: Filters) => Object.values(f).filter((v) => v !== '' && v != null).length;
export const toQuery = (f: Filters, extra: Record<string, string | number> = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== '' && v != null) q.set(k, String(v));
  return q.toString();
};
