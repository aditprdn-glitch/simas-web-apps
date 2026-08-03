// SMPN 263 Jakarta - SIMAS Asset Management Script
let databaseAset = [];
let pieChartInstance = null;
let totalAsetTerkini = 0; // read by the chart's tooltip/datalabels callbacks, kept fresh on every render

function arraysEqual(a, b) {
    return a.length === b.length && a.every((val, i) => val === b[i]);
}

// Escape a value before interpolating it into innerHTML or an HTML attribute,
// so asset data (which can come from Excel import or the shared Sheet) can't break out
// of its element/attribute context and inject markup or script.
function escapeHtml(nilai) {
    return String(nilai ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Distinct years actually present in the loaded data, newest first
function daftarTahunUnik() {
    return Array.from(new Set(databaseAset.map(x => String(x.Tahun || "").trim()).filter(Boolean)))
        .sort((a, b) => b.localeCompare(a));
}

// Initialize app
window.onload = function () {
    if (sessionStorage.getItem('simas_logged_in') === 'true') {
        tampilkanDashboard();
    } else {
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('dashboardPage').classList.add('hidden');
    }
};

// Login execution
function handleLogin(event) {
    event.preventDefault();
    const loginIdInput = document.getElementById('loginId').value.trim();
    const loginPinInput = document.getElementById('loginPassword').value.trim();

    let peranTerautentikasi = null;
    for (const [peran, kredensial] of Object.entries(CONFIG.USERS)) {
        if (loginIdInput === kredensial.id && loginPinInput === kredensial.pin) {
            peranTerautentikasi = peran;
            break;
        }
    }

    if (peranTerautentikasi) {
        sessionStorage.setItem('simas_logged_in', 'true');
        sessionStorage.setItem('simas_role', peranTerautentikasi);
        sessionStorage.setItem('simas_user_id', loginIdInput);
        tampilkanDashboard();
    } else {
        alert("Otentikasi Gagal! ID User atau PIN salah.");
    }
}

// Logout execution
function handleLogout() {
    sessionStorage.removeItem('simas_logged_in');
    sessionStorage.removeItem('simas_role');
    sessionStorage.removeItem('simas_user_id');
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('dashboardPage').classList.add('hidden');
}

// Returns true only for the SUPERUSER role; used to gate destructive actions client-side
// (the real enforcement happens server-side in the Apps Script doPost)
function isSuperuser() {
    return sessionStorage.getItem('simas_role') === 'SUPERUSER';
}

// Reflect the logged-in user's identity and role in the header, and hide superuser-only controls
function terapkanTampilanPeran() {
    const peran = sessionStorage.getItem('simas_role') || '';
    const userId = sessionStorage.getItem('simas_user_id') || '';
    const superuser = isSuperuser();

    document.getElementById('userDisplayNip').textContent = `NIP: ${userId}`;
    document.getElementById('userDisplayRole').textContent = peran === 'SUPERUSER'
        ? 'Superuser'
        : 'Pengelola Barang Inventaris';

    document.getElementById('btnHapusSemuaData').classList.toggle('hidden', !superuser);

    // USER role: read-only access — no adding/editing assets, no bulk import
    document.getElementById('fieldsetAset').disabled = !superuser;
    document.getElementById('formAksesNote').classList.toggle('hidden', superuser);
    document.getElementById('btnImporExcel').classList.toggle('hidden', !superuser);
}

// Blocks an action for anyone but SUPERUSER; shows an alert and returns true if blocked.
// This mirrors the read-only restriction already enforced visually in the UI, as a
// defense-in-depth check against the function being invoked directly (e.g. via console).
function tolakJikaBukanSuperuser(pesan) {
    if (!isSuperuser()) {
        alert(pesan || "Aksi ini hanya bisa dilakukan oleh Superuser.");
        return true;
    }
    return false;
}

// Show main panel
function tampilkanDashboard() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('dashboardPage').classList.remove('hidden');
    terapkanTampilanPeran();
    tampilkanPesanTabel("Memuat data dari cloud...");
    muatDataDariCloud();
}

// Show a placeholder message spanning the whole table (loading/error/empty states)
function tampilkanPesanTabel(pesan) {
    const jumlahKolom = document.querySelectorAll('#tabelAset thead th').length;
    const tbody = document.getElementById('tabelAsetBody');
    tbody.innerHTML = `<tr><td colspan="${jumlahKolom}" class="px-6 py-6 text-center text-slate-400 font-bold" style="font-weight: 700; color: var(--slate-400);">${escapeHtml(pesan)}</td></tr>`;
}

// Load data from Google Sheets Cloud
function muatDataDariCloud() {
    if (!CONFIG.WEB_APP_URL) {
        tampilkanPesanTabel("URL Google Apps Script belum dikonfigurasi.");
        return;
    }

    const url = `${CONFIG.WEB_APP_URL}?token=${encodeURIComponent(CONFIG.API_TOKEN)}`;

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Gagal mengambil data dari server");
            return response.json();
        })
        .then(data => {
            if (data && data.status === 'unauthorized') throw new Error("Token API ditolak oleh server (cek konfigurasi CONFIG.API_TOKEN)");
            if (!Array.isArray(data)) throw new Error("Format data dari server tidak valid");
            databaseAset = data.map(item => ({
                ID_Aset: item.ID_ASET || "",
                Jenis_Barang: item.JENIS_BARANG || "",
                Merk: item.MERK || "",
                Type_Barang: item.TYPE_BARANG || "",
                Sumber_Perolehan_Dana: item.SUMBER_PEROLEHAN_DANA || "",
                Triwulan: item.TRIWULAN || "",
                Tahun: item.TAHUN || "",
                Lantai: item.LANTAI || "",
                Ruang: item.RUANG || "",
                Kondisi: item.KONDISI || ""
            }));
            perbaruiTampilanDanStatistik();
            console.log("Database successfully synced from cloud.");
        })
        .catch(err => {
            console.error("Gagal sinkronisasi data dari cloud:", err);
            tampilkanPesanTabel("Gagal memuat data dari cloud. Cek koneksi internet atau buka Console (F12) untuk detail error.");
        });
}


