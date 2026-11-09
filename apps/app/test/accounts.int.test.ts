// Integration test against a running Supabase (local: `npx supabase start`). Skipped unless
// SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_KEY are set.
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_TEST_URL"], anon = process.env["SUPABASE_TEST_ANON_KEY"], service = process.env["SUPABASE_TEST_SERVICE_KEY"];

describe.runIf(!!(url && anon && service))("accounts (Supabase, Row Level Security)", () => {
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const stamp = Date.now();

  async function userClient(name: string) {
    const email = `${name}.${stamp}@example.test`, password = `pw-${stamp}-${name}!`;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const c = createClient(url!, anon!, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password });
    if (s.error) throw s.error;
    return { c, id: s.data.user!.id };
  }

  it("creates a profile on sign-up and keeps each user's plots private", async () => {
    const a = await userClient("anna"), b = await userClient("babis");
    const prof = await a.c.from("profiles").select("id, locale").single();
    expect(prof.data).toMatchObject({ id: a.id, locale: "el" });

    const ins = await a.c.from("saved_plots").insert({ country_code: "CY", national_ref: "4000-40/56W1-3-1-666", label: "Τεμάχιο 666", note: "δίπλα στο σχολείο", comparables: [{ date: "2026-10-03", price: 212500, areaM2: 85, kind: "apartment" }] }).select().single();
    expect(ins.error).toBeNull();
    expect(ins.data.user_id).toBe(a.id);

    // the other user sees nothing and cannot change it
    expect((await b.c.from("saved_plots").select("*")).data).toEqual([]);
    const upd = await b.c.from("saved_plots").update({ note: "hacked" }).eq("id", ins.data.id).select();
    expect(upd.data).toEqual([]);
    const del = await b.c.from("saved_plots").delete().eq("id", ins.data.id).select();
    expect(del.data).toEqual([]);
    // nor write rows in someone else's name
    const forged = await b.c.from("saved_plots").insert({ user_id: a.id, country_code: "CY", national_ref: "x" });
    expect(forged.error).not.toBeNull();

    // the owner still has it, unchanged; saving the same plot again updates it
    const mine = await a.c.from("saved_plots").select("note, comparables").eq("id", ins.data.id).single();
    expect(mine.data!.note).toBe("δίπλα στο σχολείο");
    const up = await a.c.from("saved_plots").upsert({ country_code: "CY", national_ref: "4000-40/56W1-3-1-666", note: "νέα σημείωση" }, { onConflict: "user_id,country_code,national_ref" }).select().single();
    expect(up.data!.id).toBe(ins.data.id);

    // anonymous callers read nothing
    const anonClient = createClient(url!, anon!, { auth: { persistSession: false } });
    expect((await anonClient.from("saved_plots").select("*")).data).toEqual([]);

    await admin.auth.admin.deleteUser(a.id);
    await admin.auth.admin.deleteUser(b.id);
    // deleting the user deletes their plots
    expect((await admin.from("saved_plots").select("id").eq("id", ins.data.id)).data).toEqual([]);
  }, 30_000);
});
