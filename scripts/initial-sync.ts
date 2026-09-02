// 최초 1회, 본인 컴퓨터에서만 실행하는 전체 동기화 스크립트입니다.
// Netlify에는 올리지 않아도 됩니다 — 로컬에서 한 번 돌려서 Supabase에
// 전체 데이터를 밀어 넣는 용도예요. 이후의 증분 동기화는 배포된
// netlify/functions/sync-products.js 가 담당합니다.
//
// 실행 방법:
//   1) 이 프로젝트 루트에 .env 파일을 만들고 아래 세 줄을 넣습니다.
//        NOTION_TOKEN=ntn_여기에_토큰
//        SUPABASE_URL=https://xxxxx.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=여기에_service_role_또는_secret_키
//   2) 터미널에서: npx tsx scripts/initial-sync.ts
//      (tsx가 없으면 npx가 실행 시점에 자동으로 받아와서 실행해줍니다.)

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!NOTION_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NOTION_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 값을 .env 파일에 넣어주세요.");
  process.exit(1);
}

const PRODUCT_DB_ID = "5d2ae3562c064494b6b1f0fc6469aa8a";
const NOTION_VERSION = "2022-06-28";

const BASE_FILTERS = [
  { property: "브랜드", select: { equals: "오즈키즈" } },
  {
    or: ["2024", "2025", "2026", "2027", "2028"].map((year) => ({
      property: "개발년도",
      select: { equals: year },
    })),
  },
  {
    or: ["의류", "슈즈", "잡화"].map((cat) => ({
      property: "의류/슈즈/잡화",
      select: { equals: cat },
    })),
  },
  {
    or: ["봄", "여름", "가을", "겨울", "사계절"].map((season) => ({
      property: "시즌",
      multi_select: { contains: season },
    })),
  },
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notionQuery(cursor?: string): Promise<any> {
  const body: Record<string, unknown> = { page_size: 100, filter: { and: BASE_FILTERS } };
  if (cursor) body.start_cursor = cursor;

  const res = await fetch(`https://api.notion.com/v1/databases/${PRODUCT_DB_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}) as any);
    const retryAfter = Number(data?.additional_data?.retry_after) || 5;
    console.log(`속도 제한에 걸렸어요 — ${retryAfter}초 대기 후 재시도합니다.`);
    await sleep((retryAfter + 1) * 1000);
    return notionQuery(cursor);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API 오류 (${res.status}): ${text}`);
  }
  return res.json();
}

function getTitle(page: any, prop: string): string {
  const p = page.properties[prop];
  if (!p?.title) return "";
  return p.title.map((t: any) => t.plain_text).join("");
}
function getSelect(page: any, prop: string): string {
  return page.properties[prop]?.select?.name || "";
}
function getMultiSelect(page: any, prop: string): string {
  return (page.properties[prop]?.multi_select || []).map((o: any) => o.name).join(", ");
}
function getStatus(page: any, prop: string): string {
  return page.properties[prop]?.status?.name || "";
}
function getFileUrl(page: any, prop: string): string {
  const file = page.properties[prop]?.files?.[0];
  if (!file) return "";
  return file.type === "external" ? file.external.url : file.file?.url || "";
}
function getDate(page: any, prop: string): string {
  return page.properties[prop]?.date?.start || "";
}

function mapProduct(page: any) {
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

async function supabaseUpsert(table: string, rows: unknown[], onConflict: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase 오류 (${res.status}): ${text}`);
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  let cursor: string | undefined;
  let total = 0;

  console.log("전체 동기화를 시작합니다 (조건에 맞는 제품 전체를 가져와요)...");
  do {
    const data = await notionQuery(cursor);
    const rows = data.results.map(mapProduct);
    if (rows.length > 0) {
      await supabaseUpsert("products", rows, "id");
      total += rows.length;
      console.log(`${total}개 반영됨...`);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
    if (cursor) await sleep(350); // 노션 속도 제한 여유
  } while (cursor);

  await supabaseUpsert("sync_logs", [{ id: "products", completed_at: startedAt }], "id");
  console.log(`완료! 총 ${total}개 제품을 Supabase에 반영했습니다.`);
  console.log("이제부터는 배포된 사이트의 동기화 함수가 이 시각 이후 변경분만 가져갑니다.");
}

main().catch((err) => {
  console.error("동기화 실패:", err.message);
  process.exit(1);
});
