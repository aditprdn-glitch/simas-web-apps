# SIMAS 263 — Remediation Plan

Companion to `CODE_REVIEW.md`. For each finding: what to change, and why that specific fix. Ordered by the same priority as the review.

---

## 1. Lock down the Apps Script API (fixes §1.2)

This is the one that actually matters — everything else is secondary while the data API accepts unauthenticated writes.

There are two honest options here, because a purely static site can never fully hide a secret from the browser — anything shipped in `app.js`/`config.js` can be extracted by anyone who opens DevTools. Pick based on what you have available:

### Option A (best, if the school uses Google Workspace for Education)
Restrict the deployment itself instead of writing new auth code:

**Deploy → Manage deployments → Edit → "Who has access" → "Anyone within [your school domain]"**

This makes *Google* require a login with a school account before your `doGet`/`doPost` ever runs — enforced by Google's servers, not by anything in `app.js` that could be bypassed. No code changes needed. This is the only option that provides real protection rather than "harder to find."

Downside: only works if staff actually sign in with school Google accounts, and it means the app is unreachable from outside a logged-in Google session (which is normally what you want for an internal asset system).

### Option B (if you're stuck with "Anyone with the link")
Add a shared-secret check inside the script itself, and use it to at least stop blind/opportunistic abuse (a scanner or a curious person who finds the URL without ever opening the app):

```javascript
function doPost(e) {
  const TOKEN = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (e.parameter.token !== TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ status: "unauthorized" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  // ...rest of existing doPost logic
}
```

Set `API_TOKEN` via **Project Settings → Script Properties** (not hardcoded in the script body, so it's not visible if you ever share the script's source). Then have `app.js` append `formData.append('token', CONFIG.API_TOKEN)` on every write call.

**Be clear-eyed about what this does and doesn't fix:** the token still ends up in `config.js`, still visible to anyone who inspects the page. It does not stop a targeted attacker. What it does stop is casual discovery — someone stumbling on the URL, a search engine indexing it, or a scanner probing random Apps Script endpoints. Treat it as a deterrent, not a lock.

### Either way: remove `deleteAll` from the network-reachable surface
Regardless of which option you pick, the single most destructive action (`action=deleteAll`, wiping the entire sheet) doesn't need to be an API call at all. Delete that branch from `doPost` entirely and do full-database wipes manually from the Sheet UI (Edit → Select all rows → Delete). That removes the worst-case blast radius from the attack surface completely, at the cost of one extra manual step for an action you'll rarely use.

---

## 2. Stop shipping/committing credentials (fixes §1.1)

1. **Rotate now:** change `ADMIN_PIN` to something non-guessable, and generate a new Apps Script deployment URL after §1's fix lands (the current one is already exposed regardless of what you change client-side).
2. **Stop committing `config.js`:**
   ```bash
   echo "config.js" >> .gitignore
   git rm --cached config.js
   ```
   Add a `config.example.js` with placeholder values so the repo still documents what's needed to run the app locally.
3. **If `github.com/aditprdn-glitch/simas-web-apps` is or ever was public:** the PIN and URL are permanently in git history even after step 2. Check the repo's visibility; if it's public (or was at any point), treat every credential in that history as burned — rotating them is the only real fix, rewriting history is optional cleanup on top.

---

## 3. Escape data before it reaches the DOM (fixes §1.3, §1.4)

Add one helper, use it everywhere asset data is interpolated into HTML:

```javascript
function escapeHtml(nilai) {
    return String(nilai ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
```

Then wrap every field going into a template string, e.g. `js/app.js:560-587`:

```javascript
<td><span class="badge-category">${escapeHtml(barang.Jenis_Barang)}</span></td>
...
<button onclick="hapusAset('${escapeHtml(barang.ID_Aset)}')">Hapus</button>
```

Escaping with the function above is enough for both the text-content case (§1.3) and the quoted-attribute case (§1.4) since it escapes `'` and `"` too.

