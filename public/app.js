const state = {
  models: [],
  products: [],
  modelsById: new Map(),
  productsById: new Map(),
  shoots: [],
  currentShootId: null,
  currentView: "home", // home | editor | saved

  pickModelIds: [],
  board: null, // { id, title, modelIds, columns, cells }

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

  modelPickStep: document.getElementById("modelPickStep"),
  modelPickGrid: document.getElementById("modelPickGrid"),
  buildGridBtn: document.getElementById("buildGridBtn"),

  gridStep: document.getElementById("gridStep"),
  boardTitleInput: document.getElementById("boardTitleInput"),
  addColumnBtn: document.getElementById("addColumnBtn"),
  editModelsBtn: document.getElementById("editModelsBtn"),
  saveBoardBtn: document.getElementById("saveBoardBtn"),
  boardSaveMsg: document.getElementById("boardSaveMsg"),
  outfitGrid: document.getElementById("outfitGrid"),

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

function badgeClass(category) {
  return category === "호리존 촬영" ? "horizon" : "concept";
}

function cellKey(modelId, columnId) {
  return modelId + "__" + columnId;
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
  do {
    const data = await fetchPage(endpoint, cursor);
    items = items.concat(data.items);
    cursor = data.hasMore ? data.nextCursor : undefined;
    el.syncStatus.textContent = `${label} 불러오는 중… (${items.length}개)`;
    if (cursor) await sleep(400); // pace requests to stay clear of Notion's rate limit
  } while (cursor);
  return items;
}

function applyCatalog(models, products, syncedAt) {
  state.models = models.filter((m) => m.name);
  state.products = products.filter((p) => p.name);
  state.modelsById = new Map(state.models.map((m) => [m.id, m]));
  state.productsById = new Map(state.products.map((p) => [p.id, p]));
  const timeLabel = syncedAt
    ? new Date(syncedAt).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : "";
  el.syncStatus.textContent = `모델 ${state.models.length}명 · 제품 ${state.products.length}개${timeLabel ? " · 동기화 " + timeLabel : ""}`;
}

// Fetches everything fresh from Notion, page by page (each request stays
// well under the function time limit), then commits the full lists to the
// cache in one shot each. Products and models are fetched one after another
// (not concurrently) to keep the request rate against Notion's API low.
async function fullSync() {
  const products = await fetchAllPages("/api/products-page", "제품");
  const models = await fetchAllPages("/api/models-page", "모델");
  const [productsRes] = await Promise.all([
    fetchJSONWithRetry("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products }),
    }),
    fetchJSONWithRetry("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models }),
    }),
  ]);
  applyCatalog(models, products, productsRes.syncedAt);
}

async function loadCatalog(forceRefresh = false) {
  if (forceRefresh) {
    await fullSync();
    return;
  }
  el.syncStatus.textContent = "불러오는 중…";
  const [modelsRes, productsRes] = await Promise.all([
    fetchJSONWithRetry("/api/models"),
    fetchJSONWithRetry("/api/products"),
  ]);
  if (!productsRes.syncedAt) {
    // No cache yet (first ever load) — do a full sync now.
    await fullSync();
    return;
  }
  applyCatalog(modelsRes.models, productsRes.products, productsRes.syncedAt);
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
    // Re-render whatever product/model data is currently on screen.
    if (state.currentView === "editor" && !el.modelPickStep.hidden) {
      renderModelPickGrid();
    }
    if (state.currentView === "editor" && !el.gridStep.hidden && state.board) {
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
    el.brandSub.textContent = "OZKIZ";
  } else {
    const shoot = state.shoots.find((s) => s.id === state.currentShootId);
    el.brandTitle.textContent = shoot ? shoot.title : "";
    el.brandSub.textContent = shoot ? shoot.category : "";
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
  const category = document.querySelector('input[name="shootCategory"]:checked').value;
  const shootDate = el.shootDateInput.value;
  if (!title) { el.shootFormMsg.textContent = "큰제목을 입력해주세요."; return; }
  try {
    el.submitShootBtn.disabled = true;
    await fetchJSON("/api/shoots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, shootDate }),
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
    el.shootGrid.innerHTML = `<div class="empty-note">아직 만든 촬영회차가 없어요. "+ 새 촬영 만들기"로 시작해보세요.</div>`;
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
      <div class="shoot-form-row">
        <label class="radio-chip"><input type="radio" name="editCategory-${shoot.id}" value="컨셉 촬영" ${shoot.category === "컨셉 촬영" ? "checked" : ""}/> 컨셉 촬영</label>
        <label class="radio-chip"><input type="radio" name="editCategory-${shoot.id}" value="호리존 촬영" ${shoot.category === "호리존 촬영" ? "checked" : ""}/> 호리존 촬영</label>
      </div>
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
    const category = card.querySelector(`input[name="editCategory-${shoot.id}"]:checked`).value;
    if (!title) return;
    await fetchJSON("/api/shoots", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: shoot.id, title, category, shootDate }),
    });
    await loadShoots();
    renderShootGrid();
  });
}

function enterShoot(id) {
  state.currentShootId = id;
  state.board = null;
  state.pickModelIds = [];
  showModelPickStep();
  showView("editor");
}

// ---------- Model pick step ----------
function showModelPickStep() {
  el.modelPickStep.hidden = false;
  el.gridStep.hidden = true;
  renderModelPickGrid();
}

