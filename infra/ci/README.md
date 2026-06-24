# NetForge — CI/CD (GitHub Actions)

Workflow di sini berada di area `infra/` (kepemilikan db-devops-architect).
GitHub Actions hanya membaca workflow dari `.github/workflows/` di root repo,
jadi **orchestrator** menyalin / membuat symlink file ini ke sana saat integrasi:

```
.github/workflows/backend.yml   ->  infra/ci/backend.yml
.github/workflows/frontend.yml  ->  infra/ci/frontend.yml
.github/workflows/images.yml    ->  infra/ci/images.yml
```

## Workflow

| File           | Trigger                         | Isi |
|----------------|----------------------------------|-----|
| `backend.yml`  | push/PR pada `backend/**`, `infra/db/**` | service Postgres+Redis, apply migrasi `0001`, lint (ruff), `pytest` |
| `frontend.yml` | push/PR pada `frontend/**`      | `npm ci`, `npm run lint`, `typecheck`, `build` |
| `images.yml`   | push `main` / tag `v*`          | buildx multi-arch (amd64+arm64) backend & frontend → push GHCR |

## Catatan

- `backend.yml` menjalankan migrasi DB nyata sebelum test → menangkap drift
  schema/model lebih awal (test integrasi hit Postgres asli, bukan mock).
- `images.yml` butuh `packages: write` untuk push ke `ghcr.io`. Tag image
  mengikuti branch, semver (dari git tag), dan short-SHA.
- Endpoint healthcheck backend diasumsikan `GET /api/health`. Bila backend
  memakai path lain, sesuaikan healthcheck di Dockerfile & compose.