// Dynamic barcode rendering in asset form
function pemicuBarcodeFormDinamis(val) {
    const txt = val.trim();
    if (txt.length > 2) {
        document.getElementById('formBarcodePlaceholder').classList.add('hidden');
        document.getElementById('formBarcodeCanvas').classList.remove('hidden');
        try {
            JsBarcode("#formBarcodeCanvas", txt, {
                format: "CODE128",
                lineColor: "#0f172a",
                width: 1.5,
                height: 40,
                displayValue: true,
                fontSize: 10
            });
        } catch (e) { 
            console.error("Barcode generation failed:", e); 
        }
    } else {
        document.getElementById('formBarcodePlaceholder').classList.remove('hidden');
        document.getElementById('formBarcodeCanvas').classList.add('hidden');
    }
}

// Maps internal field names to the query-parameter names the Apps Script doPost expects
const FIELD_MAP = {
    ID_Aset: 'idAset', Jenis_Barang: 'jenisBarang', Merk: 'merkBarang',
    Type_Barang: 'typeBarang', Sumber_Perolehan_Dana: 'sumberDana',
    Triwulan: 'pembelianTriwulan', Tahun: 'pembelianTahun',
    Lantai: 'lokasiLantai', Ruang: 'lokasiRuang', Kondisi: 'kondisi'
};

