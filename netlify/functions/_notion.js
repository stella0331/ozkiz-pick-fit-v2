const NOTION_VERSION = "2022-06-28";

// Thrown specifically when Notion asks us to back off. Carries the number
// of seconds Notion says to wait before retrying.
class NotionRateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super("Notion API 요청 속도 제한에 걸렸습니다.");
    this.retryAfter = retryAfterSeconds;
  }
}

async function notionFetch(path, options = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN 환경변수가 설정되지 않았습니다.");
  }
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 429) {
    // Don't retry inside this function — a long Notion-requested wait could
    // exceed this function's own execution time limit. Surface it instead
    // so the caller (the browser) can wait and retry the whole request.
    let retryAfter = 5;
    try {
      const data = await res.json();
      retryAfter = Number(data?.additional_data?.retry_after) || 5;
    } catch {
      /* ignore parse errors, use default wait */
    }
    throw new NotionRateLimitError(retryAfter);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API 오류 (${res.status}): ${body}`);
  }
  return res.json();
}

// Query a full database, following pagination until all rows are collected.
async function queryDatabase(databaseId, extraBody = {}) {
  let results = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100, ...extraBody };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// Query a single page of a database (one Notion API call). Used to fetch
// large databases page-by-page from the client instead of looping inside
// one function invocation, which can exceed the function time limit.
// `filter` is an optional Notion API filter object, passed through as-is.
async function queryDatabasePage(databaseId, cursor, filter) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  if (filter) body.filter = filter;
  const data = await notionFetch(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { results: data.results, hasMore: data.has_more, nextCursor: data.next_cursor };
}

async function retrievePage(pageId) {
  return notionFetch(`/pages/${pageId}`);
}

// --- Property extraction helpers ---
function getTitle(page, propName) {
  const prop = page.properties[propName];
  if (!prop || !prop.title) return "";
  return prop.title.map((t) => t.plain_text).join("");
}

function getSelect(page, propName) {
  const prop = page.properties[propName];
  return prop?.select?.name || "";
}

function getStatus(page, propName) {
  const prop = page.properties[propName];
  return prop?.status?.name || "";
}

function getFileUrl(page, propName) {
  const prop = page.properties[propName];
  const file = prop?.files?.[0];
  if (!file) return "";
  return file.type === "external" ? file.external.url : file.file?.url || "";
}

function getUrl(page, propName) {
  const prop = page.properties[propName];
  return prop?.url || "";
}

function getDate(page, propName) {
  const prop = page.properties[propName];
  return prop?.date?.start || "";
}

module.exports = {
  notionFetch,
  queryDatabase,
  queryDatabasePage,
  retrievePage,
  NotionRateLimitError,
  getTitle,
  getSelect,
  getStatus,
  getFileUrl,
  getUrl,
  getDate,
};
