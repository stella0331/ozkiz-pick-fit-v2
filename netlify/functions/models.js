const { sbFetch } = require("./_store");

const KEY = "models";

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  try {
    if (event.httpMethod === "POST") {
      const { models } = JSON.parse(event.body || "{}");
      if (!Array.isArray(models)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "models 배열이 필요합니다." }) };
      }
      const syncedAt = new Date().toISOString();
      await sbFetch("/kv_cache?on_conflict=key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{ key: KEY, value: models, synced_at: syncedAt }]),
      });
      return { statusCode: 200, headers, body: JSON.stringify({ syncedAt }) };
    }

    const rows = await sbFetch(`/kv_cache?key=eq.${KEY}&select=value,synced_at`);
    const row = rows && rows[0];
    if (row) {
      return { statusCode: 200, headers, body: JSON.stringify({ models: row.value, syncedAt: row.synced_at }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ models: [], syncedAt: null }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
