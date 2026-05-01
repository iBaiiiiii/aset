// =====================================================
// SDIT Aya Sophia — Sistem Manajemen Aset
// script.js — Terkoneksi ke MySQL via PHP API
// =====================================================

const API = 'http://localhost/sdit-aset/api.php';

// ============ HELPERS ============
function formatRp(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}
function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return m + 'm lalu';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'j lalu';
  return Math.floor(h / 24) + 'h lalu';
}

async function apiFetch(resource, options = {}) {
  try {
    const url = new URL(API);
    url.searchParams.set('resource', resource);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== '' && v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Terjadi kesalahan');
    return json;
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    throw e;
  }
}

// ============ NAVIGATION ============
const pageTitles = {
  dashboard: 'Dashboard',
  aset: 'Daftar Aset',
  peminjaman: 'Peminjaman Aset',
  laporan: 'Laporan & Analitik',
  kategori: 'Kategori & Lokasi',
  pengaturan: 'Pengaturan Sistem',
  profil: 'Profil Saya',
};

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  document.getElementById('pageTitle').textContent = pageTitles[id] || id;
  document.getElementById('pageBreadcrumb').textContent = `SDIT Aya Sophia → ${pageTitles[id] || id}`;
  if (event?.currentTarget) event.currentTarget.classList.add('active');

  // Load data sesuai halaman
  if (id === 'dashboard')   loadDashboard();
  if (id === 'aset')        loadAset();
  if (id === 'peminjaman')  loadPeminjaman('semua');
  if (id === 'kategori')    loadKategoriLokasi();
}

