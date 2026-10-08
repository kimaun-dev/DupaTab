/**
 * DupaTab - popup.js (V.2)
 *
 * หน้าที่หลัก:
 *  - อ่านแท็บทั้งหมด → หาซ้ำ (ใช้ findDuplicates จาก utils.js)
 *  - แสดง UI ให้ผู้ใช้เลือกแท็บที่จะปิด
 *  - ส่ง message ไป background เพื่ออัปเดต badge
 *  - เก็บ "การเลือก" ไว้ใน chrome.storage.session (ผ่าน background)
 *
 * โครงสร้างเดิม (HTML/CSS) ไม่เปลี่ยน → ใช้ ID เดิมทั้งหมด
 */

// ---------- Elements (เก็บ ref ไว้ที่เดียว) ----------
const elements = {
  totalTabs: document.getElementById("totalTabs"),
  duplicateGroups: document.getElementById("duplicateGroups"),
  duplicateTabs: document.getElementById("duplicateTabs"),
  selectedTabs: document.getElementById("selectedTabs"),
  statusMessage: document.getElementById("statusMessage"),
  globalControls: document.getElementById("globalControls"),
  groupsContainer: document.getElementById("groupsContainer"),
  emptyState: document.getElementById("emptyState"),
  closeBar: document.getElementById("closeBar"),
  refreshButton: document.getElementById("refreshButton"),
  selectAllButton: document.getElementById("selectAllButton"),
  clearSelectionButton: document.getElementById("clearSelectionButton"),
  closeSelectedButton: document.getElementById("closeSelectedButton"),
  confirmDialog: document.getElementById("confirmDialog"),
  dialogTitle: document.getElementById("dialogTitle"),
  dialogMessage: document.getElementById("dialogMessage"),
  dialogCancelButton: document.getElementById("dialogCancelButton"),
  dialogConfirmButton: document.getElementById("dialogConfirmButton"),
};

// ---------- State ----------
let duplicateGroups = []; // ผลจาก findDuplicates
let selectedTabIds = new Set(); // tab.id ที่ผู้ใช้เลือก
let pendingAction = null; // action ที่รอ confirm ("close" | "selectAll" | "clear" | null)

// ---------- Helpers ----------
/** ส่ง message ไป background (Promise-based) */
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/** แสดง message ใน status bar */
function setStatus(text, type = "info") {
  elements.statusMessage.textContent = text;
  elements.statusMessage.className = `status-message ${type}`;
}

/** อัปเดตตัวเลขสถิติ */
function updateStats() {
  if (!duplicateGroups.length) {
    elements.totalTabs.textContent = "0";
    elements.duplicateGroups.textContent = "0";
    elements.duplicateTabs.textContent = "0";
    elements.selectedTabs.textContent = "0";
    return;
  }
  const totalDup = duplicateGroups.reduce((sum, g) => sum + (g.tabs.length - 1), 0);
  elements.totalTabs.textContent = String(totalDup);
  elements.duplicateGroups.textContent = String(duplicateGroups.length);
  elements.duplicateTabs.textContent = String(
    duplicateGroups.reduce((sum, g) => sum + g.tabs.length, 0)
  );
  elements.selectedTabs.textContent = String(selectedTabIds.size);
}

/**
 * อัปเดต checkbox ของ group
 * - "some" ถ้าเลือกบางตัว
 * - "checked" ถ้าเลือกทุกตัว
 * - "unchecked" ถ้าไม่เลือก
 */
function syncGroupCheckbox(groupId) {
  const group = duplicateGroups.find((g) => g.key === groupId);
  if (!group) return;
  const row = elements.groupsContainer.querySelector(`[data-group-id="${groupId}"]`);
  if (!row) return;
  const checkbox = row.querySelector(".group-checkbox");
  if (!checkbox) return;

  const allSelected = group.tabs.every((t) => selectedTabIds.has(t.id));
  const noneSelected = group.tabs.every((t) => !selectedTabIds.has(t.id));
  checkbox.checked = allSelected;
  checkbox.indeterminate = !allSelected && !noneSelected;
}

/**
 * เปลี่ยนสถานะ checkbox ทุก group ตามเงื่อนไข
 * @param {string} state "all" | "none"
 */
function setAllCheckboxes(state) {
  for (const group of duplicateGroups) {
    const row = elements.groupsContainer.querySelector(`[data-group-id="${group.key}"]`);
    if (!row) continue;
    const checkbox = row.querySelector(".group-checkbox");
    if (!checkbox) continue;
    checkbox.checked = state === "all";
    checkbox.indeterminate = false;
  }
}

/**
 * สร้าง DOM ของ group เดียว
 * @param {object} group ผลจาก findDuplicates
 * @returns {HTMLElement}
 */
