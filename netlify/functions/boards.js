const { sbFetch } = require("./_store");

function toApi(row) {
  return {
    id: row.id,
    shootId: row.shoot_id,
    title: row.title,
    models: row.model_ids || [], // reuses the model_ids jsonb column, now storing full manually-entered model objects
    lookRows: row.look_rows || [],
    columns: row.columns || [],
    cells: row.cells || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  try {
    if (event.httpMethod === "GET") {
      const shootId = event.queryStringParameters?.shootId;
      const q = shootId
        ? `/boards?select=*&shoot_id=eq.${encodeURIComponent(shootId)}&order=updated_at.desc`
        : "/boards?select=*&order=updated_at.desc";
      const rows = await sbFetch(q);
      return { statusCode: 200, headers, body: JSON.stringify({ boards: rows.map(toApi) }) };
    }

    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      if (!payload.shootId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "shootId가 필요합니다." }) };
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const row = {
        id,
        shoot_id: payload.shootId,
        title: payload.title || "이름 없는 조합표",
        model_ids: Array.isArray(payload.models) ? payload.models : [],
        look_rows: Array.isArray(payload.lookRows) ? payload.lookRows : [],
        columns: payload.columns || [{ id: "c1", label: "착장1" }],
        cells: payload.cells || {},
        created_at: now,
        updated_at: now,
      };
      const rows = await sbFetch("/boards", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([row]),
      });
      return { statusCode: 200, headers, body: JSON.stringify(toApi(rows[0])) };
    }

    if (event.httpMethod === "PUT") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "id가 필요합니다." }) };
      const patch = { updated_at: new Date().toISOString() };
      if (payload.title !== undefined) patch.title = payload.title;
      if (payload.models !== undefined) patch.model_ids = payload.models;
      if (payload.lookRows !== undefined) patch.look_rows = payload.lookRows;
      if (payload.columns !== undefined) patch.columns = payload.columns;
      if (payload.cells !== undefined) patch.cells = payload.cells;
      const rows = await sbFetch(`/boards?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!rows || !rows[0]) return { statusCode: 404, headers, body: JSON.stringify({ error: "찾을 수 없습니다." }) };
      return { statusCode: 200, headers, body: JSON.stringify(toApi(rows[0])) };
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "id가 필요합니다." }) };
      await sbFetch(`/boards?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "지원하지 않는 메서드" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
