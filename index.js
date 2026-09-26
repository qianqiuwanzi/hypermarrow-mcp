#!/usr/bin/env node
/*
 * HyperMarrow MCP Server
 * A local-first memory layer for MCP-compatible clients.
 *
 * Tools:
 *   - record_context : capture a piece of working context
 *   - recall_memory  : semantic-ish recall by keyword relevance
 *   - consolidate    : merge duplicates and age-out stale entries
 *   - file_anchor    : anchor a short name to a local file path
 *
 * Environment:
 *   HYPERMARROW_DATA_DIR  - where memory.json lives (default ~/.hypermarrow)
 *   HYPERMARROW_ENDPOINT  - optional HTTP backend to forward tool calls
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

const DATA_DIR = process.env.HYPERMARROW_DATA_DIR || path.join(os.homedir(), '.hypermarrow');
const DATA_FILE = path.join(DATA_DIR, 'memory.json');
const ENDPOINT = process.env.HYPERMARROW_ENDPOINT || null;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadData() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.entries) parsed.entries = [];
    if (!parsed.anchors) parsed.anchors = {};
    return parsed;
  } catch {
    return { version: '0.1.0', entries: [], anchors: {} };
  }
}

async function saveData(data) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function remoteTool(name, args) {
  if (!ENDPOINT) return null;
  const url = new URL(ENDPOINT);
  const body = JSON.stringify({ tool: name, args });
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json && Array.isArray(json.content)) resolve(json);
            else resolve(null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

function rankEntries(entries, query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    return entries
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 5);
  }
  const words = q.split(/\s+/).filter(Boolean);
  return entries
    .map((e) => {
      const text = (e.context || '').toLowerCase();
      const tags = (e.tags || []).join(' ').toLowerCase();
      let score = 0;
      if (text.includes(q)) score += 10;
      words.forEach((w) => {
        if (text.includes(w)) score += 3;
        if (tags.includes(w)) score += 2;
      });
      return { ...e, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);
}

const server = new Server(
  { name: 'hypermarrow-memory', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'record_context',
      description:
        'Capture a piece of local working context (a decision, a fact, a preference) into persistent memory. Nothing is uploaded to the cloud unless HYPERMARROW_ENDPOINT is set.',
      inputSchema: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'The text to remember.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for later filtering.',
          },
        },
        required: ['context'],
      },
    },
    {
      name: 'recall_memory',
      description:
        'Recall the most relevant stored contexts given a query. Returns up to 5 ranked entries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you are looking for.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'consolidate',
      description:
        'Merge duplicate memory entries and age out entries older than 90 days. Returns a short summary.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'file_anchor',
      description:
        'Anchor a short name to an absolute local file path so future queries can resolve "the spec" to the real document.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short mnemonic name, e.g. "qianshi-spec".' },
          path: { type: 'string', description: 'Absolute local file path.' },
        },
        required: ['name', 'path'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  // Optional upstream backend. If it responds, use it; otherwise fall back local.
  const upstream = await remoteTool(name, args);
  if (upstream) return upstream;

  const data = await loadData();
  let message = '';

  switch (name) {
    case 'record_context': {
      const id = generateId();
      const now = new Date().toISOString();
      data.entries.push({
        id,
        context: String(args.context || ''),
        tags: Array.isArray(args.tags) ? args.tags : [],
        createdAt: now,
        updatedAt: now,
      });
      await saveData(data);
      message = `已记录 #${id}（${data.entries.length} 条记忆）`;
      break;
    }
    case 'recall_memory': {
      const ranked = rankEntries(data.entries, args.query);
      if (!ranked.length) {
        message = `未找到与 "${args.query}" 相关的记忆。`;
      } else {
        message = ranked
          .map(
            (e, i) =>
              `${i + 1}. [${new Date(e.updatedAt).toLocaleDateString()}] ${e.context}` +
              (e.tags.length ? ` #${e.tags.join(',')}` : '')
          )
          .join('\n---\n');
      }
      break;
    }
    case 'consolidate': {
      const before = data.entries.length;
      const seen = new Map();
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      data.entries = data.entries
        .filter((e) => new Date(e.updatedAt).getTime() > cutoff)
        .reduce((acc, e) => {
          const key = e.context.trim().toLowerCase();
          if (!key) return acc;
          if (seen.has(key)) {
            const prev = seen.get(key);
            if (new Date(e.updatedAt) > new Date(prev.updatedAt)) {
              seen.set(key, e);
            }
          } else {
            seen.set(key, e);
            acc.push(e);
          }
          return acc;
        }, []);
      await saveData(data);
      message = `整理完成：${before} → ${data.entries.length} 条；锚点 ${Object.keys(data.anchors).length} 个。`;
      break;
    }
    case 'file_anchor': {
      data.anchors[String(args.name)] = {
        path: String(args.path),
        updatedAt: new Date().toISOString(),
      };
      await saveData(data);
      message = `已锚定 "${args.name}" → ${args.path}`;
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return { content: [{ type: 'text', text: message }] };
});

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive until stdin closes.
})();
