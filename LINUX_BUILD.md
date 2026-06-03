# Linux Build Guide

This document explains how to build the Noctisai application for Linux.

## Prerequisites

- **Linux Environment**: You must be on a Linux distribution (Ubuntu, Fedora, etc.) or use WSL2 (Windows Subsystem for Linux).
- **Node.js**: Version 18 or higher recommended.
- **Build Tools**: `gcc`, `g++`, and `make` (usually part of `build-essential` on Ubuntu).

## Building Locally (on Linux)

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Rebuild native modules**:
    ```bash
    npm run rebuild
    ```
    This will compile the `linux-stub.cc` module.

3.  **Build the application**:
    ```bash
    npm run build:linux
    ```
    This will generate:
    - `dist/Noctisai-x.x.x.AppImage`
    - `dist/noctisai_x.x.x_amd64.deb`
    - `dist/noctisai-x.x.x.x86_64.rpm`

## Building on Windows (Cross-compilation)

Building Linux AppImages on Windows directly is not supported by `electron-builder` without a VM or Docker.

### Option 1: Using WSL2 (Recommended)
1. Install Ubuntu on WSL2.
2. Clone the repository in WSL2.
3. Follow the "Building Locally" steps above.

### Option 2: Using Docker
If you have Docker installed, you can use the newly added npm script:

```bash
npm run build:linux:docker
```

Or run the docker command manually:

```bash
docker run --rm -v ${PWD}:/project -v ~/.cache/electron:/root/.cache/electron -v ~/.cache/electron-builder:/root/.cache/electron-builder electronuserland/builder:wine npm run build:linux
```

## Continuous Integration

A GitHub Actions workflow has been added in `.github/workflows/build.yml`. It will automatically build and package the application for both Windows and Linux whenever a new tag (e.g., `v1.0.1`) is pushed to the repository.

## Troubleshooting

### Native Module Loading
On Linux, the native module provides stub implementations to ensure the app doesn't crash if it tries to access Windows-specific window management features. Desktop application discovery is handled via `.desktop` file scanning in `src/main/app-discovery-service.js`.

### Voice Assistant permissions
Ensure your Linux user has permission to access the microphone (`audio` group).
