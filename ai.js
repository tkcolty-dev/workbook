// AI layer. Backends, in priority order:
//   1. Anthropic API (ANTHROPIC_API_KEY)                      — Claude, vision + web search
//   2. OpenAI-compatible endpoint (Tanzu GenAI binding in VCAP_SERVICES, or OPENAI_API_BASE + OPENAI_API_KEY)
//   3. Local Claude Code CLI (`claude`, subscription login)   — dev machines
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MODEL = process.env.AI_MODEL || 'claude-opus-5';
const CLI_MODEL = process.env.AI_CLI_MODEL || 'opus';
const CLAUDE_BIN = [os.homedir() + '/.local/bin/claude', 'claude'].find(p => {
  try { return p === 'claude' || fs.existsSync(p); } catch { return false; }
});

// ---- detect OpenAI-compatible endpoint (Tanzu GenAI) ----
function detectOpenAI() {
  if (process.env.OPENAI_API_BASE && process.env.OPENAI_API_KEY) return { base: process.env.OPENAI_API_BASE.replace(/\/$/, ''), key: process.env.OPENAI_API_KEY, configUrl: process.env.OPENAI_CONFIG_URL || null, name: 'custom' };
  if (process.env.VCAP_SERVICES) {
    try {
      const vcap = JSON.parse(process.env.VCAP_SERVICES);
      for (const svc of Object.values(vcap).flat()) {
        const tags = (svc.tags || []).join(',');
        const ep = svc.credentials?.endpoint || svc.credentials;
        if ((/genai|ai-models|llm/i.test(tags) || /genai|ai-models/i.test(svc.label || '')) && ep && (ep.openai_api_base || ep.api_base) && ep.api_key) {
          return { base: (ep.openai_api_base || ep.api_base + '/openai').replace(/\/$/, ''), key: ep.api_key, configUrl: ep.config_url || null, name: ep.name || svc.name };
        }
      }
    } catch (e) { console.error('VCAP_SERVICES parse error (ai):', e.message); }
  }
  return null;
}
const OPENAI = detectOpenAI();
const CLI_OK = (() => { try { return CLAUDE_BIN === 'claude' ? !!require('child_process').spawnSync('which', ['claude']).stdout?.toString().trim() : fs.existsSync(CLAUDE_BIN); } catch { return false; } })();
const BACKEND = process.env.ANTHROPIC_API_KEY ? 'anthropic' : OPENAI ? 'openai' : CLI_OK ? 'cli' : 'none';
const USE_CLI = BACKEND === 'cli';
const AVAILABLE = BACKEND !== 'none';
const HAS_WEB_SEARCH = BACKEND === 'anthropic' || BACKEND === 'cli';

let client = null;
if (BACKEND === 'anthropic') { const Anthropic = require('@anthropic-ai/sdk'); client = new Anthropic(); }
else if (BACKEND === 'openai') console.log('AI: OpenAI-compatible endpoint (' + OPENAI.name + ')');
else if (BACKEND === 'cli') console.log('No ANTHROPIC_API_KEY — AI features will use the local Claude Code CLI (' + CLAUDE_BIN + ')');
else console.log('WARNING: no ANTHROPIC_API_KEY, no GenAI binding and no claude CLI — AI features are disabled.');
const NOT_CONFIGURED = 'AI is not set up on this server yet — an ANTHROPIC_API_KEY needs to be added (or bind a GenAI service). Scanning and notebooks still work; AI reading, study sheets, tests and flashcards need it.';

// OpenAI-compatible: pick text + vision models (env override, else from the endpoint's advertised capabilities, else defaults)
const OA = { text: process.env.AI_TEXT_MODEL || null, vision: process.env.AI_VISION_MODEL || null, ready: null };
const TEXT_PREF = ['deepseek-ai/DeepSeek-V4-Flash', 'openai/gpt-oss-120b', 'Qwen/Qwen3', 'google/gemma-4', 'poolside/Laguna', 'cyankiwi/Ornith'];
const VISION_PREF = ['cyankiwi/Ornith', 'google/gemma-4', 'Qwen/Qwen3'];
async function oaReady() {
  if (BACKEND !== 'openai') return;
  if (OA.ready) return OA.ready;
  OA.ready = (async () => {
    if (OA.text && OA.vision) return;
    let models = [];
    try {
      if (OPENAI.configUrl) { const cfg = await fetch(OPENAI.configUrl, { headers: { Authorization: 'Bearer ' + OPENAI.key } }).then(r => r.json()); models = (cfg.advertisedModels || []).map(m => ({ id: m.name, caps: m.capabilities || [] })); }
      if (!models.length) { const r = await fetch(OPENAI.base + '/v1/models', { headers: { Authorization: 'Bearer ' + OPENAI.key } }).then(r => r.json()); models = (r.data || []).map(m => ({ id: m.id, caps: ['CHAT'] })); }
    } catch (e) { console.error('model discovery failed:', e.message); }
    const pick = (prefs, filter) => { const pool = models.filter(filter); for (const p of prefs) { const m = pool.find(m => m.id.startsWith(p)); if (m) return m.id; } return pool[0]?.id || null; };
    OA.text ||= pick(TEXT_PREF, m => m.caps.includes('CHAT') && !/embed/i.test(m.id)) || 'openai/gpt-oss-120b';
    OA.vision ||= pick(VISION_PREF, m => m.caps.includes('VISION')) || OA.text;
    console.log(`AI models: text=${OA.text} vision=${OA.vision}`);
  })();
  return OA.ready;
}
oaReady();
function modelLabel() { return BACKEND === 'anthropic' ? MODEL : BACKEND === 'openai' ? ((OA.text || 'GenAI').split('/').pop() + ' + ' + (OA.vision || '').split('/').pop() + ' (vision)') : BACKEND === 'cli' ? 'claude (local CLI)' : 'not configured'; }

