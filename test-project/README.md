# Test Project for pi-bwrap-bash

This is a minimal project for testing the bubblewrap sandbox extension.

## Setup

```bash
# From the repo root
cd test-project

# Copy the extension into this project's .pi/extensions/
cp ../src/index.ts .pi/extensions/bwrap-bash.ts

# Run pi with the extension
pi -e .pi/extensions/bwrap-bash.ts
```

## What to test

1. **Basic sandboxing**: Ask the agent to `ls /`, `touch /tmp/test`, `touch ~/outside-cwd`.
2. **Network blocking**: `curl https://example.com` should fail.
3. **Config changes**: Edit `.pi/bwrap.json` to set `"internet": "allow"`, reload pi.
4. **Failure prompt**: Try writing outside the whitelist and see if the prompt appears (if in interactive mode).

## Config

See `.pi/bwrap.json` — project-local config that overrides the global default.
