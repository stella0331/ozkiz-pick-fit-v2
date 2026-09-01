const {
  queryDatabasePage,
  getTitle,
  getSelect,
  getStatus,
  getFileUrl,
  getUrl,
  NotionRateLimitError,
} = require("./_notion");

const MODEL_DB_ID = "054e6075951b4e79adfee58918f6fb41";

function mapModel(page) {
  return {
    id: page.id,
    name: getTitle(page, "이름"),
    image: getFileUrl(page, "이미지"),
    category: getSelect(page, "카테고리"),
    status: getStatus(page, "진행여부"),
    nationality: getSelect(page, "국적"),
    size: getSelect(page, "사이즈"),
    instagram: getUrl(page, "인스타그램"),
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  try {
    const cursor = event.queryStringParameters?.cursor || undefined;
    const { results, hasMore, nextCursor } = await queryDatabasePage(MODEL_DB_ID, cursor);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ items: results.map(mapModel), hasMore, nextCursor }),
    };
  } catch (err) {
    if (err instanceof NotionRateLimitError) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limited", retryAfter: err.retryAfter }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