// ============ DASHBOARD ============
async function loadDashboard() {
  try {
    const res = await apiFetch('dashboard');
    const { stats, kategori, kondisi, perhatian, aktivitas } = res;

    // Update metric cards
    document.querySelector('.metric-card.blue .metric-value').textContent  = stats.total_aset;
    document.querySelector('.metric-card.green .metric-value').textContent = stats.kondisi_baik;
    document.querySelector('.metric-card.amber .metric-value').textContent = stats.sedang_dipinjam;
    document.querySelector('.metric-card.red .metric-value').textContent   = stats.perlu_perawatan;

    document.querySelector('.metric-card.green .metric-tag').textContent =
      Math.round(stats.kondisi_baik * 100 / (stats.total_aset || 1)) + '% dari total';
    document.querySelector('.metric-card.amber .metric-tag').textContent =
      stats.jatuh_tempo + ' segera kembali';

    // Sidebar badges
    document.getElementById('sideAssetCount').textContent = stats.total_aset;
    document.getElementById('sideBorrowCount').textContent = stats.sedang_dipinjam;

    // Alert banner
    if (stats.perlu_perawatan > 0 || stats.jatuh_tempo > 0) {
      const banner = document.querySelector('.alert-banner');
      if (banner) {
        banner.querySelector('strong').nextSibling.textContent =
          `\u00a0${stats.perlu_perawatan} aset perlu perhatian & ${stats.jatuh_tempo} peminjaman jatuh tempo hari ini.`;
      }
    }

    // Quick stats (nilai total aset)
    const qsItems = document.querySelectorAll('.qs-item .qs-val');
    if (qsItems[0]) qsItems[0].textContent = (res.total_nilai / 1000000).toFixed(1) + 'M';
    if (qsItems[1]) qsItems[1].textContent = stats.total_aset;
    if (qsItems[2]) qsItems[2].textContent = stats.baru_bulan_ini;

    // Chart distribusi kategori
    renderDashChart(kategori);

    // Progress bar kondisi per kategori
    const catColors = ['#1A4F8A','#2E9462','#4A3580','#C4932A','#8B5E00','#8B1A1A'];
    const prog = document.querySelector('.card:has(.progress-item) > div:last-child');
    if (prog && kondisi.length) {
      prog.innerHTML = kondisi.map((k, i) => `
        <div class="progress-item">
          <div class="progress-row"><span>${k.nama}</span><span style="font-weight:600;">${k.persen_baik}%</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${k.persen_baik}%;background:${catColors[i % catColors.length]};"></div></div>
        </div>`).join('');
    }

    // Tabel aset perlu perhatian
    const catColors2 = { Elektronik:'tag-blue', Furnitur:'tag-green', Kendaraan:'tag-amber', Olahraga:'tag-gold', Laboratorium:'tag-purple', 'Alat Tulis':'tag-red' };
    const condClass = { Baik:'pill-ok', Perawatan:'pill-warn', Rusak:'pill-bad' };
    const pert = document.querySelector('#page-dashboard .table-wrap tbody');
    if (pert) {
      pert.innerHTML = perhatian.length ? perhatian.map(a => `
        <tr>
          <td><span class="font-bold">${a.nama}</span><div class="asset-code">${a.kode}</div></td>
          <td><span class="metric-tag ${catColors2[a.kategori] || ''}">${a.kategori || '—'}</span></td>
          <td>${a.lokasi || '—'}</td>
          <td><span class="status-pill ${condClass[a.kondisi] || ''}"><span class="pill-dot"></span>${a.kondisi}</span></td>
          <td class="text-sm">—</td>
        </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:16px;">Semua aset dalam kondisi baik 👍</td></tr>';
    }

    // Aktivitas terbaru
    const actIcons = {
      aset: { bg: 'var(--blue-bg)', svg: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="#1A4F8A" stroke-width="1.8" stroke-linecap="round"/></svg>` },
      pinjam: { bg: 'var(--amber-bg)', svg: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#8B5E00" stroke-width="1.5"/><path d="M8 5v3l2 2" stroke="#8B5E00" stroke-width="1.5" stroke-linecap="round"/></svg>` },
    };
    const actList = document.querySelector('.activity-list');
    if (actList && aktivitas.length) {
      actList.innerHTML = aktivitas.map(a => {
        const ic = actIcons[a.tipe] || actIcons.aset;
        return `
          <div class="activity-item">
            <div class="act-icon" style="background:${ic.bg};">${ic.svg}</div>
            <div class="act-body">
              <div class="act-title">${a.label}</div>
              <div class="act-sub">${a.sub || ''}</div>
            </div>
            <div class="act-time">${timeAgo(a.waktu)}</div>
          </div>`;
      }).join('');
    }
  } catch (e) {
    console.error('Dashboard error:', e);
  }
}

function renderDashChart(kategori) {
  const maxVal = Math.max(...kategori.map(d => d.jumlah), 1);
  const el = document.getElementById('dashChart');
  if (!el) return;
  const colors = { Elektronik:'#1A4F8A', Furnitur:'#2E9462', Laboratorium:'#4A3580', Olahraga:'#C4932A', Kendaraan:'#8B5E00', 'Alat Tulis':'#8B1A1A' };
  el.innerHTML = kategori.map(d => `
    <div class="bar-group">
      <div class="bar-wrap">
        <div class="bar" style="height:${(d.jumlah / maxVal) * 110}px;background:${colors[d.nama] || '#888'};opacity:.85;" title="${d.nama}: ${d.jumlah} unit"></div>
        <div class="bar" style="height:${(d.jumlah_baik / maxVal) * 110}px;background:#2E9462;opacity:.6;" title="Kondisi baik: ${d.jumlah_baik}"></div>
      </div>
      <div class="bar-label">${d.nama.substring(0, 7)}</div>
    </div>`).join('');
}

// ============ ASET ============
const catColors = { Elektronik:'tag-blue', Furnitur:'tag-green', Kendaraan:'tag-amber', Olahraga:'tag-gold', Laboratorium:'tag-purple', 'Alat Tulis':'tag-red' };
const condClass  = { Baik:'pill-ok', Perawatan:'pill-warn', Rusak:'pill-bad' };

let currentAsetPage  = 1;
let asetFilters = { q: '', kategori_id: '', lokasi_id: '', kondisi: '', sort: '' };

async function loadAset(page = 1) {
  currentAsetPage = page;
  try {
    const res = await apiFetch('aset', {
      params: { ...asetFilters, page, per_page: 8 },
    });
    renderAsetTable(res.data, res.total, res.total_pages, page);
    document.getElementById('asetTotal').textContent   = res.total;
    document.getElementById('asetShown').textContent   = res.data.length;
    document.getElementById('asetPageCount').textContent = res.total_pages;
    renderPagination(page, res.total_pages);
  } catch (e) {}
}

function renderAsetTable(data, total, totalPages, page) {
  const perPage = 8;
  const start = (page - 1) * perPage;
  const tbody = document.getElementById('asetTableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">Tidak ada aset yang cocok dengan filter</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = data.map((a, i) => `
    <tr>
      <td><input type="checkbox" class="chk"></td>
      <td style="color:var(--text3);">${start + i + 1}</td>
      <td><div style="font-weight:600;">${a.nama}</div><div class="asset-code">${a.kode}</div></td>
      <td><span class="metric-tag ${catColors[a.kategori_nama] || ''}">${a.kategori_nama || '—'}</span></td>
      <td style="color:var(--text2);">${a.lokasi_nama || '—'}</td>
      <td><span class="status-pill ${condClass[a.kondisi] || ''}"><span class="pill-dot"></span>${a.kondisi}</span></td>
      <td style="font-variant-numeric:tabular-nums;">${formatRp(a.nilai)}</td>
      <td style="color:var(--text2);">${formatDate(a.tgl_masuk)}</td>
      <td><div style="display:flex;gap:5px;">
        <button onclick="openDetailAset(${a.id})" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid #C5D8F4;background:var(--blue-bg);color:var(--blue);cursor:pointer;font-family:inherit;">Detail</button>
        <button onclick="hapusAset(${a.id})" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid #F5C0C0;background:var(--red-bg);color:var(--red);cursor:pointer;font-family:inherit;">Hapus</button>
      </div></td>
    </tr>`).join('');
}

function renderPagination(current, total) {
  const pg = document.getElementById('asetPagination');
  if (!pg) return;
  let html = `<button class="pg-btn" onclick="loadAset(${current - 1})" ${current <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= Math.min(total, 5); i++) {
    html += `<button class="pg-btn${i === current ? ' active' : ''}" onclick="loadAset(${i})">${i}</button>`;
  }
  if (total > 5) html += `<span style="padding:0 4px;font-size:12px;color:var(--text3);">...</span><button class="pg-btn" onclick="loadAset(${total})">${total}</button>`;
  html += `<button class="pg-btn" onclick="loadAset(${current + 1})" ${current >= total ? 'disabled' : ''}>›</button>`;
  pg.innerHTML = html;
}

function filterAset() {
  asetFilters.q         = document.getElementById('asetSearch')?.value || '';
  const katEl           = document.getElementById('asetKat');
  const lokEl           = document.getElementById('asetLok');
  asetFilters.kondisi   = document.getElementById('asetKond')?.value || '';
  // Kategori & lokasi filter by name dari select — kita perlu ID
  // Untuk itu, kita cari ID dari cache
  const katName = katEl?.value || '';
  const lokName = lokEl?.value || '';
  asetFilters.kategori_id = katCache.find(k => k.nama === katName)?.id || '';
  asetFilters.lokasi_id   = lokCache.find(l => l.nama === lokName)?.id || '';
  loadAset(1);
}

function resetAsetFilter() {
  ['asetSearch','asetKat','asetKond','asetLok'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  asetFilters = { q: '', kategori_id: '', lokasi_id: '', kondisi: '', sort: '' };
  loadAset(1);
}

function sortAset(col) {
  asetFilters.sort = col;
  loadAset(1);
}

function toggleCheckAll(el) {
  document.querySelectorAll('#asetTableBody .chk').forEach(c => c.checked = el.checked);
}

async function openDetailAset(id) {
  try {
    const res = await apiFetch('aset', { params: { id } });
    const a = res.data;
    document.getElementById('detailAsetNama').textContent = a.nama;
    document.getElementById('detailAsetKode').textContent = a.kode;
    document.getElementById('detailContent').innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Kategori</div><div class="detail-value"><span class="metric-tag ${catColors[a.kategori_nama] || ''}">${a.kategori_nama || '—'}</span></div></div>
        <div class="detail-item"><div class="detail-label">Kondisi</div><div class="detail-value"><span class="status-pill ${condClass[a.kondisi] || ''}"><span class="pill-dot"></span>${a.kondisi}</span></div></div>
        <div class="detail-item"><div class="detail-label">Lokasi</div><div class="detail-value">${a.lokasi_nama || '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Nilai Perolehan</div><div class="detail-value">${formatRp(a.nilai)}</div></div>
        <div class="detail-item"><div class="detail-label">Tanggal Masuk</div><div class="detail-value">${formatDate(a.tgl_masuk)}</div></div>
        <div class="detail-item"><div class="detail-label">Sumber Dana</div><div class="detail-value">${a.sumber_dana || '—'}</div></div>
        ${a.keterangan ? `<div class="detail-item" style="grid-column:1/-1"><div class="detail-label">Keterangan</div><div class="detail-value">${a.keterangan}</div></div>` : ''}
      </div>`;
    document.getElementById('detailHistory').innerHTML = `
      <div class="history-item"><div class="history-dot"></div><div><div class="history-text">Aset ditambahkan ke sistem</div><div class="history-time">${formatDate(a.tgl_masuk)}</div></div></div>
      <div class="history-item"><div class="history-dot"></div><div><div class="history-text">Terakhir diperbarui</div><div class="history-time">${formatDate(a.updated_at)}</div></div></div>`;
    openModal('modal-detail-aset');
  } catch (e) {}
}

async function hapusAset(id) {
  if (!confirm('Yakin ingin menghapus aset ini?')) return;
  try {
    const res = await apiFetch('aset', { method: 'DELETE', params: { id } });
    showToast(res.message, 'success');
    loadAset(currentAsetPage);
    loadDashboard();
  } catch (e) {}
}

async function tambahAset() {
  const form = document.querySelector('#modal-tambah-aset');
  const g = (name) => form.querySelector(`[name="${name}"]`);

  const nama      = g('nama')?.value?.trim();
  const katId     = g('kategori_id')?.value;
  const lokId     = g('lokasi_id')?.value;
  const kondisi   = g('kondisi')?.value || 'Baik';
  const nilai     = parseInt(g('nilai')?.value || 0);
  const tglMasuk  = g('tgl_masuk')?.value;
  const sumberDana = g('sumber_dana')?.value || 'BOS';
  const keterangan = g('keterangan')?.value || '';

  if (!nama)    { showToast('Nama aset wajib diisi', 'error'); return; }
  if (!katId)   { showToast('Kategori wajib dipilih', 'error'); return; }
  if (!lokId)   { showToast('Lokasi wajib dipilih', 'error'); return; }
  if (!tglMasuk){ showToast('Tanggal masuk wajib diisi', 'error'); return; }

  const body = {
    nama,
    kategori_id: parseInt(katId),
    lokasi_id:   parseInt(lokId),
    kondisi,
    nilai,
    tgl_masuk:   tglMasuk,
    sumber_dana: sumberDana,
    keterangan,
  };

  try {
    const res = await apiFetch('aset', { method: 'POST', body });
    showToast(`Aset berhasil disimpan dengan kode ${res.kode}`, 'success');
    closeModal('modal-tambah-aset');
    form.querySelectorAll('.form-input, .form-select').forEach(el => el.value = el.tagName === 'SELECT' ? '' : '');
    form.querySelectorAll('textarea').forEach(el => el.value = '');
    loadAset(1);
    loadDashboard();
  } catch (e) {}
}

// ============ PEMINJAMAN ============
let currentBorrowFilter = 'semua';

async function loadPeminjaman(filter) {
  currentBorrowFilter = filter;
  try {
    const res = await apiFetch('peminjaman', { params: { status: filter } });
    renderBorrowTable(res.data);

    // Update tab counts
    const c = res.counts;
    const tabs = document.querySelectorAll('.bs-tab');
    if (tabs[0]) tabs[0].textContent = `Semua (${c.semua})`;
    if (tabs[1]) tabs[1].textContent = `Aktif (${c.aktif})`;
    if (tabs[2]) tabs[2].textContent = `Jatuh Tempo (${c.jatuh_tempo})`;
    if (tabs[3]) tabs[3].textContent = `Selesai (${c.selesai})`;

    // Sidebar badge
    document.getElementById('sideBorrowCount').textContent = parseInt(c.aktif) + parseInt(c.jatuh_tempo);
  } catch (e) {}
}

function renderBorrowTable(data) {
  const statusPill = { 'Aktif':'pill-blue', 'Jatuh Tempo':'pill-bad', 'Selesai':'pill-ok' };
  const tbody = document.getElementById('borrowTableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Tidak ada data peminjaman</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = data.map((b, i) => `
    <tr>
      <td style="color:var(--text3);">${i + 1}</td>
      <td><div style="font-weight:600;">${b.aset_nama}</div><div class="asset-code">${b.aset_kode}</div></td>
      <td>${b.nama_peminjam}</td>
      <td><span class="text-sm">${b.jabatan}</span></td>
      <td class="text-sm">${formatDate(b.tgl_pinjam)}</td>
      <td class="text-sm">${formatDate(b.tgl_kembali)}</td>
      <td><span class="status-pill ${statusPill[b.status] || ''}"><span class="pill-dot"></span>${b.status}</span></td>
      <td><div style="display:flex;gap:5px;">
        ${b.status !== 'Selesai' ? `<button onclick="returnAsset(${b.id})" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid #C5D8F4;background:var(--blue-bg);color:var(--blue);cursor:pointer;font-family:inherit;">Kembalikan</button>` : ''}
        <button onclick="showToast('Detail peminjaman #${b.id}','success')" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-family:inherit;">Detail</button>
      </div></td>
    </tr>`).join('');
}

function filterBorrow(filter, el) {
  document.querySelectorAll('.bs-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadPeminjaman(filter);
}

async function filterBorrowSearch(q) {
  try {
    const res = await apiFetch('peminjaman', { params: { status: currentBorrowFilter, q } });
    renderBorrowTable(res.data);
  } catch (e) {}
}

async function returnAsset(id) {
  try {
    const res = await apiFetch('peminjaman', { method: 'PUT', params: { id }, body: { aksi: 'kembalikan' } });
    showToast(res.message, 'success');
    loadPeminjaman(currentBorrowFilter);
    loadDashboard();
  } catch (e) {}
}

async function catatPeminjaman() {
  const modal = document.querySelector('#modal-tambah-pinjam');
  const g = (name) => modal.querySelector(`[name="${name}"]`);

  const asetId     = g('aset_id')?.value;
  const namaPeminjam = g('nama_peminjam')?.value?.trim();
  const nip        = g('nip')?.value || '';
  const jabatan    = g('jabatan')?.value || 'Guru';
  const keperluan  = g('keperluan')?.value || '';
  const tglPinjam  = g('tgl_pinjam')?.value;
  const tglKembali = g('tgl_kembali')?.value;
  const catatan    = g('catatan')?.value || '';

  if (!asetId)       { showToast('Aset wajib dipilih', 'error'); return; }
  if (!namaPeminjam) { showToast('Nama peminjam wajib diisi', 'error'); return; }
  if (!tglPinjam)    { showToast('Tanggal pinjam wajib diisi', 'error'); return; }
  if (!tglKembali)   { showToast('Tanggal kembali wajib diisi', 'error'); return; }

  try {
    const res = await apiFetch('peminjaman', {
      method: 'POST',
      body: {
        aset_id:       parseInt(asetId),
        nama_peminjam: namaPeminjam,
        nip, jabatan, keperluan,
        tgl_pinjam:    tglPinjam,
        tgl_kembali:   tglKembali,
        catatan,
      },
    });
    showToast(res.message, 'success');
    closeModal('modal-tambah-pinjam');
    modal.querySelectorAll('.form-input, .form-select').forEach(el => el.value = '');
    modal.querySelectorAll('textarea').forEach(el => el.value = '');
    loadPeminjaman(currentBorrowFilter);
    loadDashboard();
  } catch (e) {}
}

// ============ KATEGORI & LOKASI ============
let katCache = [];
let lokCache = [];

async function loadKategoriLokasi() {
  try {
    const [katRes, lokRes] = await Promise.all([
      apiFetch('kategori'),
      apiFetch('lokasi'),
    ]);
    katCache = katRes.data;
    lokCache = lokRes.data;
    renderKategori(katCache);
    renderLokasi(lokCache);
    // Update dropdown filter & form
    populateSelects();
  } catch (e) {}
}

function renderKategori(data) {
  document.getElementById('kategoriList').innerHTML = data.map(k => `
    <div class="card" style="padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
      <div style="width:38px;height:38px;border-radius:10px;background:${k.color || 'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${k.icon || '📁'}</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;color:var(--text);">${k.nama}</div>
        <div style="font-size:11px;color:var(--text3);">${k.jumlah} unit aset</div>
      </div>
      <div style="display:flex;gap:5px;">
        <button onclick="showToast('Edit kategori: ${k.nama}','success')" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-family:inherit;">Edit</button>
        <button onclick="hapusKategori(${k.id})" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid #F5C0C0;background:var(--red-bg);color:var(--red);cursor:pointer;font-family:inherit;">Hapus</button>
      </div>
    </div>`).join('');
}

function renderLokasi(data) {
  document.getElementById('lokasiList').innerHTML = data.map(l => `
    <div class="card" style="padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
      <div style="font-size:20px;width:38px;text-align:center;">${l.icon || '📍'}</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;color:var(--text);">${l.nama}</div>
        <div style="font-size:11px;color:var(--text3);">${l.jumlah} unit aset${l.gedung_lantai ? ' · ' + l.gedung_lantai : ''}</div>
      </div>
      <div style="display:flex;gap:5px;">
        <button onclick="showToast('Edit lokasi: ${l.nama}','success')" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-family:inherit;">Edit</button>
        <button onclick="hapusLokasi(${l.id})" style="padding:4px 9px;border-radius:6px;font-size:11px;border:1px solid #F5C0C0;background:var(--red-bg);color:var(--red);cursor:pointer;font-family:inherit;">Hapus</button>
      </div>
    </div>`).join('');
}

async function hapusKategori(id) {
  if (!confirm('Yakin ingin menghapus kategori ini?')) return;
  try {
    const res = await apiFetch('kategori', { method: 'DELETE', params: { id } });
    showToast(res.message, 'success');
    loadKategoriLokasi();
  } catch (e) {}
}

async function hapusLokasi(id) {
  if (!confirm('Yakin ingin menghapus lokasi ini?')) return;
  try {
    const res = await apiFetch('lokasi', { method: 'DELETE', params: { id } });
    showToast(res.message, 'success');
    loadKategoriLokasi();
  } catch (e) {}
}

async function tambahKategori() {
  const nama = document.getElementById('newKatName')?.value?.trim();
  const desc = document.querySelector('#modal-tambah-kategori textarea')?.value || '';
  if (!nama) { showToast('Nama kategori tidak boleh kosong', 'error'); return; }
  try {
    const res = await apiFetch('kategori', { method: 'POST', body: { nama, deskripsi: desc } });
    showToast(`Kategori "${nama}" ditambahkan`, 'success');
    document.getElementById('newKatName').value = '';
    document.querySelector('#modal-tambah-kategori textarea').value = '';
    closeModal('modal-tambah-kategori');
    loadKategoriLokasi();
  } catch (e) {}
}

async function tambahLokasi() {
  const modal   = document.querySelector('#modal-tambah-lokasi');
  const nama    = document.getElementById('newLokName')?.value?.trim();
  const gedung  = modal.querySelectorAll('.form-input')[1]?.value || '';
  const kapasitas = modal.querySelector('input[type="number"]')?.value || 0;
  if (!nama) { showToast('Nama lokasi tidak boleh kosong', 'error'); return; }
  try {
    const res = await apiFetch('lokasi', { method: 'POST', body: { nama, gedung_lantai: gedung, kapasitas } });
    showToast(`Lokasi "${nama}" ditambahkan`, 'success');
    closeModal('modal-tambah-lokasi');
    modal.querySelectorAll('.form-input').forEach(el => el.value = '');
    loadKategoriLokasi();
  } catch (e) {}
}

// ============ POPULATE SELECT DROPDOWNS ============
function populateSelects() {
  // Filter bar aset — pakai nama kategori/lokasi sebagai value
  const asetKat = document.getElementById('asetKat');
  const asetLok = document.getElementById('asetLok');
  if (asetKat) {
    const val = asetKat.value;
    asetKat.innerHTML = '<option value="">Semua Kategori</option>' +
      katCache.map(k => `<option value="${k.nama}">${k.nama}</option>`).join('');
    asetKat.value = val;
  }
  if (asetLok) {
    const val = asetLok.value;
    asetLok.innerHTML = '<option value="">Semua Lokasi</option>' +
      lokCache.map(l => `<option value="${l.nama}">${l.nama}</option>`).join('');
    asetLok.value = val;
  }

  // Modal tambah aset — pakai name attribute, value = ID
  const modalKatSel = document.querySelector('#modal-tambah-aset [name="kategori_id"]');
  if (modalKatSel) {
    modalKatSel.innerHTML = '<option value="">Pilih Kategori</option>' +
      katCache.map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
  }
  const modalLokSel = document.querySelector('#modal-tambah-aset [name="lokasi_id"]');
  if (modalLokSel) {
    modalLokSel.innerHTML = '<option value="">Pilih Lokasi</option>' +
      lokCache.map(l => `<option value="${l.id}">${l.nama}</option>`).join('');
  }

  // Modal tambah peminjaman — aset select
  const modalAsetSel = document.querySelector('#modal-tambah-pinjam [name="aset_id"]');
  if (modalAsetSel && !modalAsetSel.getAttribute('data-loaded')) {
    loadAsetForSelect(modalAsetSel);
  }
}

async function loadAsetForSelect(selectEl) {
  try {
    const res = await apiFetch('aset', { params: { per_page: 200 } });
    selectEl.innerHTML = '<option value="">Pilih Aset</option>' +
      res.data.map(a => `<option value="${a.id}">${a.kode} · ${a.nama}</option>`).join('');
    selectEl.setAttribute('data-loaded', '1');
  } catch (e) {}
}

// ============ CHART LAPORAN ============
function renderLaporanChart() {
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
  const vals = [12,8,15,20,18,25,30,22,28,35,24,30];
  const max = Math.max(...vals);
  const el = document.getElementById('laporanChart');
  if (!el) return;
  el.innerHTML = months.map((m, i) => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="flex:1;display:flex;align-items:flex-end;width:100%;justify-content:center;">
        <div style="width:28px;height:${(vals[i]/max)*140}px;background:linear-gradient(to top,#1A4F8A,#3A7BD5);border-radius:4px 4px 0 0;transition:height .5s;" title="${m}: ${vals[i]} transaksi"></div>
      </div>
      <div style="font-size:10px;color:var(--text3);">${m}</div>
    </div>`).join('');
}

// ============ MODAL ============
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });
});

// ============ TOAST ============
let toastTimer;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.className = 'toast ' + (type || 'success');
  document.getElementById('toastMsg').textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  // Load kategori & lokasi dulu (untuk populate dropdown)
  await loadKategoriLokasi();
  // Load dashboard
  loadDashboard();
  renderLaporanChart();
});
