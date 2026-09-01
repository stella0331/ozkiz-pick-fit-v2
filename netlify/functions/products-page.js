const {
  queryDatabasePage,
  getTitle,
  getSelect,
  getStatus,
  getFileUrl,
  getDate,
  NotionRateLimitError,
} = require("./_notion");

const PRODUCT_DB_ID = "5d2ae3562c064494b6b1f0fc6469aa8a";

const YEARS = ["2027", "2026", "2025", "2024", "2023", "2022"];
const STATUSES = [
  "생산 요청(국내)",
  "생산 요청(해외)",
  "생산중(국내)",
  "생산중(해외)",
  "계속판매",
  "단종 예정",
  "진행 중",
];

// Only pull products that match all three conditions — recent development
// years, the OZKIZ brand, and an active/relevant production status. The DB
// has many more rows than the app needs otherwise.
const PRODUCT_FILTER = {
  and: [
    { or: YEARS.map((y) => ({ property: "개발년도", select: { equals: y } })) },
    { property: "브랜드", select: { equals: "오즈키즈" } },
    { or: STATUSES.map((s) => ({ property: "진행상태", status: { equals: s } })) },
  ],
};

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
    arrivalDate: getDate(page, "입고일"),
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  try {
    const cursor = event.queryStringParameters?.cursor || undefined;
    const { results, hasMore, nextCursor } = await queryDatabasePage(PRODUCT_DB_ID, cursor, PRODUCT_FILTER);
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