function buildGroup(group) {
  const groupEl = document.createElement("div");
  groupEl.className = "group";
  groupEl.dataset.groupId = group.key;

  // หัวกลุ่ม: checkbox + หัวข้อ + จำนวน
  const header = document.createElement("div");
  header.className = "group-header";

  const groupCheckbox = document.createElement("input");
  groupCheckbox.type = "checkbox";
  groupCheckbox.className = "group-checkbox";
  groupCheckbox.setAttribute("aria-label", `Select all tabs for ${group.title}`);

  const heading = document.createElement("div");
  heading.className = "group-heading";
  const groupTitle = document.createElement("h3");
  groupTitle.textContent = group.title;
  const groupCount = document.createElement("span");
  groupCount.className = "group-count";
  groupCount.textContent = `${group.tabs.length} tabs`;
  heading.append(groupTitle, groupCount);

  header.append(groupCheckbox, heading);
  groupEl.append(header);

  // รายการแท็บ
  const tabList = document.createElement("div");
  tabList.className = "tab-list";

  for (const tab of group.tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = "tab-row";
    tabEl.dataset.tabId = String(tab.id);
    tabEl.dataset.groupId = group.key;

    const rowCheckbox = document.createElement("input");
    rowCheckbox.type = "checkbox";
    rowCheckbox.className = "row-checkbox";
    rowCheckbox.value = String(tab.id);
    rowCheckbox.setAttribute("aria-label", `Select tab: ${tab.title}`);

    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = tab.favIconUrl || "";
    favicon.alt = "";

    const tabMeta = document.createElement("div");
    tabMeta.className = "tab-meta";
    const tabTitle = document.createElement("p");
    tabTitle.className = "tab-title";
    tabTitle.textContent = tab.title;
    const tabUrl = document.createElement("p");
    tabUrl.className = "tab-url";
    tabUrl.textContent = tab.url;
    tabMeta.append(tabTitle, tabUrl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab-close";
    closeBtn.setAttribute("aria-label", `Close tab: ${tab.title}`);
    closeBtn.textContent = "Close";

    tabEl.append(rowCheckbox, favicon, tabMeta, closeBtn);
    tabList.append(tabEl);
  }

  groupEl.append(tabList);
  return groupEl;
}

/**
 * สร้าง list ทั้งหมด + bind event
 */
function renderGroups() {
  elements.groupsContainer.innerHTML = "";

  if (!duplicateGroups.length) {
    elements.emptyState.classList.remove("hidden");
    elements.globalControls.classList.add("hidden");
    elements.closeBar.classList.add("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.globalControls.classList.remove("hidden");
  elements.closeBar.classList.remove("hidden");

  for (const group of duplicateGroups) {
    elements.groupsContainer.append(buildGroup(group));
  }

  bindGroupEvents();
  updateStats();
}

/**
 * Bind event listeners ของ list ที่เพิ่ง render
 */
function bindGroupEvents() {
  // group checkbox: เลือก/ยกเลิกทุกแท็บใน group
  elements.groupsContainer.querySelectorAll(".group-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const groupId = e.target.closest("[data-group-id]").dataset.groupId;
      const group = duplicateGroups.find((g) => g.key === groupId);
      if (!group) return;
      for (const t of group.tabs) {
        if (e.target.checked) selectedTabIds.add(t.id);
        else selectedTabIds.delete(t.id);
      }
      // sync row checkboxes
      elements.groupsContainer
        .querySelectorAll(`[data-group-id="${groupId}"] .row-checkbox`)
        .forEach((rowCb) => {
          rowCb.checked = e.target.checked;
        });
      updateStats();
    });
  });

  // row checkbox: เลือก/ยกเลิกแท็บเดียว
  elements.groupsContainer.querySelectorAll(".row-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const tabId = Number(e.target.dataset.tabId || e.target.value);
      if (e.target.checked) selectedTabIds.add(tabId);
      else selectedTabIds.delete(tabId);
      // sync group checkbox
      const groupId = e.target.closest("[data-group-id]").dataset.groupId;
      syncGroupCheckbox(groupId);
      updateStats();
    });
  });

  // close button ใน row
  elements.groupsContainer.querySelectorAll(".tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest(".tab-row");
      const tabId = Number(row.dataset.tabId);
      const tab = findTabById(tabId);
      if (tab) closeTab(tab);
    });
  });
}

/** หา tab object จาก id */
function findTabById(tabId) {
  for (const group of duplicateGroups) {
    const t = group.tabs.find((x) => x.id === tabId);
    if (t) return t;
  }
  return null;
}

/**
 * ปิดแท็บ + เก็บ log
 * @param {chrome.tabs.Tab} tab
 */
function closeTab(tab) {
  chrome.tabs
    .remove(tab.id)
    .then(() => {
      // เก็บ log
      addCloseLog(tab);
      // อัปเดต list (เอา tab ออก)
      refreshFromTabs();
      // อัปเดต badge
      sendToBackground({ type: "REFRESH_BADGE" }).catch(() => {});
    })
    .catch((err) => {
      setStatus(`Failed to close tab: ${err.message}`, "error");
    });
}

