/**
 * DupaTab - unit tests for utils.js
 * รันด้วย: npm test
 * ใช้ Node.js built-in assert (ไม่ต้อง install อะไรเพิ่ม)
 */
const assert = require("assert");
const path = require("path");
const utils = require(path.join(__dirname, "..", "v2", "utils", "utils.js"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log("Running DupaTab utils tests...\n");

// ---------- urlKey ----------
test("urlKey: same URL different query → same key", () => {
  assert.strictEqual(
    utils.urlKey("https://example.com/page?a=1"),
    utils.urlKey("https://example.com/page?b=2")
  );
});

test("urlKey: different path → different key", () => {
  assert.notStrictEqual(
    utils.urlKey("https://example.com/a"),
    utils.urlKey("https://example.com/b")
  );
});

test("urlKey: chrome:// URL → null", () => {
  assert.strictEqual(utils.urlKey("chrome://settings"), null);
});

test("urlKey: chrome-extension:// URL → null", () => {
  assert.strictEqual(utils.urlKey("chrome-extension://abc/popup.html"), null);
});

test("urlKey: invalid URL → null", () => {
  assert.strictEqual(utils.urlKey("not-a-url"), null);
});

test("urlKey: empty → null", () => {
  assert.strictEqual(utils.urlKey(""), null);
  assert.strictEqual(utils.urlKey(null), null);
});

// ---------- findDuplicates ----------
const tabs = [
  { id: 1, url: "https://a.com/x", title: "A1", lastAccessed: 100, active: true },
  { id: 2, url: "https://a.com/x?ref=1", title: "A2", lastAccessed: 200, active: false },
  { id: 3, url: "https://a.com/y", title: "B1", lastAccessed: 300, active: false },
  { id: 4, url: "https://b.com/z", title: "C1", lastAccessed: 400, active: false },
  { id: 5, url: "https://b.com/z#top", title: "C2", lastAccessed: 500, active: false },
  { id: 6, url: "chrome://settings", title: "Settings", lastAccessed: 600, active: false },
];

test("findDuplicates: returns only groups with 2+ tabs", () => {
  const dups = utils.findDuplicates(tabs);
  assert.strictEqual(dups.length, 2);
});

test("findDuplicates: group 1 has 2 tabs (a.com/x)", () => {
  const dups = utils.findDuplicates(tabs);
  const g = dups.find((d) => d.url === "https://a.com/x");
  assert.ok(g, "group for a.com/x should exist");
  assert.strictEqual(g.tabs.length, 2);
});

test("findDuplicates: group 2 has 2 tabs (b.com/z)", () => {
  const dups = utils.findDuplicates(tabs);
  const g = dups.find((d) => d.url === "https://b.com/z");
  assert.ok(g, "group for b.com/z should exist");
  assert.strictEqual(g.tabs.length, 2);
});

test("findDuplicates: excludes chrome:// tabs", () => {
  const dups = utils.findDuplicates(tabs);
  const allUrls = dups.flatMap((d) => d.tabs.map((t) => t.url));
  assert.ok(!allUrls.some((u) => u.startsWith("chrome://")));
});

test("findDuplicates: no duplicates → empty array", () => {
  const unique = [
    { id: 1, url: "https://a.com", title: "A" },
    { id: 2, url: "https://b.com", title: "B" },
  ];
  assert.strictEqual(utils.findDuplicates(unique).length, 0);
});

// ---------- countDuplicates ----------
test("countDuplicates: counts extra tabs per group", () => {
  const dups = utils.findDuplicates(tabs);
  assert.strictEqual(utils.countDuplicates(dups), 2);
});

// ---------- formatDuration ----------
test("formatDuration: seconds", () => {
  assert.strictEqual(utils.formatDuration(5000), "5s");
});

test("formatDuration: minutes + seconds", () => {
  assert.strictEqual(utils.formatDuration(150000), "2m 30s");
});

test("formatDuration: hours + minutes", () => {
  assert.strictEqual(utils.formatDuration(7200000), "2h");
});

test("formatDuration: just now", () => {
  assert.strictEqual(utils.formatDuration(500), "just now");
});

// ---------- escapeHtml ----------
test("escapeHtml: escapes basic chars", () => {
  assert.strictEqual(utils.escapeHtml("<b>&\"'</b>"), "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");
});

test("escapeHtml: null → empty string", () => {
  assert.strictEqual(utils.escapeHtml(null), "");
});

// ---------- compareByTime ----------
test("compareByTime: active tab comes first", () => {
  const a = { id: 1, active: true, lastAccessed: 100 };
  const b = { id: 2, active: false, lastAccessed: 200 };
  assert.strictEqual(utils.compareByTime(a, b), -1);
});

test("compareByTime: older tab first when both inactive", () => {
  const a = { id: 1, active: false, lastAccessed: 100 };
  const b = { id: 2, active: false, lastAccessed: 200 };
  // a (lastAccessed=100) เปิดก่อน → มาก่อน b
  assert.strictEqual(utils.compareByTime(a, b), -1);
});

// ---------- Summary ----------

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
