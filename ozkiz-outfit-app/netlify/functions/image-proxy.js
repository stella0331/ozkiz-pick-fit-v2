const { retrievePage, getFileUrl } = require("./_notion");
const { uploadToStorage } = require("./_store");

const IMAGE_BUCKET = "product-images";
const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f0e9dd"/></svg>';

function fallbackResponse() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    body: FALLBACK_SVG,
  };
}

function storagePublicUrl(id) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${id}`;
}

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return fallbackResponse();

  // 1) Already mirrored to our own storage? Point straight there — this is
  // the common case after the first view, and needs zero Notion API calls.
  try {
    const cachedUrl = storagePublicUrl(id);
    const head = await fetch(cachedUrl, { method: "HEAD" });
    if (head.ok) {
      return { statusCode: 302, headers: { Location: cachedUrl, "Cache-Control": "no-store" }, body: "" };
    }
  } catch {
    // fall through to a live fetch below
  }

  // 2) Not mirrored yet — get the (soon-to-expire) Notion URL, download the
  // actual bytes, and store our own permanent copy before redirecting.
  try {
    const page = await retrievePage(id);
    const notionUrl = getFileUrl(page, "대표이미지");
    if (!notionUrl) return fallbackResponse();

    const imgRes = await fetch(notionUrl);
    if (!imgRes.ok) return fallbackResponse();
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const publicUrl = await uploadToStorage(IMAGE_BUCKET, id, bytes, contentType);

    return { statusCode: 302, headers: { Location: publicUrl, "Cache-Control": "no-store" }, body: "" };
  } catch {
    // Includes NotionRateLimitError and any storage failure — an occasional
    // missed image is far better than the whole board erroring out.
    return fallbackResponse();
  }
};
