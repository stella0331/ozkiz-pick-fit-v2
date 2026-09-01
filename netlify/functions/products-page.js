const {
  queryDatabasePage,
  getTitle,
  getSelect,
  getStatus,
  getFileUrl,
  NotionRateLimitError,
} = require("./_notion");

const PRODUCT_DB_ID = "5d2ae3562c064494b6b1f0fc6469aa8a";

function mapProduct(page) {
  return {
    id: page.id,
    name: getTitle(page, "제품명"),
    image: getFileUrl(page, "대표이미지"),
    category: getSelect(page, "복종"),
    gender: getSelect(page, "성별"),
    season: getSelect(page, "시즌"),
    productType: getSelect(page, "제품유형"),
    status: getStatus(page, "진행상태"),
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  try {
    const cursor = event.queryStringParameters?.cursor || undefined;
    const { results, hasMore, nextCursor } = await queryDatabasePage(PRODUCT_DB_ID, cursor);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ items: results.map(mapProduct), hasMore, nextCursor }),
    };
  } catch (err) {
    if (err instanceof NotionRateLimitError) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limited", retryAfter: err.retryAfter }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