Apply the same wrap to the pie chart detail list (`js/app.js:364-388`) and the year-checkbox labels (`js/app.js:483-488`), since `Tahun` values also come from imported/synced data.

**Longer-term alternative:** replace the inline `onclick="fn('${id}')"` pattern with `addEventListener` + `dataset.id`, which removes the attribute-injection class of bug (§1.4) structurally instead of relying on remembering to escape. Lower priority than the escaping fix — do it opportunistically when you're next touching this code, not as an urgent patch.

---

## 4. Pin and verify third-party scripts (fixes §1.5)

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
        integrity="sha384-<hash-from-jsdelivr>" crossorigin="anonymous"></script>
```

jsDelivr shows the SRI hash on each package's page (e.g. `https://www.jsdelivr.com/package/npm/chart.js`) — copy the `integrity` value for the exact version you pin. Do this for all four CDN scripts in `index.html:18-21`. Pinning `chart.js` to a specific version also prevents a future breaking release from silently changing your chart's behavior.

---

## 5. Validate bulk-import data against known enums (fixes §1.6, §2.4)

In `bacaFileExcelMassal` (`js/app.js:190-246`), check imported values against the same fixed lists the UI already uses, instead of silently defaulting or accepting anything:

```javascript
const KONDISI_VALID = ["Baik", "Rusak Ringan", "Rusak Berat"];
const TRIWULAN_VALID = ["Triwulan 1", "Triwulan 2", "Triwulan 3", "Triwulan 4"];
const LANTAI_VALID = ["Lantai 1", "Lantai 2", "Lantai 3", "Lantai 4", "Area Luar / Lapangan"];

// per row, after building dataPaket:
const barisBermasalah = [];
if (!KONDISI_VALID.includes(dataPaket.Kondisi)) barisBermasalah.push(`baris ${i + 1}: Kondisi tidak valid`);
// ...same for Triwulan / Lantai

if (barisBermasalah.length > 0) {
    // skip the row, or import it but collect a warning list to show the user afterwards
}
```

Report which rows were skipped/flagged in the final alert instead of the current unconditional `"Berhasil mengimpor ${entriSukses} rekor..."`, so bad data doesn't quietly enter the system disguised as valid.

---

## 6. Fix the misleading save-success message (fixes §2.1)

`simpanData` (`js/app.js:111-173`) currently alerts success before the cloud fetch resolves. Make it `await` the result, matching the pattern already used correctly in `hapusAset`:

```javascript
async function simpanData(e) {
    e.preventDefault();
    // ...build dataPaket, update local databaseAset as today...

    if (CONFIG.WEB_APP_URL) {
        const formData = new URLSearchParams();
        // ...append fields...

        try {
            const response = await fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData });
            if (!response.ok) throw new Error("Gagal menyimpan data di server");
            resetFormAset();
            perbaruiTampilanDanStatistik();
            alert("Data aset berhasil disimpan dan disinkronisasi ke cloud!");
        } catch (err) {
            console.error('Gagal menyimpan data di cloud:', err);
            alert('Data tersimpan secara lokal, tetapi GAGAL disinkronisasi ke cloud. Coba simpan ulang.');
        }
        return;
    }

    resetFormAset();
    perbaruiTampilanDanStatistik();
    alert("Data aset berhasil disimpan (mode lokal, tanpa cloud).");
}
```

---

## 7. Small clean-code fixes (fixes §2.2, §2.3, §2.6)

These are mechanical, low-risk refactors — safe to batch together:

**§2.2 — dedupe the "unique sorted years" logic:**
```javascript
function daftarTahunUnik() {
    return Array.from(new Set(databaseAset.map(x => String(x.Tahun || "").trim()).filter(Boolean)))
        .sort((a, b) => b.localeCompare(a));
}
```
Call this from both `perbaruiOpsiTahunChart()` and `perbaruiOpsiTahunFilter()` instead of duplicating the expression.

