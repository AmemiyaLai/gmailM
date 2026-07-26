import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: import.meta.env.GEMINI_API_KEY });
  }
  return client;
}

const MODEL = import.meta.env.GEMINI_MODEL || "gemini-2.5-flash";

export interface UnreadEmailInput {
  sender: string;
  subject: string;
  snippet: string;
  category: string | null;
  receivedAt: Date;
}

export async function summarizeUnreadEmails(emails: UnreadEmailInput[]): Promise<string> {
  const list = emails
    .map(
      (e, i) =>
        `${i + 1}. [${e.category ?? "未分類"}] 寄件者：${e.sender}｜主旨：${e.subject || "(無主旨)"}｜摘要：${e.snippet || "(無)"}｜時間：${e.receivedAt.toISOString()}`,
    )
    .join("\n");

  const prompt = `你是一位郵件助理，以下是使用者目前尚未讀取的 ${emails.length} 封郵件清單：
${list}

請用繁體中文條列出重點摘要（依重要性/主題分組即可），控制在 300 字以內，語氣精簡、適合放進 Discord 通知訊息。不要加入 markdown 標題語法，只需條列文字。`;

  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  return res.text?.trim() || "(Gemini 未回傳摘要內容)";
}

export interface ImportanceJudgeInput {
  sender: string;
  subject: string;
  snippet: string;
}

export interface ImportanceResult {
  important: boolean;
  reason?: string;
}

export async function judgeEmailImportance(email: ImportanceJudgeInput): Promise<ImportanceResult> {
  const prompt = `判斷以下郵件對收件者而言是否為「重要郵件」（例如：需要立即處理的通知、帳務/安全性警示、重要人物來信、待辦事項截止提醒等；廣告、電子報、行銷推播、一般系統自動通知通常不算重要）。

寄件者：${email.sender}
主旨：${email.subject || "(無主旨)"}
內容摘要：${email.snippet || "(無)"}

請只回傳 JSON，不要有其他文字，格式如下：
{"important": boolean, "reason": "一句話說明理由（繁體中文，20字內）"}`;

  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          important: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["important"],
      },
    },
  });

  const parsed = JSON.parse(res.text ?? "{}");
  return {
    important: Boolean(parsed.important),
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
  };
}
