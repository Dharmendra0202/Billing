import { createClient } from "@supabase/supabase-js";

const getSupabaseUrl = () => import.meta.env.VITE_SUPABASE_URL || localStorage.getItem("supabase_url") || "";
const getSupabaseAnonKey = () => import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem("supabase_anon_key") || "";

export const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());

export function isSupabaseConfigured() {
  return !!(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getStoredConfig() {
  return {
    url: getSupabaseUrl(),
    key: getSupabaseAnonKey(),
    isEnv: !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  };
}

export function updateSupabaseConfig(url: string, key: string) {
  localStorage.setItem("supabase_url", url.trim());
  localStorage.setItem("supabase_anon_key", key.trim());
}

export function clearSupabaseConfig() {
  localStorage.removeItem("supabase_url");
  localStorage.removeItem("supabase_anon_key");
}

export async function fetchSavedBills() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from("saved_bills")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveBillToCloud(bill: {
  id?: string;
  bill_title: string;
  client_name: string;
  client_address: string;
  date: string;
  subject: string;
  advance: number;
  header: any;
  rows: any;
}) {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  
  const payload: any = {
    bill_title: bill.bill_title,
    client_name: bill.client_name,
    client_address: bill.client_address,
    date: bill.date,
    subject: bill.subject,
    advance: bill.advance,
    header: bill.header,
    rows: bill.rows
  };
  
  if (bill.id) {
    payload.id = bill.id;
  }
  
  const { data, error } = await supabase
    .from("saved_bills")
    .upsert(payload)
    .select();
    
  if (error) throw error;
  return data?.[0];
}

export async function deleteBillFromCloud(id: string) {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("saved_bills")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
