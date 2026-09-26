# HyperMarrow MCP Server

> Local-first AI memory layer for the [Model Context Protocol](https://modelcontextprotocol.io/).

**hypermarrow-mcp** lets any MCP-compatible client read and write your long-term memory:

- `record_context` – remember a decision, fact, or preference
- `recall_memory` – retrieve the most relevant past context
- `consolidate` – merge duplicates and age out stale entries
- `file_anchor` – map a short name to a local file path

All memory lives under `~/.hypermarrow/memory.json` on your own machine. Nothing is sent to the cloud unless you explicitly set `HYPERMARROW_ENDPOINT` to your own backend.

## Install

```bash
npx -y hypermarrow-mcp
```

Or add to your MCP client config:

```json
{
  "mcpServers": {
    "hypermarrow": {
      "command": "npx",
      "args": ["-y", "hypermarrow-mcp"]
    }
  }
}
```

## Product

- Homepage: https://hm.qianshi.cool/
- Company: 千视科技 (qianshi.cool)

## Privacy

Memory data is stored locally. The server only talks to the client over stdio and, optionally, to a user-configured `HYPERMARROW_ENDPOINT`. No telemetry, no cloud sync by default.
