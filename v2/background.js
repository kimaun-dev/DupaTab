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

// ใช้ duplicate-detection logic ชุดเดียวกับ popup เพื่อให้ผลตรงกัน
importScripts("utils/utils.js");

/**
 * อัปเดต badge บนไอคอน
 * @param {number} count จำนวนแท็บซ้ำ (0 = ซ่อน badge)
 */
async function updateBadge(count) {
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } else {
    // ล้างข้อความ badge อย่างเดียว ไม่ส่งสี "transparent" เพราะ Chrome บางเวอร์ชัน parse ไม่ได้
    await chrome.action.setBadgeText({ text: "" });
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

    case "GET_SELECTED_GROUPS": {
      chrome.storage.session.get("selectedGroups").then((data) => {
        sendResponse({
          exists: Object.prototype.hasOwnProperty.call(data, "selectedGroups"),
          groups: data.selectedGroups || {},
        });
      });
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

    case "CLOSE_TABS": {
      const ids = Array.isArray(message.ids)
        ? [...new Set(message.ids.filter((id) => Number.isInteger(id)))]
        : [];
      if (!ids.length) {
        sendResponse({ closed: 0, skipped: 0, failed: 0, requested: 0 });
        return false;
      }

      Promise.all(
        ids.map(async (id) => {
          try {
            await chrome.tabs.get(id);
          } catch {
            return { id, status: "missing" };
          }

          const removeError = await new Promise((resolve) => {
            chrome.tabs.remove(id, () => {
              // อ่าน lastError ภายใน callback เพื่อไม่ให้ Chrome พ่น unchecked error
              resolve(chrome.runtime.lastError?.message || "");
            });
          });

          // ถ้า Chrome ไม่รายงาน error ให้ถือว่าคำสั่งปิดสำเร็จ
          // ไม่ต้องรีบตรวจ chrome.tabs.get() ทันที เพราะ tab removal อาจ finalize ช้ากว่า callback
          if (!removeError) {
            return { id, status: "closed" };
          }

          // ถ้ามี error ให้ตรวจสถานะจริงซ้ำหลายรอบ เผื่อ Chrome ปิดแท็บสำเร็จแต่ callback รายงานช้า/คลาดเคลื่อน
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            try {
              await chrome.tabs.get(id);
            } catch {
              return { id, status: "closed" };
            }
          }

          return {
            id,
            status: "failed",
            error: removeError || "Tab is still open after close request",
          };
        })
      )
        .then(async (results) => {
          const closed = results.filter((r) => r.status === "closed").length;
          const skipped = results.filter((r) => r.status === "missing").length;
          const failures = results.filter((r) => r.status === "failed");
          await refreshBadge();
          sendResponse({
            closed,
            skipped,
            failed: failures.length,
            requested: ids.length,
            errors: failures.map((r) => ({ id: r.id, error: r.error })),
          });
        })
        .catch((err) => {
          console.warn("ปิดแท็บไม่สำเร็จ:", err);
          sendResponse({ closed: 0, skipped: 0, failed: ids.length, requested: ids.length });
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
