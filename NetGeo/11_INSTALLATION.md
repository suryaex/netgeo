
# 11_INSTALLATION.md

# NetGeo Installation & Deployment
Version: 0.1 Alpha

## Objective

NetGeo harus dapat dipasang dalam waktu kurang dari lima menit pada seluruh sistem operasi utama.

Prinsip:
- One Command Install
- One Click Install
- Zero Manual Configuration
- Cross Platform
- Offline Ready
- Enterprise Ready

---

# Supported Platforms

Desktop
- Windows 11+
- Windows Server
- Fedora
- Ubuntu
- Debian
- RHEL
- openSUSE
- Arch Linux
- macOS

Server
- Ubuntu Server
- Debian Server
- Rocky Linux
- AlmaLinux

Container
- Docker
- Docker Compose
- Kubernetes

---

# Installation Methods

## Windows

- NetGeoSetup.exe
- NetGeo.msi
- Portable ZIP

Silent Install:

NetGeoSetup.exe /S

---

## Linux

Package:

- .deb
- .rpm
- AppImage
- Flatpak (future)

One Command

curl -fsSL https://install.netgeo.io | bash

---

## macOS

brew install netgeo

PKG installer tersedia.

---

## Docker

docker run netgeo/community

Docker Compose:

services:
  netgeo:
    image: netgeo/community

---

# First Startup

1. Create Workspace
2. Select Theme
3. Download Device Library
4. Download Map Package (optional)
5. Finish

---

# Auto Update

Channels:
- Stable
- Beta
- Nightly

Rollback harus didukung.

---

# Enterprise Deployment

- Air-Gapped Install
- Internal Repository
- Offline License
- LDAP/AD Integration
- Proxy Support

---

# Configuration Directory

Windows:
%APPDATA%/NetGeo

Linux:
~/.config/netgeo

macOS:
~/Library/Application Support/NetGeo

---

# Cache

- Device Cache
- Tile Cache
- AI Cache
- Plugin Cache

---

# Recovery

Jika startup gagal:

- Safe Mode
- Disable Plugins
- Reset Layout
- Restore Backup

---

# CI/CD Release

Target Release:

- GitHub Releases
- Docker Registry
- Package Repository

Semua artefak harus ditandatangani secara digital.
