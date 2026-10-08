/**
 * DupaTab - utility functions
 *
 * แยก function ย่อยออกมาจาก popup.js เพื่อให้โค้ดอ่านง่ายขึ้น
 * ใช้ร่วมกันทั้ง popup และ background
 */

/**
 * คำนวณ key ของ URL (origin + pathname) ใช้จับคู่แท็บซ้ำ
 * @param {string} url
 * @returns {string|null} key หรือ null ถ้า parse ไม่ได้
 */
function urlKey(url) {
  if (!url) return null;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return null;
  }
}

/**
 * หาแท็บซ้ำจากแท็บทั้งหมด
 * @param {chrome.tabs.Tab[]} allTabs
 * @returns {object[]} [{ key, url, title, tabs: [...] }]
 */
function findDuplicates(allTabs) {
  const urlMap = {};
  for (const tab of allTabs) {
    const key = urlKey(tab.url);
    if (!key) continue;
    if (!urlMap[key]) urlMap[key] = [];
    urlMap[key].push(tab);
  }
  return Object.values(urlMap)
    .filter((group) => group.length > 1)
    .map((group) => ({
      key: group[0].url,
      url: group[0].url,
      title: group[0].title || group[0].url,
      tabs: group,
    }));
}

/**
 * คำนวณจำนวนแท็บที่ซ้ำ (ลบแท็บแรกในแต่ละกลุ่มออก)
 * @param {object[]} duplicates ผลจาก findDuplicates
 * @returns {number}
 */
function countDuplicates(duplicates) {
  let n = 0;
  for (const g of duplicates) n += g.tabs.length - 1;
  return n;
}

/**
 * แปลง millisecond เป็นข้อความอ่านง่าย (เช่น "2m 30s")
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return "just now";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 1) return `${sec}s`;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

/**
 * escape HTML เพื่อความปลอดภัย (กัน XSS จากชื่อแท็บ)
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * เปรียบเทียบเวลา — active tab มาก่อน, จากนั้น tab ที่เปิดก่อน (lastAccessed ต่ำกว่า) มาก่อน
 * @param {chrome.tabs.Tab} a
 * @param {chrome.tabs.Tab} b
 * @returns {number} -1 | 0 | 1
 */
function compareByTime(a, b) {
  // active tab มาก่อนเสมอ (ควรเก็บแท็บที่กำลังใช้)
  if (a.active !== b.active) return a.active ? -1 : 1;
  // ทั้งสองไม่ได้ active → tab ที่เปิดก่อน (lastAccessed ต่ำกว่า) มาก่อน
  if (a.lastAccessed !== b.lastAccessed) return a.lastAccessed < b.lastAccessed ? -1 : 1;
  return 0;
}

// ---------- Export (ทำงานทั้งใน module และ non-module) ----------
if (typeof module !== "undefined" && module.exports) {
  module.exports = { urlKey, findDuplicates, countDuplicates, formatDuration, escapeHtml, compareByTime };
}
