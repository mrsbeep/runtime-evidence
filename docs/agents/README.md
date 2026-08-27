# Coding agent configuration

Repository guidance has one source of truth: the root `AGENTS.md`. Tool-specific files only load or
point to that policy so instructions do not drift.

| Tool | Repository file |
|---|---|
| OpenAI Codex | `AGENTS.md` |
| Cursor Agent and Cursor CLI | `AGENTS.md` |
| Claude Code | `CLAUDE.md`, which imports `AGENTS.md` |
| Gemini CLI | `GEMINI.md`, which imports `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md`, which points to `AGENTS.md` |
| Other AGENTS.md-compatible tools | `AGENTS.md` |

Do not copy the full policy into a vendor-specific file. Add tool-specific instructions only when
the tool requires behavior that cannot be expressed in the shared file.
