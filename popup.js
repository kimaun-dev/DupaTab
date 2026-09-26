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
  dialogConfirmButton: document.getElementById("dialogConfirmButton")
};

const state = {
  allTabs: [],
  groups: [],
  selectedTabIds: new Set(),
  windowLabels: new Map(),
  scanning: false
};

/**
 * Internal browser pages are intentionally excluded from duplicate detection.
 * This list can be extended without changing the rest of the scanning logic.
 */
function isIgnoredUrl(url) {
  if (!url) {
    return true;
  }

  const ignoredPrefixes = [
    "chrome://",
    "chrome-extension://",
    "chrome-untrusted://",
    "about:",
    "devtools://"
  ];

  return ignoredPrefixes.some((prefix) =>
    url.toLowerCase().startsWith(prefix)
  );
}

/**
 * Normalize URLs only for duplicate comparison.
 *
 * Current rules:
 * - ignore hash/fragment
 * - remove a non-root trailing slash
 * - treat an origin root with or without "/" as the same URL
 * - keep query parameters exactly as they are
 *
 * Keeping this function isolated makes future comparison rules easy to change.
 */
function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    let pathname = url.pathname || "";
    if (pathname === "/") {
      pathname = "";
    } else {
      pathname = pathname.replace(/\/+$/, "");
    }

    const authority = url.host ? `//${url.host}` : url.protocol === "file:" ? "//" : "";
    return `${url.protocol}${authority}${pathname}${url.search}`;
  } catch {
    const withoutHash = String(rawUrl).split("#")[0];
    return withoutHash.length > 1
      ? withoutHash.replace(/\/+$/, "")
      : withoutHash;
  }
}

/**
 * Chrome does not expose a reliable tab creation timestamp.
 * Lower tab IDs are used only as a best-effort fallback for "oldest".
 */
function compareLikelyOldest(a, b) {
  const aId = Number.isInteger(a.id) ? a.id : Number.MAX_SAFE_INTEGER;
  const bId = Number.isInteger(b.id) ? b.id : Number.MAX_SAFE_INTEGER;
  return aId - bId;
}

/**
 * Choose the tab that should stay unchecked by default.
 * Priority: pinned -> active -> best-effort oldest.
 */
function chooseKeepTab(tabs) {
  const pinnedTabs = tabs.filter((tab) => tab.pinned);
  if (pinnedTabs.length > 0) {
    const activePinned = pinnedTabs.find((tab) => tab.active);
    return activePinned || [...pinnedTabs].sort(compareLikelyOldest)[0];
  }

  const activeTab = tabs.find((tab) => tab.active);
  if (activeTab) {
    return activeTab;
  }

  return [...tabs].sort(compareLikelyOldest)[0];
}

function buildWindowLabels(tabs) {
  const uniqueWindowIds = [...new Set(tabs.map((tab) => tab.windowId))];
  state.windowLabels = new Map(
    uniqueWindowIds.map((windowId, index) => [windowId, `Window ${index + 1}`])
  );
}

function buildDuplicateGroups(tabs) {
  const grouped = new Map();

  for (const tab of tabs) {
    if (isIgnoredUrl(tab.url)) {
      continue;
    }

    const normalizedUrl = normalizeUrl(tab.url);
    if (!normalizedUrl) {
      continue;
    }

    if (!grouped.has(normalizedUrl)) {
      grouped.set(normalizedUrl, []);
    }

    grouped.get(normalizedUrl).push(tab);
  }

  return [...grouped.entries()]
    .filter(([, groupTabs]) => groupTabs.length >= 2)
    .map(([normalizedUrl, groupTabs]) => {
      const sortedTabs = [...groupTabs].sort((a, b) => {
        if (a.windowId !== b.windowId) {
          return a.windowId - b.windowId;
        }
        return a.index - b.index;
      });

      const keepTab = chooseKeepTab(sortedTabs);

      return {
        normalizedUrl,
        displayUrl: sortedTabs[0]?.url || normalizedUrl,
        title: keepTab?.title || sortedTabs[0]?.title || "Untitled page",
        tabs: sortedTabs,
        keepTabId: keepTab?.id
      };
    })
    .sort((a, b) => {
      if (b.tabs.length !== a.tabs.length) {
        return b.tabs.length - a.tabs.length;
      }
      return a.title.localeCompare(b.title);
    });
}

function setDefaultSelectionForGroup(group) {
  for (const tab of group.tabs) {
    state.selectedTabIds.delete(tab.id);
  }

  for (const tab of group.tabs) {
    const shouldKeep = tab.id === group.keepTabId;
    const protectedByDefault = tab.pinned;

    if (!shouldKeep && !protectedByDefault) {
      state.selectedTabIds.add(tab.id);
    }
  }
}

