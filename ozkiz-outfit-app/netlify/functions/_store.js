// Talks to Supabase's auto-generated REST API (PostgREST) directly over
// fetch, using the service_role key. No npm package required, which avoids
// dependency-bundling issues in the Functions deploy pipeline.

function baseUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL 환경변수가 설정되지 않았습니다.");
  return url.replace(/\/+$/, "");
}

function authHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// path should start with "/", e.g. "/shoots?select=*&order=created_at.desc"
async function sbFetch(path, options = {}) {
  const res = await fetch(`${baseUrl()}/rest/v1${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase 오류 (${res.status}): ${text || res.statusText}`);
  }
  return text ? JSON.parse(text) : null;
}

// Uploads raw bytes to a Supabase Storage bucket (upsert = overwrite if the
// path already exists) and returns the permanent public URL. The bucket
// must be set to "Public" in Supabase for that URL to be servable directly.
async function uploadToStorage(bucket, path, bytes, contentType) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  const res = await fetch(`${baseUrl()}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Storage 오류 (${res.status}): ${text}`);
  }
  return `${baseUrl()}/storage/v1/object/public/${bucket}/${path}`;
}

module.exports = { sbFetch, uploadToStorage };
