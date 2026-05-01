<?php
// =====================================================
// config.php — Konfigurasi Koneksi Database
// Letakkan file ini di folder yang sama dengan api.php
// =====================================================

// Matikan display error agar tidak mencemari JSON output
error_reporting(0);
ini_set('display_errors', '0');

// Buffer output — tangkap semua output tak terduga sebelum JSON dikirim
ob_start();

define('DB_HOST', 'localhost');
define('DB_USER', 'root');       // default XAMPP
define('DB_PASS', '');           // default XAMPP (kosong)
define('DB_NAME', 'sdit_aset');
define('DB_CHARSET', 'utf8mb4');

// Aktifkan CORS untuk akses dari file HTML lokal
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    ob_end_clean();
    http_response_code(200);
    exit();
}

// Buat koneksi MySQLi
function getDB(): mysqli {
    static $conn = null;
    if ($conn === null) {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
        $conn->set_charset(DB_CHARSET);
        if ($conn->connect_error) {
            ob_end_clean();
            http_response_code(500);
            echo json_encode(['error' => 'Koneksi database gagal: ' . $conn->connect_error]);
            exit();
        }
    }
    return $conn;
}

// Helper: kirim JSON response (buang buffer dulu)
function sendJSON($data, int $code = 200): void {
    ob_end_clean();
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}

// Helper: kirim error
function sendError(string $msg, int $code = 400): void {
    sendJSON(['success' => false, 'error' => $msg], $code);
}
