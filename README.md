# 오즈키즈 픽앤핏 (OZKIZ Pick & Fit)

노션 제품DB · 모델DB를 실시간으로 불러와서 모델 착장을 조합해보고, 조합을 저장/공유하는 내부 도구입니다.

## 1. 로컬 없이 바로 Netlify에 배포하는 법

1. 이 폴더 전체를 GitHub 저장소에 올리거나, Netlify 대시보드에서 이 폴더를 드래그&드롭으로 배포합니다.
2. Netlify 사이트 설정 → **Environment variables** 에서 아래 값을 추가합니다.
   - `NOTION_TOKEN` : 노션 인테그레이션의 Internal Integration Secret (`ntn_...` 또는 `secret_...`로 시작하는 값)
3. 배포가 끝나면 사이트 주소로 접속해서 바로 사용할 수 있습니다.

> 노션 데이터베이스 ID(제품DB / 모델DB)는 코드 안에 이미 넣어뒀습니다.
> `netlify/functions/products.js`, `netlify/functions/models.js` 상단의 `PRODUCT_DB_ID`, `MODEL_DB_ID` 값이에요.
> 만약 나중에 DB를 새로 만들거나 옮기면 이 값만 바꿔주면 됩니다.

## 2. 노션 쪽 준비 (완료하셨다면 건너뛰어도 됨)

1. https://www.notion.so/my-integrations 에서 인테그레이션 생성 → Internal Integration Secret 복사
2. 제품DB, 모델DB 각각의 페이지에서 **공유(Share)** → 방금 만든 인테그레이션 연결 추가
3. 두 DB가 아래 속성 이름을 그대로 쓰고 있어야 앱이 정상 작동합니다.

**제품DB**
- 제품명 (제목)
- 대표이미지 (파일과 미디어)
- 복종 (셀렉트 — 원피스/세트/상의/하의/신발/부츠/아우터/잡화 등)
- 성별, 시즌, 제품유형, 진행상태

**모델DB**
- 이름 (제목)
- 이미지 (파일과 미디어)
- 카테고리 (키즈/주니어/AI버추얼)
- 진행여부, 국적, 사이즈, 인스타그램

속성 이름을 바꾸셨다면 `netlify/functions/products.js`, `netlify/functions/models.js` 안의 `getTitle(page, "제품명")` 같은 문자열도 함께 바꿔주세요.

## 3. 촬영회차 & 조합표 기능

앱에 들어가면 먼저 **프로젝트 목록**이 나옵니다. 두 가지 버튼으로 새 프로젝트를 만들 수 있어요.

- **컨셉촬영 코디 만들기** — 모델을 여러 명 추가할 수 있어요.
- **호리존촬영 코디 만들기** — 모델이 항상 1명으로 고정돼요. 한 명을 추가하면 "+ 모델 추가" 버튼이 비활성화됩니다. 모델을 바꾸고 싶으면 기존 모델을 제거(×)한 뒤 다시 추가하면 돼요.

버튼을 누르면 프로젝트 이름과 촬영일자를 입력하는 폼이 뜹니다. 각 프로젝트 카드는 수정·삭제가 가능합니다.

촬영회차 안에 들어가면 바로 착장표가 나옵니다:
1. "+ 모델 추가"로 모델을 추가하면(이미지 업로드 + 정보 + 의류/신발 사이즈) 표에 행이 생깁니다. 컨셉촬영은 여러 명, 호리존촬영은 1명까지만 가능해요.
2. "아이템" 컬럼이 가로로 5개씩 나열되고, "+ 아이템 추가"로 얼마든지 늘릴 수 있어요. 컬럼 제목은 클릭해서 바로 수정 가능합니다.
3. 왼쪽 사이드바에서 제품명 검색 · 시즌/카테고리 칩 필터로 제품을 찾고, 썸네일을 각 모델×아이템 셀 위로 드래그해서 놓으면 담깁니다. 담긴 제품마다 이름·사이즈 입력칸·수령완료 체크박스·입고일이 함께 표시됩니다.
4. **표 저장**으로 조합표 전체를 저장하고, "저장된 조합표" 탭에서 다시 불러오거나 삭제할 수 있습니다.

촬영회차를 삭제하면 그 안의 저장된 조합표도 함께 삭제됩니다.

## 4. 조합 저장은 어디에 저장되나요? (Supabase)

