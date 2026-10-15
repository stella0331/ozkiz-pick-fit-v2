const state = {
  models: [],
  products: [],
  modelsById: new Map(),
  productsById: new Map(),
  shoots: [],
  currentShootId: null,
  currentView: "home", // home | editor | saved

  board: null, // { id, title, columns, cells } — cells keyed by columnId

  searchText: "",
  selectedSeasons: new Set(),
  selectedCategories: new Set(),

  ai: {}, // { [rowId]: { score: job, tryon: job } } — AI scoring / try-on results for the open project
};

const el = {
  syncStatus: document.getElementById("syncStatus"),
  backBtn: document.getElementById("backBtn"),
  brandTitle: document.getElementById("brandTitle"),
  brandSub: document.getElementById("brandSub"),
  homeView: document.getElementById("homeView"),
  editorView: document.getElementById("editorView"),

  newConceptBtn: document.getElementById("newConceptBtn"),
  newHorizonBtn: document.getElementById("newHorizonBtn"),
  shootForm: document.getElementById("shootForm"),
  shootTitleInput: document.getElementById("shootTitleInput"),
  shootDateInput: document.getElementById("shootDateInput"),
  submitShootBtn: document.getElementById("submitShootBtn"),
  cancelShootBtn: document.getElementById("cancelShootBtn"),
  shootFormMsg: document.getElementById("shootFormMsg"),
  shootGrid: document.getElementById("shootGrid"),

  gridStep: document.getElementById("gridStep"),
  addColumnBtn: document.getElementById("addColumnBtn"),
  saveBoardBtn: document.getElementById("saveBoardBtn"),
  boardSaveMsg: document.getElementById("boardSaveMsg"),
  outfitGrid: document.getElementById("outfitGrid"),

  addModelBtn: document.getElementById("addModelBtn"),
  addLookRowBtn: document.getElementById("addLookRowBtn"),
  modelForm: document.getElementById("modelForm"),
  modelFormBackdrop: document.getElementById("modelFormBackdrop"),
  modelImageInput: document.getElementById("modelImageInput"),
  modelImagePreview: document.getElementById("modelImagePreview"),
  modelNameInput: document.getElementById("modelNameInput"),
  clothingSizeTabs: document.getElementById("clothingSizeTabs"),
  shoeSizeTabs: document.getElementById("shoeSizeTabs"),
  submitModelBtn: document.getElementById("submitModelBtn"),
  cancelModelBtn: document.getElementById("cancelModelBtn"),

  productSearch: document.getElementById("productSearch"),
  seasonChips: document.getElementById("seasonChips"),
  categoryChips: document.getElementById("categoryChips"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  sidebarCount: document.getElementById("sidebarCount"),
  sidebarProductGrid: document.getElementById("sidebarProductGrid"),

  syncBtn: document.getElementById("syncBtn"),

  exportPdfBtn: document.getElementById("exportPdfBtn"),
  aiModalBackdrop: document.getElementById("aiModalBackdrop"),
  aiModal: document.getElementById("aiModal"),
};

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "요청 실패");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function placeholderImg() {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f0e9dd"/></svg>'
  );
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Product image loading (queued + retried) ----------
// The product list holds ~2,000 thumbnails and every one is served by a Netlify function
// (/api/image-proxy). Letting the browser request them all at once can overwhelm that function
// (and Notion behind it), and the old onerror handler turned any single failure into a permanent
// blank square. This loader only requests images near the visible area, at most
// IMG_MAX_CONCURRENT at a time, drops requests for items scrolled past, times out stuck
// requests, and retries failures a few times (and tries again when scrolled back into view).
const IMG_MAX_CONCURRENT = 8;
const IMG_MAX_ATTEMPTS = 4;
const IMG_TIMEOUT_MS = 20000;
const imgQueue = [];
let imgActive = 0;
const loadedImageIds = new Set();
const imgObservers = new Map();

// Small reference copies are served straight from storage (no function in between), which is
// much faster. thumbBase comes from the server once at start; if it is unknown, or a copy
// does not exist yet, the image falls back to /api/image-proxy, which creates it.
let thumbBase = "";
let thumbVer = "";
async function loadThumbBase() {
  try {
    const res = await fetch("/api/image-proxy?info=1");
    const j = await res.json();
    thumbBase = j && j.thumbBase ? j.thumbBase : "";
  } catch (_) {
    thumbBase = "";
  }
}

function productImgHtml(id, alt, priority) {
  const proxyUrl = `/api/image-proxy?id=${encodeURIComponent(id)}`;
  const direct = thumbBase ? `${thumbBase}${encodeURIComponent(id)}${thumbVer ? "?v=" + thumbVer : ""}` : "";
  const url = direct || proxyUrl;
  const fb = direct ? ` data-fallback="${proxyUrl}"` : "";
  const altAttr = escapeHtml(alt || "");
  // Already fetched once this session: use the browser cache path directly, no queue.
  if (loadedImageIds.has(id)) return `<img src="${url}"${fb} data-img-id="${escapeHtml(id)}" alt="${altAttr}" decoding="async" />`;
  return `<img class="lazy-img" src="${placeholderImg()}" data-src="${url}"${fb} data-img-id="${escapeHtml(id)}"${priority ? ' data-priority="1"' : ""} alt="${altAttr}" decoding="async" />`;
}

// Double-click a product picture on the board to re-download it from Notion
// (use after changing the 대표이미지 in Notion).
async function refreshProductImage(id) {
  const imgs = document.querySelectorAll(`img[data-img-id="${CSS.escape(id)}"]`);
  imgs.forEach((i) => (i.style.opacity = "0.4"));
  try {
    await fetch(`/api/image-proxy?id=${encodeURIComponent(id)}&refresh=1`, { cache: "reload" });
    const t = Date.now();
    imgs.forEach((i) => {
      i.src = `/api/image-proxy?id=${encodeURIComponent(id)}&t=${t}`;
    });
  } catch (_) {
    /* leave the old picture if the refresh failed */
  }
  imgs.forEach((i) => (i.style.opacity = ""));
}

el.outfitGrid.addEventListener("dblclick", (e) => {
  const img = e.target.closest("img[data-img-id]");
  if (img && img.closest(".cell-item-top")) refreshProductImage(img.dataset.imgId);
});

function enqueueImage(img) {
  const st = img.dataset.state;
  if (st === "loaded" || st === "loading" || st === "queued") return;
  img.dataset.attempt = "0";
  img.dataset.state = "queued";
  if (img.dataset.priority) imgQueue.unshift(img);
  else imgQueue.push(img);
  pumpImages();
}

function dequeueImage(img) {
  if (img.dataset.state !== "queued") return;
  const i = imgQueue.indexOf(img);
  if (i !== -1) imgQueue.splice(i, 1);
  img.dataset.state = "";
}

function pumpImages() {
  while (imgActive < IMG_MAX_CONCURRENT && imgQueue.length) {
    const img = imgQueue.shift();
    if (!img.isConnected || img.dataset.state !== "queued") continue;
    loadImage(img);
  }
}

function loadImage(img) {
  imgActive++;
  img.dataset.state = "loading";
  const attempt = Number(img.dataset.attempt || 0);
  const fallback = img.dataset.fallback || "";
  // First try the direct small copy; if it is missing or fails, go through the proxy.
  const base = attempt >= 1 && fallback ? fallback : img.dataset.src;
  let finished = false;
  let timer = null;
  const done = (ok) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    img.onload = img.onerror = null;
    imgActive--;
    if (ok) {
      img.dataset.state = "loaded";
      loadedImageIds.add(img.dataset.imgId);
    } else if (!img.isConnected) {
      img.dataset.state = "";
    } else if (attempt + 1 < IMG_MAX_ATTEMPTS) {
      img.dataset.attempt = String(attempt + 1);
      img.dataset.state = "queued";
      setTimeout(() => {
        if (img.isConnected && img.dataset.state === "queued") {
          imgQueue.push(img);
          pumpImages();
        }
      }, attempt === 0 && fallback ? 0 : 1500 * (attempt + 1));
    } else {
      img.src = placeholderImg();
      img.dataset.state = "failed"; // tried again automatically if it scrolls back into view
    }
    pumpImages();
  };
  img.onload = () => done(true);
  img.onerror = () => done(false);
  timer = setTimeout(() => {
    img.onload = img.onerror = null;
    img.src = placeholderImg(); // aborts the stuck request so its slot is freed
    done(false);
  }, IMG_TIMEOUT_MS);
  // Retries add a throwaway query param so a cached error response isn't served again.
  img.src = attempt > 1 || (attempt === 1 && !fallback) ? `${base}${base.includes("?") ? "&" : "?"}r=${attempt}` : base;
}