// Save or edit asset record
async function simpanData(e) {
    e.preventDefault();
    if (tolakJikaBukanSuperuser()) return;

    const idVal = document.getElementById('idAset').value.trim();

    const dataPaket = {
        ID_Aset: idVal,
        Jenis_Barang: document.getElementById('jenisBarang').value.trim(),
        Merk: document.getElementById('merkBarang').value.trim(),
        Type_Barang: document.getElementById('typeBarang').value.trim(),
        Sumber_Perolehan_Dana: document.getElementById('sumberDana').value.trim(),
        Triwulan: document.getElementById('pembelianTriwulan').value,
        Tahun: document.getElementById('pembelianTahun').value,
        Lantai: document.getElementById('lokasiLantai').value,
        Ruang: document.getElementById('lokasiRuang').value,
        Kondisi: document.getElementById('kondisi').value
    };

    const isEditMode = document.getElementById('idAset').disabled;
    if (isEditMode) {
        const index = databaseAset.findIndex(x => x.ID_Aset === idVal);
        if (index !== -1) {
            databaseAset[index] = dataPaket;
        }
    } else {
        if (databaseAset.some(x => x.ID_Aset === idVal)) {
            alert("ID Aset sudah ada dalam database!");
            return;
        }
        databaseAset.push(dataPaket);
    }

    if (!CONFIG.WEB_APP_URL) {
        resetFormAset();
        perbaruiTampilanDanStatistik();
        alert("Data aset berhasil disimpan (mode lokal, tanpa cloud).");
        return;
    }

    const formData = new URLSearchParams();
    Object.keys(dataPaket).forEach(key => {
        if (FIELD_MAP[key]) formData.append(FIELD_MAP[key], dataPaket[key]);
    });
    formData.append('token', CONFIG.API_TOKEN);

    try {
        const response = await fetch(CONFIG.WEB_APP_URL, {
            method: 'POST',
            body: formData,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        if (!response.ok) throw new Error("Gagal menyimpan data di server");
        const hasil = await response.json();
        if (hasil && hasil.status === 'unauthorized') throw new Error("Token ditolak oleh server");

        resetFormAset();
        perbaruiTampilanDanStatistik();
        alert("Data aset berhasil disimpan dan disinkronisasi ke cloud!");
    } catch (err) {
        console.error('Gagal menyimpan data di cloud:', err);
        perbaruiTampilanDanStatistik();
        alert('Data tersimpan secara lokal, tetapi GAGAL disinkronisasi ke cloud. Periksa koneksi/konfigurasi lalu coba simpan ulang.');
    }
}

// Download Excel Template for Mass Import
function unduhTemplateExcelOtomatis() {
    const matriksData = [
        ["ID Aset", "Jenis Barang", "Merk", "Type Barang", "Sumber Perolehan Dana", "Triwulan", "Tahun", "Lantai", "Ruang", "Kondisi"],
        ["AST-263-001", "Printer", "Epson", "L3210", "BOS", "Triwulan 1", "2026", "Lantai 2", "Ruang Musik", "Baik"],
        ["AST-263-002", "Laptop", "ASUS", "ExpertBook B1", "BOP", "Triwulan 2", "2025", "Lantai 1", "Ruang Tata Usaha (TU)", "Baik"],
        ["AST-263-003", "Kursi Siswa", "Chitose", "Yamato", "HIBAH", "Triwulan 1", "2024", "Lantai 3", "Ruang Kelas", "Baik"]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(matriksData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template_SIMAS");
    XLSX.writeFile(workbook, "Template_SIMAS_263.xlsx");
}

// Fixed enums also used by the manual form's dropdowns; imported rows are checked against
// these instead of being accepted as-is, so bad Excel data can't silently become unfilterable.
const KONDISI_VALID = ["Baik", "Rusak Ringan", "Rusak Berat"];
const TRIWULAN_VALID = ["Triwulan 1", "Triwulan 2", "Triwulan 3", "Triwulan 4"];
const LANTAI_VALID = ["Lantai 1", "Lantai 2", "Lantai 3", "Lantai 4", "Area Luar / Lapangan"];

// Import Excel File
function bacaFileExcelMassal(event) {
    if (tolakJikaBukanSuperuser()) {
        event.target.value = "";
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const matriksJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        let entriSukses = 0;
        const barisDilewati = [];
        const gagalSinkron = [];

        // Sequential (not fire-and-forget) so each row's cloud sync result is known before
        // moving on, and a large import can't fire dozens of concurrent requests at once.
        for (let i = 1; i < matriksJson.length; i++) {
            const baris = matriksJson[i];
            if (!baris[0] || !baris[1]) continue;

            const idAset = String(baris[0]).trim();
            if (databaseAset.some(x => x.ID_Aset === idAset)) continue;

            const dataPaket = {
                ID_Aset: idAset,
                Jenis_Barang: String(baris[1]).trim(),
                Merk: baris[2] ? String(baris[2]).trim() : "-",
                Type_Barang: baris[3] ? String(baris[3]).trim() : "-",
                Sumber_Perolehan_Dana: baris[4] ? String(baris[4]).trim() : "-",
                Triwulan: baris[5] ? String(baris[5]).trim() : "Triwulan 1",
                Tahun: baris[6] ? String(baris[6]).trim() : "2026",
                Lantai: baris[7] ? String(baris[7]).trim() : "Lantai 1",
                Ruang: baris[8] ? String(baris[8]).trim() : "Ruang Guru",
                Kondisi: baris[9] ? String(baris[9]).trim() : "Baik"
            };

            if (!KONDISI_VALID.includes(dataPaket.Kondisi)) {
                barisDilewati.push(`baris ${i + 1} (${idAset}): Kondisi "${dataPaket.Kondisi}" tidak valid`);
                continue;
            }
            if (!TRIWULAN_VALID.includes(dataPaket.Triwulan)) {
                barisDilewati.push(`baris ${i + 1} (${idAset}): Triwulan "${dataPaket.Triwulan}" tidak valid`);
                continue;
            }
            if (!LANTAI_VALID.includes(dataPaket.Lantai)) {
                barisDilewati.push(`baris ${i + 1} (${idAset}): Lantai "${dataPaket.Lantai}" tidak valid`);
                continue;
            }

            databaseAset.push(dataPaket);
            entriSukses++;

            if (CONFIG.WEB_APP_URL) {
                const formData = new URLSearchParams();
                formData.append('idAset', dataPaket.ID_Aset);
                formData.append('jenisBarang', dataPaket.Jenis_Barang);
                formData.append('merkBarang', dataPaket.Merk);
                formData.append('typeBarang', dataPaket.Type_Barang);
                formData.append('sumberDana', dataPaket.Sumber_Perolehan_Dana);
                formData.append('pembelianTriwulan', dataPaket.Triwulan);
                formData.append('pembelianTahun', dataPaket.Tahun);
                formData.append('lokasiLantai', dataPaket.Lantai);
                formData.append('lokasiRuang', dataPaket.Ruang);
                formData.append('kondisi', dataPaket.Kondisi);
                formData.append('token', CONFIG.API_TOKEN);

                try {
                    const response = await fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData });
                    if (!response.ok) throw new Error();
                    const hasil = await response.json();
                    if (hasil && hasil.status === 'unauthorized') throw new Error();
                } catch {
                    gagalSinkron.push(idAset);
                }
            }
        }

        perbaruiTampilanDanStatistik();

        let pesan = `Berhasil mengimpor ${entriSukses} rekor aset baru dari file Excel.`;
        if (gagalSinkron.length > 0) {
            pesan += `\n\nGAGAL disinkronisasi ke cloud (tersimpan lokal saja, coba "Sinkronisasi" ulang nanti): ${gagalSinkron.join(', ')}`;
        }
        if (barisDilewati.length > 0) {
            pesan += `\n\nDilewati karena data tidak valid:\n${barisDilewati.join('\n')}`;
        }
        alert(pesan);
        document.getElementById('excelFileInput').value = "";
    };
    reader.readAsArrayBuffer(file);
}

// Export database to Excel
function eksporDataKeExcel() {
    if (databaseAset.length === 0) {
        return alert("Database kosong.");
    }
    const header = ["ID_ASET", "JENIS_BARANG", "MERK", "TYPE_BARANG", "SUMBER_PEROLEHAN_DANA", "TRIWULAN", "TAHUN", "LANTAI", "RUANG", "KONDISI"];
    const dataBaris = databaseAset.map(x => [x.ID_Aset, x.Jenis_Barang, x.Merk, x.Type_Barang, x.Sumber_Perolehan_Dana, x.Triwulan, x.Tahun, x.Lantai, x.Ruang, x.Kondisi]);
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...dataBaris]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Database");
    XLSX.writeFile(workbook, "DATABASE_SIMAS_263.xlsx");
}

// Purge database (SUPERUSER only — also enforced server-side in the Apps Script doPost)
function hapusSemuaDatabaseAset() {
    if (tolakJikaBukanSuperuser()) return;
    if (databaseAset.length === 0) {
        alert("Database memang sudah kosong.");
        return;
    }
    if (confirm("PERINGATAN TINGKAT TINGGI:\nApakah Anda yakin ingin menghapus SELURUH data aset di sistem ini? Tindakan ini tidak dapat dibatalkan!")) {
        if (confirm("KONFIRMASI TERAKHIR:\nSemua data akan dihapus permanen dari Google Sheet. Lanjutkan proses pengosongan database?")) {
            if (!CONFIG.WEB_APP_URL) {
                databaseAset = [];
                resetFormAset();
                perbaruiTampilanDanStatistik();
                alert("Database lokal berhasil dikosongkan sepenuhnya.");
                return;
            }

            const formData = new URLSearchParams();
            formData.append('action', 'deleteAll');
            formData.append('token', CONFIG.API_TOKEN);
            formData.append('superuserToken', CONFIG.SUPERUSER_TOKEN);

            fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData })
                .then(response => {
                    if (!response.ok) throw new Error("Gagal menghapus data di server");
                    return response.json();
                })
                .then(hasil => {
                    if (hasil && hasil.status === 'unauthorized') throw new Error("Token ditolak oleh server");
                    databaseAset = [];
                    resetFormAset();
                    perbaruiTampilanDanStatistik();
                    alert("Database berhasil dikosongkan sepenuhnya dari Google Sheet.");
                })
                .catch(err => {
                    console.error('Gagal mengosongkan data di cloud:', err);
                    alert('Gagal menghapus seluruh data di cloud. Database tidak dihapus dari Google Sheet. Coba lagi.');
                });
        }
    }
}

