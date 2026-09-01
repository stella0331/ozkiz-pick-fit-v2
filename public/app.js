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
  selectedTypes: new Set(),
  selectedCategories: new Set(),
};

const el = {
  syncStatus: document.getElementById("syncStatus"),
  backBtn: document.getElementById("backBtn"),
  brandTitle: document.getElementById("brandTitle"),
  brandSub: document.getElementById("brandSub"),
  viewTabs: document.getElementById("viewTabs"),
  homeView: document.getElementById("homeView"),
  editorView: document.getElementById("editorView"),
  savedView: document.getElementById("savedView"),

  newShootBtn: document.getElementById("newShootBtn"),
  shootForm: document.getElementById("shootForm"),
  shootTitleInput: document.getElementById("shootTitleInput"),
  shootDateInput: document.getElementById("shootDateInput"),
  submitShootBtn: document.getElementById("submitShootBtn"),
  cancelShootBtn: document.getElementById("cancelShootBtn"),
  shootFormMsg: document.getElementById("shootFormMsg"),
  shootGrid: document.getElementById("shootGrid"),

  gridStep: document.getElementById("gridStep"),
  boardTitleInput: document.getElementById("boardTitleInput"),
  addColumnBtn: document.getElementById("addColumnBtn"),
  saveBoardBtn: document.getElementById("saveBoardBtn"),
  boardSaveMsg: document.getElementById("boardSaveMsg"),
  lookColumns: document.getElementById("lookColumns"),

  productSearch: document.getElementById("productSearch"),
  seasonChips: document.getElementById("seasonChips"),
  typeChips: document.getElementById("typeChips"),
  categoryChips: document.getElementById("categoryChips"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  sidebarCount: document.getElementById("sidebarCount"),
  sidebarProductGrid: document.getElementById("sidebarProductGrid"),

  savedGrid: document.getElementById("savedGrid"),

  syncBtn: document.getElementById("syncBtn"),
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
  el.savedView.hidden = view !== "saved";
  el.backBtn.hidden = view === "home";
  el.viewTabs.hidden = view === "home";

  if (view === "home") {
    el.brandTitle.textContent = "오즈키즈 픽앤핏";
    el.brandSub.textContent = "OZKIZ PICK & FIT";
  } else {
    const shoot = state.shoots.find((s) => s.id === state.currentShootId);
    el.brandTitle.textContent = shoot ? shoot.title : "";
    el.brandSub.textContent = shoot?.shootDate ? "촬영일 " + shoot.shootDate : "";
  }

  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "saved") loadSavedBoards();
}

el.backBtn.addEventListener("click", () => {
  state.currentShootId = null;
  renderShootGrid();
  showView("home");
});

document.getElementById("viewTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  showView(btn.dataset.view);
});

