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
}

// ---------- Manual model add form ----------
const modelFormState = { clothingSize: "", shoeSize: "", imageDataUrl: "" };

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
  el.modelNameInput.value = "";
  el.modelImageInput.value = "";
  el.modelImagePreview.hidden = true;
  el.modelFormBackdrop.hidden = false;
  renderModelForm();
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
  reader.onload = () => {
    modelFormState.imageDataUrl = reader.result;
    el.modelImagePreview.src = reader.result;
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
  state.board.models.push({
    id: "m" + Date.now() + Math.random().toString(36).slice(2, 6),
    name,
    image: modelFormState.imageDataUrl,
    clothingSize: modelFormState.clothingSize,
    shoeSize: modelFormState.shoeSize,
  });
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
        html += `<div class="cell-item">
          <div class="cell-item-top">
            <img src="/api/image-proxy?id=${it.id}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${placeholderImg()}'" />
            <button class="thumb-remove" data-remove-cell="${key}" data-remove-id="${it.id}">×</button>
          </div>
          <div class="cell-item-name">${escapeHtml(p?.name || "")}</div>
          <input type="text" class="cell-item-size" placeholder="사이즈 입력" value="${escapeHtml(it.size || "")}" data-size-cell="${key}" data-size-id="${it.id}" />
          <label class="cell-item-received">
            <input type="checkbox" data-received-cell="${key}" data-received-id="${it.id}" ${it.received ? "checked" : ""} />
            수령 완료
          </label>
          ${arrival}
        </div>`;
      });
      html += `</div>`;
    }
    html += `</td>`;
  });
  return html;
}

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

  b.models.forEach((m) => {
    html += `<tr><td class="row-head"><div class="row-head-inner">
        <img src="${m.image || placeholderImg()}" alt="" decoding="async" />
        <div>
          ${b.category === "호리존 촬영" ? `<div class="row-head-look-label">착장 1</div>` : ""}
          <div class="row-head-name">${escapeHtml(m.name)}</div>
          <div class="row-head-size">${escapeHtml(m.clothingSize ? "의류 " + m.clothingSize : "")}${m.clothingSize && m.shoeSize ? " · " : ""}${escapeHtml(m.shoeSize ? "신발 " + m.shoeSize : "")}</div>
        </div>
        <button class="row-head-remove" data-remove-model="${m.id}" title="모델 제거">×</button>
      </div></td>`;
    html += renderRowCellsHtml(b, m.id, colWidth);
    html += "</tr>";
  });

  (b.lookRows || []).forEach((row) => {
    html += `<tr><td class="row-head"><div class="row-head-inner">
        <div>
          <div class="row-head-name">${escapeHtml(row.label)}</div>
        </div>
        <button class="row-head-remove" data-remove-lookrow="${row.id}" title="착장 행 제거">×</button>
      </div></td>`;
    html += renderRowCellsHtml(b, row.id, colWidth);
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
  el.outfitGrid.querySelectorAll("[data-remove-lookrow]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rowId = e.target.dataset.removeLookrow;
      if (!confirm("이 착장 행을 제거할까요?")) return;
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
      if (!confirm("이 모델을 표에서 제거할까요?")) return;
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
        state.board.cells[key].push({ id: productId, category: product.category, size: "", received: false });
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
    el.boardSaveMsg.textContent = "저장 실패: " + err.message;
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

const SEASON_CHIPS = ["봄", "가을", "여름", "겨울"];
const CATEGORY_CHIPS = ["세트", "하의", "상의", "아우터", "원피스", "슬립온", "구두", "운동화"];

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
    list = list.filter((p) => p.season && [...state.selectedSeasons].some((s) => p.season.includes(s)));
  }
  if (state.selectedCategories.size) {
    list = list.filter((p) => p.category && [...state.selectedCategories].some((c) => p.category.includes(c)));
  }

  el.sidebarCount.textContent = `${list.length} / ${state.products.length}`;
  el.sidebarProductGrid.innerHTML = "";
  list.forEach((p) => {
    const card = document.createElement("div");
    card.className = "sidebar-product-card";
    card.draggable = true;
    card.innerHTML = `
      <img src="${p.image || placeholderImg()}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" />
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