촬영회차, 조합표, 그리고 노션에서 불러온 제품·모델 캐시까지 전부 **Supabase**(무료로 쓸 수 있는 Postgres 기반 백엔드)에 저장합니다. 별도 npm 패키지 없이 순수 웹 요청(REST API)으로만 연결하기 때문에, 예전에 겪었던 Netlify Blobs 연결 오류 같은 문제가 구조적으로 없어요.

### Supabase 프로젝트 준비 (한 번만 하면 됨)

1. https://supabase.com 에서 회원가입 후 **New project**로 프로젝트를 하나 만듭니다. (Organization, 이름, 비밀번호, 리전 아무거나 선택해도 됩니다.)
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor**로 들어가서, 아래 SQL을 그대로 붙여넣고 **Run**을 누릅니다. (테이블 3개를 한 번에 만드는 코드예요.)

```sql
create table kv_cache (
  key text primary key,
  value jsonb not null,
  synced_at timestamptz not null default now()
);

create table shoots (
  id text primary key,
  title text not null,
  category text not null,
  shoot_date text,
  created_at timestamptz not null default now()
);

create table boards (
  id text primary key,
  shoot_id text not null,
  title text not null,
  model_ids jsonb not null default '[]',
  columns jsonb not null default '[]',
  cells jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

3. 왼쪽 메뉴 **Project Settings → API**로 이동해서 두 값을 복사합니다.
   - **Project URL** (예: `https://xxxxx.supabase.co`)
   - **service_role** 키 (secret 키 — anon/public 키가 아니라 **service_role**로 표시된 긴 값입니다. 이 키는 데이터베이스 전체 권한을 가지니 외부에 절대 공유하지 마세요.)
4. Netlify 사이트 → Environment variables에 아래 두 개를 추가합니다.
   - `SUPABASE_URL` : 방금 복사한 Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` : 방금 복사한 service_role 키
5. 재배포하면 끝입니다. (기존에 넣어두셨던 `NETLIFY_SITE_ID`, `NETLIFY_BLOBS_TOKEN`은 이제 안 쓰지만, 그냥 두셔도 무해합니다.)

## 5. 노션 데이터는 왜 캐싱되나요?

제품이 800개가 넘다 보니, 매번 노션에서 실시간으로 다 긁어오면 시간이 오래 걸려서(20~30초) Netlify 함수 제한 시간을 넘길 수 있어요. 그래서 제품·모델 데이터는 한 번 불러온 뒤 Supabase(`kv_cache` 테이블)에 캐싱해두고, 평소에는 그 캐시를 즉시 보여줍니다.

새로 불러올 때는(처음 접속 시 캐시가 비어있거나, "↻ 동기화" 버튼을 눌렀을 때) 노션 데이터베이스를 한 번에 다 가져오지 않고, 브라우저가 한 페이지(100개)씩 여러 번 나눠서 요청합니다. 이렇게 하면 요청 하나하나는 금방 끝나서 Netlify 함수 제한 시간에 절대 걸리지 않아요. 다 모은 뒤 한 번에 캐시에 저장합니다.

- 사이트를 배포하거나 새로 캐시가 비어있을 때 처음 접속하면, 처음 한 번은 자동으로 이 방식으로 불러오느라 화면에 "제품 불러오는 중… (300개)"처럼 진행 상황이 표시되며 시간이 좀 걸릴 수 있어요.
- 이후부터는 캐시된 데이터를 즉시 보여줘서 빠릅니다.
- 노션에 새 제품이나 모델을 추가·수정했다면, 화면 오른쪽 위 **"↻ 동기화"** 버튼을 눌러야 반영돼요.

## 6. 로컬에서 테스트하고 싶다면

```bash
npm install -g netlify-cli
npm install
netlify dev
```

`netlify dev`를 실행하기 전, 프로젝트 루트에 `.env` 파일을 만들고 아래처럼 넣어주세요.

```
NOTION_TOKEN=ntn_여기에_토큰
SUPABASE_URL=여기에_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=여기에_service_role_키
```

## 폴더 구조

```
netlify/functions/
  _notion.js      노션 API 호출 공통 함수
  products.js     제품DB 조회 API (/api/products)
  models.js       모델DB 조회 API (/api/models)
  looks.js        조합 저장/조회/삭제 API (/api/looks)
public/
  index.html      화면 구조
  style.css       디자인
  app.js          화면 동작 로직
```
