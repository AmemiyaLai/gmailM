個人自訂化 Gmail 自動化整理系統與輕量化郵
件面板建置計畫書

專案名稱:Self-Hosted Custom Gmail Automation & Real-time Dashboard System
核心架構:Astro (SSR Mode) + Supabase (PostgreSQL) + Pusher + Google Cloud
Pub/Sub + Vercel Deployment
安全防護:Cloudflare Zero Trust (Cloudflare Access) & Custom Tunnel Routing

1. 專案背景與目標 (Project Overview)
   隨著每日電子郵件量急劇增加,傳統 Gmail 介面無法針對特定領域資訊(如訂閱電子報、開發日
   誌、系統通知)進行彈性的卡片化排版與自動分類。本計畫旨在構建一套輕量、高效且全自動化的
   個人郵件管理系統。
   本系統將結合 Google Cloud Pub/Sub 實現零延遲(Sub-second)即時郵件推送,透過 Supabase
   進行郵件結構化資料庫儲存,並利用 Astro (SSR 模式) 部署於 Vercel Serverless 環境,提供高
   度自訂的 Web 瀏覽介面,最終於 Cloudflare 網域層級實施嚴格的身份存取管制(Zero Trust
   Access)。
2. 系統總體架構設計 (System Architecture)
   2.1 資料流與服務鏈架構
   模組名稱 選用技術/服務 核心職責與功能說明

郵件來源與事件源 Gmail API & GCP Pub/Sub 透過 users.watch 訂閱 Gmail
異動事件,信件進來時即時觸發
Pub/Sub Webhook。
無伺服器 API & 前端 Astro (Node.js/Vercel Adapter) 採用 SSR 模式,負責處理 GCP
Webhook、郵件內文解析、
Supabase 寫入與前端卡片渲
染。

模組名稱 選用技術/服務 核心職責與功能說明

結構化資料庫 Supabase (PostgreSQL) 儲存郵件 Header、HTML/Plain
Body、標籤與元資料,內建 Row
Level Security (RLS)。
即時事件廣播 Pusher Channels 解決 Serverless 無法常駐
WebSocket/SSE 的限制,將後
端異動毫秒級推送給瀏覽器前
端。

資安與網絡防護 Cloudflare Access (Zero Trust) 掛載於自訂主網域前,執行
OAuth 身份驗證,並設例外規則
允許 GCP Webhook 直接存取。

3. 資料庫 Schema 設計 (Supabase / PostgreSQL)
   於 Supabase 內建立 `emails` 數據表,支援 JSONB 標籤存取與關鍵字/時間快速檢索:
   -- 建立郵件核心資料表
   CREATE TABLE public.emails (
   id VARCHAR(64) PRIMARY KEY, -- Gmail Message ID
   thread_id VARCHAR(64) NOT NULL,
   sender VARCHAR(255) NOT NULL,
   recipient VARCHAR(255),
   subject TEXT,
   snippet TEXT,
   body_html TEXT,
   body_plain TEXT,
   labels JSONB DEFAULT '[]'::jsonb,
   received_at TIMESTAMPTZ NOT NULL,
   is_read BOOLEAN DEFAULT FALSE,
   created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   );
   -- 建立高效索引
   CREATE INDEX idx_emails_received_at ON public.emails(received_at DESC);
   CREATE INDEX idx_emails_sender ON public.emails(sender);
   CREATE INDEX idx_emails_thread_id ON public.emails(thread_id);

4. Astro (SSR) 核心程式碼實作 (Core Implementation)
   4.1 Astro 配置檔 (`astro.config.mjs`)
   import { defineConfig } from 'astro/config';
   import vercel from '@astrojs/vercel/serverless';
   import tailwind from '@astrojs/tailwind';
   export default defineConfig({
   output: 'server', // 開啟 SSR 模式
   adapter: vercel(),
   integrations: [tailwind()],
   });

4.2 GCP Webhook 接收與 Pusher 廣播 API Route
(`src/pages/api/webhook/gmail.ts`)
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import Pusher from 'pusher';
const supabase = createClient(
import.meta.env.SUPABASE_URL,
import.meta.env.SUPABASE_SERVICE_ROLE_KEY
);
const pusher = new Pusher({
appId: import.meta.env.PUSHER_APP_ID,
key: import.meta.env.PUSHER_KEY,
secret: import.meta.env.PUSHER_SECRET,
cluster: import.meta.env.PUSHER_CLUSTER,
useTLS: true
});
export const POST: APIRoute = async ({ request }) => {
try {
const body = await request.json();
if (!body.message || !body.message.data) {
return new Response('Invalid Pub/Sub Payload', { status: 400 });
}
// 1. 解密 GCP Pub/Sub Base64 Data
const pubsubData = JSON.parse(

Buffer.from(body.message.data, 'base64').toString('utf-8')
);
const { emailAddress, historyId } = pubsubData;
// 2. 調用 Gmail API (透過 History API 擷取最新信件,此處簡化為模擬數據寫入)
const mockEmail = {
id: `msg_${Date.now()}`,
thread_id: `thread_${historyId}`,
sender: "service@notifications.com",
recipient: emailAddress,
subject: "自動化系統即時通知:最新郵件已同步",
snippet: "這是一封透過 GCP Pub/Sub 即時同步進來的郵件範例...",
body_html: "<p>這是一封透過 GCP Pub/Sub 即時同步進來的郵件範例...</p>",
received_at: new Date().toISOString(),
labels: ["INBOX", "UNREAD"]
};
// 3. 寫入 Supabase 資料庫
const { error } = await supabase.from('emails').upsert(mockEmail);
if (error) throw error;
// 4. 發送 Pusher 即時廣播給前端 UI
await pusher.trigger('gmail-channel', 'new-email', {
email: mockEmail
});
return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
} catch (err: any) {
console.error('Webhook Error:', err);
return new Response(JSON.stringify({ error: err.message }), { status: 500 });
}
};