// LaTeX inside JSON strings: models often write \frac instead of \\frac. A lone backslash + letters that is
// not a real JSON escape (\n \t \f \b \r \uXXXX) is doubled; known LaTeX macros that collide with escapes are doubled too.
const LATEX_ESC_MACROS = new Set(['neq','ne','nabla','not','nu','times','theta','tau','text','tan','tfrac','tilde','to','triangle','therefore','frac','forall','because','beta','bar','binom','boxed','big','bigg','bigl','bigr','rightarrow','right','rho','root','rceil','rfloor','notin','textbf','textit']);
function fixLatexEscapes(t) {
  return t.replace(/(?<!\\)\\([a-zA-Z]+)/g, (m, word) => {
    const c = word[0];
    if (c === 'u' && /^u[0-9a-fA-F]{4}/.test(word)) return m;
    if ('ntfbr'.includes(c) && !LATEX_ESC_MACROS.has(word)) return m;
    return '\\\\' + word;
  });
}

function parseJSON(text) {
  if (!text) throw new Error('empty AI response');
  let t = fixLatexEscapes(text.trim());
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const first = t.search(/[[{]/);
  if (first > 0) t = t.slice(first);
  const lastObj = t.lastIndexOf('}'), lastArr = t.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  if (last >= 0) t = t.slice(0, last + 1);
  return JSON.parse(t);
}

/**
 * complete({ system, prompt | messages, images:[{data(base64), mediaType}], maxTokens, effort, webSearch, json })
 * Returns { text }
 */
async function complete(opts) {
  if (!AVAILABLE) throw new Error(NOT_CONFIGURED);
  if (BACKEND === 'openai') return completeOpenAI(opts);
  const text = USE_CLI ? await completeCli(opts) : await completeApi(opts);
  return text;
}

// ---- OpenAI-compatible chat completions ----
function oaMessages({ system, prompt, messages, images = [] }) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  if (messages) { for (const m of messages) out.push({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('\n') }); }
  else {
    const content = [];
    for (const img of images) content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType || 'image/jpeg'};base64,${img.data}` } });
    content.push({ type: 'text', text: prompt || '' });
    out.push({ role: 'user', content: images.length ? content : (prompt || '') });
  }
  return out;
}
async function oaFetch(body, { stream = false, timeoutMs = 240000 } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(OPENAI.base + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + OPENAI.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, stream }), signal: ctrl.signal });
    if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error(`AI endpoint error ${r.status}: ${txt.slice(0, 200)}`); }
    return r;
  } finally { if (!stream) clearTimeout(t); }
}
function stripThink(t) { return String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }
async function completeOpenAI(opts) {
  await oaReady();
  const { images = [], maxTokens = 4000, temperature } = opts;
  const model = images.length ? OA.vision : OA.text;
  const r = await oaFetch({ model, max_tokens: maxTokens, temperature: temperature ?? (opts.json ? 0.2 : 0.5), messages: oaMessages(opts) });
  const o = await r.json();
  const text = o.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI returned no text' + (o.error ? ': ' + JSON.stringify(o.error).slice(0, 200) : ''));
  return stripThink(text);
}
async function streamOpenAI({ system, messages, maxTokens = 2000, onText }) {
  await oaReady();
  const r = await oaFetch({ model: OA.text, max_tokens: maxTokens, temperature: 0.5, messages: oaMessages({ system, messages }) }, { stream: true, timeoutMs: 300000 });
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '', inThink = false;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim(); if (!payload || payload === '[DONE]') continue;
      let obj; try { obj = JSON.parse(payload); } catch { continue; }
      let d = obj.choices?.[0]?.delta?.content; if (!d) continue;
      // hide <think> blocks if the model emits them
      if (d.includes('<think>')) { inThink = true; d = d.split('<think>')[0]; }
      if (inThink) { if (d.includes('</think>')) { inThink = false; d = d.split('</think>').pop(); } else continue; }
      if (d) onText(d);
    }
  }
}

async function completeApi({ system, prompt, messages, images = [], maxTokens = 4000, effort = 'medium', webSearch = false }) {
  const content = [];
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data } });
  }
  if (prompt) content.push({ type: 'text', text: prompt });
  const msgs = messages || [{ role: 'user', content }];
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: msgs,
  };
  if (webSearch) params.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  const res = await client.beta.messages.create(params);
  if (res.stop_reason === 'refusal') throw new Error('The AI declined that request.');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function runCli(prompt, { tools = [], maxTurns = 1, timeoutMs = 240000, onText, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--max-turns', String(maxTurns), '--model', CLI_MODEL,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
    if (tools.length) { args.push('--tools', tools.join(','), '--allowedTools', tools.join(',')); }
    else args.push('--tools', '');
    const child = spawn(CLAUDE_BIN, args, { cwd: cwd || os.tmpdir(), env: process.env });
    let out = '', buf = '', streamed = false, resultText = '';
    const killer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        if (obj.type === 'stream_event' && obj.event?.type === 'content_block_delta' && obj.event.delta?.type === 'text_delta') {
          streamed = true; out += obj.event.delta.text; if (onText) onText(obj.event.delta.text);
        } else if (obj.type === 'result') {
          if (typeof obj.result === 'string') resultText = obj.result;
          if (obj.subtype && obj.subtype !== 'success' && !obj.result) resultText = '';
        }
      }
    });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', code => {
      clearTimeout(killer);
      // When tools ran, the streamed text includes intermediate thoughts; prefer the final result.
      const text = (tools.length && resultText) ? resultText : (streamed ? out : resultText);
      if (!text && code !== 0) return reject(new Error('claude CLI exited with code ' + code + (err ? ': ' + err.slice(0, 200) : '')));
      if (tools.length && resultText && onText && !streamed) onText(resultText);
      resolve(text);
    });
    child.on('error', e => { clearTimeout(killer); reject(new Error('Could not start claude CLI: ' + e.message)); });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function completeCli({ system, prompt, messages, images = [], webSearch = false }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwb-'));
  let full = (system || '') + '\n\n';
  const tools = [];
  let maxTurns = 1;
  if (images.length) {
    const paths = images.map((img, i) => {
      const p = path.join(tmpDir, `image-${i + 1}.${(img.mediaType || 'image/jpeg').split('/')[1] || 'jpg'}`);
      fs.writeFileSync(p, Buffer.from(img.data, 'base64'));
      return p;
    });
    full += 'First, use the Read tool to look at ' + (paths.length > 1 ? 'these image files' : 'this image file') + ':\n' + paths.map(p => '- ' + p).join('\n') + '\n\n';
    tools.push('Read'); maxTurns = images.length + 2;
  }
  if (webSearch) { tools.push('WebSearch', 'WebFetch'); maxTurns = 20; full += 'You may use WebSearch (and WebFetch) to find real, current web resources. Do at most 5 searches / 3 fetches total, then STOP searching and write your complete final answer.\n\n'; }
  if (!tools.length) full += 'Answer directly in this single reply from your own knowledge. Do not use any tools.\n\n';
  if (messages) {
    full += '--- Conversation so far ---\n' + messages.map(m => (m.role === 'user' ? 'Student: ' : 'Tutor: ') + (typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('\n'))).join('\n\n') + '\n\nReply to the Student\'s last message now.';
  } else {
    full += prompt || '';
  }
  try {
    return await runCli(full, { tools, maxTurns, cwd: tmpDir, timeoutMs: webSearch ? 600000 : 300000 });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** Streaming chat: calls onText(delta) as text arrives. */
async function stream({ system, messages, maxTokens = 2000, effort = 'low', onText }) {
  if (!AVAILABLE) throw new Error(NOT_CONFIGURED);
  if (BACKEND === 'openai') return streamOpenAI({ system, messages, maxTokens, onText });
  if (USE_CLI) {
    let full = (system || '') + '\n\nAnswer directly in this single reply from your own knowledge. Do not use any tools.\n\n';
    full += '--- Conversation so far ---\n' + messages.map(m => (m.role === 'user' ? 'Student: ' : 'Tutor: ') + m.content).join('\n\n') + '\n\nReply to the Student\'s last message now.';
    return runCli(full, { onText });
  }
  const s = client.beta.messages.stream({
    model: MODEL, max_tokens: maxTokens, output_config: { effort },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system, messages: messages.map(m => ({ role: m.role, content: m.content })),
  });
  s.on('text', onText);
  const final = await s.finalMessage();
  if (final.stop_reason === 'refusal') onText("Sorry — I can't help with that one.");
}

async function completeJSON(opts) {
  const text = await complete({ ...opts, json: true });
  try { return parseJSON(text); }
  catch (e) {
    // one repair attempt
    const fixed = await complete({ system: 'You fix malformed JSON. Output ONLY valid JSON, nothing else.', prompt: 'Fix this into valid JSON:\n\n' + text, maxTokens: opts.maxTokens || 4000, effort: 'low' });
    return parseJSON(fixed);
  }
}

module.exports = { complete, completeJSON, stream, parseJSON, USE_CLI, MODEL, AVAILABLE, BACKEND, HAS_WEB_SEARCH, modelLabel };
