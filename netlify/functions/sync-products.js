const {
  notionFetch,
  getTitle,
  getSelect,
  getMultiSelect,
  getStatus,
  getFileUrl,
  getDate,
  NotionRateLimitError,
} = require("./_notion");
const { sbFetch } = require("./_store");

const PRODUCT_DB_ID = "5d2ae3562c064494b6b1f0fc6469aa8a";
const SYNC_LOG_ID = "products"; // row id in sync_logs for this particular sync job

const BASE_FILTERS = [
  // 1. 브랜드: 오즈키즈
  { property: "브랜드", select: { equals: "오즈키즈" } },
  // 2. 개발년도: 2024 ~ 2027
  {
    or: ["2024", "2025", "2026", "2027"].map((year) => ({
      property: "개발년도",
      select: { equals: year },
    })),
  },
  // 3. 카테고리: 의류, 슈즈, 잡화
  {
    or: ["의류", "슈즈", "잡화"].map((cat) => ({
      property: "의류/슈즈/잡화",
      select: { equals: cat },
    })),
  },
  // 4. 시즌: 봄, 여름, 가을, 겨울, 사계절 (multi_select)
  {
    or: ["봄", "여름", "가을", "겨울", "사계절"].map((season) => ({
      property: "시즌",
      multi_select: { contains: season },
    })),
  },
  // 5. 진행상태: 7가지 대상 상태
  {
    or: [
      "생산 요청(국내)",
      "생산 요청(해외)",
      "생산중(국내)",
      "생산중(해외)",
      "계속판매",
      "단종 예정",
      "진행 중",
    ].map((status) => ({
      property: "진행상태",
      status: { equals: status },
    })),
  },
];

// 6. last_edited_time — only when we already have a previous successful
// sync to diff against. This is what keeps a repeat run small on the Free
// plan's tight function time limit, no matter how large the DB has grown.
function buildFilter(lastSyncedAt) {
  const and = [...BASE_FILTERS];
  if (lastSyncedAt) {
    and.push({ timestamp: "last_edited_time", last_edited_time: { after: lastSyncedAt } });
  }
  return { and };
}

function mapProduct(page) {
  return {
    id: page.id,
    name: getTitle(page, "제품명"),
    image: getFileUrl(page, "대표이미지"),
    category: getSelect(page, "의류/슈즈/잡화"),
    gender: getSelect(page, "성별"),
    season: getMultiSelect(page, "시즌"),
    product_type: getSelect(page, "제품유형"),
    status: getStatus(page, "진행상태"),
    arrival_date: getDate(page, "입고일"),
    synced_at: new Date().toISOString(),
  };
}

async function getLastSyncedAt() {
  const rows = await sbFetch(`/sync_logs?id=eq.${SYNC_LOG_ID}&select=completed_at`);
  return rows && rows[0] ? rows[0].completed_at : null;
}

async function setLastSyncedAt(iso) {
  await sbFetch("/sync_logs?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ id: SYNC_LOG_ID, completed_at: iso }]),
  });
}

// One Notion query call. Retries a 429 at most once, and only waits up to
// 5s for it — a regular Free-plan function has roughly 10s total, so a
// longer wait here would just guarantee a timeout instead of a clean error.
async function queryOnePage(filter, cursor, retriesLeft = 1) {
  const body = { page_size: 100, filter };
  if (cursor) body.start_cursor = cursor;
  try {
    return await notionFetch(`/databases/${PRODUCT_DB_ID}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof NotionRateLimitError && retriesLeft > 0) {
      const wait = Math.min(err.retryAfter, 5);
      await new Promise((resolve) => setTimeout(resolve, (wait + 0.5) * 1000));
      return queryOnePage(filter, cursor, retriesLeft - 1);
    }
    throw err;
  }
}

exports.handler = async () => {
  const headers = { "Content-Type": "application/json" };
  const syncStartedAt = new Date().toISOString(); // captured *before* querying, so edits made mid-sync aren't missed next time
  try {
    const lastSyncedAt = await getLastSyncedAt();
    const filter = buildFilter(lastSyncedAt);

    let cursor = undefined;
    let total = 0;
    do {
      const data = await queryOnePage(filter, cursor);
      const rows = data.results.map(mapProduct);
      if (rows.length > 0) {
        await