// Render pie chart for asset categories
const PIE_CHART_COLORS = ['#0284c7', '#0f172a', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#ec4899', '#64748b', '#14b8a6', '#a855f7'];

if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

// Keep the year dropdown's options in sync with the loaded data without resetting the user's current selection
function perbaruiOpsiTahunChart() {
    const select = document.getElementById('filterTahunChart');
    const nilaiSaatIni = select.value;

    const tahunTerurut = daftarTahunUnik();

    select.innerHTML = '<option value="">Semua Tahun</option>' +
        tahunTerurut.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    if (tahunTerurut.includes(nilaiSaatIni)) {
        select.value = nilaiSaatIni;
    }
}

function renderKategoriPieChart() {
    perbaruiOpsiTahunChart();

    const tahunTerpilih = document.getElementById('filterTahunChart').value;
    const dataTerfilter = tahunTerpilih
        ? databaseAset.filter(x => String(x.Tahun || "").trim() === tahunTerpilih)
        : databaseAset;

    document.getElementById('pieChartSubtitle').textContent = tahunTerpilih
        ? `Sebaran aset tahun ${tahunTerpilih} berdasarkan Jenis Barang`
        : "Jumlah dan persentase sebaran aset berdasarkan Jenis Barang";

    const rekapJenis = {};
    const rekapSumberDana = {}; // { jenis: { sumberDana: jumlah } }
    dataTerfilter.forEach(item => {
        let jenis = item.Jenis_Barang ? item.Jenis_Barang.trim() : "Lain-lain";
        jenis = jenis.charAt(0).toUpperCase() + jenis.slice(1).toLowerCase();
        rekapJenis[jenis] = (rekapJenis[jenis] || 0) + 1;

        const sumberDana = item.Sumber_Perolehan_Dana ? item.Sumber_Perolehan_Dana.trim() : "Tidak diketahui";
        if (!rekapSumberDana[jenis]) rekapSumberDana[jenis] = {};
        rekapSumberDana[jenis][sumberDana] = (rekapSumberDana[jenis][sumberDana] || 0) + 1;
    });

    // Show the biggest categories first so the detail list reads like a ranking
    const entriesTerurut = Object.entries(rekapJenis).sort((a, b) => b[1] - a[1]);
    const labels = entriesTerurut.map(x => x[0]);
    const dataValues = entriesTerurut.map(x => x[1]);
    const totalAset = dataValues.reduce((sum, v) => sum + v, 0);
    totalAsetTerkini = totalAset;

    const detailList = document.getElementById('pieChartDetailList');

    if (labels.length === 0) {
        if (pieChartInstance !== null) {
            pieChartInstance.destroy();
            pieChartInstance = null;
        }
        detailList.innerHTML = `<p class="pie-chart-empty">Belum ada data untuk ditampilkan${tahunTerpilih ? ` di tahun ${escapeHtml(tahunTerpilih)}` : ''}.</p>`;
        return;
    }

    detailList.innerHTML = entriesTerurut.map(([jenis, jumlah], i) => {
        const persen = ((jumlah / totalAset) * 100).toFixed(1);
        const warna = PIE_CHART_COLORS[i % PIE_CHART_COLORS.length];

        const sumberDanaText = Object.entries(rekapSumberDana[jenis] || {})
            .sort((a, b) => b[1] - a[1])
            .map(([sumber, jml]) => `${escapeHtml(sumber)} (${jml})`)
            .join(', ');

        return `
            <div class="pie-chart-detail-item">
                <div class="pie-chart-detail-main">
                    <span class="label-group">
                        <span class="color-dot" style="background-color: ${warna};"></span>
                        ${escapeHtml(jenis)}
                    </span>
                    <span class="value-group">
                        <span class="value-count">${jumlah}</span>
                        <span class="value-percent">(${persen}%)</span>
                    </span>
                </div>
                ${sumberDanaText ? `<div class="pie-chart-detail-sumber">Sumber Dana: ${sumberDanaText}</div>` : ''}
            </div>
        `;
    }).join('');

    // If the set of categories hasn't changed, update the existing chart's values in place
    // instead of destroying and recreating the whole Chart.js instance on every filter/search change.
    if (pieChartInstance !== null && arraysEqual(pieChartInstance.data.labels, labels)) {
        pieChartInstance.data.datasets[0].data = dataValues;
        pieChartInstance.data.datasets[0].backgroundColor = labels.map((_, i) => PIE_CHART_COLORS[i % PIE_CHART_COLORS.length]);
        pieChartInstance.update();
        return;
    }

    if (pieChartInstance !== null) {
        pieChartInstance.destroy();
        pieChartInstance = null;
    }

    const ctx = document.getElementById('kategoriPieChart').getContext('2d');
    pieChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: labels.map((_, i) => PIE_CHART_COLORS[i % PIE_CHART_COLORS.length]),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const jumlah = context.raw;
                            const persen = ((jumlah / totalAsetTerkini) * 100).toFixed(1);
                            return `${context.label}: ${jumlah} unit (${persen}%)`;
                        }
                    }
                },
                datalabels: {
                    color: '#ffffff',
                    font: { weight: 'bold', size: 11, family: 'sans-serif' },
                    formatter: (jumlah) => {
                        const persen = (jumlah / totalAsetTerkini) * 100;
                        return persen >= 5 ? `${persen.toFixed(1)}%` : '';
                    }
                }
            }
        }
    });
}