// Call after (re)rendering a container. `scrollRoot` is the element that actually scrolls
// (the sidebar list); pass null for the main page.
function observeLazyImages(container, scrollRoot) {
  const old = imgObservers.get(container);
  if (old) old.disconnect();
  const imgs = container.querySelectorAll("img.lazy-img");
  if (imgs.length === 0) return;
  if (!("IntersectionObserver" in window)) {
    imgs.forEach(enqueueImage);
    return;
  }
  const obs = new IntersectionObserver(
    (entries) => entries.forEach((e) => (e.isIntersecting ? enqueueImage(e.target) : dequeueImage(e.target))),
    { root: scrollRoot || null, rootMargin: "300px 0px" }
  );
  imgObservers.set(container, obs);
  imgs.forEach((img) => obs.observe(img));
}

// Retries a failed request a few times. If Notion told us how long to wait
// (429 with retryAfter), we honor that wait exactly instead of guessing —
// this is what stops the frontend and backend from retrying in a way that
// makes the rate limit worse.
async function fetchJSONWithRetry(url, options, retries = 6) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchJSON(url, options);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      if (err.status === 429 && err.data?.retryAfter) {
        el.syncStatus.textContent = `노션 요청이 많아서 ${err.data.retryAfter}초 기다리는 중…`;
        await sleep((Number(err.data.retryAfter) + 1) * 1000);
      } else {
        await sleep(500 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// ---------- Data load ----------
async function fetchPage(endpoint, cursor) {
  const q = cursor ? "?cursor=" + encodeURIComponent(cursor) : "";
  return fetchJSONWithRetry(endpoint + q);
}

async function fetchAllPages(endpoint, label) {
  let cursor = undefined;
  let items = [];
  let pageCount = 0;
  const MAX_PAGES = 200; // safety cap (20,000 items) so a bug can't run forever
  do {
    const data = await fetchPage(endpoint, cursor);
    items = items.concat(data.items);
    cursor = data.hasMore ? data.nextCursor : undefined;
    pageCount++;
    el.syncStatus.textContent = `${label} 불러오는 중… (${items.length}개)`;
    if (pageCount >= MAX_PAGES) {
      throw new Error(`${label} 페이지가 ${MAX_PAGES}개를 넘었어요 — 뭔가 잘못된 것 같아 멈췄습니다.`);
    }
    if (cursor) await sleep(400); // pace requests to stay clear of Notion's rate limit
  } while (cursor);
  return items;
}

function applyCatalog(products, syncedAt) {
  thumbVer = syncedAt ? String(Date.parse(syncedAt) || "") : "";
  state.products = products.filter((p) => p.name);
  state.productsById = new Map(state.products.map((p) => [p.id, p]));
  const timeLabel = syncedAt
    ? new Date(syncedAt).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : "";
  el.syncStatus.textContent = `제품 ${state.products.length}개${timeLabel ? " · 동기화 " + timeLabel : ""}`;
}

// Fetches everything fresh from Notion, page by page (each request stays
// well under the function time limit), then commits the full list to the
// cache in one shot. Model DB sync is skipped for now to keep this fast.
async function fullSync() {
  const products = await fetchAllPages("/api/products-page", "제품");
  const productsRes = await fetchJSONWithRetry("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products }),
  });
  applyCatalog(products, productsRes.syncedAt);
}

async function loadCatalog(forceRefresh = false) {
  if (forceRefresh) {
    await fullSync();
    return;
  }
  el.syncStatus.textContent = "불러오는 중…";
  const productsRes = await fetchJSONWithRetry("/api/products");
  if (!productsRes.syncedAt) {
    // No cache yet (first ever load) — do a full sync now.
    await fullSync();
    return;
  }
  applyCatalog(productsRes.products, productsRes.syncedAt);
}

async function loadShoots() {
  const { shoots } = await fetchJSON("/api/shoots");
  state.shoots = shoots;
}

el.syncBtn.addEventListener("click", async () => {
  el.syncBtn.disabled = true;
  const prevLabel = el.syncBtn.textContent;
  el.syncBtn.textContent = "동기화 중…";
  try {
    await loadCatalog(true);
    // Re-render whatever product data is currently on screen.
    if (state.currentView === "editor" && state.board) {
      renderSidebarFilters();
      renderSidebarProductGrid();
      renderGrid();
    }
  } catch (err) {
    el.syncStatus.textContent = "동기화 실패: " + err.message;
  } finally {
    el.syncBtn.disabled = false;
    el.syncBtn.textContent = prevLabel;
  }
});

// ---------- View switching ----------
function showView(view) {
  state.currentView = view;
  el.homeView.hidden = view !== "home";
  el.editorView.hidden = view !== "editor";
  el.backBtn.hidden = view === "home";

  if (view === "home") {
    el.brandTitle.textContent = "오즈키즈 픽앤핏";
    el.brandSub.textContent = "OZKIZ PICK & FIT";
  } else {
    const shoot = state.shoots.find((s) => s.id === state.currentShootId);
    el.brandTitle.textContent = shoot ? shoot.title : "";
    el.brandSub.textContent = shoot?.shootDate ? "촬영일 " + shoot.shootDate : "";
  }
}

el.backBtn.addEventListener("click", () => {
  state.currentShootId = null;
  renderShootGrid();
  showView("home");
});

// ---------- Shoot list (home) ----------
let pendingShootCategory = "컨셉 촬영";

el.newConceptBtn.addEventListener("click", () => {
  pendingShootCategory = "컨셉 촬영";
  el.shootForm.hidden = false;
  el.shootFormMsg.textContent = "";
});

el.newHorizonBtn.addEventListener("click", () => {
  pendingShootCategory = "호리존 촬영";
  el.shootForm.hidden = false;
  el.shootFormMsg.textContent = "";
});

el.cancelShootBtn.addEventListener("click", () => {
  el.shootForm.hidden = true;
  el.shootTitleInput.value = "";
  el.shootDateInput.value = "";
  el.shootFormMsg.textContent = "";
});

el.submitShootBtn.addEventListener("click", async () => {
  const title = el.shootTitleInput.value.trim();
  const shootDate = el.shootDateInput.value;
  if (!title) { el.shootFormMsg.textContent = "프로젝트 이름을 입력해주세요."; return; }
  try {
    el.submitShootBtn.disabled = true;
    await fetchJSON("/api/shoots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, shootDate, category: pendingShootCategory }),
    });
    el.shootTitleInput.value = "";
    el.shootDateInput.value = "";
    el.shootForm.hidden = true;
    await loadShoots();
    renderShootGrid();
  } catch (err) {
    el.shootFormMsg.textContent = "생성 실패: " + err.message;
  } finally {
    el.submitShootBtn.disabled = false;
  }
});

function badgeClass(category) {
  return category === "호리존 촬영" ? "horizon" : "concept";
}

function renderShootGrid() {
  if (state.shoots.length === 0) {
    el.shootGrid.innerHTML = `<div class="empty-note">아직 만든 프로젝트가 없어요. 위 버튼으로 시작해보세요.</div>`;
    return;
  }
  el.shootGrid.innerHTML = "";
  state.shoots.forEach((shoot) => {
    const card = document.createElement("div");
    card.className = "shoot-card";
    card.innerHTML = `
      <div class="shoot-card-actions">
        <button class="icon-btn shoot-edit-btn">수정</button>
        <button class="icon-btn shoot-delete-btn">삭제</button>
      </div>
      <span class="shoot-badge ${badgeClass(shoot.category)}">${escapeHtml(shoot.category)}</span>
      <div class="shoot-card-title">${escapeHtml(shoot.title)}</div>
      <div class="shoot-card-date">${shoot.shootDate ? "촬영일 " + escapeHtml(shoot.shootDate) : "촬영일 미정"}</div>
    `;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".shoot-edit-btn") || e.target.closest(".shoot-delete-btn")) return;
      enterShoot(shoot.id);
    });
    card.querySelector(".shoot-edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openEditShoot(card, shoot);
    });
    card.querySelector(".shoot-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`"${shoot.title}"을(를) 삭제할까요? 안에 저장된 조합표도 함께 삭제됩니다.`)) return;
      await fetchJSON(`/api/shoots?id=${encodeURIComponent(shoot.id)}`, { method: "DELETE" });
      await loadShoots();
      renderShootGrid();
    });
    el.shootGrid.appendChild(card);
  });
}

function openEditShoot(card, shoot) {
  card.innerHTML = `
    <div class="shoot-edit-form">
      <input type="text" class="edit-title-input" value="${escapeHtml(shoot.title)}" />
      <input type="date" class="edit-date-input" value="${escapeHtml(shoot.shootDate || "")}" />
      <div class="shoot-form-actions">
        <button class="btn-primary save-edit-btn">저장</button>
        <button class="btn-ghost cancel-edit-btn">취소</button>
      </div>
    </div>
  `;
  card.querySelector(".cancel-edit-btn").addEventListener("click", (e) => { e.stopPropagation(); renderShootGrid(); });
  card.querySelector(".save-edit-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const title = card.querySelector(".edit-title-input").value.trim();
    const shootDate = card.querySelector(".edit-date-input").value;
    if (!title) return;
    await fetchJSON("/api/shoots", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: shoot.id, title, shootDate }),
    });
    await loadShoots();
    renderShootGrid();
  });
}

