// SMPN 263 Jakarta - SIMAS Asset Management Script
let databaseAset = JSON.parse(localStorage.getItem('SMPN263_EXCEL_ASSETS')) || [];
let pieChartInstance = null;

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

    if (loginIdInput === CONFIG.ADMIN_ID && loginPinInput === CONFIG.ADMIN_PIN) {
        sessionStorage.setItem('simas_logged_in', 'true');
        tampilkanDashboard();
    } else {
        alert("Otentikasi Gagal! ID User atau PIN salah.");
    }
}

// Logout execution
function handleLogout() {
    sessionStorage.removeItem('simas_logged_in');
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('dashboardPage').classList.add('hidden');
}

// Show main panel
function tampilkanDashboard() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('dashboardPage').classList.remove('hidden');
    perbaruiTampilanDanStatistik();
    muatDataDariCloud();
}

// Load data from Google Sheets Cloud
function muatDataDariCloud() {
    if (!CONFIG.WEB_APP_URL) return;
    
    fetch(CONFIG.WEB_APP_URL)
        .then(response => {
            if (!response.ok) throw new Error("Gagal mengambil data dari server");
            return response.json();
        })
        .then(data => {
            if (Array.isArray(data)) {
                databaseAset = data.map(item => ({
                    ID_Aset: item.ID_Aset || item.idAset || "",
                    Jenis_Barang: item.Jenis_Barang || item.jenisBarang || "",
                    Merk: item.Merk || item.merkBarang || "",
                    Type_Barang: item.Type_Barang || item.typeBarang || "",
                    Triwulan: item.Triwulan || item.pembelianTriwulan || "",
                    Tahun: item.Tahun || item.pembelianTahun || "",
                    Lantai: item.Lantai || item.lokasiLantai || "",
                    Ruang: item.Ruang || item.lokasiRuang || "",
                    Kondisi: item.Kondisi || item.kondisi || ""
                }));
                localStorage.setItem('SMPN263_EXCEL_ASSETS', JSON.stringify(databaseAset));
                perbaruiTampilanDanStatistik();
                console.log("Database successfully synced from cloud.");
            }
        })
        .catch(err => {
            console.error("Gagal sinkronisasi data dari cloud:", err);
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

// Save or edit asset record
function simpanData(e) {
    e.preventDefault();
    const idVal = document.getElementById('idAset').value.trim();

    const dataPaket = {
        ID_Aset: idVal,
        Jenis_Barang: document.getElementById('jenisBarang').value.trim(),
        Merk: document.getElementById('merkBarang').value.trim(),
        Type_Barang: document.getElementById('typeBarang').value.trim(),
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

    if (CONFIG.WEB_APP_URL) {
        const formData = new URLSearchParams();
        Object.keys(dataPaket).forEach(key => {
            const mappedKey = 
                key === 'ID_Aset' ? 'idAset' : 
                key === 'Jenis_Barang' ? 'jenisBarang' : 
                key === 'Merk' ? 'merkBarang' : 
                key === 'Type_Barang' ? 'typeBarang' : 
                key === 'Triwulan' ? 'pembelianTriwulan' : 
                key === 'Tahun' ? 'pembelianTahun' : 
                key === 'Lantai' ? 'lokasiLantai' : 
                key === 'Ruang' ? 'lokasiRuang' : 
                key === 'Kondisi' ? 'kondisi' : '';
            if (mappedKey) {
                formData.append(mappedKey, dataPaket[key]);
            }
        });

        fetch(CONFIG.WEB_APP_URL, {
            method: 'POST',
            body: formData,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
        .then(() => console.log('Sukses sinkronisasi cloud.'))
        .catch(err => console.error('Cloud synchronization error:', err));
    }

    resetFormAset();
    perbaruiTampilanDanStatistik();
    alert("Data aset berhasil disimpan dan disinkronisasi ke cloud!");
}

// Download Excel Template for Mass Import
function unduhTemplateExcelOtomatis() {
    const matriksData = [
        ["ID Aset", "Jenis Barang", "Merk", "Type Barang", "Triwulan", "Tahun", "Lantai", "Ruang", "Kondisi"],
        ["AST-263-001", "Printer", "Epson", "L3210", "Triwulan 1", "2026", "Lantai 2", "Ruang Musik", "Baik"],
        ["AST-263-002", "Laptop", "ASUS", "ExpertBook B1", "Triwulan 2", "2025", "Lantai 1", "Ruang Tata Usaha (TU)", "Baik"],
        ["AST-263-003", "Kursi Siswa", "Chitose", "Yamato", "Triwulan 1", "2024", "Lantai 3", "Ruang Kelas", "Baik"]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(matriksData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template_SIMAS");
    XLSX.writeFile(workbook, "Template_SIMAS_263.xlsx");
}

// Import Excel File
function bacaFileExcelMassal(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const matriksJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        let entriSukses = 0;
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
                Triwulan: baris[4] ? String(baris[4]).trim() : "Triwulan 1",
                Tahun: baris[5] ? String(baris[5]).trim() : "2026",
                Lantai: baris[6] ? String(baris[6]).trim() : "Lantai 1",
                Ruang: baris[7] ? String(baris[7]).trim() : "Ruang Guru",
                Kondisi: baris[8] ? String(baris[8]).trim() : "Baik"
            };

            databaseAset.push(dataPaket);
            entriSukses++;

            if (CONFIG.WEB_APP_URL) {
                const formData = new URLSearchParams();
                formData.append('idAset', dataPaket.ID_Aset);
                formData.append('jenisBarang', dataPaket.Jenis_Barang);
                formData.append('merkBarang', dataPaket.Merk);
                formData.append('typeBarang', dataPaket.Type_Barang);
                formData.append('pembelianTriwulan', dataPaket.Triwulan);
                formData.append('pembelianTahun', dataPaket.Tahun);
                formData.append('lokasiLantai', dataPaket.Lantai);
                formData.append('lokasiRuang', dataPaket.Ruang);
                formData.append('kondisi', dataPaket.Kondisi);
                fetch(CONFIG.WEB_APP_URL, { method: 'POST', body: formData });
            }
        }

        perbaruiTampilanDanStatistik();
        alert(`Berhasil mengimpor ${entriSukses} rekor aset baru dari file Excel.`);
        document.getElementById('excelFileInput').value = "";
    };
    reader.readAsArrayBuffer(file);
}

// Export database to Excel
function eksporDataKeExcel() {
    if (databaseAset.length === 0) {
        return alert("Database kosong.");
    }
    const header = ["ID Aset", "Jenis Barang", "Merk", "Type Barang", "Triwulan", "Tahun", "Lantai", "Ruang", "Kondisi"];
    const dataBaris = databaseAset.map(x => [x.ID_Aset, x.Jenis_Barang, x.Merk, x.Type_Barang, x.Triwulan, x.Tahun, x.Lantai, x.Ruang, x.Kondisi]);
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...dataBaris]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Database");
    XLSX.writeFile(workbook, "DATABASE_SIMAS_263.xlsx");
}

// Purge database
function hapusSemuaDatabaseAset() {
    if (databaseAset.length === 0) {
        alert("Database memang sudah kosong.");
        return;
    }
    if (confirm("PERINGATAN TINGKAT TINGGI:\nApakah Anda yakin ingin menghapus SELURUH data aset di sistem ini? Tindakan ini tidak dapat dibatalkan!")) {
        if (confirm("KONFIRMASI TERAKHIR:\nSemua data fisik inventaris akan hilang dari penyimpanan lokal. Lanjutkan proses pengosongan database?")) {
            databaseAset = [];
            localStorage.removeItem('SMPN263_EXCEL_ASSETS');

            resetFormAset();
            perbaruiTampilanDanStatistik();
            alert("Database lokal berhasil dikosongkan sepenuhnya.");
        }
    }
}

// Render pie chart for asset categories
function renderKategoriPieChart() {
    const rekapJenis = {};
    databaseAset.forEach(item => {
        let jenis = item.Jenis_Barang ? item.Jenis_Barang.trim() : "Lain-lain";
        jenis = jenis.charAt(0).toUpperCase() + jenis.slice(1).toLowerCase();
        rekapJenis[jenis] = (rekapJenis[jenis] || 0) + 1;
    });

    const labels = Object.keys(rekapJenis);
    const dataValues = Object.values(rekapJenis);

    if (pieChartInstance !== null) {
        pieChartInstance.destroy();
    }

    if (labels.length === 0) return;

    const ctx = document.getElementById('kategoriPieChart').getContext('2d');
    pieChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: [
                    '#0284c7', '#0f172a', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#ec4899', '#64748b', '#14b8a6', '#a855f7'
                ],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10,
                        font: { size: 10, weight: 'bold', family: 'sans-serif' },
                        color: '#475569'
                    }
                }
            }
        }
    });
}

