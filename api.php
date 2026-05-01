<?php
// =====================================================
// api.php — REST API Sistem Manajemen Aset SDIT Aya Sophia
// Letakkan file ini di: C:\xampp\htdocs\sdit-aset\api.php
// Akses via: http://localhost/sdit-aset/api.php?resource=...
// =====================================================

require_once 'config.php';

$resource = $_GET['resource'] ?? '';
$method   = $_SERVER['REQUEST_METHOD'];
$body     = json_decode(file_get_contents('php://input'), true) ?? [];

// =====================================================
// ROUTER
// =====================================================
switch ($resource) {

    // ---------- DASHBOARD ----------
    case 'dashboard':
        handleDashboard($method);
        break;

    // ---------- ASET ----------
    case 'aset':
        handleAset($method, $body);
        break;

    // ---------- PEMINJAMAN ----------
    case 'peminjaman':
        handlePeminjaman($method, $body);
        break;

    // ---------- KATEGORI ----------
    case 'kategori':
        handleKategori($method, $body);
        break;

    // ---------- LOKASI ----------
    case 'lokasi':
        handleLokasi($method, $body);
        break;

    default:
        sendError('Resource tidak ditemukan. Gunakan: dashboard, aset, peminjaman, kategori, lokasi', 404);
}

// =====================================================
// DASHBOARD
// =====================================================
function handleDashboard(string $method): void {
    if ($method !== 'GET') sendError('Method tidak diizinkan', 405);
    $db = getDB();

    // Statistik utama
    $stats = $db->query("SELECT * FROM v_dashboard_stats")->fetch_assoc();

    // Distribusi per kategori (untuk chart)
    $katRows = $db->query("SELECT * FROM v_kategori_distribusi ORDER BY jumlah DESC");
    $kategori = [];
    while ($r = $katRows->fetch_assoc()) $kategori[] = $r;

    // Kondisi per kategori (untuk progress bar)
    $kondisi = [];
    foreach ($kategori as $k) {
        if ($k['jumlah'] > 0) {
            $kondisi[] = [
                'nama'        => $k['nama'],
                'persen_baik' => (float)$k['persen_baik'],
            ];
        }
    }

    // Aset yang perlu perhatian (kondisi Perawatan/Rusak)
    $perhatianRows = $db->query("
        SELECT a.id, a.kode, a.nama, k.nama AS kategori, l.nama AS lokasi, a.kondisi
        FROM aset a
        LEFT JOIN kategori k ON a.kategori_id = k.id
        LEFT JOIN lokasi l ON a.lokasi_id = l.id
        WHERE a.kondisi IN ('Perawatan','Rusak')
        ORDER BY FIELD(a.kondisi,'Rusak','Perawatan')
        LIMIT 5
    ");
    $perhatian = [];
    while ($r = $perhatianRows->fetch_assoc()) $perhatian[] = $r;

    // Aktivitas terbaru — gabungkan aset terbaru + peminjaman terbaru
    $aktRows = $db->query("
        (SELECT 'aset' AS tipe, a.nama AS label, CONCAT('Aset baru: ', k.nama) AS sub, a.created_at AS waktu
         FROM aset a LEFT JOIN kategori k ON a.kategori_id = k.id ORDER BY a.created_at DESC LIMIT 3)
        UNION ALL
        (SELECT 'pinjam' AS tipe, a.nama AS label, CONCAT(p.nama_peminjam, ' · ', p.jabatan) AS sub, p.created_at AS waktu
         FROM peminjaman p JOIN aset a ON p.aset_id = a.id ORDER BY p.created_at DESC LIMIT 3)
        ORDER BY waktu DESC LIMIT 5
    ");
    $aktivitas = [];
    while ($r = $aktRows->fetch_assoc()) $aktivitas[] = $r;

    // Total nilai aset
    $nilaiRow = $db->query("SELECT IFNULL(SUM(nilai),0) AS total FROM aset")->fetch_assoc();

    sendJSON([
        'success'   => true,
        'stats'     => $stats,
        'kategori'  => $kategori,
        'kondisi'   => $kondisi,
        'perhatian' => $perhatian,
        'aktivitas' => $aktivitas,
        'total_nilai' => (int)$nilaiRow['total'],
    ]);
}

// =====================================================
// ASET
// =====================================================
function handleAset(string $method, array $body): void {
    $db = getDB();
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    if ($method === 'GET') {
        if ($id > 0) {
            // Detail satu aset
            $stmt = $db->prepare("
                SELECT a.*, k.nama AS kategori_nama, l.nama AS lokasi_nama
                FROM aset a
                LEFT JOIN kategori k ON a.kategori_id = k.id
                LEFT JOIN lokasi l ON a.lokasi_id = l.id
                WHERE a.id = ?
            ");
            $stmt->bind_param('i', $id);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            if (!$row) sendError('Aset tidak ditemukan', 404);
            sendJSON(['success' => true, 'data' => $row]);
        }

        // Daftar aset dengan filter & pagination
        $where  = ['1=1'];
        $params = [];
        $types  = '';

        if (!empty($_GET['q'])) {
            $q = '%' . $_GET['q'] . '%';
            $where[] = '(a.nama LIKE ? OR a.kode LIKE ? OR l.nama LIKE ?)';
            $params = array_merge($params, [$q, $q, $q]);
            $types .= 'sss';
        }
        if (!empty($_GET['kategori_id'])) {
            $where[] = 'a.kategori_id = ?';
            $params[] = (int)$_GET['kategori_id'];
            $types .= 'i';
        }
        if (!empty($_GET['lokasi_id'])) {
            $where[] = 'a.lokasi_id = ?';
            $params[] = (int)$_GET['lokasi_id'];
            $types .= 'i';
        }
        if (!empty($_GET['kondisi'])) {
            $where[] = 'a.kondisi = ?';
            $params[] = $_GET['kondisi'];
            $types .= 's';
        }

        $whereSQL = implode(' AND ', $where);

        // Hitung total
        $countSQL = "SELECT COUNT(*) AS total FROM aset a LEFT JOIN lokasi l ON a.lokasi_id = l.id WHERE $whereSQL";
        if ($params) {
            $stmt = $db->prepare($countSQL);
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $total = $stmt->get_result()->fetch_assoc()['total'];
        } else {
            $total = $db->query($countSQL)->fetch_assoc()['total'];
        }

        // Ambil data dengan pagination
        $page    = max(1, (int)($_GET['page'] ?? 1));
        $perPage = max(1, (int)($_GET['per_page'] ?? 8));
        $offset  = ($page - 1) * $perPage;

        $sort = match($_GET['sort'] ?? '') {
            'nama'  => 'a.nama ASC',
            'nilai' => 'a.nilai DESC',
            'terbaru' => 'a.created_at DESC',
            default => 'a.kode ASC',
        };

        $dataSQL = "
            SELECT a.id, a.kode, a.nama, a.kondisi, a.nilai, a.tgl_masuk,
                   k.nama AS kategori_nama, k.id AS kategori_id,
                   l.nama AS lokasi_nama, l.id AS lokasi_id
            FROM aset a
            LEFT JOIN kategori k ON a.kategori_id = k.id
            LEFT JOIN lokasi l ON a.lokasi_id = l.id
            WHERE $whereSQL
            ORDER BY $sort
            LIMIT $perPage OFFSET $offset
        ";

        if ($params) {
            $stmt = $db->prepare($dataSQL);
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $rows = $stmt->get_result();
        } else {
            $rows = $db->query($dataSQL);
        }

        $data = [];
        while ($r = $rows->fetch_assoc()) $data[] = $r;

        sendJSON([
            'success'    => true,
            'data'       => $data,
            'total'      => (int)$total,
            'page'       => $page,
            'per_page'   => $perPage,
            'total_pages' => ceil($total / $perPage),
        ]);
    }

    if ($method === 'POST') {
        // Validasi wajib
        $required = ['nama', 'kategori_id', 'lokasi_id', 'tgl_masuk'];
        foreach ($required as $f) {
            if (empty($body[$f])) sendError("Field '$f' wajib diisi");
        }

        // Generate kode aset otomatis
        $maxKode = $db->query("SELECT MAX(CAST(SUBSTRING(kode,5) AS UNSIGNED)) AS mx FROM aset WHERE kode LIKE 'AST-%'")->fetch_assoc()['mx'];
        $kode = 'AST-' . str_pad(($maxKode + 1), 4, '0', STR_PAD_LEFT);

        $stmt = $db->prepare("
            INSERT INTO aset (kode, nama, kategori_id, lokasi_id, kondisi, nilai, sumber_dana, keterangan, tgl_masuk)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $kondisi     = $body['kondisi']     ?? 'Baik';
        $nilai       = (int)($body['nilai'] ?? 0);
        $sumberDana  = $body['sumber_dana'] ?? 'BOS';
        $keterangan  = $body['keterangan']  ?? '';
        $katId       = (int)$body['kategori_id'];
        $lokId       = (int)$body['lokasi_id'];
        $stmt->bind_param('ssiisisss',
            $kode, $body['nama'], $katId, $lokId,
            $kondisi, $nilai, $sumberDana, $keterangan, $body['tgl_masuk']
        );
        if (!$stmt->execute()) sendError('Gagal menyimpan aset: ' . $stmt->error);

        sendJSON(['success' => true, 'message' => 'Aset berhasil disimpan', 'kode' => $kode, 'id' => $db->insert_id], 201);
    }

    if ($method === 'PUT') {
        if (!$id) sendError('ID aset diperlukan');
        $nilai = (int)($body['nilai'] ?? 0);
        $stmt = $db->prepare("
            UPDATE aset SET nama=?, kategori_id=?, lokasi_id=?, kondisi=?, nilai=?, sumber_dana=?, keterangan=?, tgl_masuk=?
            WHERE id=?
        ");
        $stmt->bind_param('siisisssi',
            $body['nama'], (int)$body['kategori_id'], (int)$body['lokasi_id'],
            $body['kondisi'], $nilai, $body['sumber_dana'] ?? 'BOS', $body['keterangan'] ?? '',
            $body['tgl_masuk'], $id
        );
        if (!$stmt->execute()) sendError('Gagal update aset: ' . $stmt->error);
        sendJSON(['success' => true, 'message' => 'Aset berhasil diperbarui']);
    }

    if ($method === 'DELETE') {
        if (!$id) sendError('ID aset diperlukan');
        $stmt = $db->prepare("DELETE FROM aset WHERE id=?");
        $stmt->bind_param('i', $id);
        if (!$stmt->execute()) sendError('Gagal menghapus aset');
        sendJSON(['success' => true, 'message' => 'Aset berhasil dihapus']);
    }
}

// =====================================================
// PEMINJAMAN
// =====================================================
function handlePeminjaman(string $method, array $body): void {
    $db = getDB();
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    // Auto-update status jatuh tempo
    $db->query("UPDATE peminjaman SET status='Jatuh Tempo' WHERE tgl_kembali < CURDATE() AND status='Aktif'");

    if ($method === 'GET') {
        $where  = ['1=1'];
        $params = [];
        $types  = '';

        if (!empty($_GET['status']) && $_GET['status'] !== 'semua') {
            $statusMap = ['aktif'=>'Aktif','jatuh'=>'Jatuh Tempo','selesai'=>'Selesai'];
            $s = $statusMap[$_GET['status']] ?? $_GET['status'];
            $where[] = 'p.status = ?';
            $params[] = $s;
            $types .= 's';
        }
        if (!empty($_GET['q'])) {
            $q = '%' . $_GET['q'] . '%';
            $where[] = '(a.nama LIKE ? OR p.nama_peminjam LIKE ?)';
            $params = array_merge($params, [$q, $q]);
            $types .= 'ss';
        }

        $whereSQL = implode(' AND ', $where);
        $dataSQL = "
            SELECT p.id, p.nama_peminjam, p.nip, p.jabatan, p.keperluan,
                   p.tgl_pinjam, p.tgl_kembali, p.tgl_dikembalikan, p.status, p.catatan,
                   a.id AS aset_id, a.nama AS aset_nama, a.kode AS aset_kode
            FROM peminjaman p
            JOIN aset a ON p.aset_id = a.id
            WHERE $whereSQL
            ORDER BY p.created_at ASC
        ";

        if ($params) {
            $stmt = $db->prepare($dataSQL);
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $rows = $stmt->get_result();
        } else {
            $rows = $db->query($dataSQL);
        }

        $data = [];
        while ($r = $rows->fetch_assoc()) $data[] = $r;

        // Hitung tab counts
        $counts = $db->query("
            SELECT
              COUNT(*) AS semua,
              SUM(status='Aktif') AS aktif,
              SUM(status='Jatuh Tempo') AS jatuh_tempo,
              SUM(status='Selesai') AS selesai
            FROM peminjaman
        ")->fetch_assoc();

        sendJSON(['success' => true, 'data' => $data, 'counts' => $counts]);
    }

        if ($method === 'POST') {
            $required = ['aset_id', 'nama_peminjam', 'tgl_pinjam', 'tgl_kembali'];
            foreach ($required as $f) {
                if (empty($body[$f])) sendError("Field '$f' wajib diisi");
            }

            // --- PERBAIKAN: Assign ke variabel dulu sebelum bind_param ---
            $asetId     = (int)$body['aset_id'];
            $nama       = $body['nama_peminjam'];
            $nip        = $body['nip'] ?? '';
            $jabatan    = $body['jabatan'] ?? 'Guru';
            $keperluan  = $body['keperluan'] ?? '';
            $tglPinjam  = $body['tgl_pinjam'];
            $tglKembali = $body['tgl_kembali'];
            $catatan    = $body['catatan'] ?? '';

            $stmt = $db->prepare("
                INSERT INTO peminjaman (aset_id, nama_peminjam, nip, jabatan, keperluan, tgl_pinjam, tgl_kembali, status, catatan)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Aktif', ?)
            ");

            if (!$stmt) {
                sendError('Gagal menyiapkan query: ' . $db->error);
            }

            // Gunakan 'i' untuk integer (asetId) dan sisanya 's'
            $stmt->bind_param('isssssss', 
                $asetId, $nama, $nip, $jabatan, $keperluan, $tglPinjam, $tglKembali, $catatan
            );

            if (!$stmt->execute()) {
                sendError('Gagal menyimpan peminjaman: ' . $stmt->error);
            }

            sendJSON(['success' => true, 'message' => 'Peminjaman berhasil dicatat', 'id' => $db->insert_id], 201);
        }

    if ($method === 'PUT') {
        // Kembalikan aset
        if (!$id) sendError('ID peminjaman diperlukan');
        $aksi = $body['aksi'] ?? 'kembalikan';
        if ($aksi === 'kembalikan') {
            $stmt = $db->prepare("UPDATE peminjaman SET status='Selesai', tgl_dikembalikan=CURDATE() WHERE id=?");
            $stmt->bind_param('i', $id);
            if (!$stmt->execute()) sendError('Gagal update peminjaman');
            sendJSON(['success' => true, 'message' => 'Aset berhasil dikembalikan']);
        }
        sendError('Aksi tidak dikenali');
    }

    if ($method === 'DELETE') {
        if (!$id) sendError('ID peminjaman diperlukan');
        $stmt = $db->prepare("DELETE FROM peminjaman WHERE id=?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        sendJSON(['success' => true, 'message' => 'Data peminjaman dihapus']);
    }
}

// =====================================================
// KATEGORI
// =====================================================
function handleKategori(string $method, array $body): void {
    $db = getDB();
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    if ($method === 'GET') {
        $rows = $db->query("SELECT * FROM v_kategori_distribusi ORDER BY jumlah DESC");
        $data = [];
        while ($r = $rows->fetch_assoc()) $data[] = $r;
        sendJSON(['success' => true, 'data' => $data]);
    }

    if ($method === 'POST') {
        if (empty($body['nama'])) sendError('Nama kategori wajib diisi');
        $stmt = $db->prepare("INSERT INTO kategori (nama, deskripsi, icon, color, tcolor) VALUES (?,?,?,?,?)");
        $icon   = $body['icon']   ?? '📁';
        $color  = $body['color']  ?? 'var(--bg3)';
        $tcolor = $body['tcolor'] ?? 'var(--text)';
        $desc   = $body['deskripsi'] ?? '';
        $stmt->bind_param('sssss', $body['nama'], $desc, $icon, $color, $tcolor);
        if (!$stmt->execute()) sendError('Gagal menambah kategori');
        sendJSON(['success' => true, 'message' => 'Kategori ditambahkan', 'id' => $db->insert_id], 201);
    }

    if ($method === 'PUT') {
        if (!$id) sendError('ID diperlukan');
        $stmt = $db->prepare("UPDATE kategori SET nama=?, deskripsi=? WHERE id=?");
        $stmt->bind_param('ssi', $body['nama'], $body['deskripsi'] ?? '', $id);
        $stmt->execute();
        sendJSON(['success' => true, 'message' => 'Kategori diperbarui']);
    }

    if ($method === 'DELETE') {
        if (!$id) sendError('ID diperlukan');
        // Cek apakah ada aset di kategori ini
        $count = $db->query("SELECT COUNT(*) AS c FROM aset WHERE kategori_id=$id")->fetch_assoc()['c'];
        if ($count > 0) sendError("Tidak bisa dihapus: ada $count aset di kategori ini");
        $stmt = $db->prepare("DELETE FROM kategori WHERE id=?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        sendJSON(['success' => true, 'message' => 'Kategori dihapus']);
    }
}

// =====================================================
// LOKASI
// =====================================================
function handleLokasi(string $method, array $body): void {
    $db = getDB();
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    if ($method === 'GET') {
        $rows = $db->query("SELECT * FROM v_lokasi_distribusi ORDER BY jumlah DESC");
        $data = [];
        while ($r = $rows->fetch_assoc()) $data[] = $r;
        sendJSON(['success' => true, 'data' => $data]);
    }

    if ($method === 'POST') {
        if (empty($body['nama'])) sendError('Nama lokasi wajib diisi');
        $stmt = $db->prepare("INSERT INTO lokasi (nama, gedung_lantai, kapasitas, icon) VALUES (?,?,?,?)");
        $gedung   = $body['gedung_lantai'] ?? '';
        $kapasitas = (int)($body['kapasitas'] ?? 0);
        $icon      = $body['icon'] ?? '📍';
        $stmt->bind_param('ssis', $body['nama'], $gedung, $kapasitas, $icon);
        if (!$stmt->execute()) sendError('Gagal menambah lokasi');
        sendJSON(['success' => true, 'message' => 'Lokasi ditambahkan', 'id' => $db->insert_id], 201);
    }

    if ($method === 'PUT') {
        if (!$id) sendError('ID diperlukan');
        $stmt = $db->prepare("UPDATE lokasi SET nama=?, gedung_lantai=?, kapasitas=? WHERE id=?");
        $kap = (int)($body['kapasitas'] ?? 0);
        $stmt->bind_param('ssii', $body['nama'], $body['gedung_lantai'] ?? '', $kap, $id);
        $stmt->execute();
        sendJSON(['success' => true, 'message' => 'Lokasi diperbarui']);
    }

    if ($method === 'DELETE') {
        if (!$id) sendError('ID diperlukan');
        $count = $db->query("SELECT COUNT(*) AS c FROM aset WHERE lokasi_id=$id")->fetch_assoc()['c'];
        if ($count > 0) sendError("Tidak bisa dihapus: ada $count aset di lokasi ini");
        $stmt = $db->prepare("DELETE FROM lokasi WHERE id=?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        sendJSON(['success' => true, 'message' => 'Lokasi dihapus']);
    }
}
