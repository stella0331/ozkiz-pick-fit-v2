// Starts an AI job (look scoring or virtual try-on image) for one look row.
//
// Why it's split in three: image generation and web-search-backed scoring can
// take minutes, far beyond a normal function's ~10s limit. So this function only
// validates the request, saves a "queued" job row in Supabase, and kicks off
// ai-run-background (which can run up to 15 minutes). The browser then polls
// ai-job for the result.
const crypto = require("crypto");
const { sbFetch, uploadToStorage } = require("./_store");

const BUCKET = "product-images"; // reuse the existing public bucket; files go under ai-models/ and tryon/
const MAX_ITEMS = 12;
const HOURLY_LIMIT = Number(process.env.AI_HOURLY_LIMIT || 40); // safety net against runaway API spend

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST만 지원해요." });
  try {
    const body = JSON.parse(event.body || "{}");
    const { type, shootId, rowId, signature } = body;
    if (type !== "score" && type !== "tryon") return json(400, { error: "알 수 없는 작업이에요." });
    if (!shootId || !rowId) return json(400, { error: "프로젝트/착장 정보가 없어요." });

    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (items.length === 0) return json(400, { error: "제품이 없는 착장이에요." });

    // Fail fast with a readable message instead of failing later in the background.
    if (type === "score" && !process.env.ANTHROPIC_API_KEY) {
      return json(500, { error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았어요. Netlify 환경변수에 등록해주세요." });
    }
    if (type === "tryon" && !process.env.OPENAI_API_KEY) {
      return json(500, { error: "OPENAI_API_KEY 환경변수가 설정되지 않았어요. Netlify 환경변수에 등록해주세요." });
    }

    // Rate limit: total jobs created in the last hour.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await sbFetch(`/ai_jobs?created_at=gte.${encodeURIComponent(since)}&select=id&limit=1000`);
    if ((recent || []).length >= HOURLY_LIMIT) {
      return json(429, { error: `AI 요청이 너무 많아요. 1시간에 ${HOURLY_LIMIT}건까지 가능해요. 잠시 후 다시 시도해주세요.` });
    }

    const jobId = crypto.randomUUID();

    // Try-on needs the model photo as a URL the background function can fetch.
    let modelImageUrl = "";
    if (type === "tryon") {
      const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(body.modelImage || "");
      if (!m) return json(400, { error: "모델 사진을 읽지 못했어요. 모델 사진을 다시 올려주세요." });
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > 4.5 * 1024 * 1024) return json(400, { error: "모델 사진이 너무 커요." });
      const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
      modelImageUrl = await uploadToStorage(BUCKET, `ai-models/${jobId}.${ext}`, bytes, m[1]);
    }

    const input = {
      rowLabel: clip(body.rowLabel, 60),
      boardCategory: clip(body.boardCategory, 20),
      model: body.model
        ? {
            name: clip(body.model.name, 80),
            clothingSize: clip(body.model.clothingSize, 10),
            shoeSize: clip(body.model.shoeSize, 10),
          }
        : null,
      modelImageUrl,
      items: items.map((it) => ({
        id: clip(it.id, 64),
        slot: clip(it.slot, 40),
        name: clip(it.name, 120),
        category: clip(it.category, 40),
        gender: clip(it.gender, 20),
        season: clip(it.season, 40),
        size: clip(it.size, 40),
        note: clip(it.note, 200),
      })),
    };

    await sbFetch("/ai_jobs", {
      method: "POST",
      body: JSON.stringify([
        {
          id: jobId,
          shoot_id: clip(shootId, 80),
          row_id: clip(rowId, 80),
          type,
          status: "queued",
          signature: clip(signature, 2000),
          input,
        },
      ]),
    });

    // Fire the background function. It answers 202 right away; only the job id is
    // sent because background functions have a small request-payload limit.
    const siteUrl = process.env.URL || `https://${event.headers.host}`;
    const trigger = await fetch(`${siteUrl}/.netlify/functions/ai-run-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    if (!trigger.ok && trigger.status !== 202) {
      await sbFetch(`/ai_jobs?id=eq.${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "error", error: `백그라운드 실행 실패 (${trigger.status})`, updated_at: new Date().toISOString() }),
      });
      return json(500, { error: `백그라운드 작업을 시작하지 못했어요 (${trigger.status}).` });
    }

    return json(200, { id: jobId });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