const CLOTHING_SIZES = ["100", "110", "120", "130", "140"];
const SHOE_SIZES = ["140", "150", "160", "170", "180", "190", "200"];

async function enterShoot(id) {
  state.currentShootId = id;
  state.ai = {};
  el.aiModalBackdrop.hidden = true;
  const shoot = state.shoots.find((s) => s.id === id);
  state.board = {
    id: null,
    title: shoot?.title || "",
    category: shoot?.category || "컨셉 촬영",
    models: [],
    lookRows: [],
    columns: Array.from({ length: 5 }, (_, i) => ({ id: "c" + Date.now() + i, label: "아이템" + (i + 1) })),
    cells: {},
  };
  el.boardSaveMsg.textContent = "";
  el.modelFormBackdrop.hidden = true;
  renderSidebarFilters();
  renderSidebarProductGrid();
  renderGrid();
  showView("editor");

  // This project may already have a saved coordi — load it in if so.
  try {
    const { boards } = await fetchJSON(`/api/boards?shootId=${encodeURIComponent(id)}`);
    if (boards && boards.length > 0) {
      const b = boards[0];
      state.board = {
        id: b.id,
        title: b.title,
        category: shoot?.category || "컨셉 촬영",
        models: b.models || [],
        lookRows: b.lookRows || [],
        columns: b.columns,
        cells: b.cells,
      };
      renderGrid();
    }
  } catch {
    // no saved coordi yet, or the fetch failed — keep the fresh empty one
  }
  loadAiJobs(id);
}

// ---------- Manual model add form ----------
const modelFormState = { clothingSize: "", shoeSize: "", imageDataUrl: "", editingId: null };

function renderSizeTabs(container, values, selected, onPick) {
  container.innerHTML = "";
  values.forEach((v) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "size-tab" + (selected === v ? " on" : "");
    btn.textContent = v;
    btn.addEventListener("click", () => onPick(v));
    container.appendChild(btn);
  });
}

function renderModelForm() {
  renderSizeTabs(el.clothingSizeTabs, CLOTHING_SIZES, modelFormState.clothingSize, (v) => {
    modelFormState.clothingSize = v;
    renderModelForm();
  });
  renderSizeTabs(el.shoeSizeTabs, SHOE_SIZES, modelFormState.shoeSize, (v) => {
    modelFormState.shoeSize = v;
    renderModelForm();
  });
}

el.addModelBtn.addEventListener("click", () => {
  if (state.board.category === "호리존 촬영" && state.board.models.length >= 1) return; // capped at 1 model
  modelFormState.clothingSize = "";
  modelFormState.shoeSize = "";
  modelFormState.imageDataUrl = "";
  modelFormState.editingId = null;
  document.getElementById("modelFormTitle").textContent = "모델 추가";
  el.submitModelBtn.textContent = "추가";
  el.modelNameInput.value = "";
  el.modelImageInput.value = "";
  el.modelImagePreview.hidden = true;
  el.modelFormBackdrop.hidden = false;
  renderModelForm();
});

// Double-click a model profile to edit it (same form, pre-filled).
el.outfitGrid.addEventListener("dblclick", (e) => {
  const head = e.target.closest("[data-edit-model]");
  if (!head || e.target.closest("button")) return;
  const m = state.board.models.find((x) => x.id === head.dataset.editModel);
  if (!m) return;
  modelFormState.editingId = m.id;
  modelFormState.clothingSize = m.clothingSize || "";
  modelFormState.shoeSize = m.shoeSize || "";
  modelFormState.imageDataUrl = m.image || "";
  document.getElementById("modelFormTitle").textContent = "모델 수정";
  el.submitModelBtn.textContent = "저장";
  el.modelNameInput.value = m.name || "";
  el.modelImageInput.value = "";
  if (m.image) {
    el.modelImagePreview.src = m.image;
    el.modelImagePreview.hidden = false;
  } else {
    el.modelImagePreview.hidden = true;
  }
  el.modelFormBackdrop.hidden = false;
  renderModelForm();
  el.modelNameInput.focus();
});

el.cancelModelBtn.addEventListener("click", () => {
  el.modelFormBackdrop.hidden = true;
});

el.modelFormBackdrop.addEventListener("click", (e) => {
  if (e.target === el.modelFormBackdrop) el.modelFormBackdrop.hidden = true;
});

el.modelImageInput.addEventListener("change", () => {
  const file = el.modelImageInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    // Phone photos are several MB; keeping them whole makes the board too big to save.
    let url = reader.result;
    try { url = await downscaleDataUrl(url, 1024); } catch (_) {}
    modelFormState.imageDataUrl = url;
    el.modelImagePreview.src = url;
    el.modelImagePreview.hidden = false;
  };
  reader.readAsDataURL(file);
});

el.submitModelBtn.addEventListener("click", () => {
  const name = el.modelNameInput.value.trim();
  if (!name) {
    el.modelNameInput.focus();
    return;
  }
  const editing = modelFormState.editingId && state.board.models.find((x) => x.id === modelFormState.editingId);
  if (editing) {
    editing.name = name;
    editing.image = modelFormState.imageDataUrl;
    editing.clothingSize = modelFormState.clothingSize;
    editing.shoeSize = modelFormState.shoeSize;
  } else {
    state.board.models.push({
      id: "m" + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      image: modelFormState.imageDataUrl,
      clothingSize: modelFormState.clothingSize,
      shoeSize: modelFormState.shoeSize,
    });
  }
  modelFormState.editingId = null;
  el.modelFormBackdrop.hidden = true;
  renderGrid();
});

// ---------- Grid step ----------
el.addColumnBtn.addEventListener("click", () => {
  const n = state.board.columns.length + 1;
  state.board.columns.push({ id: "c" + Date.now(), label: "아이템" + n });
  renderGrid();
});

function cellKey(modelId, columnId) {
  return modelId + "__" + columnId;
}

function updateAddModelBtnState() {
  const isHorizon = state.board.category === "호리존 촬영";
  const capped = isHorizon && state.board.models.length >= 1;
  el.addModelBtn.disabled = capped;
  el.addModelBtn.textContent = capped ? "모델 1명 고정 (호리존)" : "+ 모델 추가";
  el.addLookRowBtn.hidden = !isHorizon;
}

el.addLookRowBtn.addEventListener("click", () => {
  const n = state.board.lookRows.length + 2; // +2 because the model row itself counts as 착장 1
  state.board.lookRows.push({ id: "l" + Date.now(), label: "착장 " + n });
  renderGrid();
});

const ROW_HEAD_WIDTH = 150;
const MIN_COL_WIDTH = 220;

function computeColWidthPx() {
  // Always sized as if there were 5 columns — deleting items down to 1, 2,
  // or any count never stretches the remaining ones; empty space just
  // stays empty on the right. More than 5 still overflows into a scrollbar.
  const container = el.outfitGrid.parentElement; // .grid-scroll
  const containerWidth = container ? container.clientWidth : 0;
  if (containerWidth > ROW_HEAD_WIDTH + 40) {
    const avail = containerWidth - ROW_HEAD_WIDTH;
    return Math.max(MIN_COL_WIDTH, avail / 5);
  }
  return MIN_COL_WIDTH;
}

function renderRowCellsHtml(b, rowId, colWidth) {
  let html = "";
  b.columns.forEach((col) => {
    const key = cellKey(rowId, col.id);
    const items = b.cells[key] || [];
    html += `<td class="grid-cell" style="width:${colWidth}px" data-model="${rowId}" data-col="${col.id}">`;
    if (items.length === 0) {
      html += `<div class="grid-cell-empty">제품을 끌어다 놓으세요</div>`;
    } else {
      html += `<div class="grid-cell-thumbs">`;
      items.forEach((it) => {
        const p = state.productsById.get(it.id);
        const arrival = p?.arrivalDate
          ? `<div class="cell-item-arrival">입고일 ${escapeHtml(p.arrivalDate)}</div>`
          : `<div class="cell-item-arrival unset">입고일 미정</div>`;
        html += `<div class="cell-item" draggable="true" data-source-cell="${key}" data-item-id="${it.id}">
          <div class="cell-item-top">
            ${productImgHtml(it.id, "", true)}
            <button class="thumb-remove" data-remove-cell="${key}" data-remove-id="${it.id}">×</button>
          </div>
          <div class="cell-item-name">${escapeHtml(p?.name || "")}</div>
          <input type="text" class="cell-item-size" placeholder="사이즈 입력" value="${escapeHtml(it.size || "")}" data-size-cell="${key}" data-size-id="${it.id}" />
          <div class="cell-item-checks">
          <label class="cell-item-sample-requested">
            <input type="checkbox" data-sample-cell="${key}" data-sample-id="${it.id}" ${it.sampleRequested ? "checked" : ""} />
            샘플요청
          </label>
          <label class="cell-item-received">
            <input type="checkbox" data-received-cell="${key}" data-received-id="${it.id}" ${it.received ? "checked" : ""} />
            수령 완료
          </label>
          </div>
          <input type="text" class="cell-item-note" placeholder="비고" value="${escapeHtml(it.note || "")}" data-note-cell="${key}" data-note-id="${it.id}" />
          ${arrival}
        </div>`;
      });
      html += `</div>`;
    }
    html += `</td>`;
  });
  return html;
}

