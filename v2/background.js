/**
 * DupaTab - background service worker (MV3)
 *
 * หน้าที่หลัก (ทำง่ายๆ):
 *  1. เมื่อ popup เปิด/ปิด → เก็บ/ล้าง "แท็บที่ถูกเลือก" ใน chrome.storage.session
 *  2. อัปเดต badge บนไอคอนเป็นจำนวนแท็บซ้ำที่พบ
 *  3. จัดการข้อความ (messages) ระหว่าง popup <-> background
 *
 * แยกออกมาจาก popup.js เพื่อให้ popup ไม่ต้องทำงานทุกอย่างเอง
 */

const BADGE_COLOR = "#4f46e5";
const BADGE_COLOR_EMPTY = "transparent";

/**
 * อัปเดต badge บนไอคอน
 * @param {number} count จำนวนแท็บซ้ำ (0 = ซ่อน badge)
 */
async function updateBadge(count) {
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_EMPTY });
  }
}

/**
 * อ่านแท็บที่เลือกทั้งหมดจาก storage.session
 * @returns {Promise<object>} map: groupId -> [tabId, ...]
 */
async function getSelectedGroups() {
  const data = await chrome.storage.session.get("selectedGroups");
  return data.selectedGroups || {};
}

/**
 * นับจำนวนแท็บที่เลือกทั้งหมด
 */
async function countSelectedTabs() {
  const groups = await getSelectedGroups();
  let total = 0;
  for (const ids of Object.values(groups)) {
    total += ids.length;
  }
  return total;
}

/**
 * คำนวณแท็บซ้ำจากแท็บทั้งหมด
 * (คัดลอก logic เดิมจาก popup.js มาใช้ — ทำเหมือนเดิมเป๊ะ)
 * @param {chrome.tabs.Tab[]} allTabs
 * @returns {object[]} กลุ่มแท็บซ้ำ
 */
function findDuplicates(allTabs) {
  const urlMap = {};
  for (const tab of allTabs) {
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      continue;
    }
    // ใช้ origin + pathname เป็น key (ตัด query/hash ออก)
    try {
      const parsed = new URL(tab.url);
      const key = parsed.origin + parsed.pathname;
      if (!urlMap[key]) urlMap[key] = [];
      urlMap[key].push(tab);
    } catch {
      // URL ที่ parse ไม่ได้ (เช่น about:blank) → ข้าม
    }
  }
  return Object.values(urlMap)
    .filter((group) => group.length > 1)
    .map((group) => ({
      key: group[0].url,
      tabs: group,
    }));
}

/**
 * อัปเดต badge จากแท็บทั้งหมด (เรียกเมื่อแท็บเปลี่ยน)
 */
async function refreshBadge() {
  const tabs = await chrome.tabs.query({});
  const duplicates = findDuplicates(tabs);
  // จำนวนแท็บที่ซ้ำ = จำนวนแท็บทั้งหมดในทุกลุ่่ม - จำนวน URL ที่ซ้ำ
  let dupCount = 0;
  for (const g of duplicates) {
    dupCount += g.tabs.length - 1;
  }
  await updateBadge(dupCount);
}

// ---------- Message handlers ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "GET_SELECTED_COUNT": {
      countSelectedTabs().then(sendResponse);
      return true; // async
    }

    case "SET_SELECTED_GROUPS": {
      chrome.storage.session
        .set({ selectedGroups: message.groups })
        .then(() => {
          const ids = Object.values(message.groups).flat();
          sendResponse({ ok: true, count: ids.length });
        });
      return true; // async
    }

    case "REFRESH_BADGE": {
      refreshBadge().then(() => sendResponse({ ok: true }));
      return true; // async
    }

    default:
      sendResponse({ ok: false, error: "Unknown message type" });
      return false;
  }
});

// ---------- Event listeners ----------
// อัปเดต badge เมื่อแท็บถูกเปิด/ปิด/เปลี่ยน URL
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status) refreshBadge();
});
chrome.tabs.onRemoved.addListener(() => refreshBadge());
chrome.tabs.onCreated.addListener(() => refreshBadge());

// เมื่อ extension ถูกติดตั้ง/อัปเดต → refresh ครั้งแรก
chrome.runtime.onInstalled.addListener(() => refreshBadge());