4.3 即時郵件儀表板前端頁面 (`src/pages/index.astro`)
---

import Layout from '../layouts/Layout.astro';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
import.meta.env.SUPABASE_URL,
import.meta.env.SUPABASE_ANON_KEY
);

// SSR 初次載入:拉取最近 20 封郵件
const { data: initialEmails } = await supabase
.from('emails')
.select('*')
.order('received_at', { ascending: false })
.limit(20);
---

<Layout title="Personal Gmail Dashboard">
<main class="max-w-5xl mx-auto p-6">
<header class="flex justify-between items-center mb-8 pb-4 border-b
border-slate-200">
<h1 class="text-2xl font-bold text-slate-800">郵件即時監控面板</h1>
<span id="status-badge" class="px-3 py-1 text-xs rounded-full bg-emerald-100
text-emerald-700">
即時同步中 (Pusher Active)
</span>
</header>
<div id="email-list" class="space-y-4">
{initialEmails && initialEmails.map((email) => (
<div class="p-4 border border-slate-200 rounded-lg bg-white shadow-sm
hover:border-blue-400 transition">

<div class="flex justify-between items-start mb-2">
<span class="font-semibold text-slate-900">{email.sender}</span>
<span class="text-xs text-slate-400">{new
Date(email.received_at).toLocaleString()}</span>

</div>
<h2 class="text-base font-medium text-blue-600 mb-1">{email.subject}</h2>
<p class="text-sm text-slate-600 line-clamp-2">{email.snippet}</p>
</div>
))}
</div>
</main>
<script src="https://js.pusher.com/8.0/pusher.min.js" is:inline></script>
<script is:inline define:vars={{ pusherKey: import.meta.env.PUBLIC_PUSHER_KEY,
cluster: import.meta.env.PUBLIC_PUSHER_CLUSTER }}>
const pusher = new Pusher(pusherKey, { cluster: cluster });
const channel = pusher.subscribe('gmail-channel');
channel.bind('new-email', function(data) {
const email = data.email;
const emailList = document.getElementById('email-list');

const newCard = document.createElement('div');
newCard.className = 'p-4 border border-blue-300 rounded-lg bg-blue-50/30
shadow-sm transition animate-pulse';
newCard.innerHTML = `
<div class="flex justify-between items-start mb-2">
<span class="font-semibold text-slate-900">\${email.sender}</span>
<span class="text-xs text-slate-400">\${new
Date(email.received_at).toLocaleString()}</span>
</div>
<h2 class="text-base font-medium text-blue-600 mb-1">\${email.subject}</h2>
<p class="text-sm text-slate-600 line-clamp-2">\${email.snippet}</p>
`;
emailList.insertBefore(newCard, emailList.firstChild);
});
</script>
</Layout>

5. Cloudflare Security & Vercel 部署設定 (Security & Deployment)
   5.1 Cloudflare Access 防護組態
1. 存取管制設置 (Zero Trust App): 在 Cloudflare Access 建立應用程式並綁定自訂子網域
   mail.yourdomain.com,限制僅特定 Email / Identity Provider 可存取。
1. Webhook 豁免規則 (Bypass Policy): 為避免 GCP Pub/Sub 打入 Webhook 時遭到驗證頁
   面攔截,需新增一條 Policy:
   ○ Action: Bypass
   ○ Include: Path `/api/webhook/gmail`
   5.2 Vercel 環境變數設定 (Environment Variables)
   變數名稱 類型 / 說明

SUPABASE_URL Server-side (Supabase API Endpoint)
SUPABASE_SERVICE_ROLE_KEY Server-side Secret (具有 Database 寫入權限)
PUSHER_APP_ID / PUSHER_SECRET Server-side Secret (用於觸發 Trigger)

變數名稱 類型 / 說明

PUBLIC_PUSHER_KEY /
PUBLIC_PUSHER_CLUSTER

Client-side Public (提供前端 JS 連線)

6. 結論與預期效益
   本計畫成功結合 Astro SSR 的 Serverless 高效能特性與 Google Cloud Pub/Sub 的即時推送
   能力,打造出零養護成本(全部使用各平台免費額度)且安全等級極高的自訂郵件管理系統。系統
   預計可達到少於 1 秒的郵件同步延遲,同時完全保有地端與雲端資料庫的擴充彈性。