const ROW_DRAG_TYPE = "application/x-board-row";

// Reorder rows (착장). Rows are the model rows followed by the extra look rows. When there are
// only model rows, the rows themselves are reordered. In the 호리존 layout the first row is
// tied to the model, so the *contents* (the picked products) move between the fixed row heads
// instead — what you see is still "착장 1" dropped below "착장 2".
function moveBoardRow(srcId, targetId, after) {
  const b = state.board;
  if (!srcId || !targetId || srcId === targetId) return;
  const slotIds = [...b.models.map((m) => m.id), ...(b.lookRows || []).map((r) => r.id)];
  if (!slotIds.includes(srcId) || !slotIds.includes(targetId)) return;
  const order = slotIds.filter((id) => id !== srcId);
  const at = order.indexOf(targetId) + (after ? 1 : 0);
  order.splice(at, 0, srcId);
  if (order.join("|") === slotIds.join("|")) return;

  if (!(b.lookRows || []).length) {
    const byId = new Map(b.models.map((m) => [m.id, m]));
    b.models = order.map((id) => byId.get(id));
  } else {
    const old = b.cells;
    const next = {};
    Object.keys(old).forEach((k) => {
      if (!slotIds.some((id) => k.startsWith(id + "__"))) next[k] = old[k];
    });
    slotIds.forEach((slot, i) => {
      const from = order[i];
      Object.keys(old).forEach((k) => {
        if (k.startsWith(from + "__")) next[slot + "__" + k.slice(from.length + 2)] = old[k];
      });
    });
    b.cells = next;
  }
  renderGrid();
  el.boardSaveMsg.textContent = "순서를 바꿨어요. 저장 버튼을 눌러야 반영돼요.";
  el.boardSaveMsg.className = "save-msg";
}

// ---- Auto-scroll while dragging near the screen edge (so cards can be dragged to rows far below) ----
(function setupDragAutoScroll() {
  const ZONE = 110;
  const MAX = 26;
  let vy = 0;
  let vx = 0;
  let timer = null;
  let lastDragAt = 0;
  const stop = () => {
    vy = 0;
    vx = 0;
    if (timer) cancelAnimationFrame(timer);
    timer = null;
  };
  const tick = () => {
    if (performance.now() - lastDragAt > 250) return stop();
    if (vy) (document.scrollingElement || document.documentElement).scrollTop += vy;
    const gs = el.outfitGrid.parentElement;
    if (vx && gs) gs.scrollLeft += vx;
    timer = requestAnimationFrame(tick);
  };
  document.addEventListener("dragover", (e) => {
    lastDragAt = performance.now();
    const h = window.innerHeight;
    vy = e.clientY < ZONE ? -MAX * (1 - e.clientY / ZONE) : e.clientY > h - ZONE ? MAX * (1 - (h - e.clientY) / ZONE) : 0;
    vx = 0;
    const gs = el.outfitGrid.parentElement;
    if (gs) {
      const r = gs.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        if (e.clientX > r.right - ZONE && e.clientX <= r.right) vx = MAX * (1 - (r.right - e.clientX) / ZONE);
        else if (e.clientX < r.left + ZONE + 150 && e.clientX >= r.left + 150) vx = -MAX * (1 - (e.clientX - r.left - 150) / ZONE);
      }
    }
    if ((vy || vx) && !timer) timer = requestAnimationFrame(tick);
  });
  ["drop", "dragend"].forEach((t) => document.addEventListener(t, stop, true));
})();