// Toggle a checkbox filter dropdown open/closed, closing any other open ones
function toggleMultiselectFilter(panelId) {
    const panel = document.getElementById(panelId);
    const sedangTerbuka = !panel.classList.contains('hidden');

    document.querySelectorAll('.multiselect-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.multiselect-trigger').forEach(t => t.classList.remove('is-open'));

    if (!sedangTerbuka) {
        panel.classList.remove('hidden');
        panel.previousElementSibling.classList.add('is-open');
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.multiselect-filter')) {
        document.querySelectorAll('.multiselect-panel').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('.multiselect-trigger').forEach(t => t.classList.remove('is-open'));
    }
});

// Delegated handler for the per-row action buttons (Barcode/Ubah/Hapus). Reading the asset ID
// from `dataset.id` instead of interpolating it into an inline onclick="..." string means the ID
// is passed as a plain JS value and can never be interpreted as executable code, no matter what
// characters it contains.
document.getElementById('tabelAsetBody').addEventListener('click', (e) => {
    const tombol = e.target.closest('button[data-action]');
    if (!tombol) return;
    const idTarget = tombol.dataset.id;
    if (tombol.dataset.action === 'cetak') cetakLabelBarcode(idTarget);
    else if (tombol.dataset.action === 'ubah') muatDataKeFormUbah(idTarget);
    else if (tombol.dataset.action === 'hapus') hapusAset(idTarget);
});

