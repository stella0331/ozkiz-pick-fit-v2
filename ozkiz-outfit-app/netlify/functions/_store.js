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

module.exports = { sbFetch };
