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
- **호리존촬영 코디 만들기** — 모델이 항상 1명으로 고정돼요. 한 명을 추가하면 "+ 모델 추가" 버튼이 비활성화됩니다. 모델을 바꾸고 싶으면 기존 모델을 제거(×)한 뒤 다시 추가하면 돼요. 대신 "+ 착장 추가" 버튼이 나타나서, 그 한 모델 아래로 착장(룩) 행을 몇 개든 추가할 수 있어요.

버튼을 누르면 프로젝트 이름과 촬영일자를 입력하는 폼이 뜹니다. 각 프로젝트 카드는 수정·삭제가 가능합니다.

촬영회차 안에 들어가면 바로 착장표가 나옵니다:
1. "+ 모델 추가"로 모델을 추가하면(이미지 업로드 + 정보 + 의류/신발 사이즈) 표에 행이 생깁니다. 컨셉촬영은 여러 명, 호리존촬영은 1명까지만 가능해요.
2. "아이템" 컬럼이 가로로 5개씩 나열되고, "+ 아이템 추가"로 얼마든지 늘릴 수 있어요. 컬럼 제목은 클릭해서 바로 수정 가능합니다.
3. 왼쪽 사이드바에서 제품명 검색 · 시즌/카테고리 칩 필터로 제품을 찾고, 썸네일을 각 모델×아이템 셀 위로 드래그해서 놓으면 담깁니다. 담긴 제품마다 이름·사이즈 입력칸·수령완료 체크박스·입고일이 함께 표시됩니다.
4. **코디 저장**을 누르면 지금 보이는 표가 그 프로젝트 자체에 저장됩니다. 별도의 "조합표 이름"을 정하거나 여러 개를 따로 저장하는 개념 없이, **프로젝트 하나당 코디 하나**예요. 프로젝트를 다시 열면 저장해둔 코디가 자동으로 불러와집니다.

촬영회차를 삭제하면 그 안에 저장된 코디도 함께 삭제됩니다.

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

