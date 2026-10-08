const MG_EXCLUDED_SCHEMES = [
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "devtools:",
  "view-source:"
];

const MG_FRIENDLY_NAMES = new Map([
  ["youtube.com", "YouTube"],
  ["google.com", "Google"],
  ["gmail.com", "Gmail"],
  ["chatgpt.com", "ChatGPT"],
  ["openai.com", "OpenAI"],
  ["facebook.com", "Facebook"],
  ["messenger.com", "Messenger"],
  ["instagram.com", "Instagram"],
  ["x.com", "X"],
  ["twitter.com", "Twitter"],
  ["shopee.co.th", "Shopee"],
  ["lazada.co.th", "Lazada"],
  ["github.com", "GitHub"],
  ["reddit.com", "Reddit"],
  ["tiktok.com", "TikTok"]
]);

const MG_GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

const mgEls = {
  modeDuplicates: document.getElementById("modeDuplicates"),
  modeGroups: document.getElementById("modeGroups"),
  duplicatesPanel: document.getElementById("duplicatesPanel"),
  groupsPanel: document.getElementById("groupsPanel"),
  tabCount: document.getElementById("mgTabCount"),
  siteCount: document.getElementById("mgSiteCount"),
  groupableCount: document.getElementById("mgGroupableCount"),
  autoGroupEnabled: document.getElementById("mgAutoGroupEnabled"),
  autoGroupState: document.getElementById("mgAutoGroupState"),
  includeSingle: document.getElementById("mgIncludeSingle"),
  includePinned: document.getElementById("mgIncludePinned"),
  collapseGroups: document.getElementById("mgCollapseGroups"),
  preview: document.getElementById("mgPreview"),
  status: document.getElementById("mgStatus"),
  groupBtn: document.getElementById("mgGroupBtn"),
  refreshBtn: document.getElementById("mgRefreshBtn")
};

let mgCurrentGroups = [];

function mgRootDomain(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;

  const commonSecondLevel = new Set([
    "co.th", "or.th", "go.th", "ac.th", "co.uk", "org.uk", "com.au", "com.br", "co.jp"
  ]);
  const lastTwo = parts.slice(-2).join(".");
  if (commonSecondLevel.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

function mgDisplayName(domain) {
  if (MG_FRIENDLY_NAMES.has(domain)) return MG_FRIENDLY_NAMES.get(domain);
  const first = domain.split(".")[0] || domain;
  return first
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || domain;
}

function mgColorForDomain(domain) {
  let hash = 0;
  for (const char of domain) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return MG_GROUP_COLORS[Math.abs(hash) % MG_GROUP_COLORS.length];
}

function mgDomainFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (MG_EXCLUDED_SCHEMES.includes(url.protocol) || !url.hostname) return null;
    return mgRootDomain(url.hostname);
  } catch {
    return null;
  }
}

function mgIsAllowedTab(tab) {
  if (!tab.id || !tab.url) return false;
  if (!mgEls.includePinned.checked && tab.pinned) return false;
  return Boolean(mgDomainFromUrl(tab.url));
}

function mgBuildGroups(tabs) {
  const byDomain = new Map();
  for (const tab of tabs) {
    if (!mgIsAllowedTab(tab)) continue;
    const domain = mgDomainFromUrl(tab.url);
    if (!byDomain.has(domain)) {
      byDomain.set(domain, { domain, title: mgDisplayName(domain), tabs: [] });
    }
    byDomain.get(domain).tabs.push(tab);
  }

  return [...byDomain.values()]
    .filter((group) => mgEls.includeSingle.checked || group.tabs.length >= 2)
    .sort((a, b) => b.tabs.length - a.tabs.length || a.title.localeCompare(b.title));
}

function mgSetStatus(message, type = "") {
  mgEls.status.textContent = message;
  mgEls.status.className = type ? `status ${type}` : "status";
}

function mgRenderAutoGroupState() {
  const enabled = mgEls.autoGroupEnabled.checked;
  mgEls.autoGroupState.textContent = enabled ? "On" : "Off";
  mgEls.autoGroupState.classList.toggle("on", enabled);
}

