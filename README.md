# Folio PDF Reader

Aplikasi PDF Reader offline-first dengan pengalaman membalik halaman buku menggunakan **StPageFlip**. PDF dirender oleh **Mozilla PDF.js**, lalu setiap halaman ditempatkan sebagai lembar HTML pada mesin flip 3D. Proyek memakai React + Vite dan dapat dikemas menjadi aplikasi Android menggunakan Capacitor.

## Fitur yang sudah disiapkan

- Impor beberapa PDF dari perangkat.
- Koleksi dokumen tersimpan lokal melalui IndexedDB, termasuk file PDF aslinya.
- Recently opened, pencarian nama dokumen, metadata ukuran/jumlah halaman, dan posisi baca terakhir.
- Real page-curl engine: drag sudut, swipe, bayangan, lipatan, dan gesture sentuh melalui StPageFlip.
- Mode satu halaman / buku terbuka yang menyesuaikan ukuran layar.
- Navigasi sebelumnya/berikutnya, input nomor halaman, dan slider progres.
- Render PDF bertahap: halaman aktif dan beberapa halaman di sekitarnya diprioritaskan; kanvas halaman lain dibuat saat diperlukan.
- Zoom, rotasi tampilan, kecerahan, tema paper/sepia/dark, dan fullscreen.
- Pencarian teks dalam dokumen, pemilihan teks, bookmark, sorotan, catatan, dan daftar isi PDF jika tersedia.
- Offline: worker PDF.js dibundel di aplikasi; file PDF dan anotasi disimpan di IndexedDB. Service worker untuk app shell hanya dijalankan pada web HTTPS. Build Capacitor tidak memakai service worker.
- Tutorial penggunaan pertama.

## Teknologi

| Bagian | Teknologi |
|---|---|
| UI | React 18 + TypeScript |
| Build | Vite 6 |
| PDF parsing/rendering | PDF.js (`pdfjs-dist`) |
| Realistic page turn | StPageFlip (`page-flip` 2.0.7) |
| Android packaging | Capacitor 8 |
| Penyimpanan lokal | IndexedDB |

## Menjalankan versi web

Persyaratan: Node.js 22 atau lebih baru dan npm.

```bash
npm install
npm run dev
```

Untuk build web:

```bash
npm run build
npm run preview
```

Hasil build web ada di folder `dist/`.

## Membuat aplikasi Android

Persyaratan: Node.js 22+, Android Studio, Android SDK, dan Java 21 (Android Studio menyediakan JDK yang sesuai).

```bash
npm install
npm run build
npm run android:init
npx cap sync android
npm run android:open
```

Di Android Studio, pilih perangkat/emulator lalu jalankan konfigurasi `app`.

Untuk membangun APK debug melalui terminal:

```bash
npm run android:debug
```

APK lokal akan berada di:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Mengirim ke GitHub

1. Buat repository baru di GitHub.
2. Ekstrak ZIP proyek ini.
3. Buka terminal pada folder `flipbook-pdf-reader`.
4. Jalankan:

```bash
git init
git add .
git commit -m "Initial Folio PDF Reader app"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Ganti `USERNAME/REPOSITORY` dengan alamat repository milikmu. Setelah push, workflow **Build Android APK** berjalan otomatis. APK debug akan tersedia di tab **Actions → workflow run → Artifacts**.

Workflow membangkitkan folder Android dari konfigurasi Capacitor saat CI berjalan. Bila ingin mengubah kode native di Android Studio, jalankan `npm run android:init` dan commit folder `android/` ke repository.

## Catatan teknis dan batas yang perlu diuji

- StPageFlip dipakai sebagai mesin lipatan fisik: bukan efek fade/slide buatan. Versi npm yang digunakan adalah 2.0.7 dan proyek upstream tidak aktif merilis versi baru dalam beberapa tahun. Mesin tersebut diisolasi di `src/components/BookReader.tsx` agar penggantian di masa depan tidak memengaruhi modul PDF dan penyimpanan.
- Isi PDF ditampilkan sebagai canvas agar tampilan visual tetap dekat dengan dokumen asli. Lapisan teks transparan di atas canvas memungkinkan seleksi dan pencarian teks. Sorotan disimpan berdasarkan teks yang dipilih pada halaman; karena PDF tidak memiliki satu standar koordinat teks yang konsisten untuk semua dokumen, penempatan sorotan kompleks pada PDF dengan tata letak rumit tetap perlu pengujian perangkat nyata.
- Rendering kanvas bersifat lazy untuk menghemat memori, tetapi PDF.js tetap perlu membaca data file ketika dokumen dibuka. File sangat besar atau PDF dengan gambar beresolusi ekstrem perlu diuji pada perangkat dengan RAM rendah.
- Halaman kosong tetap menjadi lembar yang dapat dibalik. PDF rusak akan ditangani saat impor/pembukaan dan ditampilkan sebagai pesan kesalahan, bukan membuat aplikasi menutup paksa.
- Pencarian membaca teks halaman satu per satu. Pada dokumen ratusan halaman, pencarian pertama dapat memerlukan waktu lebih lama.
- Workflow GitHub menghasilkan **debug APK**, bukan APK release yang ditandatangani. Untuk distribusi publik, buat signing key sendiri dan siapkan konfigurasi release yang aman.
- Pengujian fisik Android belum dapat dijalankan dari lingkungan penyusunan ini karena Android SDK/Android Studio dan perangkat Android tidak tersedia di sini. Workflow CI disediakan agar proses native build dapat dijalankan pada runner GitHub.

## Lisensi

Kode aplikasi ini disediakan dengan lisensi MIT. Periksa lisensi masing-masing dependency sebelum mendistribusikan build.
