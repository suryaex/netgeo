# NetGeo — Migrasi Database (LEGACY)

> ⚠️ **LEGACY / DIBEKUKAN.** Tree ini (`infra/db/migrations/` + `infra/db/schema.sql`)
> adalah model "topologi sederhana" `MASTER_SPEC §4` (`app_user`, `project`,
> `node`, `iface`, `link`, ...). Tree **otoritatif** sekarang ada di
> **`infra/db/postgres/migrations/`** (skema NetGeo Enterprise per
> `NetGeo/08_DATABASE_AND_ERD.md`). Lihat **`infra/db/README.md`** untuk
> keputusan rekonsiliasi dan cara menjalankan.
>
> Tree ini hanya dipertahankan karena `backend/app/store/postgres.py` +
> `app/models/schemas.py` masih menargetkan nama tabel/kolom legacy ini. Jangan
> mencampur kedua tree dalam satu database.

Migrasi SQL bernomor (gaya `dbmate` / `migrate` / `sqitch`), tanpa lock-in ORM.
Backend FastAPI boleh menjalankannya lewat runner pilihan atau langsung `psql`.

## Konvensi penamaan

```
NNNN_<deskripsi>.up.sql     # menerapkan perubahan
NNNN_<deskripsi>.down.sql   # membatalkan (rollback)
```

`NNNN` = nomor urut 4 digit, monoton naik. Setiap `.up` WAJIB punya `.down`
yang reversibel. Migrasi destruktif (drop kolom/tabel) harus didahului langkah
backup atau pola **expand-contract** (lihat di bawah).

## Daftar migrasi

| No   | File                | Isi                                                        |
|------|---------------------|------------------------------------------------------------|
| 0001 | `0001_init`         | Skema awal: enum, helper, app_user, project, node, iface, link, scenario, config_artifact, simulation_run, view |

## Cara menjalankan

### Lewat psql (paling sederhana)

```bash
# UP
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0001_init.up.sql

# DOWN (rollback — DESTRUKTIF)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0001_init.down.sql
```

### Lewat dbmate (rekomendasi CI)

```bash
export DATABASE_URL="postgres://netgeo:secret@localhost:5432/netgeo?sslmode=disable"
dbmate --migrations-dir ./ up
dbmate --migrations-dir ./ rollback
```

### Otomatis di startup container

Compose memuat `schema.sql` ke `docker-entrypoint-initdb.d` saat volume kosong
(bootstrap pertama). Untuk database yang sudah ada, jalankan migrasi via job
terpisah (lihat `infra/ci/` dan target `migrate` di README utama infra).

## Pola expand-contract (zero-downtime)

Untuk perubahan skema di prod tanpa downtime:

1. **Expand** — tambah kolom/tabel baru (nullable / default), deploy kode yang
   menulis ke dua tempat.
2. **Backfill** — isi data lama secara bertahap (batched UPDATE).
3. **Contract** — setelah semua kode membaca kolom baru, drop kolom lama di
   migrasi terpisah bernomor lebih tinggi.

Jangan pernah menggabungkan expand & contract dalam satu migrasi yang sama.