**§2.3 — replace the field-mapping ternary chain with a lookup table:**
```javascript
const FIELD_MAP = {
    ID_Aset: 'idAset', Jenis_Barang: 'jenisBarang', Merk: 'merkBarang',
    Type_Barang: 'typeBarang', Sumber_Perolehan_Dana: 'sumberDana',
    Triwulan: 'pembelianTriwulan', Tahun: 'pembelianTahun',
    Lantai: 'lokasiLantai', Ruang: 'lokasiRuang', Kondisi: 'kondisi'
};
// then: formData.append(FIELD_MAP[key], dataPaket[key]);
```

**§2.6 — compute `colspan` instead of hardcoding it:**
```javascript
function tampilkanPesanTabel(pesan) {
    const jumlahKolom = document.querySelectorAll('#tabelAset thead th').length;
    const tbody = document.getElementById('tabelAsetBody');
    tbody.innerHTML = `<tr><td colspan="${jumlahKolom}" ...>${escapeHtml(pesan)}</td></tr>`;
}
```
(Give the table's `<thead>` an id, e.g. `id="tabelAset"` on the `<table>`, if it doesn't have one already.)

---

## 8. Performance fixes (fixes §3.1, §3.2)

**§3.1 — debounce search, single-pass stats, update chart instead of rebuilding it:**

```javascript
let debounceTimer;
document.getElementById('filterPencarian').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(perbaruiTampilanDanStatistik, 200);
});
// remove the inline oninput="..." from index.html once this is wired up
```

```javascript
// one pass instead of four separate .filter().length calls
const counts = databaseAset.reduce((acc, x) => {
    acc.total++;
    if (x.Kondisi === 'Baik') acc.baik++;
    else if (x.Kondisi === 'Rusak Ringan') acc.ringan++;
    else if (x.Kondisi === 'Rusak Berat') acc.berat++;
    return acc;
}, { total: 0, baik: 0, ringan: 0, berat: 0 });
```

For the chart, only recreate it when the label set changes; otherwise update in place:
```javascript
if (pieChartInstance && arraysEqual(pieChartInstance.data.labels, labels)) {
    pieChartInstance.data.datasets[0].data = dataValues;
    pieChartInstance.update();
} else {
    pieChartInstance?.destroy();
    pieChartInstance = new Chart(ctx, { /* ... */ });
}
```

**§3.2 — sequential/batched import with real success tracking:**

```javascript
let entriSukses = 0;
const gagalSinkron = [];

for (let i = 1; i < matriksJson.length; i++) {
    // ...build dataPaket, push to local databaseAset as today...

    if (CONFIG.WEB_APP_URL) {
        try {
            const response = await fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData });
            if (!response.ok) throw new Error();
            entriSukses++;
        } catch {
            gagalSinkron.push(dataPaket.ID_Aset);
        }
    } else {
        entriSukses++;
    }
}

alert(gagalSinkron.length === 0
    ? `Berhasil mengimpor ${entriSukses} rekor aset baru.`
    : `Berhasil mengimpor ${entriSukses} rekor. GAGAL sinkron ke cloud: ${gagalSinkron.join(', ')}`);
```
This trades import speed for correctness (rows go one at a time instead of all firing at once) — worth it, since a large import failing silently is worse than a large import taking a few extra seconds.

---

## What I'd hold off on

- §2.5 (inline handlers → `addEventListener`) and §3.3 (DOM lookup caching) are real but low-impact — fine to leave for whenever you're already touching that code, not worth a dedicated pass.

## Suggested order to actually do this in

1. §1 (Apps Script auth) — pick Option A or B and decide about removing `deleteAll`.
2. §2 (stop committing secrets) + rotate credentials.
3. §3 (escaping helper) — mechanical, touches many lines but each change is trivial and low-risk.
4. §4–§8 — any order, none of them are urgent once 1–3 are done.

Happy to implement any of these directly — say which section(s) and I'll make the changes.
