import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";

/**
 * Phone bottom sheets share the bottom of the screen: a lowered sheet becomes a bar, bars stack
 * (first opened at the bottom), and at most one sheet is raised, sitting on top of the bars.
 * Raising a sheet lowers the one that was up; closing a raised sheet raises again the one it pushed down.
 */

/** Height of a lowered sheet's bar. */
export const PEEK = 64;

interface Entry {
  order: number;
  down: boolean;
  /** Height of the sheet when raised (measured). */
  h: number;
  /** Lowered automatically when this other sheet was raised. */
  loweredBy?: string;
}

interface Dock {
  entries: Record<string, Entry>;
  register(id: string, down: boolean): void;
  unregister(id: string): void;
  setDown(id: string, down: boolean): void;
  setHeight(id: string, h: number): void;
}

const Ctx = createContext<Dock | null>(null);

let counter = 0;

export function SheetDockProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const register = useCallback((id: string, down: boolean) => {
    setEntries((e) => {
      if (e[id]) return e;
      const next: Record<string, Entry> = {};
      // a sheet that opens raised pushes the raised one down
      for (const [k, v] of Object.entries(e)) next[k] = !down && !v.down ? { ...v, down: true, loweredBy: id } : v;
      next[id] = { order: ++counter, down, h: 0 };
      return next;
    });
  }, []);
  const unregister = useCallback((id: string) => {
    setEntries((e) => {
      if (!e[id]) return e;
      const wasUp = !e[id]!.down;
      const next: Record<string, Entry> = {};
      for (const [k, v] of Object.entries(e)) {
        if (k === id) continue;
        next[k] = wasUp && v.loweredBy === id ? { ...v, down: false, loweredBy: undefined } : v.loweredBy === id ? { ...v, loweredBy: undefined } : v;
      }
      return next;
    });
  }, []);
  const setDown = useCallback((id: string, down: boolean) => {
    setEntries((e) => {
      if (!e[id]) return e;
      const next: Record<string, Entry> = {};
      for (const [k, v] of Object.entries(e)) {
        if (k === id) next[k] = { ...v, down, loweredBy: undefined };
        else if (!down && !v.down) next[k] = { ...v, down: true, loweredBy: id };
        else next[k] = v;
      }
      return next;
    });
  }, []);
  const setHeight = useCallback((id: string, h: number) => {
    setEntries((e) => (e[id] && Math.abs(e[id]!.h - h) > 1 ? { ...e, [id]: { ...e[id]!, h } } : e));
  }, []);
  const value = useMemo(() => ({ entries, register, unregister, setDown, setHeight }), [entries, register, unregister, setDown, setHeight]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Position of one sheet in the dock. Without a provider (wide screens) the sheet is on its own. */
export function useDockedSheet(id: string, initialDown = false, maxFrac = 0.88) {
  const dock = useContext(Ctx);
  const { height } = useWindowDimensions();
  const [localDown, setLocalDown] = useState(initialDown);
  const first = useRef(initialDown);
  useEffect(() => {
    if (!dock) return;
    dock.register(id, first.current);
    return () => dock.unregister(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!dock]);
  if (!dock) return { down: localDown, setDown: setLocalDown, bottom: 0, maxHeight: Math.round(height * maxFrac), setHeight: () => undefined };
  const me = dock.entries[id];
  const lowered = Object.entries(dock.entries).filter(([, v]) => v.down).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  const down = me ? me.down : first.current;
  const bars = lowered.length;
  return {
    down,
    setDown: (d: boolean) => dock.setDown(id, d),
    // a bar sits in its place in the stack; a raised sheet sits on top of all the bars
    bottom: down ? Math.max(0, lowered.indexOf(id)) * PEEK : bars * PEEK,
    maxHeight: Math.round(height * maxFrac) - bars * PEEK,
    setHeight: (h: number) => dock.setHeight(id, h),
  };
}

/** Space the sheets take at the bottom of the screen (for the map's floating buttons). */
export function useDockInset(): number {
  const dock = useContext(Ctx);
  if (!dock) return 0;
  const all = Object.values(dock.entries);
  const bars = all.filter((v) => v.down).length * PEEK;
  const up = all.find((v) => !v.down);
  return bars + (up ? up.h : 0);
}

/** Render prop for elements that must stay above the sheets (e.g. a legend card on the map). */
export function DockAware({ children }: { children(inset: number): ReactNode }) {
  return <>{children(useDockInset())}</>;
}
