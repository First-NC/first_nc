# Immersive App Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-based update handoff with an in-app download flow, immersive splash-style update overlay, and a clear About/version entry.

**Architecture:** Keep update discovery on the existing frontend API call, but move package download and installer launch into Tauri commands so the app can download locally without exposing URLs. The React app owns the update state machine and renders a splash-like overlay plus a lightweight About modal around that state.

**Tech Stack:** React 19, TypeScript, Tauri 2, Rust, node:test

---

### Task 1: Lock the new update presentation behavior with tests

**Files:**
- Create: `first_nc/src/lib/updatePresentation.ts`
- Create: `first_nc/src/lib/updatePresentation.test.ts`
- Modify: `first_nc/src/lib/updateClient.test.ts`

- [ ] Add small pure helpers for progress labels, status text, and installer filename handling so the UI logic is testable outside `App.tsx`.
- [ ] Write failing tests for progress formatting, ready-state copy, and download filename derivation.
- [ ] Run: `npm test -- --run src/lib/updatePresentation.test.ts`
- [ ] Confirm the new tests fail before implementation.

### Task 2: Move download/install responsibilities into Tauri

**Files:**
- Modify: `first_nc/src-tauri/Cargo.toml`
- Modify: `first_nc/src-tauri/src/lib.rs`

- [ ] Add Tauri commands for downloading update packages, emitting progress, cancelling, and launching the prepared installer.
- [ ] Save update packages under an app-controlled updates directory instead of exposing URLs in the UI.
- [ ] Emit progress events the React app can subscribe to.
- [ ] Keep platform-specific installer launch behavior inside Rust.

### Task 3: Replace the old modal flow in the React app

**Files:**
- Modify: `first_nc/src/App.tsx`
- Modify: `first_nc/src/App.css`
- Modify: `first_nc/src/locales/zh-CN.json`
- Modify: `first_nc/src/locales/en-US.json`

- [ ] Replace “open update URL” actions with “download update package”.
- [ ] Add immersive splash-like overlay states: idle, downloading, ready, failed.
- [ ] Add an About modal with current version, update state, and a manual update action.
- [ ] Update the status bar to reflect download progress and ready-to-restart states.

### Task 4: Verify the integrated flow

**Files:**
- Modify as needed based on verification fallout.

- [ ] Run targeted frontend tests.
- [ ] Run a TypeScript build or equivalent verification.
- [ ] Run a Rust check if dependency resolution stays local.
- [ ] Document any platform-specific limitations discovered during verification.