function renderGrid() {
  const b = state.board;
  updateAddModelBtnState();

  if (b.models.length === 0) {
    el.outfitGrid.innerHTML = `<tr><td class="empty-note">"+ 모델 추가"로 모델을 먼저 추가해주세요.</td></tr>`;
    return;
  }

  const colWidth = computeColWidthPx();
  const tableWidth = ROW_HEAD_WIDTH + b.columns.length * colWidth;
  el.outfitGrid.style.tableLayout = "fixed";
  el.outfitGrid.style.width = tableWidth + "px";

  let html = `<thead><tr><th class="row-head" style="width:${ROW_HEAD_WIDTH}px">`;
  html += "</th>";
  b.columns.forEach((col) => {
    html += `<th class="col-head" style="width:${colWidth}px" data-col="${col.id}">
      <div class="col-head-row">
        <input type="text" value="${escapeHtml(col.label)}" data-col-input="${col.id}" />
        ${b.columns.length > 1 ? `<button class="col-remove-btn" data-col-remove="${col.id}">×</button>` : ""}
      </div>
    </th>`;
  });
  html += "</tr></thead><tbody>";

  const multiRows = b.models.length + (b.lookRows || []).length > 1;
  const gripHtml = (id) =>
    multiRows ? `<span class="row-grip" draggable="true" data-row-grip="${id}" title="끌어서 착장 순서를 바꿀 수 있어요">⠿</span>` : "";

  b.models.forEach((m) => {
    html += `<tr data-row-id="${m.id}"><td class="row-head"><div class="row-head-inner row-head-stack" data-edit-model="${m.id}" title="더블클릭하면 모델 정보를 수정할 수 있어요">
        ${b.category === "호리존 촬영" || gripHtml(m.id) ? `<div class="row-head-look-label">${b.category === "호리존 촬영" ? "착장 1" : ""}${gripHtml(m.id)}</div>` : ""}
        <img src="${m.image || placeholderImg()}" alt="" decoding="async" />
        <div>
          <div class="row-head-name">${escapeHtml(m.name)}</div>
          <div class="row-head-size">${escapeHtml(m.clothingSize ? "의류 " + m.clothingSize : "")}${m.clothingSize && m.shoeSize ? " · " : ""}${escapeHtml(m.shoeSize ? "신발 " + m.shoeSize : "")}</div>
        </div>
        <button class="row-head-remove" data-remove-model="${m.id}" title="모델 제거">×</button>
      </div>${rowAiContainerHtml(m.id)}</td>`;
    html += renderRowCellsHtml(b, m.id, colWidth);
    html += "</tr>";
  });

  (b.lookRows || []).forEach((row) => {
    html += `<tr data-row-id="${row.id}"><td class="row-head"><div class="row-head-inner">
        <div>
          <div class="row-head-name">${escapeHtml(row.label)}${gripHtml(row.id)}</div>
        </div>
        <button class="row-head-remove" data-remove-lookrow="${row.id}" title="착장 행 제거">×</button>
      </div>${rowAiContainerHtml(row.id)}</td>`;
    html += renderRowCellsHtml(b, row.id, colWidth);
    html += "</tr>";
  });

  html += "</tbody>";
  el.outfitGrid.innerHTML = html;
  observeLazyImages(el.outfitGrid, null);

  el.outfitGrid.querySelectorAll("[data-col-input]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const colId = e.target.dataset.colInput;
      const col = state.board.columns.find((c) => c.id === colId);
      if (col) col.label = e.target.value;
    });
  });
  el.outfitGrid.querySelectorAll("[data-col-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const colId = e.target.dataset.colRemove;
      const col = state.board.columns.find((c) => c.id === colId);
      if (!confirm(`"${col?.label || "이"}" 열을 삭제할까요?\n이 열에 담긴 제품이 모두 함께 사라져요.`)) return;
      state.board.columns = state.board.columns.filter((c) => c.id !== colId);
      Object.keys(state.board.cells).forEach((k) => {
        if (k.endsWith("__" + colId)) delete state.board.cells[k];
      });
      renderGrid();
    });
  });
  el.outfitGrid.querySelectorAll("[data-remove-lookrow]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rowId = e.target.dataset.removeLookrow;
      const lookRow = state.board.lookRows.find((r) => r.id === rowId);
      if (!confirm(`"${lookRow?.label || "이 착장"}" 행을 삭제할까요?\n이 행에 담긴 제품이 모두 함께 사라져요.`)) return;
      state.board.lookRows = state.board.lookRows.filter((r) => r.id !== rowId);
      Object.keys(state.board.cells).forEach((k) => {
        if (k.startsWith(rowId + "__")) delete state.board.cells[k];
      });
      renderGrid();
    });
  });
  el.outfitGrid.querySelectorAll("[data-remove-model]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const modelId = e.target.dataset.removeModel;
      const model = state.board.models.find((m) => m.id === modelId);
      if (!confirm(`"${model?.name || "이 모델"}" 모델을 삭제할까요?\n이 모델 행에 담긴 제품이 모두 함께 사라져요.`)) return;
      state.board.models = state.board.models.filter((m) => m.id !== modelId);
      Object.keys(state.board.cells).forEach((k) => {
        if (k.startsWith(modelId + "__")) delete state.board.cells[k];
      });
      renderGrid();
    });
  });
  el.outfitGrid.querySelectorAll("[data-remove-cell]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = e.target.dataset.removeCell;
      const id = e.target.dataset.removeId;
      const prod = state.productsById.get(id);
      if (!confirm(`"${prod?.name || "이 제품"}"을(를) 보드에서 삭제할까요?`)) return;
      state.board.cells[key] = (state.board.cells[key] || []).filter((it) => it.id !== id);
      renderGrid();
    });
  });
  el.outfitGrid.querySelectorAll("[data-size-cell]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const key = e.target.dataset.sizeCell;
      const id = e.target.dataset.sizeId;
      const item = (state.board.cells[key] || []).find((it) => it.id === id);
      if (item) item.size = e.target.value;
    });
  });
  el.outfitGrid.querySelectorAll("[data-received-cell]").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const key = e.target.dataset.receivedCell;
      const id = e.target.dataset.receivedId;
      const item = (state.board.cells[key] || []).find((it) => it.id === id);
      if (item) item.received = e.target.checked;
    });
  });
  el.outfitGrid.querySelectorAll("[data-sample-cell]").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const key = e.target.dataset.sampleCell;
      const id = e.target.dataset.sampleId;
      const item = (state.board.cells[key] || []).find((it) => it.id === id);
      if (item) item.sampleRequested = e.target.checked;
    });
  });
  el.outfitGrid.querySelectorAll("[data-note-cell]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const key = e.target.dataset.noteCell;
      const id = e.target.dataset.noteId;
      const item = (state.board.cells[key] || []).find((it) => it.id === id);
      if (item) item.note = e.target.value;
    });
  });
  // ---- Row (착장) reordering: grab the grip, drop above/below another row ----
  el.outfitGrid.querySelectorAll("[data-row-grip]").forEach((grip) => {
    grip.addEventListener("dragstart", (e) => {
      const tr = grip.closest("tr");
      e.dataTransfer.setData(ROW_DRAG_TYPE, grip.dataset.rowGrip);
      e.dataTransfer.effectAllowed = "move";
      const head = grip.closest("td");
      if (head && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(head, 20, 20);
      if (tr) tr.classList.add("row-dragging");
    });
    grip.addEventListener("dragend", () => {
      el.outfitGrid.querySelectorAll("tr").forEach((r) => r.classList.remove("row-dragging", "row-drop-before", "row-drop-after"));
    });
  });
  el.outfitGrid.querySelectorAll("tbody tr[data-row-id]").forEach((tr) => {
    const dropSide = (e) => {
      const r = tr.getBoundingClientRect();
      return e.clientY > r.top + r.height / 2 ? "after" : "before";
    };
    tr.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const side = dropSide(e);
      tr.classList.toggle("row-drop-before", side === "before");
      tr.classList.toggle("row-drop-after", side === "after");
    });
    tr.addEventListener("dragleave", (e) => {
      if (!tr.contains(e.relatedTarget)) tr.classList.remove("row-drop-before", "row-drop-after");
    });
    tr.addEventListener("drop", (e) => {
      if (!e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return;
      e.preventDefault();
      const srcId = e.dataTransfer.getData(ROW_DRAG_TYPE);
      const side = dropSide(e);
      tr.classList.remove("row-drop-before", "row-drop-after");
      moveBoardRow(srcId, tr.dataset.rowId, side === "after");
    });
  });
  el.outfitGrid.querySelectorAll(".cell-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(
        "application/x-board-item",
        JSON.stringify({ sourceKey: item.dataset.sourceCell, itemId: item.dataset.itemId })
      );
      e.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
  });
  el.outfitGrid.querySelectorAll(".grid-cell").forEach((cell) => {
    cell.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes(ROW_DRAG_TYPE)) return;
      e.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const key = cellKey(cell.dataset.model, cell.dataset.col);

      // Moving an item already placed on the board (up/down between rows,
      // or across into a different item column) rather than a fresh drop
      // from the sidebar.
      const moveRaw = e.dataTransfer.getData("application/x-board-item");
      if (moveRaw) {
        let moveData;
        try {
          moveData = JSON.parse(moveRaw);
        } catch {
          return;
        }
        const { sourceKey, itemId } = moveData || {};
        if (!sourceKey || !itemId || sourceKey === key) return;
        const sourceItems = state.board.cells[sourceKey] || [];
        const idx = sourceItems.findIndex((it) => it.id === itemId);
        if (idx === -1) return;
        const [movedItem] = sourceItems.splice(idx, 1);
        if (!state.board.cells[key]) state.board.cells[key] = [];
        if (!state.board.cells[key].some((it) => it.id === movedItem.id)) {
          state.board.cells[key].push(movedItem);
        }
        renderGrid();
        return;
      }

      const productId = e.dataTransfer.getData("text/plain");
      if (!productId) return;
      const product = state.productsById.get(productId);
      if (!product) return;
      if (!state.board.cells[key]) state.board.cells[key] = [];
      if (!state.board.cells[key].some((it) => it.id === productId)) {
        state.board.cells[key].push({ id: productId, category: product.category, size: "", received: false, sampleRequested: false, note: "" });
      }
      renderGrid();
    });
  });
}

el.saveBoardBtn.addEventListener("click", async () => {
  const b = state.board;
  el.boardSaveMsg.textContent = "";
  el.boardSaveMsg.className = "save-msg";
  try {
    el.saveBoardBtn.disabled = true;
    el.saveBoardBtn.textContent = "저장 중…";
    const shoot = state.shoots.find((s) => s.id === state.currentShootId);
    // Shrink oversized model photos (already-saved boards may hold full-size originals).
    for (const m of b.models) {
      if (m.image && m.image.startsWith("data:") && m.image.length > 250000) {
        try { m.image = await downscaleDataUrl(m.image, 1024); } catch (_) {}
      }
    }
    const payload = {
      shootId: state.currentShootId,
      title: shoot?.title || "이름 없는 코디",
      models: b.models,
      lookRows: b.lookRows,
      columns: b.columns,
      cells: b.cells,
    };
    if (b.id) {
      const res = await fetchJSON("/api/boards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: b.id, ...payload }),
      });
      state.board.id = res.id;
    } else {
      const res = await fetchJSON("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.board.id = res.id;
    }
    el.boardSaveMsg.textContent = "저장했어요.";
  } catch (err) {
    const big = /failed to fetch/i.test(err.message || "")
      ? " (네트워크 연결 또는 저장 데이터 크기 문제일 수 있어요. 잠시 후 다시 시도해주세요)"
      : "";
    el.boardSaveMsg.textContent = "저장 실패: " + err.message + big;
    el.boardSaveMsg.className = "save-msg error";
  } finally {
    el.saveBoardBtn.disabled = false;
    el.saveBoardBtn.textContent = "코디 저장";
  }
});

// ---------- Sidebar: search + filter chips + draggable product grid ----------
function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function renderChipGroup(container, values, selectedSet) {
  container.innerHTML = "";
  values.forEach((v) => {
    const chip = document.createElement("button");
    chip.className = "filter-chip" + (selectedSet.has(v) ? " on" : "");
    chip.textContent = v;
    chip.addEventListener("click", () => {
      toggleSetValue(selectedSet, v);
      renderSidebarFilters();
      renderSidebarProductGrid();
    });
    container.appendChild(chip);
  });
}

const SEASON_CHIPS = ["봄/가을", "여름", "겨울"];

// "봄/가을" is a combined chip — a product matches it if its season field
// mentions either 봄 or 가을. Other chips match by simple substring as before.
function seasonMatchesChip(productSeason, chip) {
  if (!productSeason || productSeason.includes("사계절")) return true; // unspecified or all-season items show up under any season filter
  if (chip === "봄/가을") return productSeason.includes("봄") || productSeason.includes("가을");
  return productSeason.includes(chip);
}
const CATEGORY_CHIPS = ["세트", "하의", "상의", "아우터", "원피스", "슬립온", "구두", "운동화", "잡화", "가방"];

function renderSidebarFilters() {
  renderChipGroup(el.seasonChips, SEASON_CHIPS, state.selectedSeasons);
  renderChipGroup(el.categoryChips, CATEGORY_CHIPS, state.selectedCategories);
}

el.productSearch.addEventListener("input", (e) => {
  state.searchText = e.target.value.trim();
  renderSidebarProductGrid();
});