create table products (
  id text primary key,
  name text,
  image text,
  category text,
  gender text,
  season text,
  product_type text,
  status text,
  arrival_date text,
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
  look_rows jsonb not null default '[]',
  columns jsonb not null default '[]',
  cells jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

> 이미 테이블을 만들어두셨다면, 이 한 줄만 Supabase SQL Editor에 붙여넣고 실행하면 됩니다:
> ```sql
> alter table boards add column if not exists look_rows jsonb not null default '[]';
> ```

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

### 표에 담긴 제품 이미지는 왜 며칠이 지나도 안 깨지나요?

노션에 올린 이미지 링크는 보안상 1시간 정도만 유효해요. 캐시에 저장해둔 오래된 링크를 그대로 쓰면 시간이 지나 이미지가 깨져 보여요. 이걸 막기 위해, **모델×아이템 표에 실제로 담긴 제품 이미지**만은 화면에 보여줄 때마다 노션에 최신 주소를 물어보는 작은 중계 기능(`netlify/functions/image-proxy.js`)을 거쳐요. 그래서 며칠이 지나도, 동기화를 안 눌러도 표에 담긴 이미지는 계속 살아있어요.

왼쪽 사이드바(제품 1000개 이상 전체 목록)까지 매번 실시간으로 물어보면 노션 요청이 너무 많아져서 속도제한에 걸릴 수 있어, 사이드바 썸네일은 지금처럼 캐시된 이미지를 쓰고 "↻ 동기화"를 누를 때 갱신돼요.

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

## 부록. 서버사이드 통합 동기화 함수 (sync-products.js) — Free 플랜용 증분 동기화

Netlify **Free 플랜**에서도 쓸 수 있도록, Background Function이 아니라 일반 함수로 만들었어요. 대신 **처음 한 번은 로컬 스크립트로 전체를 밀어 넣고, 그다음부터는 이 함수가 "바뀐 것만" 가져오는" 방식**으로 시간 초과·속도제한 위험을 낮췄습니다.

### 1) Supabase에 `sync_logs` 테이블 추가

```sql
create table sync_logs (
  id text primary key,
  completed_at timestamptz not null
);
```

이 테이블에 `id = 'products'`인 행 하나로 "마지막 동기화가 언제 끝났는지"만 기록합니다.

### 2) 최초 1회: 로컬에서 전체 적재 (`scripts/initial-sync.ts`)

제품이 많을 때 처음 한 번은 Netlify 함수가 아니라 **본인 컴퓨터에서** 실행해서, 시간 제한 걱정 없이 전체 데이터를 Supabase에 밀어 넣습니다.

1. 프로젝트 루트에 `.env` 파일을 만들고 아래 세 줄을 넣습니다.
   ```
   NOTION_TOKEN=ntn_여기에_토큰
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=여기에_service_role_또는_secret_키
   ```
2. Node.js가 설치되어 있어야 해요 (버전 18 이상). 터미널에서 프로젝트 폴더로 이동한 뒤:
   ```bash
   npx tsx scripts/initial-sync.ts
   ```
   `tsx`가 없으면 `npx`가 그 자리에서 자동으로 받아와 실행해줍니다. 진행 상황이 터미널에 "N개 반영됨..."으로 계속 찍히다가 끝나면 완료예요.

이 스크립트는 노션에서 조건에 맞는 제품 **전체**를 가져와 Supabase `products` 테이블에 upsert하고, 끝나면 시작 시각을 `sync_logs`에 기록합니다.

### 3) 이후: 배포된 함수가 담당하는 증분 동기화

`netlify/functions/sync-products.js`는 실행할 때마다 `sync_logs`에서 마지막 동기화 시각을 읽어와서, **그 이후에 수정된(`last_edited_time`) 제품만** 노션에 요청합니다. 평소에는 바뀐 게 몇 개 안 되니 Free 플랜의 짧은 함수 실행 시간 안에 충분히 끝나요.

- 호출: `POST /api/sync-products` (요청 본문 없음). 성공하면 `{ synced: <반영된 개수>, since: <이전 동기화 시각> }`를 반환합니다.
- 노션에서 조건에 안 맞게 바뀌거나 삭제된 제품은 Supabase `products` 테이블에서 자동으로 지워지지 않아요 (증분 동기화의 한계예요 — 새로 생기거나 바뀐 것만 반영하고, 없어진 것은 그대로 남습니다). 필요하시면 별도 정리 로직을 추가해드릴 수 있어요.
- 이미 있는 `kv_cache` 기반 동기화("↻ 동기화" 버튼)와는 별개의 테이블(`products`)에 저장돼요. 화면 버튼에 연결하려면 알려주세요 — 지금은 독립된 엔드포인트로만 존재합니다.

## 부록2. GitHub Actions로 자동 동기화 (매주 월요일 새벽 3시)

`.github/workflows/notion-supabase-sync.yml` 워크플로우가 매주 월요일 새벽 3시(한국시간)에 자동으로, 그리고 GitHub 웹에서 버튼 클릭으로 언제든 배포된 `/api/sync-products` 함수를 호출해서 증분 동기화를 실행합니다.

### 설정 (한 번만)

1. GitHub 저장소 → **Settings** → 왼쪽 메뉴 **Secrets and variables → Actions** → **New repository secret**.
2. Name: `SYNC_ENDPOINT_URL`, Value: 실제 배포된 사이트 주소 + `/api/sync-products` (예: `https://ozkizpicknfit.netlify.app/api/sync-products`).
3. 저장하면 끝입니다. 코드는 이미 이 시크릿을 사용하도록 되어 있어요.

### 수동으로 즉시 실행하고 싶을 때

GitHub 저장소 → 상단 **Actions** 탭 → 왼쪽에서 "Notion-Supabase 제품 동기화" 클릭 → 오른쪽 **Run workflow** 버튼 → 다시 **Run workflow** 눌러서 바로 실행할 수 있습니다.

### 참고

- GitHub Actions의 `schedule`은 항상 UTC 기준이라, 코드에는 `cron: "0 18 * * 0"`(UTC 일요일 18시 = 한국시간 월요일 새벽 3시)로 넣어뒀어요. 시간을 바꾸고 싶으면 이 줄만 조정하면 됩니다.
- GitHub의 스케줄 실행은 부하가 몰리면 몇 분 정도 늦게 시작될 수 있어요 (GitHub 자체 특성이라 저희 쪽에서 더 정확하게 맞출 수는 없어요).
- 실행 결과(성공/실패, 응답 내용)는 Actions 탭에서 해당 실행 기록을 클릭하면 로그로 확인할 수 있습니다.

## 부록3. 제품 이미지가 며칠이 지나도 안 깨지는 이유

노션에 올린 이미지 링크는 보안상 1시간 정도만 유효해요. 이 문제를 완전히 없애기 위해, 제품 이미지를 화면에 보여줄 때(`netlify/functions/image-proxy.js`) **처음 한 번만** 노션에서 실제 이미지를 다운로드해서 Supabase Storage(우리 저장소)에 영구 복사해두고, 그다음부터는 노션에 아예 물어보지 않고 그 복사본을 바로 보여줍니다. 즉 시간이 지날수록 노션 API 요청은 줄어들고, 이미지는 절대 안 깨져요.

### Supabase에 Storage 버킷 추가 (한 번만 하면 됨)

1. Supabase 대시보드 → 왼쪽 메뉴에서 **Storage** 아이콘 클릭.
2. **New bucket** 클릭 → 이름을 정확히 `product-images` 로 입력.
3. **Public bucket**을 켜주세요(토글 ON). 이미지가 브라우저에서 바로 보이려면 공개 버킷이어야 해요.
4. Create bucket.

이게 끝입니다. 코드는 이미 이 버킷 이름(`product-images`)을 쓰도록 되어 있어요.

## 부록4. 회사 직원(@openhan.kr)만 접속 가능하도록 구글 로그인 걸기

사이트 접속 시 구글 로그인 화면이 먼저 뜨고, `@openhan.kr` 계정으로 로그인해야만 안의 내용을 볼 수 있습니다. 예전 CopyFlow 프로젝트에서 쓰던 구글 로그인 설정(클라이언트 ID)을 그대로 재사용합니다.

### 설정 (한 번만 하면 됨)

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 접속 (CopyFlow 만들 때 쓰신 구글 계정으로 로그인).
2. 해당 프로젝트 선택 → **API 및 서비스 → 사용자 인증 정보**.
3. 기존 OAuth 2.0 클라이언트 ID(`755068696639-...`)를 클릭.
4. **승인된 자바스크립트 원본(Authorized JavaScript origins)** 목록에 이 사이트 주소를 추가:
   ```
   https://ozkizpicknfit.netlify.app
   ```
   (실제 배포 주소로, `https://`만 넣고 뒤에 `/`는 붙이지 마세요.)
5. 저장.
6. 만약 OAuth 동의 화면이 "테스트" 상태라면, **테스트 사용자** 목록에 로그인할 직원들의 실제 이메일을 추가해야 로그인이 돼요. (CopyFlow 때 이미 추가해두셨다면 그대로 재사용됩니다.)

### 참고

- 이 인증은 **클라이언트 사이드 검증**이에요 — 완벽한 보안은 아니고, 개발자 도구를 다룰 줄 아는 사람은 우회할 수 있는 수준의 "허들"이에요. 회사 내부용으로 쓰기엔 충분해요.
- 로그인 상태는 `sessionStorage`에 저장돼서, 브라우저 탭을 닫으면 초기화되고 다시 로그인해야 해요.
- `@openhan.kr`이 아닌 다른 도메인 계정도 허용하려면, `public/app.js`에서 `ALLOWED_DOMAINS` 배열에 도메인을 추가하면 됩니다 (예: `["openhan.kr", "ozkiz.com"]`).