// Debounce the search box so typing doesn't re-run the full filter/chart/table pipeline
// on every keystroke — only after the user pauses for 200ms.
let timerPencarian;
document.getElementById('filterPencarian').addEventListener('input', () => {
    clearTimeout(timerPencarian);
    timerPencarian = setTimeout(perbaruiTampilanDanStatistik, 200);
});

// Read the checked values inside a filter panel, optionally scoped to a data-filter-group (e.g. "tahun" vs "triwulan")
function bacaNilaiTercentang(panelId, filterGroup) {
    const selector = filterGroup
        ? `input[type="checkbox"][data-filter-group="${filterGroup}"]:checked`
        : 'input[type="checkbox"]:checked';
    return Array.from(document.querySelectorAll(`#${panelId} ${selector}`)).map(cb => cb.value);
}

// Show a "(n)" count on a filter button and highlight it when it has active selections
function perbaruiIndikatorFilter(triggerId, jumlahTerpilih) {
    const trigger = document.getElementById(triggerId);
    const labelSpan = trigger.querySelector('span');
    if (!trigger.dataset.label) {
        trigger.dataset.label = labelSpan.textContent;
    }
    labelSpan.textContent = jumlahTerpilih > 0 ? `${trigger.dataset.label} (${jumlahTerpilih})` : trigger.dataset.label;
    trigger.classList.toggle('has-active', jumlahTerpilih > 0);
}

// Keep the "Tahun" checkbox list in sync with years actually present in the data, without losing current checks
function perbaruiOpsiTahunFilter() {
    const container = document.getElementById('filterTahunOptions');
    const tahunTersedia = daftarTahunUnik();
    const tahunTercentang = new Set(bacaNilaiTercentang('filterTahunPengadaanPanel', 'tahun'));

    if (tahunTersedia.length === 0) {
        container.innerHTML = `<p class="multiselect-empty">Belum ada data tahun.</p>`;
        return;
    }

    container.innerHTML = tahunTersedia.map(tahun => `
        <label class="multiselect-option">
            <input type="checkbox" data-filter-group="tahun" value="${escapeHtml(tahun)}" onchange="perbaruiTampilanDanStatistik()" ${tahunTercentang.has(tahun) ? 'checked' : ''}>
            ${escapeHtml(tahun)}
        </label>
    `).join('');
}

// Clear the search box and every checkbox filter, then refresh the view
function resetSemuaFilter() {
    document.getElementById('filterPencarian').value = '';
    document.querySelectorAll('.multiselect-panel input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.multiselect-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.multiselect-trigger').forEach(t => t.classList.remove('is-open'));
    perbaruiTampilanDanStatistik();
}

