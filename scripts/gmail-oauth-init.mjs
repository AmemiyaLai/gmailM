import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";

// gmail.modify 涵蓋讀取（listHistory/getMessage/listMessages/watch）與修改
// （messages.modify 的已讀/星號/封存、messages.trash）。永久刪除才需要更大的
// https://mail.google.com/，本專案未使用。
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const PORT = 3847;

const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("請先設定 GMAIL_OAUTH_CLIENT_ID 與 GMAIL_OAUTH_CLIENT_SECRET 環境變數");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  `http://localhost:${PORT}/callback`,
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Missing code parameter");
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><body style="font-family:sans-serif;padding:40px;">
          <h1>OAuth 成功！</h1>
          <p>請將以下 refresh token 加入你的 .env：</p>
          <pre style="background:#f4f4f4;padding:16px;border-radius:8px;">GMAIL_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}</pre>
          <p>你可以關閉此視窗了。</p>
        </body></html>
      `);
      console.log("\n✅ Refresh Token:", tokens.refresh_token);
    } catch (err) {
      res.writeHead(500);
      res.end("Token exchange failed");
      console.error("Token exchange failed:", err);
    } finally {
      server.close();
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🔗 請在瀏覽器中開啟以下網址完成授權：\n\n${authUrl}\n`);
});
