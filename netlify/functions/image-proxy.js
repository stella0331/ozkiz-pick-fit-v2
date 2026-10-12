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

function storagePublicUrl(id, version) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const url = `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${id}`;
  // The file keeps the same path when its picture is replaced, so the version in the
  // query string is what tells the CDN and the browser that it is a different image.
  return version ? `${url}?v=${version}` : url;
}

function redirect(location, cache) {
  return { statusCode: 302, headers: { Location: location, "Cache-Control": cache }, body: "" };
}

// Looks the file up in Storage via the authenticated list API (not a plain HEAD on the
// public URL — some CDN paths return a misleadingly "ok" response for missing public
// objects). Returns { exists, version } where version changes whenever the file is
// re-uploaded.
async function findMirrored(id) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { exists: false, version: "" };
  try {
    const res = await fetch(`${base}/storage/v1/object/list/${IMAGE_BUCKET}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", search: id, limit: 1 }),
    });
    if (!res.ok) {
      console.error("findMirrored: list API failed", res.status, await res.text());
      return { exists: false, version: "" };
    }
    const data = await res.json();
    const file = Array.isArray(data) ? data.find((f) => f.name === id) : null;
    if (!file) return { exists: false, version: "" };
    const stamp = Date.parse(file.updated_at || file.last_accessed_at || file.created_at || "");
    return { exists: true, version: Number.isFinite(stamp) ? String(stamp) : "" };
  } catch (err) {
    console.error("findMirrored: threw", err.message);
    return { exists: false, version: "" };
  }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const id = q.id;
  if (!id) return fallbackResponse();
  const forceRefresh = q.refresh === "1"; // re-download from Notion even if a copy exists

  // 1) Already mirrored to our own storage? Point straight there — this is the common
  // case after the first view, and needs zero Notion API calls. A short cache lets the
  // browser reuse the redirect without hitting this function for every repeat view.
  if (!forceRefresh) {
    const found = await findMirrored(id);
    if (found.exists) {
      return redirect(storagePublicUrl(id, found.version), "public, max-age=300");
    }
  }

  // 2) Not mirrored yet (or a refresh was requested) — get the (soon-to-expire) Notion
  // URL, download the actual bytes, and store our own permanent copy before redirecting.
  try {
    const page = await retrievePage(id);
    const notionUrl = getFileUrl(page, "대표이미지");
    if (!notionUrl) {
      console.error("image-proxy: no 대표이미지 file url for page", id);
      return fallbackResponse();
    }

    const imgRes = await fetch(notionUrl);
    if (!imgRes.ok) {
      console.error("image-proxy: notion image download failed", imgRes.status);
      return fallbackResponse();
    }
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    await uploadToStorage(IMAGE_BUCKET, id, bytes, contentType);

    return redirect(storagePublicUrl(id, String(Date.now())), "no-store");
  } catch (err) {
    // Includes NotionRateLimitError and any storage failure — an occasional
    // missed image is far better than the whole board erroring out.
    console.error("image-proxy: mirror step failed", err.message);
    return fallbackResponse();
  }
};
