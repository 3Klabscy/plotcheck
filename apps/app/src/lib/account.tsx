// Signed-in user (e-mail code, no password) and the user's saved plots.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { ComparableSale } from "@plotcheck/engine";
import type { UseType } from "@plotcheck/core";
import { supabase } from "./supabase";
import type { UserCollection } from "./userLayer";

export interface SavedPlot {
  id: string;
  country_code: string;
  national_ref: string;
  label: string | null;
  note: string | null;
  centroid_lng: number | null;
  centroid_lat: number | null;
  area_m2: number | null;
  zone_code: string | null;
  use_type: UseType | null;
  comparables: ComparableSale[];
  drawings: UserCollection;
  updated_at: string;
}

export type SavedPlotInput = Omit<SavedPlot, "id" | "updated_at">;

interface AccountState {
  enabled: boolean;
  session: Session | null;
  email?: string;
  plots: SavedPlot[];
  sendCode(email: string): Promise<string | undefined>;
  verifyCode(email: string, code: string): Promise<string | undefined>;
  signOut(): Promise<void>;
  savePlot(p: SavedPlotInput): Promise<SavedPlot | undefined>;
  updatePlot(id: string, patch: Partial<SavedPlotInput>): Promise<void>;
  removePlot(id: string): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AccountState | null>(null);

const errKey = (e: { message?: string; status?: number } | null | undefined) => {
  if (!e) return undefined;
  const m = (e.message ?? "").toLowerCase();
  if (m.includes("rate") || e.status === 429) return "auth_rate";
  if (m.includes("expired") || m.includes("invalid")) return "auth_code";
  if (m.includes("email")) return "auth_email";
  return "generic";
};

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [plots, setPlots] = useState<SavedPlot[]>([]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!supabase || !session) return setPlots([]);
    const { data } = await supabase.from("saved_plots").select("*").order("updated_at", { ascending: false }).limit(200);
    setPlots((data ?? []) as SavedPlot[]);
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AccountState>(() => ({
    enabled: !!supabase,
    session,
    ...(session?.user.email ? { email: session.user.email } : {}),
    plots,
    async sendCode(email) {
      if (!supabase) return "generic";
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
      return errKey(error);
    },
    async verifyCode(email, code) {
      if (!supabase) return "generic";
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
      return errKey(error);
    },
    async signOut() {
      await supabase?.auth.signOut();
      setPlots([]);
    },
    async savePlot(p) {
      if (!supabase || !session) return undefined;
      const { data, error } = await supabase.from("saved_plots").upsert(p, { onConflict: "user_id,country_code,national_ref" }).select().single();
      if (error) throw error;
      await refresh();
      return data as SavedPlot;
    },
    async updatePlot(id, patch) {
      if (!supabase || !session) return;
      await supabase.from("saved_plots").update(patch).eq("id", id);
      setPlots((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    async removePlot(id) {
      if (!supabase || !session) return;
      await supabase.from("saved_plots").delete().eq("id", id);
      setPlots((ps) => ps.filter((p) => p.id !== id));
    },
    refresh,
  }), [session, plots, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount outside AccountProvider");
  return v;
}