// ---------- Shoot list (home) ----------
el.newShootBtn.addEventListener("click", () => {
  el.shootForm.hidden = !el.shootForm.hidden;
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
      body: JSON.stringify({ title, shootDate }),
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

function renderShootGrid() {
  if (state.shoots.length === 0) {
    el.shootGrid.innerHTML = `<div class="empty-note">아직 만든 프로젝트가 없어요. "+ 새 촬영 코디 만들기"로 시작해보세요.</div>`;
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

function enterShoot(id) {
  state.currentShootId = id;
  state.board = {
    id: null,
    title: "",
    columns: [{ id: "c" + Date.now(), label: "착장1" }],
    cells: {},
  };
  el.boardTitleInput.value = "";
  el.boardSaveMsg.textContent = "";
  renderSidebarFilters();
  renderSidebarProductGrid();
  renderGrid();
  showView("editor");
}

// ---------- Grid step ----------
el.addColumnBtn.addEventListener("click", () => {
  const n = state.board.columns.length + 1;
  state.board.columns.push({ id: "c" + Date.now(), label: "착장" + n });
  renderGrid();
});

el.boardTitleInput.addEventListener("input", (e) => {
  state.board.title = e.target.value;
});

function renderGrid() {
  const b = state.board;
  el.boardTitleInput.value = b.title || "";

  el.lookColumns.innerHTML = "";
  b.columns.forEach((col) => {
    const items = b.cells[col.id] || [];
    const card = document.createElement("div");
    card.className = "look-card";
    card.dataset.col = col.id;
    card.innerHTML = `
      <div class="look-card-head">
        <input type="text" value="${escapeHtml(col.label)}" data-col-input="${col.id}" />
        ${b.columns.length > 1 ? `<button class="col-remove-btn" data-col-remove="${col.id}">×</button>` : ""}
      </div>
      <div class="look-card-drop" data-col="${col.id}">
        ${items.length === 0
          ? `<div class="look-card-empty">제품을 끌어다 놓으세요</div>`
          : `<div class="look-card-thumbs">${items
              .map((it) => {
                const p = state.productsById.get(it.id);
                return `<div class="grid-cell-thumb-wrap">
                  <img src="${p?.image || placeholderImg()}" alt="" title="${escapeHtml(p?.name || "")}" />
                  <button class="thumb-remove" data-remove-col="${col.id}" data-remove-id="${it.id}">×</button>
                </div>`;
              })
              .join("")}</div>`
        }
      </div>
    `;
    el.lookColumns.appendChild(card);
  });

  el.lookColumns.querySelectorAll("[data-col-input]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const colId = e.target.dataset.colInput;
      const col = state.board.columns.find((c) => c.id === colId);
      if (col) col.label = e.target.value;
    });
  });
  el.lookColumns.querySelectorAll("[data-col-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const colId = e.target.dataset.colRemove;
      state.board.columns = state.board.columns.filter((c) => c.id !== colId);
      delete state.board.cells[colId];
      renderGrid();
    });
  });
  el.lookColumns.querySelectorAll("[data-remove-col]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const colId = e.target.dataset.removeCol;
      const id = e.target.dataset.removeId;
      state.board.cells[colId] = (state.board.cells[colId] || []).filter((it) => it.id !== id);
      renderGrid();
    });
  });
  el.lookColumns.querySelectorAll(".look-card-drop").forEach((drop) => {
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag-over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag-over");
      const productId = e.dataTransfer.getData("text/plain");
      if (!productId) return;
      const product = state.productsById.get(productId);
      if (!product) return;
      const colId = drop.dataset.col;
      if (!state.board.cells[colId]) state.board.cells[colId] = [];
      if (!state.board.cells[colId].some((it) => it.id === productId)) {
        state.board.cells[colId].push({ id: productId, category: product.category });
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
    const payload = {
      shootId: state.currentShootId,
      title: b.title.trim() || "이름 없는 조합표",
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
    el.boardSaveMsg.textContent = "저장 실패: " + err.message;
    el.boardSaveMsg.className = "save-msg error";
  } finally {
    el.saveBoardBtn.disabled = false;
    el.saveBoardBtn.textContent = "표 저장";
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

function renderSidebarFilters() {
  const seasons = [...new Set(state.products.map((p) => p.season).filter(Boolean))];
  const types = [...new Set(state.products.map((p) => p.productType).filter(Boolean))];
  const categories = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  renderChipGroup(el.seasonChips, seasons, state.selectedSeasons);
  renderChipGroup(el.typeChips, types, state.selectedTypes);
  renderChipGroup(el.categoryChips, categories, state.selectedCategories);
}

el.productSearch.addEventListener("input", (e) => {
  state.searchText = e.target.value.trim();
  renderSidebarProductGrid();
});

el.resetFiltersBtn.addEventListener("click", () => {
  state.searchText = "";
  state.selectedSeasons.clear();
  state.selectedTypes.clear();
  state.selectedCategories.clear();
  el.productSearch.value = "";
  renderSidebarFilters();
  renderSidebarProductGrid();
});

function renderSidebarProductGrid() {
  let list = state.products;
  if (state.searchText) list = list.filter((p) => p.name.includes(state.searchText));
  if (state.selectedSeasons.size) list = list.filter((p) => state.selectedSeasons.has(p.season));
  if (state.selectedTypes.size) list = list.filter((p) => state.selectedTypes.has(p.productType));
  if (state.selectedCategories.size) list = list.filter((p) => state.selectedCategories.has(p.category));

  el.sidebarCount.textContent = `${list.length} / ${state.products.length}`;
  el.sidebarProductGrid.innerHTML = "";
  list.forEach((p) => {
    const card = document.createElement("div");
    card.className = "sidebar-product-card";
    card.draggable = true;
    card.innerHTML = `
      <img src="${p.image || placeholderImg()}" alt="${escapeHtml(p.name)}" loading="lazy" />
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
}

// ---------- Saved boards view ----------
async function loadSavedBoards() {
  el.savedGrid.innerHTML = `<div class="empty-note">불러오는 중…</div>`;
  try {
    const { boards } = await fetchJSON(`/api/boards?shootId=${encodeURIComponent(state.currentShootId)}`);
    if (boards.length === 0) {
      el.savedGrid.innerHTML = `<div class="empty-note">아직 저장된 조합표가 없어요.</div>`;
      return;
    }
    el.savedGrid.innerHTML = "";
    boards.forEach((board) => {
      const card = document.createElement("div");
      card.className = "saved-card";
      card.innerHTML = `
        <div class="saved-card-head">
          <div>
            <div class="saved-card-title">${escapeHtml(board.title || "이름 없는 조합표")}</div>
            <div class="saved-card-sub">착장 ${board.columns.length}개</div>
          </div>
        </div>
        <button class="saved-delete">삭제</button>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".saved-delete")) return;
        state.board = {
          id: board.id,
          title: board.title,
          columns: board.columns,
          cells: board.cells,
        };
        el.boardSaveMsg.textContent = "";
        showView("editor");
        renderSidebarFilters();
        renderSidebarProductGrid();
        renderGrid();
      });
      card.querySelector(".saved-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("이 조합표를 삭제할까요?")) return;
        await fetchJSON(`/api/boards?id=${encodeURIComponent(board.id)}`, { method: "DELETE" });
        loadSavedBoards();
      });
      el.savedGrid.appendChild(card);
    });
  } catch (err) {
    el.savedGrid.innerHTML = `<div class="empty-note">불러오기 실패: ${escapeHtml(err.message)}</div>`;
  }
}

// ---------- Boot ----------
(async function init() {
  try {
    await Promise.all([loadCatalog(), loadShoots()]);
  } catch (err) {
    el.shootGrid.innerHTML = `<div class="empty-note">불러오기 실패: ${escapeHtml(err.message)}</div>`;
    return;
  }
  renderShootGrid();
  showView("home");
})();
