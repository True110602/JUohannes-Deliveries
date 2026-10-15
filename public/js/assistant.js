// public/js/assistant.js
// Floating AI assistant, loaded on every logged-in page by menu.js.
// Talks to POST /api/assistant. All text is inserted with textContent (never as HTML).
(function () {
  if (window.__jdAssistantLoaded) return;
  window.__jdAssistantLoaded = true;

  function readSession() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { token, role: payload.role || 'customer' };
    } catch (e) { return null; }
  }

  const SUGGESTIONS = {
    customer: ['Which shops are open now?', 'Where is my order?', 'How much is delivery?', 'How do I send a parcel?'],
    merchant: ['How do I add products?', 'How do I upload a menu from a spreadsheet?', 'How do I add an advert?', 'Show my recent orders'],
    driver: ['How do I take an order?', 'Show my recent deliveries', 'How do I get paid?'],
    admin: ['Show recent orders', 'How do I approve a shop?', 'How do I add an advert?']
  };

  function init() {
    const session = readSession();
    if (!session || !document.body) return;

    const style = document.createElement('style');
    style.textContent = `
      #jd-ai-btn{position:fixed;left:18px;bottom:18px;z-index:950;width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:24px;background:linear-gradient(135deg,#667eea,#764ba2);box-shadow:0 4px 14px rgba(0,0,0,.3)}
      #jd-ai-panel{position:fixed;left:18px;bottom:82px;z-index:950;width:min(360px,calc(100vw - 36px));height:min(500px,70vh);background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font-family:inherit}
      #jd-ai-panel.open{display:flex}
      .jd-ai-head{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between}
      .jd-ai-head b{font-size:15px}
      .jd-ai-head button{background:none;border:none;color:#fff;cursor:pointer;font-size:13px;opacity:.9;margin-left:10px}
      .jd-ai-note{font-size:11px;color:#777;padding:6px 14px;background:#f6f6fb;border-bottom:1px solid #eee}
      #jd-ai-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .jd-ai-msg{max-width:86%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}
      .jd-ai-msg.user{align-self:flex-end;background:#667eea;color:#fff;border-bottom-right-radius:3px}
      .jd-ai-msg.bot{align-self:flex-start;background:#f0f0f6;color:#222;border-bottom-left-radius:3px}
      .jd-ai-msg.err{align-self:flex-start;background:#fdecea;color:#b3261e}
      .jd-ai-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}
      .jd-ai-chips button{border:1px solid #667eea;color:#667eea;background:#fff;border-radius:16px;padding:5px 10px;font-size:12px;cursor:pointer}
      .jd-ai-row{display:flex;gap:8px;padding:10px;border-top:1px solid #eee}
      #jd-ai-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:9px 14px;font-size:14px;outline:none}
      #jd-ai-send{border:none;border-radius:20px;background:#667eea;color:#fff;padding:0 16px;cursor:pointer;font-size:14px}
      #jd-ai-send:disabled{opacity:.5;cursor:default}`;
    document.head.appendChild(style);

    const el = (tag, props, parent) => { const n = document.createElement(tag); Object.assign(n, props || {}); if (parent) parent.appendChild(n); return n; };

    const btn = el('button', { id: 'jd-ai-btn', textContent: '✨', title: 'Ask the AI assistant' }, document.body);
    btn.setAttribute('aria-label', 'Open AI assistant');
    const panel = el('div', { id: 'jd-ai-panel' }, document.body);
    const head = el('div', { className: 'jd-ai-head' }, panel);
    el('b', { textContent: '✨ AI Assistant' }, head);
    const headBtns = el('span', {}, head);
    const clearBtn = el('button', { textContent: 'Clear', title: 'Start a new chat' }, headBtns);
    const closeBtn = el('button', { textContent: '✕', title: 'Close' }, headBtns);
    el('div', { className: 'jd-ai-note', textContent: 'AI can make mistakes. For payment or account problems, contact support.' }, panel);
    const msgs = el('div', { id: 'jd-ai-msgs' }, panel);
    const chips = el('div', { className: 'jd-ai-chips' }, panel);
    const row = el('div', { className: 'jd-ai-row' }, panel);
    const input = el('input', { id: 'jd-ai-input', type: 'text', placeholder: 'Ask me anything about the app…', maxLength: 500 }, row);
    const send = el('button', { id: 'jd-ai-send', textContent: 'Send' }, row);

    let history = [];
    try { history = JSON.parse(sessionStorage.getItem('jdAiChat') || '[]').slice(-20); } catch (e) { history = []; }
    let busy = false;

    function save() { try { sessionStorage.setItem('jdAiChat', JSON.stringify(history.slice(-20))); } catch (e) {} }
    function bubble(kind, text) {
      const b = el('div', { className: 'jd-ai-msg ' + kind, textContent: text }, msgs);
      msgs.scrollTop = msgs.scrollHeight;
      return b;
    }
    function renderAll() {
      msgs.textContent = '';
      if (!history.length) bubble('bot', 'Hi! I can help you find shops and menus, check your orders, and explain how the app works. What do you need?');
      history.forEach(m => bubble(m.role === 'user' ? 'user' : 'bot', m.content));
      renderChips();
    }
    function renderChips() {
      chips.textContent = '';
      if (!history.length) (SUGGESTIONS[session.role] || SUGGESTIONS.customer).forEach(s => {
        el('button', { textContent: s, onclick: () => ask(s) }, chips);
      });
    }

    async function ask(text) {
      text = String(text || '').trim();
      if (!text || busy) return;
      busy = true; send.disabled = true; input.value = ''; chips.textContent = '';
      history.push({ role: 'user', content: text }); save();
      bubble('user', text);
      const thinking = bubble('bot', 'Thinking…');
      try {
        const res = await fetch((window.API_BASE || '') + '/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
          body: JSON.stringify({ messages: history.slice(-12), page: (location.pathname.split('/').pop() || 'home') })
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        thinking.remove();
        if (res.ok && data && data.reply) {
          history.push({ role: 'assistant', content: data.reply }); save();
          bubble('bot', data.reply);
        } else {
          const msg = res.status === 401 ? 'Please log in again to use the assistant.' : (data && data.message) || 'The assistant is unavailable right now. Please try again shortly.';
          bubble('err', msg);
          history.pop(); save(); renderChips(); // let the person retry the same question
        }
      } catch (e) {
        thinking.remove();
        bubble('err', 'Could not reach the server. Check your connection and try again.');
        history.pop(); save(); renderChips();
      }
      busy = false; send.disabled = false; input.focus();
    }

    btn.addEventListener('click', () => { panel.classList.toggle('open'); if (panel.classList.contains('open')) { renderAll(); input.focus(); } });
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));
    clearBtn.addEventListener('click', () => { if (busy) return; history = []; save(); renderAll(); });
    send.addEventListener('click', () => ask(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(input.value); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
