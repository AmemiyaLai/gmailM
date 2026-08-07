import { GoogleGenAI } from "@google/genai";
import { env } from "./env";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = env("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const MODEL = env("GEMINI_MODEL") || "gemini-3.5-flash";

export interface UnreadEmailInput {
  sender: string;
  subject: string;
  snippet: string;
  category: string | null;
  receivedAt: Date;
}

function formatTaipeiDateTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export async function summarizeUnreadEmails(emails: UnreadEmailInput[]): Promise<string> {
  const list = emails
    .map(
      (e, i) =>
        `${i + 1}. [${formatTaipeiDateTime(e.receivedAt)}][${e.category ?? "未分類"}] 寄件者：${e.sender}｜主旨：${e.subject || "(無主旨)"}｜摘要：${e.snippet || "(無)"}`,
    )
    .join("\n");

  const prompt = `你是一位郵件助理，以下是使用者目前 ${emails.length} 個未讀收件匣討論串的代表郵件（每串取最新未讀信；每筆開頭 [MM/DD HH:mm] 是收件日期時間，時區為台北時間）：
${list}

請用繁體中文條列出重點摘要（依重要性/主題分組即可），**每一點摘要的最前面都必須標註該封信對應的收件日期與時間，格式為「[MM/DD HH:mm]」**，讓使用者能一眼判斷該事項的緊急程度。控制在 300 字以內，語氣精簡、適合放進 Discord 通知訊息。不要加入 markdown 標題語法，只需條列文字。`;

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

export interface SenderTagJudgeResult {
  tag: string;
  confidence: number;
}

export async function judgeSenderTag(email: ImportanceJudgeInput): Promise<SenderTagJudgeResult> {
  const prompt = `將這封郵件的寄件者歸入一個共享主題標籤。只能使用：banking、securities、commerce、development、media、learning、travel、security、other。
寄件者：${email.sender}\n主旨：${email.subject || "(無主旨)"}\n摘要：${email.snippet || "(無)"}\n請只回傳 JSON：{"tag":"其中一個標籤","confidence":0到1的數字}`;
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  const parsed = JSON.parse(res.text ?? "{}");
  return { tag: typeof parsed.tag === "string" ? parsed.tag : "other", confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0 };
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