function renderModelPickGrid() {
  el.modelPickGrid.innerHTML = "";
  state.models.forEach((m) => {
    const checked = state.pickModelIds.includes(m.id);
    const card = document.createElement("div");
    card.className = "model-pick-card" + (checked ? " checked" : "");
    card.innerHTML = `
      <img src="${m.image || placeholderImg()}" alt="" />
      <div class="model-pick-card-name">${escapeHtml(m.name)}</div>
      <div class="model-pick-card-size">${escapeHtml(m.size || "")}</div>
    `;
    card.addEventListener("click", () => {
      const i = state.pickModelIds.indexOf(m.id);
      if (i === -1) state.pickModelIds.push(m.id);
      else state.pickModelIds.splice(i, 1);
      renderModelPickGrid();
      el.buildGridBtn.disabled = state.pickModelIds.length === 0;
    });
    el.modelPickGrid.appendChild(card);
  });
  el.buildGridBtn.disabled = state.pickModelIds.length === 0;
}

el.buildGridBtn.addEventListener("click", () => {
  state.board = {
    id: null,
    title: "",
    modelIds: [...state.pickModelIds],
    columns: [{ id: "c" + Date.now(), label: "착장1" }],
    cells: {},
  };
  el.modelPickStep.hidden = true;
  el.gridStep.hidden = false;
  el.boardTitleInput.value = "";
  el.boardSaveMsg.textContent = "";
  renderSidebarFilters();
  renderSidebarProductGrid();
  renderGrid();
});

el.editModelsBtn.addEventListener("click", () => {
  state.pickModelIds = [...state.board.modelIds];
  showModelPickStep();
});

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

  let html = "<thead><tr><th class=\"row-head\"></th>";
  b.columns.forEach((col) => {
    html += `<th class="col-head" data-col="${col.id}">
      <div class="col-head-row">
        <input type="text" value="${escapeHtml(col.label)}" data-col-input="${col.id}" />
        ${b.columns.length > 1 ? `<button class="col-remove-btn" data-col-remove="${col.id}">×</button>` : ""}
      </div>
    </th>`;
  });
  html += "</tr></thead><tbody>";

  b.modelIds.forEach((modelId) => {
    const m = state.modelsById.get(modelId);
    html += `<tr><td class="row-head"><div class="row-head-inner">
        <img src="${m?.image || placeholderImg()}" alt="" />
        <div><div class="row-head-name">${escapeHtml(m?.name || "?")}</div><div class="row-head-size">${escapeHtml(m?.size || "")}</div></div>
      </div></td>`;
    b.columns.forEach((col) => {
      const key = cellKey(modelId, col.id);
      const items = b.cells[key] || [];
      html += `<td class="grid-cell" data-model="${modelId}" data-col="${col.id}">`;
      if (items.length === 0) {
        html += `<div class="grid-cell-empty">제품을 끌어다 놓으세요</div>`;
      } else {
        html += `<div class="grid-cell-thumbs">`;
        items.forEach((it) => {
          const p = state.productsById.get(it.id);
          html += `<div class="grid-cell-thumb-wrap">
            <img src="${p?.image || placeholderImg()}" alt="" title="${escapeHtml(p?.name || "")}" />
            <button class="thumb-remove" data-remove-cell="${key}" data-remove-id="${it.id}">×</button>
          </div>`;
        });
        html += `</div>`;
      }
      html += `</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  el.outfitGrid.innerHTML = html;

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
      state.board.columns = state.board.columns.filter((c) => c.id !== colId);
      Object.keys(state.board.cells).forEach((k) => {
        if (k.endsWith("__" + colId)) delete state.board.cells[k];
      });
      renderGrid();
    });
  });
  el.outfitGrid.querySelectorAll("[data-remove-cell]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = e.target.dataset.removeCell;
      const id = e.target.dataset.removeId;
      state.board.cells[key] = (state.board.cells[key] || []).filter((it) => it.id !== id);
      renderGrid();
    });
  });
  el.outfitGrid.querySelectorAll(".grid-cell").forEach((cell) => {
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const productId = e.dataTransfer.getData("text/plain");
      if (!productId) return;
      const product = state.productsById.get(productId);
      if (!product) return;
      const key = cellKey(cell.dataset.model, cell.dataset.col);
      if (!state.board.cells[key]) state.board.cells[key] = [];
      if (!state.board.cells[key].some((it) => it.id === productId)) {
        state.board.cells[key].push({ id: productId, category: product.category });
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
      modelIds: b.modelIds,
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
      const modelNames = board.modelIds.map((id) => state.modelsById.get(id)?.name).filter(Boolean).join(", ");
      const card = document.createElement("div");
      card.className = "saved-card";
      card.innerHTML = `
        <div class="saved-card-head">
          <div>
            <div class="saved-card-title">${escapeHtml(board.title || "이름 없는 조합표")}</div>
            <div class="saved-card-sub">모델 ${board.modelIds.length}명 (${escapeHtml(modelNames)}) · 착장 ${board.columns.length}개</div>
          </div>
        </div>
        <button class="saved-delete">삭제</button>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".saved-delete")) return;
        state.board = {
          id: board.id,
          title: board.title,
          modelIds: board.modelIds,
          columns: board.columns,
          cells: board.cells,
        };
        el.modelPickStep.hidden = true;
        el.gridStep.hidden = false;
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
