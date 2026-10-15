const { retrievePage, getFileUrl } = require("./_notion");
const { uploadToStorage } = require("./_store");
const { THUMB_PREFIX, makeThumb } = require("./_thumb");

const IMAGE_BUCKET = "product-images";
const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f0e9dd"/></svg>';

function fallbackResponse() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    body: FALLBACK_SVG,
  };
}

function storagePublicUrl(id, version, folder = "") {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const url = `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${folder}${id}`;
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
async function findMirrored(id, folder = "") {
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
      body: JSON.stringify({ prefix: folder.replace(/\/$/, ""), search: id, limit: 1 }),
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
  // The page asks once where the small reference copies live, so it can load them directly.
  if (q.info === "1") {
    const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify({ thumbBase: base ? `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${THUMB_PREFIX}` : "" }),
    };
  }
  const id = q.id;
  if (!id) return fallbackResponse();
  const forceRefresh = q.refresh === "1"; // re-download from Notion even if a copy exists

  // 1) A small reference copy already exists? Point straight at it — this is the common
  // case after the first view and needs zero Notion calls. A short cache lets the
  // browser reuse the redirect without hitting this function for every repeat view.
  if (!forceRefresh) {
    const thumb = await findMirrored(id, THUMB_PREFIX);
    if (thumb.exists) {
      return redirect(storagePublicUrl(id, thumb.version, THUMB_PREFIX), "public, max-age=300");
    }
  }

  try {
    let bytes = null;

    // 2) No small copy yet. Use our own stored original if there is one (fast, no Notion
    // call); on a refresh request, or if there is none, download from Notion and store it.
    if (!forceRefresh) {
      const orig = await findMirrored(id);
      if (orig.exists) {
        const r = await fetch(storagePublicUrl(id, orig.version));
        if (r.ok) bytes = Buffer.from(await r.arrayBuffer());
      }
    }
    if (!bytes) {
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
      bytes = Buffer.from(await imgRes.arrayBuffer());
      await uploadToStorage(IMAGE_BUCKET, id, bytes, contentType);
    }

    // 3) Make the small copy. If that is not possible, fall back to the original.
    const small = await makeThumb(bytes);
    if (small) {
      await uploadToStorage(IMAGE_BUCKET, THUMB_PREFIX + id, small, "image/jpeg");
      return redirect(storagePublicUrl(id, String(Date.now()), THUMB_PREFIX), forceRefresh ? "no-store" : "public, max-age=300");
    }
    return redirect(storagePublicUrl(id, String(Date.now())), "no-store");
  } catch (err) {
    // Includes NotionRateLimitError and any storage failure — an occasional
    // missed image is far better than the whole board erroring out.
    console.error("image-proxy: mirror step failed", err.message);
    return fallbackResponse();
  }
};
