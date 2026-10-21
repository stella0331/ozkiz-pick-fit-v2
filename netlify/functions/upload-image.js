// Lets the board owner upload their own picture (not from the Notion product DB) and
// returns a public URL. Stored in the same bucket under a bare id ("custom-…"), which is
// also where the AI functions look for product images, so it works with 룩 평가 / 착장 피팅.
const crypto = require("crypto");
const { uploadToStorage } = require("./_store");

const BUCKET = "product-images";
const MAX_BYTES = 4 * 1024 * 1024;

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST만 가능해요." });
  try {
    const body = JSON.parse(event.body || "{}");
    const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(body.dataUrl || "");
    if (!m) return json(400, { error: "이미지 파일(png, jpg, webp)만 올릴 수 있어요." });
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > MAX_BYTES) return json(400, { error: "이미지가 너무 커요." });
    const id = `custom-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const url = await uploadToStorage(BUCKET, id, bytes, m[1]);
    return json(200, { id, url });
  } catch (err) {
    console.error("upload-image failed:", err.message);
    return json(500, { error: "이미지를 올리지 못했어요: " + err.message });
  }
};
