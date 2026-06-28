<div align="center">

# NetGeo

**Next-generation large-scale network simulation, planning, GIS/digital-twin, and AI-assistant platform**

*The simplicity of Cisco Packet Tracer · the depth of GNS3/EVE-NG · telecom-grade RF and optical planning —*
*unified in a single cross-platform application built for engineers, researchers, and enterprises.*

[![CI](https://github.com/suryaex/netgeo/actions/workflows/backend.yml/badge.svg)](https://github.com/suryaex/netgeo/actions)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Python](https://img.shields.io/badge/python-3.13+-blue)
![React](https://img.shields.io/badge/react-18-61dafb)
![Status](https://img.shields.io/badge/status-alpha-orange)

</div>

---

## What is NetGeo?

NetGeo is a **next-generation large-scale network simulation platform** that combines:

- **Network Design and Simulation** — discrete-event simulation engine supporting L2/L3, MPLS, EVPN/VXLAN, BGP, OSPF, IS-IS, Segment Routing, QoS, and more
- **GIS Planning** — real-world geographic context with elevation, DEM, land use, building footprints, climate, and terrain-aware propagation models
- **Digital Twin** — live telemetry ingestion, streaming metrics, and what-if simulation against live infrastructure
- **AI Assistant** — MCP-compatible, provider-agnostic AI that designs topologies, generates vendor configs, detects faults, and optimizes routing
- **Telecom Validation** — end-to-end validation for fiber, wireless, optical, and IP/MPLS infrastructure from home networks to national backbone

One application. The complete network engineering lifecycle — from design, through simulation and validation, all the way to deployment planning, documentation, and monitoring integration.

---

## One-Command Install

**Linux**
```bash
curl -fsSL https://install.netgeo.io | bash
```

**Docker**
```bash
docker run netgeo/community
```

**Windows**
```
NetGeoSetup.exe
```

**macOS**
```bash
brew install netgeo
```

> NetGeo is designed to start in under 3 seconds and idle below 300 MB RAM, while remaining interactive with projects exceeding 100,000 simulated nodes.

---

## Platform Modules

### Workspace
Multi-project workspace with auto-save, version history, real-time team collaboration, offline mode, and cloud sync. Maximum three clicks to any primary feature.

### Simulation Engine
Full-stack discrete-event simulation (DES) supporting:

| Layer | Protocols |
|---|---|
| Layer 2 | Ethernet, 802.1Q VLAN, STP, LACP |
| Layer 3 | IPv4, IPv6, Static, RIP, OSPF, IS-IS, BGP |
| MPLS | LDP, RSVP-TE, Segment Routing, L3VPN, L2VPN |
| Overlay | EVPN, VXLAN, GRE, IPSec, PPPoE |
| Services | NAT, DHCP, DNS, QoS, Multicast |

Simulation parameters: latency, jitter, packet loss, queue depth, CPU/RAM consumption, and physical-layer impairments.

### Wireless Simulation
| Technology | Parameters |
|---|---|
| Wi-Fi 4/5/6/6E/7 | RSSI, SNR, noise floor, interference, channel plan |
| LTE / 5G NR | Coverage, capacity, handover, beamforming |
| Microwave | Fresnel zone, rain fade, path loss, terrain profile |
| LoRaWAN / ZigBee / BLE | Propagation, gateway planning |
| Satellite | Link budget, elevation angle, latency |

Terrain-aware: DEM elevation, vegetation loss, building attenuation, earth curvature, weather.

### Optical Network
- GPON and XGS-PON planning with fiber budget and splitter design
- OTN, DWDM, CWDM with channel plan and amplifier sizing
- OTDR simulation and fiber fault localization

### GIS Module
Online and offline maps with:
- Digital elevation model (DEM)
- Land use, building footprints, road and rail networks
- Population density, coastline, river data
- Climate and weather overlays
- Earth curvature correction for long-haul wireless and microwave links

### AI Assistant
- Design network topologies from natural-language intent
- Generate vendor-specific configurations automatically
- Detect misconfigurations, routing anomalies, and coverage gaps
- Optimize routing, capacity, and redundancy
- Generate technical documentation and reports
- Explain network concepts interactively

MCP-compatible. Provider-agnostic — works with any LLM backend.

### Device Library
| Category | Devices |
|---|---|
| Routing | Router, L3 Switch, Firewall |
| Switching | L2 Switch, Access Switch |
| Wireless | AP, Controller, BTS, Microwave |
| Optical | OLT, ONU, DWDM Transponder |
| Compute | Server, Client, IoT |
| WAN | SD-WAN CPE, Satellite Terminal |

All devices are data-driven and extensible via the plugin system.

### Vendor Support (Plugin Architecture)

| Tier | Vendors |
|---|---|
| Routing/Switching | MikroTik RouterOS, Cisco IOS/IOS-XE/NX-OS, Juniper JunOS, Arista EOS, Nokia SR OS |
| Enterprise/Campus | Ubiquiti, TP-Link Omada, Ruijie, Cambium, OpenWrt |
| Telecom | Ericsson, Huawei, ZTE, Nokia |
| Open | Linux Networking, FRRouting, VyOS |

Every vendor is implemented as a sandboxed, signed plugin. New vendors can be added without modifying the core engine.

### Report Generator
Export to PDF, DOCX, HTML, Markdown, JSON, and YAML. Reports cover topology diagrams, device inventories, IP addressing tables, link budgets, RF coverage maps, and simulation results.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Presentation Layer                                                  │
│  Desktop (Tauri)  ·  Web Client  ·  CLI                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  REST /api/v1   WebSocket   gRPC
┌──────────────────────────────▼──────────────────────────────────────┐
│  Application Layer           FastAPI (async, Python 3.13+)          │
│  Workspace Manager · Project Manager · AI Assistant                  │
│  Simulation Orchestrator · Device Manager · Plugin Manager           │
│  Map Manager · Report Engine · Event Bus                            │
└──────────┬─────────────────┬────────────────────┬───────────────────┘
           │                 │                    │
┌──────────▼──────┐  ┌───────▼──────┐  ┌─────────▼────────┐
│  Engine Layer   │  │  Data Layer  │  │  Plugin Layer    │
│  Routing Engine │  │  SQLite      │  │  Vendor Drivers  │
│  Switching Eng  │  │  PostgreSQL  │  │  Protocol Mods   │
│  Wireless Eng   │  │  Redis       │  │  AI Tools        │
│  Optical Engine │  │  Object Stor │  │  Report Exports  │
│  GIS Engine     │  └──────────────┘  └──────────────────┘
│  Packet Engine  │
│  Validation Eng │
└─────────────────┘
```

### Backend Stack

| Component | Technology |
|---|---|
| Language | Python 3.13+ |
| Framework | FastAPI (async) |
| Concurrency | asyncio, Celery/Dramatiq |
| Realtime | WebSocket |
| ORM | SQLAlchemy + Pydantic |
| Testing | Pytest |

### Frontend Stack

| Component | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite |
| State | Zustand |
| Canvas | React Flow |
| Styling | Tailwind CSS |

### Desktop Runtime

Tauri (primary) for minimal footprint and fast startup. Electron as fallback for environments that require it.

### Infrastructure

Docker + Docker Compose (single-node). Kubernetes optional for enterprise scale.

---

## Repository Structure

| Directory | Contents |
|---|---|
| `backend/` | FastAPI application, simulation engine (DES kernel, packet engine, scheduler), API routes, services |
| `frontend/` | React desktop-class UI — workspace shell, topology canvas, panels, real-time console |
| `network/devices/library/` | Vendor-agnostic device library (routers, switches, OLT/ONU, firewalls, AP, optical transport) |
| `infra/` | PostgreSQL schema, migrations, Redis config, Docker Compose files, CI config |
| `scripts/` | Operational utilities — `self-update.sh` for in-app update flow |
| `docs/` | Architecture docs, API reference, REBRAND_PLAN |
| `NetGeo/` | Authoritative product specification documents (vision, PRD, architecture, roadmap) |

---

## Quick Start

### Prerequisites

- **Git** + **Docker and Docker Compose**
  - Linux: installer auto-installs Docker (Fedora, Ubuntu, Debian, RHEL, Arch)
  - Windows/macOS: install Docker Desktop first
- Port **8090** free (or set `HTTP_PORT`)

### Install and Run

```bash
# 1. Clone
git clone https://github.com/suryaex/netgeo.git
cd netgeo

# 2. Install, build, and start
./install.sh            # Linux/macOS
.\install.ps1           # Windows PowerShell
```

The installer generates secrets, builds the full stack (PostgreSQL + Redis + FastAPI backend + React frontend) behind a single nginx gateway, waits for `/api/health`, and prints access URLs:

```
On this machine  ->  http://localhost:8090
On the network   ->  http://<LAN-IP>:8090
API docs         ->  http://<LAN-IP>:8090/docs
```

### Install Options

| Command | Effect |
|---|---|
| `./install.sh` | Build + start (dev stack, nginx LAN gateway on port 8090) |
| `./install.sh --prod` | Production stack (immutable images, nginx, scale) |
| `./install.sh --rebuild` | Force rebuild images (no cache) |
| `./install.sh --no-build` | Start without rebuilding |
| `./install.sh --down` | Stop the stack |
| `./install.sh --reset` | Stop and DELETE all data (volumes) |
| `./install.sh --tailscale` | Install + join Tailscale, use VPN IP |
| `./install.sh --public` | Detect public IP and add to CORS |
| `HTTP_PORT=9000 ./install.sh` | Override HTTP port |
| `.\install.ps1 -Down` | Windows stop |
| `./uninstall.sh` | Uninstall (keep data) |
| `./uninstall.sh --purge` | Uninstall + delete all volumes |
| `make help` | List all Make targets |

### Manual (Component by Component)

<details>
<summary>Backend, Frontend, raw Docker Compose</summary>

```bash
# Backend
cd backend
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000    # http://localhost:8000/docs
pytest -q

# Frontend
cd frontend
npm install
npm run dev                                  # http://localhost:5173

# Full stack (raw Docker Compose, no LAN gateway)
docker compose -f infra/docker-compose.yml up --build
```

</details>

---

## In-App Self-Update

NetGeo can check for and apply updates directly from the UI — the download icon in the top menu bar compares the running version against the latest GitHub release, then (optionally) pulls, rebuilds, and restarts.

- `GET /api/update/check` — compare versions (read-only)
- `POST /api/update/apply` — execute upgrade (requires `UPDATE_TOKEN`; disabled when empty)
- `scripts/self-update.sh` — the single auditable script the backend executes: checkout latest tag + `docker compose up -d --build`

Manual: `./scripts/self-update.sh --check` / `--apply` / `--watch`

---

## Development Roadmap

| Phase | Focus | Status |
|---|---|---|
| Phase 0 — Foundation | Vision, architecture, database schema, plugin SDK, API standard | Completed |
| Phase 1 — Core Platform | Workspace, project manager, device library, canvas, map engine, simulation MVP | Alpha |
| Phase 2 — Network Simulation | Routing, switching, wireless, optical, traffic generator, packet analyzer | Beta |
| Phase 3 — Enterprise | Collaboration, RBAC, plugin marketplace, AI assistant, report engine, cloud sync | Planned |
| Phase 4 — Telecom Planning | RF planning, GPON/fiber planning, microwave planning, capacity planning | Planned |
| Phase 5 — Digital Twin | Live monitoring, streaming telemetry, predictive AI, what-if simulation | Planned |
| Phase 6 — Ecosystem | Public SDK, plugin marketplace, vendor certification, enterprise support | Planned |

**Success Metrics:** startup < 3 s, idle RAM < 300 MB, 1,000,000 simulated devices, 60 FPS canvas, cross-platform.

---

## Target Users

- Students and researchers
- Network engineers and architects
- ISPs and mobile operators
- Data center and cloud engineers
- Telecommunications regulators and government
- Enterprise IT and operations teams

---

## Security

- RBAC with role-based access control
- Plugin sandbox and digital signature validation
- Secret vault integration
- Audit log for all simulation and configuration actions
- OAuth2, API Key, JWT, and Personal Access Token authentication

---

## Contributing

Contributions use DCO and SemVer. Open an issue or pull request at [github.com/suryaex/netgeo](https://github.com/suryaex/netgeo).

---

## License

[Apache-2.0](LICENSE) (c) Muhammad Surya Ragasin — Politeknik Negeri Sriwijaya, D4 Teknik Telekomunikasi.
