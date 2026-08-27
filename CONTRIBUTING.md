# Contributing to Stellar Circles

Thank you for your interest in contributing! This project is built on Stellar Soroban smart contracts and a React + Vite frontend.

## Development Setup

### Prerequisites
- Rust stable + `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
- Node.js v20+
- [Freighter](https://freighter.app) wallet extension

### Quick Start
```bash
git clone https://github.com/sumitadutta953-ops/stellar-circles.git
cd stellar-circles
cd frontend && npm install && cd ..
cp frontend/.env.example frontend/.env
# Populate frontend/.env with your contract IDs and Firebase config
cd frontend && npm run dev
```

## Project Structure

```
contracts/   → Soroban Rust contracts (cargo test --workspace)
frontend/    → React + Vite app (npm run dev)
scripts/     → Local deployment PowerShell scripts
.github/     → CI (ci.yml) and CD (cd.yml) GitHub Actions workflows
```

## Making Changes

### Smart Contracts (Rust)
1. Edit the relevant contract in `contracts/<name>/src/lib.rs`
2. Build: `cd contracts && stellar contract build`
3. Test: `cargo test --workspace`
4. Lint: `cargo clippy --all-targets -- -D warnings`
5. Format: `cargo fmt --all`

### Frontend (TypeScript/React)
1. Edit files in `frontend/src/`
2. Type-check: `npx tsc --noEmit`
3. Lint: `npm run lint`
4. Build: `npm run build`

### Adding a New Contract Function
1. Add the function to the relevant `contracts/<name>/src/lib.rs`
2. Add a corresponding call in the appropriate frontend page or service
3. Update `CONTRACT_IDS` in `frontend/src/services/stellar.ts` if needed
4. Add E2E test coverage in `frontend/tests/`

## CI/CD

All PRs must pass:
- `cargo fmt --check`
- `cargo audit`
- `cargo clippy -D warnings`
- `stellar contract build`
- `cargo test --workspace`
- `tsc --noEmit`
- `npm run lint`
- `npm run build`
- Playwright E2E tests

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(contracts): add reputation scoring to contribution contract
fix(frontend): handle Freighter rejection gracefully
ci: add cargo-audit security scanning
docs: update contract function reference in README
chore: bump soroban-sdk to v28
```

## License

By contributing, you agree your contributions will be licensed under Apache 2.0.
