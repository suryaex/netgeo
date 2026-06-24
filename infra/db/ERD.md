# NetForge — Entity-Relationship Diagram

Diagram relasi entitas lapisan data NetForge, mengacu pada `schema.sql` dan
MASTER_SPEC §4. Notasi Mermaid (`erDiagram`) + ringkasan kardinalitas as-text.

## Diagram (Mermaid)

```mermaid
erDiagram
    APP_USER ||--o{ PROJECT          : owns
    APP_USER ||--o{ PROJECT_MEMBER   : "member of"
    PROJECT  ||--o{ PROJECT_MEMBER   : has
    PROJECT  ||--o{ NODE             : contains
    PROJECT  ||--o{ LINK             : contains
    PROJECT  ||--o{ SCENARIO         : has
    PROJECT  ||--o{ SIMULATION_RUN   : has
    NODE     ||--o{ IFACE            : exposes
    NODE     ||--o{ CONFIG_ARTIFACT  : "generates (history)"
    NODE     }o--o| CONFIG_ARTIFACT  : "active config_ref"
    IFACE    }o--o| LINK             : "peer_link_id"
    LINK     }o--|| IFACE            : a_iface
    LINK     }o--|| IFACE            : b_iface
    SCENARIO ||--o{ SIMULATION_RUN   : "may target"

    APP_USER {
        uuid id PK
        citext username UK
        citext email UK
        text password_hash
        jsonb preferences
    }
    PROJECT {
        uuid id PK
        uuid owner_id FK
        text name
        int version "optimistic lock"
        jsonb topology_ref
    }
    PROJECT_MEMBER {
        uuid project_id PK,FK
        uuid user_id PK,FK
        user_role role
    }
    NODE {
        uuid id PK
        uuid project_id FK
        text name
        node_kind kind
        nos_kind nos
        node_mode mode
        double x
        double y
        node_status status
        uuid config_ref FK
        jsonb attributes
    }
    IFACE {
        uuid id PK
        uuid node_id FK
        text name
        iface_type type
        inet_array ip
        macaddr mac
        bigint speed_mbps
        int mtu
        uuid peer_link_id FK
    }
    LINK {
        uuid id PK
        uuid project_id FK
        uuid a_iface FK
        uuid b_iface FK
        link_type type
        bigint bandwidth_mbps
        double delay_ms
        double loss_pct
        int mtu
    }
    SCENARIO {
        uuid id PK
        uuid project_id FK
        text name
        jsonb steps
        jsonb expected_outcomes
    }
    CONFIG_ARTIFACT {
        uuid id PK
        uuid node_id FK
        nos_kind vendor
        config_format format
        jsonb source_intent
        text content
        int version
        bool is_active
    }
    SIMULATION_RUN {
        uuid id PK
        uuid project_id FK
        uuid scenario_id FK
        uuid triggered_by FK
        text status
        jsonb result
    }
```

## Kardinalitas (as-text)

- **APP_USER 1 — N PROJECT** — satu user memiliki banyak project (`project.owner_id`).
  `ON DELETE RESTRICT`: user tak bisa dihapus jika masih punya project.
- **PROJECT N — M APP_USER** via **PROJECT_MEMBER** — kolaborasi multi-user
  dengan RBAC per-project (`role`).
- **PROJECT 1 — N NODE / LINK / SCENARIO / SIMULATION_RUN** — semuanya cascade
  saat project dihapus.
- **NODE 1 — N IFACE** — node mengekspos banyak interface (`§4 interfaces[]`).
- **IFACE 2 — 1 LINK** — sebuah link point-to-point menghubungkan tepat dua
  interface (`a_iface`, `b_iface`), constraint `a_iface <> b_iface` + UNIQUE pair.
- **IFACE 1 — 0..1 LINK** (`peer_link_id`) — pointer balik dari interface ke
  link yang terpasang; `ON DELETE SET NULL` saat link dihapus (jadi unwired).
- **NODE 1 — N CONFIG_ARTIFACT** — riwayat append-only config. Tepat satu yang
  `is_active` (partial unique index) dan dirujuk `node.config_ref` (0..1).
- **SCENARIO 1 — N SIMULATION_RUN** — satu skenario bisa dieksekusi berkali-kali.

## Catatan integritas penting

1. **Dua FK siklik** sengaja dibuat dan ditutup setelah kedua tabel ada:
   - `iface.peer_link_id → link.id` (SET NULL)
   - `node.config_ref → config_artifact.id` (SET NULL)
   Backend harus membuat baris induk dulu, lalu meng-`UPDATE` pointer.
2. **Versioning**: `project.version` adalah optimistic-lock counter (naik tiap
   mutasi topologi). `config_artifact` versioning lewat `version` + append-only.
3. **JSONB** dipakai untuk data yang berevolusi: `topology_ref`, `attributes`,
   `steps`, `expected_outcomes`, `source_intent`, `result`. Di-index GIN bila
   sering dikueri.