// Re-render statistics, charts, and data tables
function perbaruiTampilanDanStatistik() {
    perbaruiOpsiTahunFilter();

    const kueri = document.getElementById('filterPencarian').value.toLowerCase().trim();
    const statusTerpilih = bacaNilaiTercentang('filterStatusPanel');
    const tahunTerpilih = bacaNilaiTercentang('filterTahunPengadaanPanel', 'tahun');
    const triwulanTerpilih = bacaNilaiTercentang('filterTahunPengadaanPanel', 'triwulan');
    const lokasiTerpilih = bacaNilaiTercentang('filterLokasiPanel');
    const sumberDanaTerpilih = bacaNilaiTercentang('filterSumberDanaPanel');

    perbaruiIndikatorFilter('filterStatusTrigger', statusTerpilih.length);
    perbaruiIndikatorFilter('filterTahunPengadaanTrigger', tahunTerpilih.length + triwulanTerpilih.length);
    perbaruiIndikatorFilter('filterLokasiTrigger', lokasiTerpilih.length);
    perbaruiIndikatorFilter('filterSumberDanaTrigger', sumberDanaTerpilih.length);

    let filtered = databaseAset.filter(x => {
        const cocokKueri = !kueri ||
            x.ID_Aset.toLowerCase().includes(kueri) ||
            (x.Jenis_Barang && x.Jenis_Barang.toLowerCase().includes(kueri)) ||
            (x.Merk && x.Merk.toLowerCase().includes(kueri)) ||
            (x.Type_Barang && x.Type_Barang.toLowerCase().includes(kueri));
        const cocokStatus = statusTerpilih.length === 0 || statusTerpilih.includes(x.Kondisi);
        const cocokTahun = tahunTerpilih.length === 0 || tahunTerpilih.includes(String(x.Tahun || "").trim());
        const cocokTriwulan = triwulanTerpilih.length === 0 || triwulanTerpilih.includes(x.Triwulan);
        const cocokLokasi = lokasiTerpilih.length === 0 || lokasiTerpilih.includes(x.Lantai);
        const cocokSumberDana = sumberDanaTerpilih.length === 0 ||
            sumberDanaTerpilih.some(s => (x.Sumber_Perolehan_Dana || "").trim().toUpperCase() === s.toUpperCase());
        return cocokKueri && cocokStatus && cocokTahun && cocokTriwulan && cocokLokasi && cocokSumberDana;
    });

    const jumlahKondisi = databaseAset.reduce((acc, x) => {
        if (x.Kondisi === 'Baik') acc.baik++;
        else if (x.Kondisi === 'Rusak Ringan') acc.ringan++;
        else if (x.Kondisi === 'Rusak Berat') acc.berat++;
        return acc;
    }, { baik: 0, ringan: 0, berat: 0 });

    document.getElementById('statTotalAset').innerText = databaseAset.length;
    document.getElementById('statKondisiBaik').innerText = jumlahKondisi.baik;
    document.getElementById('statKondisiRusakRingan').innerText = jumlahKondisi.ringan;
    document.getElementById('statKondisiRusakBerat').innerText = jumlahKondisi.berat;

    renderKategoriPieChart();

    const tbody = document.getElementById('tabelAsetBody');
    tbody.innerHTML = "";

    if (filtered.length === 0) {
        tampilkanPesanTabel("Tidak ada rekor data aset yang sesuai.");
        return;
    }

    const superuser = isSuperuser();

    filtered.forEach(barang => {
        let statusBadge = '';
        if (barang.Kondisi === 'Baik') {
            statusBadge = `<span class="badge-status badge-status-baik">Baik</span>`;
        } else if (barang.Kondisi === 'Rusak Ringan') {
            statusBadge = `<span class="badge-status badge-status-rusak-ringan">Rusak Ringan</span>`;
        } else {
            statusBadge = `<span class="badge-status badge-status-rusak-berat">Rusak Berat</span>`;
        }

        const namaDisplay = escapeHtml(`${barang.Merk} ${barang.Type_Barang}`);
        const idAsetAman = escapeHtml(barang.ID_Aset);

        const tr = document.createElement('tr');
        tr.className = "table-row-hover";
        tr.innerHTML = `
            <td>
                <div>
                    <p class="asset-detail-name">${namaDisplay}</p>
                    <p class="asset-detail-id">${idAsetAman}</p>
                </div>
            </td>
            <td>
                <span class="badge-category">${escapeHtml(barang.Jenis_Barang)}</span>
            </td>
            <td>
                <span class="badge-category">${escapeHtml(barang.Sumber_Perolehan_Dana)}</span>
            </td>
            <td>
                ${escapeHtml(barang.Triwulan)}<br>
                <span style="font-size: 10px; color: var(--slate-400); font-weight: 500;">Tahun ${escapeHtml(barang.Tahun)}</span>
            </td>
            <td>
                ${escapeHtml(barang.Lantai)}<br>
                <span style="font-size: 10px; color: var(--slate-400); font-weight: 500;">${escapeHtml(barang.Ruang)}</span>
            </td>
            <td style="text-align: center;">${statusBadge}</td>
            <td class="cell-actions no-print">
                <button data-action="cetak" data-id="${idAsetAman}" class="btn-action btn-action-barcode">Barcode</button>
                ${superuser ? `
                <button data-action="ubah" data-id="${idAsetAman}" class="btn-action btn-action-ubah">Ubah</button>
                <button data-action="hapus" data-id="${idAsetAman}" class="btn-action btn-action-hapus">Hapus</button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Populate modification form
function muatDataKeFormUbah(idTarget) {
    if (tolakJikaBukanSuperuser()) return;

    const barang = databaseAset.find(x => x.ID_Aset === idTarget);
    if (barang) {
        document.getElementById('formTitle').innerText = `Ubah Aset: ${barang.ID_Aset}`;
        document.getElementById('idAset').value = barang.ID_Aset;
        document.getElementById('idAset').disabled = true;
        document.getElementById('btnBatalEdit').classList.remove('hidden');
        document.getElementById('jenisBarang').value = barang.Jenis_Barang || "";
        document.getElementById('merkBarang').value = barang.Merk || "";
        document.getElementById('typeBarang').value = barang.Type_Barang || "";
        document.getElementById('sumberDana').value = barang.Sumber_Perolehan_Dana || "";
        document.getElementById('pembelianTriwulan').value = barang.Triwulan;
        document.getElementById('pembelianTahun').value = barang.Tahun;
        document.getElementById('lokasiLantai').value = barang.Lantai;
        document.getElementById('lokasiRuang').value = barang.Ruang;
        document.getElementById('kondisi').value = barang.Kondisi;

        pemicuBarcodeFormDinamis(barang.ID_Aset);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Delete asset record
function hapusAset(idTarget) {
    if (tolakJikaBukanSuperuser()) return;
    if (!confirm(`Hapus rekor aset ${idTarget}?`)) return;

    if (!CONFIG.WEB_APP_URL) {
        databaseAset = databaseAset.filter(x => x.ID_Aset !== idTarget);
        perbaruiTampilanDanStatistik();
        resetFormAset();
        return;
    }

    const formData = new URLSearchParams();
    formData.append('action', 'delete');
    formData.append('idAset', idTarget);
    formData.append('token', CONFIG.API_TOKEN);

    fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) throw new Error("Gagal menghapus data di server");
            return response.json();
        })
        .then(() => {
            databaseAset = databaseAset.filter(x => x.ID_Aset !== idTarget);
            perbaruiTampilanDanStatistik();
            resetFormAset();
        })
        .catch(err => {
            console.error('Gagal menghapus data di cloud:', err);
            alert('Gagal menghapus data di cloud. Aset tidak dihapus dari Google Sheet. Coba lagi.');
        });
}

// Reset asset form state
function resetFormAset() {
    document.getElementById('formTitle').innerText = "Tambah Aset Baru";
    document.getElementById('idAset').disabled = false;
    document.getElementById('btnBatalEdit').classList.add('hidden');
    document.getElementById('formAset').reset();
    pemicuBarcodeFormDinamis("");
}

// Print Barcode Label
function cetakLabelBarcode(idTarget) {
    const barang = databaseAset.find(x => x.ID_Aset === idTarget);
    if (!barang) return;
    document.getElementById('printNamaBarang').innerText = `${barang.Merk} ${barang.Type_Barang}`;
    document.getElementById('printIdAset').innerText = barang.ID_Aset;
    JsBarcode("#printBarcodeCanvas", barang.ID_Aset, { 
        format: "CODE128", 
        lineColor: "#000000", 
        width: 2, 
        height: 45, 
        displayValue: false 
    });

    document.getElementById('dashboardPage').classList.add('hidden');
    document.getElementById('printZone').classList.remove('hidden');
    window.print();
    setTimeout(() => {
        document.getElementById('printZone').classList.add('hidden');
        document.getElementById('dashboardPage').classList.remove('hidden');
    }, 400);
}