function applyDefaultSelection() {
  state.selectedTabIds.clear();
  for (const group of state.groups) {
    setDefaultSelectionForGroup(group);
  }
}

function setStatus(message = "", isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("error", isError);
}

function setScanningUi(isScanning) {
  state.scanning = isScanning;
  elements.refreshButton.disabled = isScanning;
  elements.selectAllButton.disabled = isScanning;
  elements.clearSelectionButton.disabled = isScanning;

  if (isScanning) {
    elements.closeSelectedButton.disabled = true;
  } else {
    updateCounters();
  }
}

async function scanTabs({ preselectDuplicates = true, statusMessage = "" } = {}) {
  setScanningUi(true);
  setStatus("Scanning open tabs...");

  try {
    const tabs = await chrome.tabs.query({});
    state.allTabs = tabs;
    buildWindowLabels(tabs);
    state.groups = buildDuplicateGroups(tabs);

    if (preselectDuplicates) {
      applyDefaultSelection();
    } else {
      state.selectedTabIds.clear();
    }

    render();
    setStatus(statusMessage);
  } catch (error) {
    state.allTabs = [];
    state.groups = [];
    state.selectedTabIds.clear();
    render();
    setStatus(`Could not scan tabs: ${error.message || error}`, true);
  } finally {
    setScanningUi(false);
  }
}

function updateCounters() {
  const duplicateTabCount = state.groups.reduce(
    (sum, group) => sum + group.tabs.length,
    0
  );
  const selectedCount = state.selectedTabIds.size;

  elements.totalTabs.textContent = String(state.allTabs.length);
  elements.duplicateGroups.textContent = String(state.groups.length);
  elements.duplicateTabs.textContent = String(duplicateTabCount);
  elements.selectedTabs.textContent = String(selectedCount);

  elements.closeSelectedButton.textContent = `Close Selected Tabs (${selectedCount})`;
  elements.closeSelectedButton.disabled = state.scanning || selectedCount === 0;
}

function render() {
  renderGroups();
  updateCounters();

  const hasDuplicates = state.groups.length > 0;
  elements.groupsContainer.hidden = !hasDuplicates;
  elements.globalControls.hidden = !hasDuplicates;
  elements.closeBar.hidden = !hasDuplicates;
  elements.emptyState.hidden = hasDuplicates;
}

function renderGroups() {
  elements.groupsContainer.replaceChildren();

  for (const group of state.groups) {
    elements.groupsContainer.appendChild(createGroupElement(group));
  }
}

function createGroupElement(group) {
  const article = document.createElement("article");
  article.className = "group";
  article.dataset.groupUrl = group.normalizedUrl;

  const header = document.createElement("div");
  header.className = "group-header";

  const titleRow = document.createElement("div");
  titleRow.className = "group-title-row";

  const title = document.createElement("h2");
  title.className = "group-title";
  title.textContent = group.title;
  title.title = group.title;

  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = `${group.tabs.length} duplicate tabs`;

  titleRow.append(title, count);

  const url = document.createElement("div");
  url.className = "group-url";
  url.textContent = group.displayUrl;
  url.title = group.displayUrl;

  const actions = document.createElement("div");
  actions.className = "group-actions";

  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "button button-secondary button-small";
  selectButton.textContent = "Select Duplicates";
  selectButton.addEventListener("click", () => {
    setDefaultSelectionForGroup(group);
    syncSelectionUi();
  });

  const deselectButton = document.createElement("button");
  deselectButton.type = "button";
  deselectButton.className = "button button-secondary button-small";
  deselectButton.textContent = "Deselect All";
  deselectButton.addEventListener("click", () => {
    for (const tab of group.tabs) {
      state.selectedTabIds.delete(tab.id);
    }
    syncSelectionUi();
  });

  actions.append(selectButton, deselectButton);
  header.append(titleRow, url, actions);

  const tabList = document.createElement("div");
  tabList.className = "tab-list";

  for (const tab of group.tabs) {
    tabList.appendChild(createTabRow(tab, group));
  }

  article.append(header, tabList);
  return article;
}

