interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const result = await env.DB
    .prepare("SELECT 1 AS ok")
    .first<{ ok: number }>();

  return Response.json({
    ok: result?.ok === 1,
    service: "cloudflare-d1",
  });
};
