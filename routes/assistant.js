// routes/assistant.js
// POST /api/assistant  { messages: [{role:'user'|'assistant', content}], page? }
// The in-app AI assistant. Runs on the server so the API key never reaches the browser.
// Needs ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in the environment.
const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { authenticateToken } = require('../middleware/auth');
const { toolDefinitions, executeTool } = require('../utils/assistantTools');
const { buildSystemPrompt } = require('../utils/assistantPrompt');

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_HISTORY = 12;          // messages kept from the conversation
const MAX_CHARS = 1500;          // per message
const MAX_TOOL_ROUNDS = 4;       // look-ups the assistant may chain for one question
const HOURLY_LIMIT = parseInt(process.env.ASSISTANT_HOURLY_LIMIT, 10) || 30;

// Simple per-user limit so one account can't run up the bill.
const usage = new Map();
function overLimit(key) {
  const now = Date.now(), hourAgo = now - 3600 * 1000;
  const recent = (usage.get(key) || []).filter(t => t > hourAgo);
  if (recent.length >= HOURLY_LIMIT) { usage.set(key, recent); return true; }
  recent.push(now); usage.set(key, recent);
  return false;
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

async function callClaude(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    return await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally { clearTimeout(timer); }
}

router.post('/', authenticateToken, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, message: 'The AI assistant is not switched on yet. The app owner needs to add ANTHROPIC_API_KEY.' });
    }
    const messages = cleanMessages(req.body && req.body.messages);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ success: false, message: 'Please type a question.' });
    }
    if (overLimit(req.user.email)) {
      return res.status(429).json({ success: false, message: 'You have asked a lot of questions this hour. Please try again a little later.' });
    }

    const account = await User.findById(req.user.id).select('name');
    const firstName = account && account.name ? account.name.split(/\s+/)[0].replace(/[^\p{L}\p{N}.'-]/gu, '').slice(0, 30) : '';
    const page = typeof (req.body && req.body.page) === 'string' && /^[a-z0-9._\-\/]{1,60}$/i.test(req.body.page) ? req.body.page : '';
    const system = buildSystemPrompt({ role: req.user.role, firstName, page });
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

    const convo = messages.slice();
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const apiRes = await callClaude({ model, max_tokens: 600, system, tools: toolDefinitions, messages: convo });
      if (!apiRes.ok) {
        let detail = '';
        try { const e = await apiRes.json(); detail = (e.error && e.error.message) || ''; } catch (_) {}
        console.error(`Assistant: Anthropic API returned HTTP ${apiRes.status} ${detail.replace(/sk-[A-Za-z0-9_\-]+/g, '[redacted]')}`);
        return res.status(502).json({ success: false, message: 'The assistant is unavailable right now. Please try again shortly.' });
      }
      const data = await apiRes.json();

      if (data.stop_reason === 'tool_use' && round < MAX_TOOL_ROUNDS) {
        const results = [];
        for (const block of data.content.filter(b => b.type === 'tool_use')) {
          let output;
          try { output = await executeTool(block.name, block.input, req.user); }
          catch (e) { console.error('Assistant tool error:', block.name, e.message); output = { error: 'That look-up failed.' }; }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
        }
        convo.push({ role: 'assistant', content: data.content });
        convo.push({ role: 'user', content: results });
        continue;
      }

      const reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return res.json({ success: true, reply: (reply || "Sorry, I couldn't come up with an answer. Could you rephrase that?").slice(0, 2000) });
    }
    res.json({ success: true, reply: "Sorry, that took too many steps. Could you ask in a simpler way?" });
  } catch (err) {
    console.error('Assistant error:', err);
    res.status(500).json({ success: false, message: 'The assistant ran into a problem. Please try again.' });
  }
});

module.exports = router;