function createTabRow(tab, group) {
  const row = document.createElement("div");
  row.className = "tab-row";
  row.dataset.tabId = String(tab.id);

  if (tab.active) {
    row.classList.add("active");
  }
  if (tab.pinned) {
    row.classList.add("pinned");
  }
  if (state.selectedTabIds.has(tab.id)) {
    row.classList.add("selected");
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "tab-checkbox";
  checkbox.dataset.tabId = String(tab.id);
  checkbox.checked = state.selectedTabIds.has(tab.id);
  checkbox.setAttribute("aria-label", `Select ${tab.title || "tab"} for closing`);

  checkbox.addEventListener("change", async () => {
    const tabId = tab.id;

    if (checkbox.checked) {
      state.selectedTabIds.add(tabId);

      if (isEntireGroupSelected(group)) {
        const keepAllSelected = await showDialog({
          title: "Every tab in this group is selected",
          message:
            "You selected every tab in this duplicate group.\nAt least one tab should normally remain open.",
          cancelLabel: "Undo Selection",
          confirmLabel: "Keep All Selected"
        });

        if (!keepAllSelected) {
          state.selectedTabIds.delete(tabId);
        }
      }
    } else {
      state.selectedTabIds.delete(tabId);
    }

    syncSelectionUi();
  });

  const info = document.createElement("div");
  info.className = "tab-info";

  const tabTitle = document.createElement("div");
  tabTitle.className = "tab-title";
  tabTitle.textContent = tab.title || "Untitled tab";
  tabTitle.title = tab.title || tab.url || "Untitled tab";

  const meta = document.createElement("div");
  meta.className = "tab-meta";

  const windowLabel = document.createElement("span");
  windowLabel.textContent = `${state.windowLabels.get(tab.windowId) || "Window"} · Tab ${tab.index + 1}`;
  windowLabel.title = `Window ID: ${tab.windowId}`;
  meta.appendChild(windowLabel);

  if (tab.pinned) {
    const pinned = document.createElement("span");
    pinned.className = "badge badge-pinned";
    pinned.textContent = "📌 Pinned";
    meta.appendChild(pinned);
  }

  if (tab.active) {
    const active = document.createElement("span");
    active.className = "badge badge-active";
    active.textContent = "● Active";
    meta.appendChild(active);
  }

  if (tab.id === group.keepTabId) {
    const keep = document.createElement("span");
    keep.className = "badge";
    keep.textContent = "Default keep";
    keep.title = "This tab is left unchecked by the default duplicate selection.";
    meta.appendChild(keep);
  }

  info.append(tabTitle, meta);

  const goButton = document.createElement("button");
  goButton.type = "button";
  goButton.className = "button button-secondary button-small";
  goButton.textContent = "Go to Tab";
  goButton.title = "Activate this tab and focus its Chrome window.";
  goButton.addEventListener("click", async () => {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      setStatus("Focused the selected tab.");
    } catch (error) {
      setStatus("That tab or window is no longer available.", true);
    }
  });

  row.append(checkbox, info, goButton);
  return row;
}

function syncSelectionUi() {
  const checkboxes = elements.groupsContainer.querySelectorAll(".tab-checkbox");

  for (const checkbox of checkboxes) {
    const tabId = Number(checkbox.dataset.tabId);
    const selected = state.selectedTabIds.has(tabId);
    checkbox.checked = selected;

    const row = checkbox.closest(".tab-row");
    if (row) {
      row.classList.toggle("selected", selected);
    }
  }

  updateCounters();
}

function isEntireGroupSelected(group) {
  return group.tabs.every((tab) => state.selectedTabIds.has(tab.id));
}

function showDialog({
  title,
  message,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm"
}) {
  elements.dialogTitle.textContent = title;
  elements.dialogMessage.textContent = message;
  elements.dialogCancelButton.textContent = cancelLabel;
  elements.dialogConfirmButton.textContent = confirmLabel;

  return new Promise((resolve) => {
    const handleClose = () => {
      elements.confirmDialog.removeEventListener("close", handleClose);
      resolve(elements.confirmDialog.returnValue === "confirm");
    };

    elements.confirmDialog.addEventListener("close", handleClose);
    elements.confirmDialog.returnValue = "";
    elements.confirmDialog.showModal();
  });
}

async function getLiveSelectedTabs(selectedIds) {
  const expectedUrlByTabId = new Map();

  for (const group of state.groups) {
    for (const tab of group.tabs) {
      if (selectedIds.has(tab.id)) {
        expectedUrlByTabId.set(tab.id, group.normalizedUrl);
      }
    }
  }

  const validTabs = [];
  let unavailableCount = 0;
  let changedCount = 0;

  for (const tabId of selectedIds) {
    try {
      const liveTab = await chrome.tabs.get(tabId);
      const expectedUrl = expectedUrlByTabId.get(tabId);

      if (
        !expectedUrl ||
        isIgnoredUrl(liveTab.url) ||
        normalizeUrl(liveTab.url) !== expectedUrl
      ) {
        changedCount += 1;
        continue;
      }

      validTabs.push(liveTab);
    } catch {
      unavailableCount += 1;
    }
  }

  return { validTabs, unavailableCount, changedCount };
}