el.resetFiltersBtn.addEventListener("click", () => {
  state.searchText = "";
  state.selectedSeasons.clear();
  state.selectedCategories.clear();
  el.productSearch.value = "";
  renderSidebarFilters();
  renderSidebarProductGrid();
});

function renderSidebarProductGrid() {
  let list = state.products;
  if (state.searchText) list = list.filter((p) => p.name.includes(state.searchText));
  if (state.selectedSeasons.size) {
    list = list.filter((p) => [...state.selectedSeasons].some((s) => seasonMatchesChip(p.season, s)));
  }
  if (state.selectedCategories.size) {
    list = list.filter((p) =>
      [...state.selectedCategories].some(
        (c) => (p.category && p.category.includes(c)) || (p.name && p.name.includes(c))
      )
    );
  }

  el.sidebarCount.textContent = `${list.length} / ${state.products.length}`;
  el.sidebarProductGrid.innerHTML = "";
  list.forEach((p) => {
    const card = document.createElement("div");
    card.className = "sidebar-product-card";
    card.draggable = true;
    card.innerHTML = `
      ${productImgHtml(p.id, p.name, false)}
      <div class="spc-name">${escapeHtml(p.name)}</div>
    `;
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", p.id);
      e.dataTransfer.effectAllowed = "copy";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    el.sidebarProductGrid.appendChild(card);
  });
  observeLazyImages(el.sidebarProductGrid, el.sidebarProductGrid);
}

// ---------- PDF export (board table only, landscape) ----------
function safeFileName(s) {
  return String(s || "코디표").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 60) || "코디표";
}

const PDF_ROWS_PER_PAGE = 3; // looks (착장) per A4 page in the PDF

async function exportBoardPdf() {
  const b = state.board;
  if (!b || b.models.length === 0) {
    alert("내보낼 코디표가 없어요. 모델과 제품을 먼저 추가해주세요.");
    return;
  }
  if (!window.html2canvas || !window.jspdf) {
    alert("PDF 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침한 뒤 다시 시도해주세요.");
    return;
  }
  const btn = el.exportPdfBtn;
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "PDF 만드는 중…";
  try {
    const table = el.outfitGrid;

    // Board images load through the queued loader, so some may still be placeholders. Fetch
    // them now (ignoring the queue) and swap them in before capturing.
    await Promise.all(
      [...table.querySelectorAll("img[data-src]")]
        .filter((img) => img.dataset.state !== "loaded" && img.dataset.state !== "loading")
        .map(async (img) => {
          const url = img.dataset.src;
          const ok = await new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve(true);
            probe.onerror = () => resolve(false);
            setTimeout(() => resolve(false), 30000);
            probe.src = url;
          });
          if (ok && img.dataset.state !== "loading") {
            img.src = url;
            img.dataset.state = "loaded";
            loadedImageIds.add(img.dataset.imgId);
          }
        })
    );

    // Lazy images below the fold would be captured blank — force-load them all first.
    const imgs = [...table.querySelectorAll("img")];
    imgs.forEach((img) => { img.loading = "eager"; });
    await Promise.all(
      imgs.map((img) =>
        img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; })
      )
    );

    // Pictures arrive via /api/image-proxy, which redirects to another host (Supabase). html2canvas
    // treats the URL as same-origin, loads it without CORS and the canvas ends up "tainted"
    // (cannot be exported). So fetch each picture ourselves with CORS and hand it over as data.
    const EMPTY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const blobToDataUrl = (blob) =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    const pdfSrcCache = new Map();
    const pdfImgSrc = (url) => {
      if (!url || url.startsWith("data:")) return Promise.resolve(url);
      if (!pdfSrcCache.has(url)) {
        pdfSrcCache.set(
          url,
          (async () => {
            try {
              // "reload" skips any cached copy that was stored without CORS headers
              const res = await fetch(url, { mode: "cors", cache: "reload" });
              if (!res.ok) throw new Error(String(res.status));
              const blob = await res.blob();
              if (!/^image\/(?!svg)/.test(blob.type)) return EMPTY_PNG; // fallback placeholder etc.
              return await blobToDataUrl(blob);
            } catch (_) {
              return EMPTY_PNG; // a picture that cannot be read is left blank rather than failing the whole PDF
            }
          })()
        );
      }
      return pdfSrcCache.get(url);
    };
    const liveImgs = [...table.querySelectorAll("img")];
    const pdfSrcs = await Promise.all(liveImgs.map((img) => pdfImgSrc(img.currentSrc || img.src)));

    // Typed text lives in the .value property, not the HTML attribute, so copy it
    // over before capturing — otherwise the clone would show stale/empty values.
    table.querySelectorAll("input[type=text]").forEach((i) => i.setAttribute("value", i.value));
    table.querySelectorAll("input[type=checkbox]").forEach((c) => {
      if (c.checked) c.setAttribute("checked", "");
      else c.removeAttribute("checked");
    });

    // The capture runs on a cleaned-up clone (empty inputs and buttons removed), so its
    // rows are shorter than the live table. Row positions must be measured on the clone.
    let cloneLayout = null;
    const MAX_CANVAS_PX = 14000; // stay well under browser canvas limits
    const scale = Math.min(2, MAX_CANVAS_PX / Math.max(table.offsetHeight, 1));
    const canvas = await window.html2canvas(table, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      onclone: (doc) => {
        const cloneRoot = doc.getElementById("outfitGrid");
        doc.querySelectorAll(".row-grip").forEach((n) => n.remove());
        if (cloneRoot) {
          const view = doc.defaultView;
          [...cloneRoot.querySelectorAll("img")].forEach((img, i) => {
            const src = pdfSrcs[i] || img.src;
            const cs = view.getComputedStyle(img);
            const rect = img.getBoundingClientRect();
            // html2canvas ignores object-fit and stretches the picture to fill its box. Draw it as a
            // background instead (contain / cover behave the same as on the board).
            const fit = cs.objectFit === "contain" ? "contain" : "cover";
            const box = doc.createElement("div");
            box.style.cssText =
              `display:block;flex:none;width:${rect.width}px;height:${rect.height}px;` +
              `border-radius:${cs.borderRadius};background-color:${cs.backgroundColor};` +
              `background-image:url("${src}");background-repeat:no-repeat;` +
              `background-position:center;background-size:${fit};`;
            img.replaceWith(box);
          });
        }
        doc.querySelectorAll(".thumb-remove, .row-head-remove, .col-remove-btn, .row-ai").forEach((n) => n.remove());
        // Empty slots show a "drag a product here" hint on screen; that's UI guidance, not content,
        // so leave those cells blank in the PDF.
        doc.querySelectorAll(".grid-cell-empty").forEach((n) => {
          n.textContent = "";
          n.style.border = "none";
          n.style.background = "transparent";
        });
        const toText = (selector, className, prefix) => {
          doc.querySelectorAll(selector).forEach((inp) => {
            const v = (inp.value || inp.getAttribute("value") || "").trim();
            if (!v) { inp.remove(); return; }
            const d = doc.createElement("div");
            d.className = className;
            d.textContent = (prefix || "") + v;
            inp.replaceWith(d);
          });
        };
        toText(".cell-item-size", "pdf-field", "사이즈 ");
        toText(".cell-item-note", "pdf-field", "비고 ");
        doc.querySelectorAll(".col-head input").forEach((inp) => {
          const d = doc.createElement("div");
          d.className = "pdf-colhead";
          d.textContent = inp.value || inp.getAttribute("value") || "";
          inp.replaceWith(d);
        });
        // Empty size/note fields were dropped above, so cards in one row end up with different heights.
        // Stretch each single-card cell to the tallest card of its row so the row looks even.
        doc.querySelectorAll("#outfitGrid tbody tr").forEach((tr) => {
          const cards = [...tr.querySelectorAll(".grid-cell-thumbs")]
            .filter((t) => t.querySelectorAll(".cell-item").length === 1)
            .map((t) => t.querySelector(".cell-item"));
          const tallest = Math.max(0, ...cards.map((c) => c.getBoundingClientRect().height));
          cards.forEach((c) => {
            c.style.boxSizing = "border-box";
            c.style.minHeight = tallest + "px";
          });
        });
        const cloneTable = doc.getElementById("outfitGrid");
        if (cloneTable) {
          const firstRow = cloneTable.querySelector("tbody tr");
          cloneLayout = {
            height: cloneTable.offsetHeight,
            headBottom: firstRow ? firstRow.offsetTop : 0, // bottom edge of the column-title row
            bottoms: [...cloneTable.querySelectorAll("tbody tr")].map((tr) => tr.offsetTop + tr.offsetHeight),
          };
        }
      },
    });

    // Page layout: A4 landscape, 8mm margins. Cut between rows where possible so a
    // look (착장) isn't sliced in half; only hard-slice a row taller than one page.
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const margin = 8;
    const usableW = pdf.internal.pageSize.getWidth() - margin * 2;
    const usableH = pdf.internal.pageSize.getHeight() - margin * 2;
    const pageHpx = Math.floor((usableH * canvas.width) / usableW);
    // css px -> canvas px, using the clone's own height. If measuring failed we simply
    // have no row boundaries and fall back to plain slicing.
    const k = cloneLayout && cloneLayout.height ? canvas.height / cloneLayout.height : 1;
    const boundaries = cloneLayout ? cloneLayout.bottoms.map((v) => Math.round(v * k)) : [];

    // Column titles (아이템1, 아이템2…) are repeated at the top of every page after the first.
    const headPx = cloneLayout ? Math.round(cloneLayout.headBottom * k) : 0;
    const addSlicePage = (pageNo, bodyTop, bodyH, withHead, scaleMm) => {
      const top = withHead ? headPx : 0;
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = top + bodyH;
      const ctx = slice.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      if (withHead) ctx.drawImage(canvas, 0, 0, canvas.width, headPx, 0, 0, canvas.width, headPx);
      ctx.drawImage(canvas, 0, bodyTop, canvas.width, bodyH, 0, top, canvas.width, bodyH);
      if (pageNo > 0) pdf.addPage();
      const w = slice.width * scaleMm;
      const h = slice.height * scaleMm;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin + (usableW - w) / 2, margin, w, h);
    };

    if (boundaries.length > 0 && headPx > 0) {
      // Fixed number of looks (착장 rows) per page, column titles on every page. One common scale
      // is used so every page looks alike: as large as possible while the fullest page still fits.
      const groups = [];
      for (let i = 0; i < boundaries.length; i += PDF_ROWS_PER_PAGE) {
        const start = i === 0 ? headPx : boundaries[i - 1];
        const end = boundaries[Math.min(i + PDF_ROWS_PER_PAGE, boundaries.length) - 1];
        groups.push([start, end]);
      }
      const tallest = Math.max(...groups.map(([st, en]) => headPx + (en - st)));
      const scaleMm = Math.min(usableW / canvas.width, usableH / tallest);
      groups.forEach(([st, en], idx) => addSlicePage(idx, st, en - st, true, scaleMm));
    } else {
      let y = 0;
      let pageNo = 0;
      while (y < canvas.height - 1) {
        const withHead = pageNo > 0 && headPx > 0 && headPx < pageHpx / 2;
        const capacity = withHead ? pageHpx - headPx : pageHpx;
        let end = Math.min(y + capacity, canvas.height);
        if (end < canvas.height) {
          const fits = boundaries.filter((v) => v > y + 40 && v <= end);
          if (fits.length) end = fits[fits.length - 1];
        }
        addSlicePage(pageNo, y, end - y, withHead, usableW / canvas.width);
        y = end;
        pageNo++;
      }
    }

    const shoot = state.shoots.find((s) => s.id === state.currentShootId);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    pdf.save(`${safeFileName(shoot?.title || b.title)}_코디표_${stamp}.pdf`);
  } catch (err) {
    console.error(err);
    alert("PDF 만들기에 실패했어요: " + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

el.exportPdfBtn.addEventListener("click", exportBoardPdf);

// ---------- AI features: look scoring (Claude) + virtual try-on image (OpenAI) ----------
const AI_FN = "/.netlify/functions";
const SCORE_LABELS = [
  ["color", "색상 조화"],
  ["composition", "아이템 구성"],
  ["trend", "트렌드·경쟁사 비교"],
];
// Total shown in the UI = mean of the criteria we still show (older saved results also had a
// "성별·연령 적합" score, which is no longer part of the total).
function scoreTotal(r) {
  const vals = SCORE_LABELS.map(([k]) => r?.scores?.[k]).filter((v) => typeof v === "number");
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : r?.total;
}
let tryonCostConfirmed = false;

function rowModel(rowId) {
  const b = state.board;
  return b.models.find((m) => m.id === rowId) || b.models[0] || null;
}

function rowLabel(rowId) {
  const b = state.board;
  const m = b.models.find((x) => x.id === rowId);
  if (m) return b.category === "호리존 촬영" ? "착장 1" : m.name;
  return (b.lookRows || []).find((r) => r.id === rowId)?.label || "착장";
}

function collectRowLook(rowId) {
  const b = state.board;
  const items = [];
  b.columns.forEach((col) => {
    (b.cells[cellKey(rowId, col.id)] || []).forEach((it) => {
      const p = state.productsById.get(it.id);
      items.push({
        id: it.id,
        slot: col.label || "",
        name: p?.name || "",
        category: p?.category || "",
        gender: p?.gender || "",
        season: p?.season || "",
        size: it.size || "",
        note: it.note || "",
      });
    });
  });
  return { model: rowModel(rowId), label: rowLabel(rowId), items };
}

// Identifies "this exact look" so we can tell when a saved AI result is out of date.
function rowSignature(rowId) {
  const b = state.board;
  const ids = [];
  b.columns.forEach((col) => (b.cells[cellKey(rowId, col.id)] || []).forEach((it) => ids.push(it.id)));
  const m = rowModel(rowId);
  return (m ? m.id : "-") + "|" + ids.sort().join(",");
}

function downscaleDataUrl(dataUrl, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("모델 사진을 읽지 못했어요."));
    img.src = dataUrl;
  });
}