// Re-render statistics, charts, and data tables
function perbaruiTampilanDanStatistik() {
    localStorage.setItem('SMPN263_EXCEL_ASSETS', JSON.stringify(databaseAset));
    const kueri = document.getElementById('filterPencarian').value.toLowerCase().trim();
    const fKon = document.getElementById('filterKondisi').value;

    let filtered = databaseAset.filter(x => {
        const cocokKueri = !kueri ||
            x.ID_Aset.toLowerCase().includes(kueri) ||
            (x.Jenis_Barang && x.Jenis_Barang.toLowerCase().includes(kueri)) ||
            (x.Merk && x.Merk.toLowerCase().includes(kueri)) ||
            (x.Type_Barang && x.Type_Barang.toLowerCase().includes(kueri));
        const cocokKon = !fKon || x.Kondisi === fKon;
        return cocokKueri && cocokKon;
    });

    document.getElementById('statTotalAset').innerText = databaseAset.length;
    document.getElementById('statKondisiBaik').innerText = databaseAset.filter(x => x.Kondisi === 'Baik').length;
    document.getElementById('statKondisiRusakRingan').innerText = databaseAset.filter(x => x.Kondisi === 'Rusak Ringan').length;
    document.getElementById('statKondisiRusakBerat').innerText = databaseAset.filter(x => x.Kondisi === 'Rusak Berat').length;

    renderKategoriPieChart();

    const tbody = document.getElementById('tabelAsetBody');
    tbody.innerHTML = "";

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-6 text-center text-slate-400 font-bold" style="font-weight: 700; color: var(--slate-400);">Tidak ada rekor data aset yang sesuai.</td></tr>`;
        return;
    }

    filtered.forEach(barang => {
        let statusBadge = '';
        if (barang.Kondisi === 'Baik') {
            statusBadge = `<span class="badge-status badge-status-baik">Baik</span>`;
        } else if (barang.Kondisi === 'Rusak Ringan') {
            statusBadge = `<span class="badge-status badge-status-rusak-ringan">Rusak Ringan</span>`;
        } else {
            statusBadge = `<span class="badge-status badge-status-rusak-berat">Rusak Berat</span>`;
        }

        const namaDisplay = `${barang.Merk} ${barang.Type_Barang}`;

        const tr = document.createElement('tr');
        tr.className = "table-row-hover";
        tr.innerHTML = `
            <td>
                <div>
                    <p class="asset-detail-name">${namaDisplay}</p>
                    <p class="asset-detail-id">${barang.ID_Aset}</p>
                </div>
            </td>
            <td>
                <span class="badge-category">${barang.Jenis_Barang}</span>
            </td>
            <td>
                ${barang.Triwulan}<br>
                <span style="font-size: 10px; color: var(--slate-400); font-weight: 500;">Tahun ${barang.Tahun}</span>
            </td>
            <td>
                ${barang.Lantai}<br>
                <span style="font-size: 10px; color: var(--slate-400); font-weight: 500;">${barang.Ruang}</span>
            </td>
            <td style="text-align: center;">${statusBadge}</td>
            <td class="cell-actions no-print">
                <button onclick="cetakLabelBarcode('${barang.ID_Aset}')" class="btn-action btn-action-barcode">Barcode</button>
                <button onclick="muatDataKeFormUbah('${barang.ID_Aset}')" class="btn-action btn-action-ubah">Ubah</button>
                <button onclick="hapusAset('${barang.ID_Aset}')" class="btn-action btn-action-hapus">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Populate modification form
function muatDataKeFormUbah(idTarget) {
    const barang = databaseAset.find(x => x.ID_Aset === idTarget);
    if (barang) {
        document.getElementById('formTitle').innerText = `Ubah Aset: ${barang.ID_Aset}`;
        document.getElementById('idAset').value = barang.ID_Aset;
        document.getElementById('idAset').disabled = true;
        document.getElementById('btnBatalEdit').classList.remove('hidden');
        document.getElementById('jenisBarang').value = barang.Jenis_Barang || "";
        document.getElementById('merkBarang').value = barang.Merk || "";
        document.getElementById('typeBarang').value = barang.Type_Barang || "";
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
    if (confirm(`Hapus rekor aset ${idTarget}?`)) {
        databaseAset = databaseAset.filter(x => x.ID_Aset !== idTarget);
        perbaruiTampilanDanStatistik();
        resetFormAset();
    }
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
