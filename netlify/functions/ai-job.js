// Read-only status endpoint for AI jobs.
//   GET ?id=<jobId>        -> { job }
//   GET ?shootId=<shootId> -> { jobs } — the newest job per (row, type), so the
//                             board can show saved results when it's reopened.
const { sbFetch } = require("./_store");

const COLS = "id,shoot_id,row_id,type,status,signature,result,error,created_at,updated_at";
const STUCK_AFTER_MS = 20 * 60 * 1000; // background functions are capped at 15 min

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// A job whose worker died (timeout, crash) would otherwise look "running" forever.
function normalize(job) {
  if ((job.status === "queued" || job.status === "running") && Date.now() - new Date(job.created_at).getTime() > STUCK_AFTER_MS) {
    return { ...job, status: "error", error: "작업이 중간에 멈췄어요. 다시 시도해주세요." };
  }
  return job;
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    if (q.id) {
      const rows = await sbFetch(`/ai_jobs?id=eq.${encodeURIComponent(q.id)}&select=${COLS}`);
      if (!rows || !rows[0]) return json(404, { error: "작업을 찾을 수 없어요." });
      return json(200, { job: normalize(rows[0]) });
    }
    if (q.shootId) {
      const rows = await sbFetch(
        `/ai_jobs?shoot_id=eq.${encodeURIComponent(q.shootId)}&select=${COLS}&order=created_at.desc&limit=200`
      );
      const seen = new Set();
      const jobs = [];
      for (const r of rows || []) {
        const k = r.row_id + "|" + r.type;
        if (seen.has(k)) continue; // rows are newest-first, so the first hit is the latest
        seen.add(k);
        jobs.push(normalize(r));
      }
      return json(200, { jobs });
    }
    return json(400, { error: "id 또는 shootId가 필요해요." });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
