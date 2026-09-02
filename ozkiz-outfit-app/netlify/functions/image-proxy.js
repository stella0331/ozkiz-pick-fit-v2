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

// Checks whether the file already exists in Storage via the authenticated
// list API (not a plain HEAD on the public URL — some CDN paths return a
// misleadingly "ok" response for missing public objects, which was silently
// skipping the mirror-and-upload step every time).
async function isMirrored(id) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  try {
    const res = await fetch(`${base}/storage/v1/object/list/${IMAGE_BUCKET}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ search: id, limit: 1 }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data) && data.some((f) => f.name === id);
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return fallbackResponse();

  // 1) Already mirrored to our own storage? Point straight there — this is
  // the common case after the first view, and needs zero Notion API calls.
  if (await isMirrored(id)) {
    return { statusCode: 302, headers: { Location: storagePublicUrl(id), "Cache-Control": "no-store" }, body: "" };
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