function aiBtnHtml(kind, rowId) {
  const job = state.ai[rowId]?.[kind];
  const label = kind === "score" ? "✨룩 평가" : "✨착장 피팅";
  const busyLabel = kind === "score" ? "평가하는 중…" : "피팅 이미지 만드는 중…";
  const attr = `data-ai-row="${rowId}"`;
  if (job && (job.status === "queued" || job.status === "running")) {
    return `<button class="ai-btn busy" disabled>${busyLabel}</button>`;
  }
  if (job && job.status === "error") {
    const why = String(job.error || "알 수 없는 오류").slice(0, 120);
    return `<button class="ai-btn error" data-ai-act="${kind}" ${attr}>실패 · 다시 시도</button><div class="ai-err">${escapeHtml(why)}</div>`;
  }
  if (job && job.status === "done") {
    const stale = job.signature && job.signature !== rowSignature(rowId);
    const main =
      kind === "score"
        ? `✨룩 평가 ${scoreTotal(job.result) ?? "-"}점`
        : "✨피팅 이미지 보기";
    return `<div class="ai-done">
      <button class="ai-chip${stale ? " stale" : ""}" data-ai-act="view-${kind}" ${attr}>${main}${stale ? " · 변경됨" : ""}</button>
      <button class="ai-redo" data-ai-act="${kind}" ${attr} title="다시 만들기" aria-label="다시 만들기">🔄️</button>
    </div>`;
  }
  return `<button class="ai-btn" data-ai-act="${kind}" ${attr}>${label}</button>`;
}

function rowAiInnerHtml(rowId) {
  return aiBtnHtml("score", rowId) + aiBtnHtml("tryon", rowId);
}

function rowAiContainerHtml(rowId) {
  return `<div class="row-ai" data-ai-box="${rowId}">${rowAiInnerHtml(rowId)}</div>`;
}

function refreshRowAi(rowId) {
  const box = el.outfitGrid.querySelector(`[data-ai-box="${rowId}"]`);
  if (box) box.innerHTML = rowAiInnerHtml(rowId);
}

