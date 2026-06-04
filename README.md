# pi-bash-wrap

Sandbox [pi](https://github.com/earendil-works/pi-coding-agent) bash commands with [bubblewrap](https://github.com/containers/bubblewrap). LLM-invoked commands run inside a minimal filesystem sandbox. User-initiated `!commands` are never sandboxed.

## Install

```bash
pi install npm:@jerryan/pi-bash-wrap
```

Or load locally:

```bash
pi -e /path/to/pi-bwrap-bash/dist/index.js
```

## Requirements

- **Linux only**. On other platforms the extension loads but shows `bwrap: unsupported` and passes commands through unchanged.
- [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) must be installed.

```bash
# Ubuntu / Debian
sudo apt install bubblewrap

# Fedora
sudo dnf install bubblewrap

# Arch
sudo pacman -S bubblewrap

# openSUSE
sudo zypper install bubblewrap

# Alpine
sudo apk add bubblewrap
```

If `bwrap` is missing, the extension detects your package manager and shows the correct install command in the UI.

## How it works

When active, the extension replaces pi's built-in `bash` tool with a bubblewrap sandbox that:

- Mounts the root filesystem **read-only**
- Mounts the current working directory **read-write**
- Mounts `/dev`, `/proc`, and `/tmp` normally
- Allows writing to a whitelist of cache/config directories (see [Default write paths](#default-write-paths))
- Optionally blocks network access with `--unshare-net`

**What is sandboxed:** commands invoked by the agent (via the `bash` tool).  
**What is NOT sandboxed:** user-initiated `!commands` and `!!commands` — "users know what they are doing."

## Configuration

Config files are JSON. Two levels, merged; project-local wins:

| Path | Scope |
|------|-------|
| `~/.pi/agent/bwrap.json` | Global |
| `<cwd>/.pi/bwrap.json` | Project-local |

### Options

```json
{
  "enabled": true,
  "internet": "allow",
  "extraReadPaths": [],
  "extraWritePaths": [],
  "shellPath": "/bin/bash",
  "promptOnFailure": true,
  "writeTools": {
    "write": "path",
    "edit": "path"
  },
  "timeout": 600
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the extension |
| `internet` | `"allow" \| "block"` | `"allow"` | `"block"` removes network access with `--unshare-net` |
| `extraReadPaths` | `string[]` | `[]` | Additional paths to mount read-only (must exist) |
| `extraWritePaths` | `string[]` | `[]` | Additional paths to mount read-write (created if missing) |
| `shellPath` | `string` | auto-detected | Shell to run commands inside the sandbox |
| `promptOnFailure` | `boolean` | `true` | Prompt to retry without sandbox on filesystem errors |
| `writeTools` | `object` | `{"write": "path", "edit": "path"}` | Map of tool name → path parameter name to restrict |
| `timeout` | `number` | `600` | Default timeout in seconds for sandboxed commands. Agents can request a longer timeout per command. |

Paths support `~` expansion (e.g. `"~/custom-cache"`).

### Default write paths

The following cache/config directories are writable by default. **Global install destinations are intentionally excluded** — the sandbox itself blocks them without command-pattern heuristics.

- `~/.cache`
- `~/.config`
- `~/.npm`
- `~/.cargo/registry/cache`
- `~/.cargo/git`
- `~/.cargo/registry/src`
- `~/.rustup`
- `~/.m2/repository`
- `~/.gradle/caches`
- `~/.pip`

**Not writable (examples):**
- `~/.cargo/bin` — `cargo install` fails naturally
- `~/.local/lib` — `pip install --user` fails naturally
- `/usr/local/*` — system-wide installs fail naturally

You can add exceptions via `extraWritePaths` in your config if needed.

## Status bar

A footer indicator shows the sandbox state:

| State | Footer text |
|-------|-------------|
| Active, network allowed | `bwrap: protection on 🛜` |
| Active, network blocked | `bwrap: protection on` |
| Disabled (`--no-bwrap` or config) | `bwrap: off` |
| bwrap binary missing | `bwrap: missing` |
| bwrap installed but user namespaces blocked | `bwrap: incompatible` |
| Unsupported OS | `bwrap: unsupported` |

## Commands and flags

### `/bwrap`

Type `/bwrap` in the pi prompt to see current status, the detected bwrap binary path, and the resolved configuration.

### `--no-bwrap`

Disable sandboxing for the session:

```bash
pi --no-bwrap
```

## Write tool restrictions

The extension also gates `write` and `edit` tool calls. If a tool tries to write outside the working directory, the user is prompted to allow or deny it:

```
Write outside cwd

Tool "write" wants to write to:
/etc/passwd

Allow?
→ Yes
  No
```

Configure which tools to gate and which parameter holds the path via `writeTools`:

```json
{
  "writeTools": {
    "write": "path",
    "edit": "path",
    "my_custom_tool": "target"
  }
}
```

- Key = tool name to intercept
- Value = parameter name containing the file path
- Set `"promptOnFailure": false` to silently block instead of prompting

## Sandbox failure prompt

When a sandboxed command fails with a filesystem error (`Read-only file system`, `Permission denied`, `EACCES`, `EROFS`), the extension can prompt you to retry without the sandbox:

```
Sandbox failure

$ touch /outside-cwd/file

OSError: [Errno 30] Read-only file system: '/outside-cwd/file'

Retry without sandbox?
→ Yes
  No
```

- **Timeouts and aborts** are never retried — they are returned as errors immediately.
- **Non-interactive mode** (no UI) skips the prompt and returns the error.
- Set `"promptOnFailure": false` in config to disable prompting entirely.

## Mount order

Bubblewrap processes arguments sequentially; later mounts override earlier ones. The extension uses this order:

```
--die-with-parent
--chdir <cwd>
--ro-bind / /      # read-only root (must come first)
--dev /dev         # overrides /dev
--proc /proc       # overrides /proc
--bind <cwd> <cwd> # overrides cwd
--tmpfs /tmp       # overrides /tmp
```

## Limitations

- **Does not prevent reading secrets.** The `read` tool and bash `cat` are unrestricted — the sandbox focuses on preventing accidental or malicious writes outside the project.
- **Requires unprivileged user namespaces.** If your kernel or container runtime blocks user namespaces (common in hardened environments, some CI runners, or Docker without `--privileged`), bubblewrap cannot create its sandbox. The extension detects this at startup and shows `bwrap: incompatible`.

## Development

```bash
git clone git@github.com:JerryAZR/pi-bash-wrap.git
cd pi-bash-wrap
npm install
npm run build
npm test
```

Tests use Node's built-in test runner (`node:test`) and cover config loading, bwrap argument construction, and utility functions.

## License

MIT
