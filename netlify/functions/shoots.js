const { sbFetch } = require("./_store");

const CATEGORIES = ["컨셉 촬영", "호리존 촬영"];

function toApi(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    shootDate: row.shoot_date || "",
    createdAt: row.created_at,
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  try {
    if (event.httpMethod === "GET") {
      const rows = await sbFetch("/shoots?select=*&order=created_at.desc");
      return { statusCode: 200, headers, body: JSON.stringify({ shoots: rows.map(toApi) }) };
    }

    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const title = (payload.title || "").trim();
      const category = payload.category;
      const shootDate = payload.shootDate || null;
      if (!title) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "프로젝트 이름을 입력해주세요." }) };
      }
      if (!CATEGORIES.includes(category)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "촬영 종류를 선택해주세요." }) };
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rows = await sbFetch("/shoots", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ id, title, category, shoot_date: shootDate }]),
      });
      return { statusCode: 200, headers, body: JSON.stringify(toApi(rows[0])) };
    }

    if (event.httpMethod === "PUT") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "id가 필요합니다." }) };
      const patch = {};
      if (payload.title !== undefined) patch.title = payload.title.trim();
      if (payload.shootDate !== undefined) patch.shoot_date = payload.shootDate || null;
      if (payload.category !== undefined) patch.category = payload.category;
      if (patch.title !== undefined && !patch.title) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "프로젝트 이름을 입력해주세요." }) };
      }
      if (patch.category !== undefined && !CATEGORIES.includes(patch.category)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "촬영 종류를 선택해주세요." }) };
      }
      const rows = await sbFetch(`/shoots?id=eq.${encodeURIComponent(id)}`, {
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
      await sbFetch(`/boards?shoot_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      await sbFetch(`/shoots?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "지원하지 않는 메서드" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