async function findLiveWholeGroupClosures(validTabs) {
  if (validTabs.length === 0) {
    return [];
  }

  const selectedIds = new Set(validTabs.map((tab) => tab.id));
  const allLiveTabs = await chrome.tabs.query({});
  const liveByUrl = new Map();

  for (const tab of allLiveTabs) {
    if (isIgnoredUrl(tab.url)) {
      continue;
    }

    const key = normalizeUrl(tab.url);
    if (!liveByUrl.has(key)) {
      liveByUrl.set(key, []);
    }
    liveByUrl.get(key).push(tab);
  }

  const affectedKeys = new Set(validTabs.map((tab) => normalizeUrl(tab.url)));
  const wholeGroupClosures = [];

  for (const key of affectedKeys) {
    const matchingTabs = liveByUrl.get(key) || [];
    if (
      matchingTabs.length > 0 &&
      matchingTabs.every((tab) => selectedIds.has(tab.id))
    ) {
      wholeGroupClosures.push({
        normalizedUrl: key,
        count: matchingTabs.length
      });
    }
  }

  return wholeGroupClosures;
}

async function closeSelectedTabs() {
  if (state.scanning || state.selectedTabIds.size === 0) {
    return;
  }

  const selectedIds = new Set(state.selectedTabIds);
  const selectedCount = selectedIds.size;

  const knownWholeGroups = state.groups.filter((group) =>
    isEntireGroupSelected(group)
  );

  if (knownWholeGroups.length > 0) {
    const continueWithWholeGroups = await showDialog({
      title: "Entire duplicate group selected",
      message:
        `You selected every tab in ${knownWholeGroups.length} duplicate group${knownWholeGroups.length === 1 ? "" : "s"}.\n` +
        "At least one tab should normally remain open.",
      cancelLabel: "Review Selection",
      confirmLabel: "Continue Anyway"
    });

    if (!continueWithWholeGroups) {
      return;
    }
  }

  const confirmed = await showDialog({
    title: "Close selected tabs?",
    message: `You selected ${selectedCount} tab${selectedCount === 1 ? "" : "s"} to close. Continue?`,
    cancelLabel: "Cancel",
    confirmLabel: "Close Tabs"
  });

  if (!confirmed) {
    return;
  }

  setScanningUi(true);
  setStatus("Checking selected tabs before closing...");

  try {
    const { validTabs, unavailableCount, changedCount } =
      await getLiveSelectedTabs(selectedIds);

    const liveWholeGroups = await findLiveWholeGroupClosures(validTabs);
    const knownWholeKeys = new Set(
      knownWholeGroups.map((group) => group.normalizedUrl)
    );
    const newlyWholeGroups = liveWholeGroups.filter(
      (group) => !knownWholeKeys.has(group.normalizedUrl)
    );

    if (newlyWholeGroups.length > 0) {
      setScanningUi(false);

      const proceed = await showDialog({
        title: "Tab state changed",
        message:
          "Since the scan, other tabs changed or closed.\n" +
          `Closing the still-selected tabs would now remove every remaining tab in ${newlyWholeGroups.length} group${newlyWholeGroups.length === 1 ? "" : "s"}.`,
        cancelLabel: "Cancel",
        confirmLabel: "Close Anyway"
      });

      if (!proceed) {
        setStatus("Close cancelled. Scan again to review the latest tabs.");
        return;
      }

      setScanningUi(true);
    }

    let closedCount = 0;
    let closeFailureCount = 0;

    for (const tab of validTabs) {
      try {
        await chrome.tabs.remove(tab.id);
        closedCount += 1;
      } catch {
        closeFailureCount += 1;
      }
    }

    const skippedCount = unavailableCount + changedCount + closeFailureCount;
    let message = `${closedCount} tab${closedCount === 1 ? "" : "s"} closed.`;

    if (skippedCount > 0) {
      const reasons = [];
      if (unavailableCount > 0) {
        reasons.push(`${unavailableCount} already unavailable`);
      }
      if (changedCount > 0) {
        reasons.push(`${changedCount} changed URL`);
      }
      if (closeFailureCount > 0) {
        reasons.push(`${closeFailureCount} could not be closed`);
      }
      message += ` Skipped: ${reasons.join(", ")}.`;
    }

    // Requirement: after closing, rescan but do not automatically select anything else.
    await scanTabs({
      preselectDuplicates: false,
      statusMessage: message
    });
  } catch (error) {
    setStatus(`Could not finish closing tabs: ${error.message || error}`, true);
  } finally {
    setScanningUi(false);
  }
}

elements.refreshButton.addEventListener("click", () => {
  scanTabs({ preselectDuplicates: true });
});

elements.selectAllButton.addEventListener("click", () => {
  state.selectedTabIds.clear();
  for (const group of state.groups) {
    setDefaultSelectionForGroup(group);
  }
  syncSelectionUi();
});

elements.clearSelectionButton.addEventListener("click", () => {
  state.selectedTabIds.clear();
  syncSelectionUi();
});

elements.closeSelectedButton.addEventListener("click", closeSelectedTabs);

// Initial scan may pre-select extra duplicates, but it never closes anything.
scanTabs({ preselectDuplicates: true });