function mgRenderPreview(groups, totalTabs, allSiteCount) {
  mgEls.tabCount.textContent = String(totalTabs);
  mgEls.siteCount.textContent = String(allSiteCount);
  mgEls.groupableCount.textContent = String(groups.length);
  mgEls.preview.replaceChildren();

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty mg-empty";
    empty.textContent = "No websites currently meet the grouping rules.";
    mgEls.preview.append(empty);
    mgEls.groupBtn.disabled = true;
    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "mg-site-row";

    const meta = document.createElement("div");
    meta.className = "mg-site-meta";
    const name = document.createElement("strong");
    name.textContent = group.title;
    name.title = group.domain;
    const domain = document.createElement("span");
    domain.textContent = group.domain;
    meta.append(name, domain);

    const count = document.createElement("span");
    count.className = "mg-site-count";
    count.textContent = `${group.tabs.length} tabs`;

    row.append(meta, count);
    mgEls.preview.append(row);
  }

  mgEls.groupBtn.disabled = false;
}

async function mgScanTabs() {
  mgSetStatus("Scanning tabs...");
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const eligible = tabs.filter(mgIsAllowedTab);
    const siteDomains = new Set(eligible.map((tab) => mgDomainFromUrl(tab.url)));
    mgCurrentGroups = mgBuildGroups(tabs);
    mgRenderPreview(mgCurrentGroups, tabs.length, siteDomains.size);
    mgSetStatus("");
  } catch (error) {
    mgSetStatus(`Failed to scan tabs: ${error.message || error}`, "error");
  }
}

async function mgSaveSettings() {
  await chrome.storage.local.set({
    autoGroupEnabled: mgEls.autoGroupEnabled.checked,
    includeSingle: mgEls.includeSingle.checked,
    includePinned: mgEls.includePinned.checked,
    collapseGroups: mgEls.collapseGroups.checked
  });
}

async function mgLoadSettings() {
  const saved = await chrome.storage.local.get({
    autoGroupEnabled: false,
    includeSingle: false,
    includePinned: false,
    collapseGroups: true
  });
  mgEls.autoGroupEnabled.checked = saved.autoGroupEnabled;
  mgEls.includeSingle.checked = saved.includeSingle;
  mgEls.includePinned.checked = saved.includePinned;
  mgEls.collapseGroups.checked = saved.collapseGroups;
  mgRenderAutoGroupState();
}

async function mgGroupTabs() {
  if (!mgCurrentGroups.length) return;
  mgEls.groupBtn.disabled = true;
  mgSetStatus("Creating groups...");

  try {
    let created = 0;
    for (const group of mgCurrentGroups) {
      const tabIds = group.tabs.map((tab) => tab.id).filter(Number.isInteger);
      if (!tabIds.length) continue;
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: group.title,
        color: mgColorForDomain(group.domain),
        collapsed: mgEls.collapseGroups.checked
      });
      created += 1;
    }
    await mgScanTabs();
    mgSetStatus(`Created/updated ${created} groups. No tabs were closed.`, "success");
  } catch (error) {
    mgSetStatus(`Grouping failed: ${error.message || error}`, "error");
  } finally {
    mgEls.groupBtn.disabled = !mgCurrentGroups.length;
  }
}

function mgShowPanel(name) {
  const showGroups = name === "groups";
  mgEls.duplicatesPanel.hidden = showGroups;
  mgEls.groupsPanel.hidden = !showGroups;
  mgEls.modeDuplicates.classList.toggle("active", !showGroups);
  mgEls.modeGroups.classList.toggle("active", showGroups);
  if (showGroups) mgScanTabs();
}

mgEls.modeDuplicates.addEventListener("click", () => mgShowPanel("duplicates"));
mgEls.modeGroups.addEventListener("click", () => mgShowPanel("groups"));
mgEls.refreshBtn.addEventListener("click", mgScanTabs);
mgEls.groupBtn.addEventListener("click", mgGroupTabs);
mgEls.autoGroupEnabled.addEventListener("change", async () => {
  mgRenderAutoGroupState();
  await mgSaveSettings();
  mgSetStatus(mgEls.autoGroupEnabled.checked ? "Auto Group enabled." : "Auto Group disabled.", "success");
});
mgEls.includeSingle.addEventListener("change", async () => { await mgSaveSettings(); await mgScanTabs(); });
mgEls.includePinned.addEventListener("change", async () => { await mgSaveSettings(); await mgScanTabs(); });
mgEls.collapseGroups.addEventListener("change", mgSaveSettings);

document.addEventListener("DOMContentLoaded", async () => {
  await mgLoadSettings();
  mgShowPanel("duplicates");
});