async function startAiJob(kind, rowId) {
  const look = collectRowLook(rowId);
  if (look.items.length === 0) {
    alert("이 착장에 제품을 먼저 놓아주세요.");
    return;
  }
  if (kind === "tryon") {
    if (!look.model || !look.model.image) {
      alert("입혀볼 모델 사진이 필요해요. \"+ 모델 추가\"에서 모델 사진을 올려주세요.");
      return;
    }
    if (!tryonCostConfirmed) {
      if (!confirm("AI 이미지 생성은 만들 때마다 OpenAI API 사용료가 나가요. 진행할까요?")) return;
      tryonCostConfirmed = true;
    }
  }

  state.ai[rowId] = { ...(state.ai[rowId] || {}), [kind]: { type: kind, status: "queued", id: null } };
  refreshRowAi(rowId);
  const signature = rowSignature(rowId);
  try {
    const modelImage = kind === "tryon" ? await downscaleDataUrl(look.model.image, 1280) : "";
    const res = await fetchJSON(`${AI_FN}/ai-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: kind,
        shootId: state.currentShootId,
        rowId,
        signature,
        rowLabel: look.label,
        boardCategory: state.board.category,
        model: look.model
          ? { name: look.model.name, clothingSize: look.model.clothingSize || "", shoeSize: look.model.shoeSize || "" }
          : null,
        modelImage,
        items: look.items,
      }),
    });
    state.ai[rowId][kind] = { type: kind, status: "queued", id: res.id, signature };
    pollAiJob(rowId, kind, res.id);
  } catch (err) {
    // A JSON parse error here means the server answered with an HTML 404 page, i.e. the
    // function files haven't been deployed yet.
    const msg =
      err instanceof SyntaxError
        ? "서버 함수를 찾지 못했어요. netlify/functions의 ai-*.js 파일이 배포됐는지 확인해주세요."
        : err.message;
    state.ai[rowId][kind] = { type: kind, status: "error", error: msg };
    refreshRowAi(rowId);
  }
}

async function pollAiJob(rowId, kind, jobId) {
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    await sleep(3000);
    // Stop if the user left this project or started a newer job for the same row.
    if (state.ai[rowId]?.[kind]?.id !== jobId) return;
    try {
      const { job } = await fetchJSON(`${AI_FN}/ai-job?id=${encodeURIComponent(jobId)}`);
      state.ai[rowId][kind] = job;
      refreshRowAi(rowId);
      if (job.status === "done" || job.status === "error") return;
    } catch {
      // transient network error — keep polling
    }
  }
  if (state.ai[rowId]?.[kind]?.id === jobId) {
    state.ai[rowId][kind] = { type: kind, status: "error", id: jobId, error: "시간이 너무 오래 걸려 중단했어요." };
    refreshRowAi(rowId);
  }
}

async function loadAiJobs(shootId) {
  try {
    const { jobs } = await fetchJSON(`${AI_FN}/ai-job?shootId=${encodeURIComponent(shootId)}`);
    if (state.currentShootId !== shootId) return;
    state.ai = {};
    (jobs || []).forEach((j) => {
      state.ai[j.row_id] = state.ai[j.row_id] || {};
      state.ai[j.row_id][j.type] = j;
    });
    renderGrid();
    Object.entries(state.ai).forEach(([rowId, byType]) =>
      Object.entries(byType).forEach(([kind, j]) => {
        if (j.status === "queued" || j.status === "running") pollAiJob(rowId, kind, j.id);
      })
    );
  } catch {
    // AI table not set up yet or network hiccup — the board works fine without it
  }
}

function scoreColorClass(n) {
  if (n >= 80) return "good";
  if (n >= 60) return "ok";
  return "low";
}

function openAiModal(rowId, kind) {
  const job = state.ai[rowId]?.[kind];
  if (!job || job.status !== "done" || !job.result) return;
  const r = job.result;
  const label = rowLabel(rowId);
  const stale = job.signature && job.signature !== rowSignature(rowId);
  let html = `<button class="ai-modal-close" id="aiModalClose" aria-label="닫기">×</button>`;
  html += `<h3 class="modal-title">${kind === "score" ? "룩 평가" : "착장 피팅"} · ${escapeHtml(label)}</h3>`;
  if (stale) html += `<p class="ai-note warn">이 결과를 만든 뒤 코디가 바뀌었어요. 최신 코디로 보려면 🔄 버튼을 눌러주세요.</p>`;

  if (kind === "score") {
    const totalScore = scoreTotal(r);
    html += `<div class="ai-total ${scoreColorClass(totalScore)}"><span class="ai-total-num">${totalScore}</span><span class="ai-total-unit">/ 100</span></div>`;
    if (r.summary) html += `<p class="ai-summary">${escapeHtml(r.summary)}</p>`;
    SCORE_LABELS.forEach(([key, name]) => {
      const n = r.scores?.[key];
      if (n == null) return;
      html += `<div class="ai-bar-row">
        <div class="ai-bar-head"><span>${name}</span><b>${n}</b></div>
        <div class="ai-bar-track"><div class="ai-bar-fill ${scoreColorClass(n)}" style="width:${Math.max(0, Math.min(100, n))}%"></div></div>
        <div class="ai-bar-comment">${escapeHtml(r.comments?.[key] || "")}</div>
      </div>`;
    });
    if (r.improvements && r.improvements.length) {
      html += `<h4 class="ai-sub">개선 제안</h4><ul class="ai-list">`;
      r.improvements.forEach((t) => (html += `<li>${escapeHtml(t)}</li>`));
      html += `</ul>`;
    }
    if (r.competitors && r.competitors.length) {
      html += `<h4 class="ai-sub">경쟁 브랜드 비교</h4><ul class="ai-list">`;
      r.competitors.forEach((c) => {
        html += `<li><b>${escapeHtml(c.brand || "")}</b> ${escapeHtml(c.note || "")}</li>`;
      });
      html += `</ul>`;
    }
    if (r.sources && r.sources.length) {
      html += `<h4 class="ai-sub">참고한 웹 자료</h4><ul class="ai-list small">`;
      r.sources.forEach((s) => {
        const safe = /^https?:\/\//.test(s.url || "") ? s.url : "#";
        html += `<li><a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url || "")}</a></li>`;
      });
      html += `</ul>`;
    }
    html += `<p class="ai-note">${r.webSearch ? "웹 검색으로 최신 트렌드와 경쟁 브랜드를 확인해 평가했어요." : "웹 검색을 쓰지 못해, 이미지와 AI의 기존 지식만으로 평가했어요. 트렌드·경쟁사 항목은 참고용으로만 봐주세요."} AI의 의견이라 실제 판단의 참고 자료로 활용해주세요.</p>`;
  } else {
    html += `<div class="ai-tryon-wrap"><img class="ai-tryon-img" src="${escapeHtml(r.imageUrl || "")}" alt="AI가 만든 착장 피팅 이미지" /></div>`;
    html += `<p class="ai-note">AI가 만든 시안이라 제품의 색·프린트·디테일이 실제와 다를 수 있어요. 촬영 전 분위기 확인용으로 써주세요.</p>`;
    html += `<div class="shoot-form-actions"><a class="btn-primary ai-link" href="${escapeHtml(r.imageUrl || "#")}" target="_blank" rel="noopener noreferrer">새 탭에서 열기 (저장)</a></div>`;
  }
  el.aiModal.innerHTML = html;
  el.aiModalBackdrop.hidden = false;
  document.getElementById("aiModalClose").addEventListener("click", () => (el.aiModalBackdrop.hidden = true));
}

el.aiModalBackdrop.addEventListener("click", (e) => {
  if (e.target === el.aiModalBackdrop) el.aiModalBackdrop.hidden = true;
});

// One delegated listener — the grid's innerHTML is rebuilt often, so per-button
// listeners would be lost.
el.outfitGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ai-act]");
  if (!btn) return;
  e.stopPropagation();
  const rowId = btn.dataset.aiRow;
  const act = btn.dataset.aiAct;
  if (act === "score" || act === "tryon") startAiJob(act, rowId);
  else if (act === "view-score") openAiModal(rowId, "score");
  else if (act === "view-tryon") openAiModal(rowId, "tryon");
});

// ---------- Boot ----------
async function initApp() {
  try {
    await Promise.all([loadThumbBase(), loadCatalog(), loadShoots()]);
  } catch (err) {
    el.shootGrid.innerHTML = `<div class="empty-note">불러오기 실패: ${escapeHtml(err.message)}</div>`;
    return;
  }
  renderShootGrid();
  showView("home");
}

// ---------- Login gate (Google, restricted to @openhan.kr) ----------
const GOOGLE_CLIENT_ID = "755068696639-48epod73fvbl3254mgovd6s6p0eb6d6q.apps.googleusercontent.com";
const ALLOWED_DOMAINS = ["openhan.kr", "ozkiz.com"];
const SESSION_KEY = "ozkiz_pickfit_user";

function decodeJwt(token) {
  const payload = token.split(".")[1];
  const json = decodeURIComponent(
    atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
  return JSON.parse(json);
}

function showApp(user) {
  document.getElementById("loginGate").hidden = true;
  document.getElementById("appContent").hidden = false;
  const avatar = document.getElementById("userAvatar");
  if (user.picture) {
    avatar.src = user.picture;
    avatar.hidden = false;
  }
  document.getElementById("userEmail").textContent = user.email;
  initApp();
}

function handleCredentialResponse(response) {
  const data = decodeJwt(response.credential);
  const email = data.email || "";
  const domain = email.split("@")[1] || "";
  const errorBox = document.getElementById("loginError");
  if (!ALLOWED_DOMAINS.includes(domain)) {
    errorBox.hidden = false;
    document.getElementById("loginErrorMsg").textContent = `${email} 계정은 접근 권한이 없습니다.`;
    return;
  }
  errorBox.hidden = true;
  const user = { email, name: data.name, picture: data.picture };
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  showApp(user);
}

document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  location.reload();
});

(function initLoginGate() {
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    try {
      showApp(JSON.parse(stored));
      return;
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }
  const tryRender = () => {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
      google.accounts.id.renderButton(document.getElementById("googleSignInBtn"), {
        theme: "outline",
        size: "large",
        text: "signin_with",
      });
    } else {
      setTimeout(tryRender, 100);
    }
  };
  tryRender();
})();
