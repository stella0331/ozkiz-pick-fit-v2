// Background worker (the "-background" suffix makes Netlify answer 202 immediately
// and let this run for up to 15 minutes). Does the slow part of an AI job:
//   - score : Claude (Anthropic API) looks at the product images, optionally with
//             web search for current kids-fashion trends and competitor brands
//   - tryon : OpenAI image edit puts the products on the virtual model photo
// Results are written to the ai_jobs row; the browser polls ai-job to read them.
//
// IMPORTANT: this handler never throws. Netlify retries a failed background
// invocation, which here would mean paying for the same API call twice.
const { sbFetch, uploadToStorage } = require("./_store");

const BUCKET = "product-images";
const COMPETITORS = ["베베드피노", "리미떼두두", "슈슈앤크라", "아베끄뚜아", "보보쇼즈", "로아앤제인", "아프리콧 스튜디오"];
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;

async function patchJob(id, fields) {
  await sbFetch(`/ai_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

// ---------- image loading ----------
async function fetchImage(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    let type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type === "image/jpg") type = "image/jpeg";
    if (!IMAGE_TYPES.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4.5 * 1024 * 1024) return null; // stay under the APIs' per-image limits
    return { buf, type };
  } catch {
    return null;
  }
}

// Product images are cached in Supabase Storage under the bare product id (the same
// file image-proxy serves). If it isn't cached yet, ask image-proxy to fetch + cache it.
async function loadProductImage(id) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const first = await fetchImage(`${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(id)}`);
  if (first) return first;
  const site = process.env.URL;
  if (site) return fetchImage(`${site}/api/image-proxy?id=${encodeURIComponent(id)}`);
  return null;
}

const extOf = (type) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg");

// ---------- score (Claude) ----------
function buildSystemPrompt() {
  return `너는 한국 아동복 브랜드 오즈키즈(OZKIZ)의 시니어 스타일리스트이자 MD다. 모델 1명이 입는 착장(제품 조합)을 평가해 점수와 근거를 JSON으로만 답한다.

평가 기준 (각 0~100 정수):
1. color — 색상 조화: 제품 간 톤·채도·포인트 컬러의 균형
2. ageGender — 성별·연령 적합: 모델의 사이즈(의류·신발)와 제품의 성별/타깃 연령이 맞는지
3. composition — 아이템 구성: 상의·하의·아우터·슈즈·잡화 등 착장으로서 빠진 것, 겹치는 것, 오늘 날짜 기준 계절 및 제품 시즌 값과 어긋나는 것
4. trend — 최신 키즈 패션 트렌드와 경쟁 브랜드 대비 경쟁력

경쟁 브랜드 (이 순서대로 모두 비교): ${COMPETITORS.join(", ")}

규칙:
- 웹 검색 도구가 있으면 최신 키즈 패션 트렌드와 위 경쟁 브랜드의 최근 컬렉션·스타일링을 검색해 근거로 삼는다. 검색으로 확인하지 못한 브랜드는 지어내지 말고 note에 "확인하지 못함"이라고 쓴다.
- 제품 이미지에서 실제로 보이는 색·소재감·디테일만 근거로 쓴다. 보이지 않는 것은 단정하지 않는다.
- 점수를 후하게 주지 않는다. 개선이 필요하면 낮게 준다. 코멘트는 한국어로 1~2문장씩 간결하게.
- 출력은 아래 형식의 JSON 객체 하나뿐이다. 코드블록이나 다른 설명을 붙이지 않는다.

{"scores":{"color":0,"ageGender":0,"composition":0,"trend":0},"summary":"한 줄 총평","comments":{"color":"","ageGender":"","composition":"","trend":""},"competitors":[{"brand":"","note":""}],"improvements":["",""]}`;
}

function buildScoreIntro(input, today) {
  const m = input.model;
  const modelLine = m
    ? `${m.name}${m.clothingSize ? " / 의류 " + m.clothingSize : ""}${m.shoeSize ? " / 신발 " + m.shoeSize : ""}`
    : "모델 정보 없음";
  const lines = input.items.map(
    (it, i) =>
      `${i + 1}. [${it.slot}] ${it.name}` +
      ` (분류: ${it.category || "-"}, 성별: ${it.gender || "-"}, 시즌: ${it.season || "미지정"}` +
      `${it.size ? ", 사이즈: " + it.size : ""}${it.note ? ", 비고: " + it.note : ""})`
  );
  return `오늘 날짜: ${today}
촬영 유형: ${input.boardCategory || "-"}
착장: ${input.rowLabel || "-"}
모델: ${modelLine}

착장 제품 목록:
${lines.join("\n")}

아래 이미지는 위 제품들의 사진이다. 이 착장을 평가해줘.`;
}

// Pulls the JSON object out of the model's reply even if it added chatter around it
// (common when web search is on). Scans for the object that contains "scores".
function extractJson(text) {
  const anchor = text.indexOf('"scores"');
  if (anchor === -1) return null;
  let start = text.lastIndexOf("{", anchor);
  while (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
    start = text.lastIndexOf("{", start - 1);
  }
  return null;
}

async function callClaude({ key, model, system, content, useSearch }) {
  const body = { model, max_tokens: 4000, system, messages: [{ role: "user", content }] };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];

  let messages = body.messages;
  const sources = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ ...body, messages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Anthropic API 오류 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    let text = "";
    for (const block of data.content || []) {
      if (block.type === "text") text += block.text;
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type === "web_search_result" && r.url) sources.push({ title: r.title || r.url, url: r.url });
        }
      }
    }
    // A long web-search turn can be paused by the API; hand the partial answer back to continue.
    if (data.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: data.content }];
      continue;
    }
    return { text, sources };
  }
  throw new Error("AI 응답이 끝나지 않았어요. 다시 시도해주세요.");
}

const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

async function runScore(job) {
  const input = job.input;
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  if (!key) throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았어요.");

  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
  const images = await Promise.all(input.items.map((it) => loadProductImage(it.id)));

  const content = [{ type: "text", text: buildScoreIntro(input, today) }];
  input.items.forEach((it, i) => {
    if (!images[i]) return;
    content.push({ type: "text", text: `[제품 ${i + 1}] ${it.name}` });
    content.push({ type: "image", source: { type: "base64", media_type: images[i].type, data: images[i].buf.toString("base64") } });
  });
  if (!images.some(Boolean)) {
    content.push({ type: "text", text: "(제품 이미지를 불러오지 못했어요. 제품명과 정보만으로 평가하고, 색상 항목은 근거가 부족하다고 코멘트에 적어줘.)" });
  }

  const system = buildSystemPrompt();
  let webSearch = true;
  let out;
  try {
    out = await callClaude({ key, model, system, content, useSearch: true });
  } catch (err) {
    // Web search must be enabled for the Anthropic org; if it isn't, fall back to a
    // plain evaluation (and tell the user it wasn't search-backed).
    if ((err.status === 400 || err.status === 403) && /web.?search|tool/i.test(err.message)) {
      webSearch = false;
      out = await callClaude({ key, model, system, content, useSearch: false });
    } else {
      throw err;
    }
  }

  let parsed = extractJson(out.text);
  if (!parsed && webSearch) {
    webSearch = false;
    out = await callClaude({ key, model, system, content, useSearch: false });
    parsed = extractJson(out.text);
  }
  if (!parsed || !parsed.scores) throw new Error("AI 답변 형식을 읽지 못했어요. 다시 시도해주세요.");

  const scores = {
    color: clampScore(parsed.scores.color),
    ageGender: clampScore(parsed.scores.ageGender),
    composition: clampScore(parsed.scores.composition),
    trend: clampScore(parsed.scores.trend),
  };
  const total = Math.round((scores.color + scores.ageGender + scores.composition + scores.trend) / 4);

  const seen = new Set();
  const sources = [];
  for (const s of out.sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push(s);
    if (sources.length >= 8) break;
  }

  return {
    total,
    scores,
    summary: String(parsed.summary || ""),
    comments: parsed.comments || {},
    competitors: Array.isArray(parsed.competitors) ? parsed.competitors.slice(0, 10) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 6) : [],
    sources: webSearch ? sources : [],
    webSearch,
    model,
  };
}

// ---------- try-on (OpenAI) ----------
function buildTryonPrompt(input, usedItems) {
  const list = usedItems.map((it, i) => `${i + 2}. ${it.name} (${it.slot}${it.category ? ", " + it.category : ""})`).join("\n");
  return `Create one photorealistic full-body fashion photo of the child model from the FIRST image wearing ALL of the products shown in the following images, styled together as a single coordinated outfit.

Rules:
- Keep the model's face, hair, skin tone, age and body proportions exactly as in the first image.
- Reproduce every product faithfully: exact color, pattern, print, embroidery, trims, logos, silhouette and length. Do not redesign, recolor or simplify any product.
- Each product appears exactly once and is worn naturally: tops, outerwear, bottoms and dresses on the body, shoes on the feet, bags and accessories carried or worn. Do not add any clothing or accessories that are not provided.
- Standing pose facing the camera, full body visible from head to toe, soft even studio lighting, clean light-gray seamless background. No text, no watermark, no added logos.

Products, in image order after the model photo:
${list}`;
}

async function runTryon(job) {
  const input = job.input;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았어요.");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const quality = process.env.OPENAI_IMAGE_QUALITY || "medium"; // low | medium | high — higher costs more
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1536";

  const modelImg = await fetchImage(input.modelImageUrl);
  if (!modelImg) throw new Error("모델 사진을 불러오지 못했어요.");

  const loaded = await Promise.all(input.items.map((it) => loadProductImage(it.id)));
  const usedItems = [];
  const usedImgs = [];
  input.items.forEach((it, i) => {
    if (loaded[i]) {
      usedItems.push(it);
      usedImgs.push(loaded[i]);
    }
  });
  if (usedImgs.length === 0) throw new Error("제품 이미지를 불러오지 못했어요. 제품 동기화 후 다시 시도해주세요.");

  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", buildTryonPrompt(input, usedItems));
  fd.append("size", size);
  fd.append("quality", quality);
  fd.append("n", "1");
  fd.append("image[]", new Blob([modelImg.buf], { type: modelImg.type }), `model.${extOf(modelImg.type)}`);
  usedImgs.forEach((img, i) => fd.append("image[]", new Blob([img.buf], { type: img.type }), `item${i + 1}.${extOf(img.type)}`));

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` }, // no Content-Type: fetch adds the multipart boundary itself
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI API 오류 (${res.status})`);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("이미지가 만들어지지 않았어요. 다시 시도해주세요.");

  const imageUrl = await uploadToStorage(BUCKET, `tryon/${job.id}.png`, Buffer.from(b64, "base64"), "image/png");
  return {
    imageUrl,
    model,
    quality,
    usedProducts: usedItems.length,
    skippedProducts: input.items.length - usedItems.length, // products whose image couldn't be loaded
    usage: data.usage || null,
  };
}

// ---------- entry ----------
exports.handler = async (event) => {
  let jobId = "";
  try {
    jobId = String(JSON.parse(event.body || "{}").jobId || "");
    if (!jobId) return;
    const rows = await sbFetch(`/ai_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`);
    const job = rows && rows[0];
    if (!job || job.status !== "queued") return; // already handled (e.g. a Netlify retry)

    await patchJob(jobId, { status: "running" });
    const result = job.type === "score" ? await runScore(job) : await runTryon(job);
    await patchJob(jobId, { status: "done", result });
  } catch (err) {
    console.error("ai-run-background failed:", err);
    if (jobId) {
      try {
        await patchJob(jobId, { status: "error", error: String(err.message || err).slice(0, 500) });
      } catch {
        /* nothing more we can do */
      }
    }
  }
};
