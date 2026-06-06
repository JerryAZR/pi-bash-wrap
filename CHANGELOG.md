# Changelog

## 0.1.4

### Fixed
- **Concurrent prompt serialization**: Added `withUILock` to serialize `ctx.ui.confirm()` calls. Previously, when multiple unsandboxed bash calls fired simultaneously, only the last prompt was shown and earlier ones hung forever.
- **`/tmp` bind-mount**: Changed `--tmpfs /tmp` to `--bind /tmp /tmp` so files written to `/tmp` inside the sandbox persist and are visible on the host. Previously each command got an isolated tmpfs that vanished on exit.

## 0.1.3

### Added
- `license`, `author`, `engines`, and `publishConfig` fields to `package.json`.
- `prepublishOnly` script to ensure `dist/` is built before publishing.

### Removed
- **Dead reference file**: Removed `src/vanilla-bash-reference.js` (no longer needed).

### Fixed
- **README path**: Fixed stale `pi-bwrap-bash` reference in local-load example.

### Removed
- **Automatic sandbox-failure prompt**: Removed the regex-based detection (`looksLikeSandboxFailure`) and the automatic "Retry without sandbox?" prompt that fired after sandbox errors. This detection was unreliable (e.g., false positives on `npm test` failures). The agent is the better judge — it can now use the explicit `unsandboxed: true` parameter when it determines a command needs to run outside the sandbox.

### Fixed
- **README updated**: Removed stale "Sandbox failure prompt" section (documented a removed feature) and added "Unsandboxed commands" documentation. Updated `promptOnFailure` option description.

## 0.1.2

### Added
- **`unsandboxed` parameter**: The bash tool now accepts an optional `unsandboxed: true` parameter. When a command fails due to sandbox restrictions (e.g., `podman`, `docker`), the agent can retry with `unsandboxed: true` to run outside the sandbox. If `promptOnFailure` is enabled, the user is prompted for confirmation before the unsandboxed execution proceeds.
- **Guideline in tool description**: The bash tool description now includes a note about `unsandboxed: true` so the LLM learns to use it when sandbox errors occur.

## 0.1.1

### Fixed
- **SSH compatibility in containers**: Mount a `tmpfs` over `/etc/ssh/ssh_config.d` to hide root-owned config snippets that appear as `nobody` inside user namespaces, which caused SSH to reject connections with "Bad owner or permissions".
- **Write tool gating**: Whitelist the system temp directory (`/tmp`) so `write`/`edit` tool calls to temp files are not needlessly blocked or prompted.

### Changed
- **Default timeout**: Increased from 60s to 600s to accommodate longer-running commands like `pip install` or `cargo run`. Agents can still request longer timeouts per-command.

## 0.1.0

### Added
- Initial release. Bubblewrap sandbox for pi bash commands.
- Configurable JSON config (`~/.pi/agent/bwrap.json`, `<cwd>/.pi/bwrap.json`).
- Status bar indicator (`bwrap: protection on`, `bwrap: off`, `bwrap: missing`, `bwrap: incompatible`, `bwrap: unsupported`).
- `/bwrap` status command.
- `--no-bwrap` CLI flag to disable for a session.
- Network blocking via `--unshare-net` (configurable).
- Write/edit tool path gating (ask-if-outside-cwd).
- Bwrap compatibility smoke-test at startup (detects blocked user namespaces).
