# Changelog

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
- Sandbox-failure prompt with retry-without-sandbox option.
- Write/edit tool path gating (ask-if-outside-cwd).
- Bwrap compatibility smoke-test at startup (detects blocked user namespaces).
