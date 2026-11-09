// Supabase client for accounts. Configured with public values only (project URL and anon key);
// without them the app runs as before, with no sign-in. Row Level Security protects the data.
import { Platform } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function storage() {
  if (Platform.OS === "web") return undefined; // localStorage
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@react-native-async-storage/async-storage").default;
}

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { storage: storage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

export const accountsEnabled = supabase !== null;