/**
 * เพิ่ม log การปิดแท็บ (เก็บใน storage.local, จำกัด 100 รายการ)
 */
function addCloseLog(tab) {
  chrome.storage.local
    .get("closeLog")
    .then((data) => {
      const log = data.closeLog || [];
      log.unshift({
        title: tab.title,
        url: tab.url,
        closedAt: Date.now(),
      });
      if (log.length > 100) log.length = 100;
      return chrome.storage.local.set({ closeLog: log });
    })
    .catch(() => {}); // log เป็น optional
}

/**
 * อ่านแท็บทั้งหมด + คำนวณซ้ำ + render
 * ใช้เมื่อ refresh หรือหลัง close
 */
function refreshFromTabs() {
  chrome.tabs
    .query({})
    .then((tabs) => {
      duplicateGroups = findDuplicates(tabs);
      renderGroups();
    })
    .catch((err) => {
      setStatus(`Failed to load tabs: ${err.message}`, "error");
    });
}

// ---------- Confirm dialog ----------
/**
 * เปิด dialog
 * @param {string} title
 * @param {string} message
 * @param {string} confirmLabel
 * @param {string} type "danger" | "default"
 * @param {Function} onConfirm
 */
function openDialog(title, message, confirmLabel, type, onConfirm) {
  elements.dialogTitle.textContent = title;
  elements.dialogMessage.textContent = message;
  elements.dialogConfirmButton.textContent = confirmLabel;
  elements.dialogConfirmButton.className = type === "danger" ? "danger" : "";
  elements.confirmDialog.classList.remove("hidden");
  elements.dialogConfirmButton.focus();
  // เก็บ callback
  pendingAction = onConfirm;
}

/** ปิด dialog */
function closeDialog() {
  elements.confirmDialog.classList.add("hidden");
  pendingAction = null;
}

// ---------- Global actions ----------
function selectAll() {
  for (const group of duplicateGroups) {
    for (const t of group.tabs) selectedTabIds.add(t.id);
  }
  setAllCheckboxes("all");
  // sync row checkboxes
  elements.groupsContainer.querySelectorAll(".row-checkbox").forEach((cb) => {
    cb.checked = true;
  });
  updateStats();
  // เก็บ selection ไป background
  saveSelectionToBackground();
}

function clearSelection() {
  selectedTabIds.clear();
  setAllCheckboxes("none");
  elements.groupsContainer.querySelectorAll(".row-checkbox").forEach((cb) => {
    cb.checked = false;
  });
  updateStats();
  saveSelectionToBackground();
}

/** ส่ง selection ไปเก็บใน background (session) */
function saveSelectionToBackground() {
  const groups = {};
  for (const g of duplicateGroups) {
    const ids = g.tabs.filter((t) => selectedTabIds.has(t.id)).map((t) => t.id);
    if (ids.length) groups[g.key] = ids;
  }
  sendToBackground({ type: "SET_SELECTED_GROUPS", groups }).catch(() => {});
}

function closeSelected() {
  if (!selectedTabIds.size) {
    setStatus("No tabs selected", "info");
    return;
  }
  const count = selectedTabIds.size;
  openDialog(
    "Close selected tabs?",
    `This will close ${count} tab${count > 1 ? "s" : ""}. You cannot undo this.`,
    `Close ${count} tab${count > 1 ? "s" : ""}`,
    "danger",
    () => {
      // ปิดทุก tab ที่เลือก
      Promise.allSettled(
        Array.from(selectedTabIds).map((id) => {
          const tab = findTabById(id);
          return tab ? chrome.tabs.remove(id) : Promise.resolve();
        })
      )
        .then(() => {
          selectedTabIds.clear();
          refreshFromTabs();
          setStatus(`${count} tab${count > 1 ? "s" : ""} closed`, "success");
        })
        .catch((err) => setStatus(`Failed: ${err.message}`, "error"));
    }
  );
}

// ---------- Event listeners (global buttons) ----------
elements.refreshButton.addEventListener("click", () => {
  refreshFromTabs();
  sendToBackground({ type: "REFRESH_BADGE" }).catch(() => {});
});

elements.selectAllButton.addEventListener("click", selectAll);
elements.clearSelectionButton.addEventListener("click", clearSelection);
elements.closeSelectedButton.addEventListener("click", closeSelected);

// Dialog
elements.dialogCancelButton.addEventListener("click", closeDialog);
elements.dialogConfirmButton.addEventListener("click", () => {
  if (typeof pendingAction === "function") {
    pendingAction();
    closeDialog();
  }
});

// Escape = ปิด dialog
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !elements.confirmDialog.classList.contains("hidden")) {
    closeDialog();
  }
});

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  refreshFromTabs();
});
