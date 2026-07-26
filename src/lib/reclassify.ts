import { getSupabase } from "./supabase";
import { classifyEmail } from "./classify";

export interface ReclassifyResult {
  total: number;
  updated: number;
  unchanged: number;
}

const PAGE_SIZE = 500;

interface EmailRow {
  id: string;
  sender: string;
  subject: string;
  category: string | null;
}

/** 依目前 classify.ts 規則重新掃描既有信件，僅更新分類有變動的資料列。 */
export async function reclassifyEmails(): Promise<ReclassifyResult> {
  const supabase = getSupabase();

  let total = 0;
  let updated = 0;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("emails" as never)
      .select("id, sender, subject, category")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const rows = (data ?? []) as unknown as EmailRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      total++;
      const category = classifyEmail({ sender: row.sender, subject: row.subject });
      if (category === row.category) continue;

      const { error: updateError } = await supabase
        .from("emails" as never)
        .update({ category } as never)
        .eq("id", row.id);

      if (updateError) throw updateError;
      updated++;
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { total, updated, unchanged: total - updated };
}
