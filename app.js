// very small, readable nostr client for “wikipedia-style” articles
// - connects via WebSocket to a relay
// - sends a REQ with { kinds: [kind], limit: N, optional tag filter }
// - renders latest N events; first non-empty line = title, rest = body

(() => {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    form: $('#query-form'),
    relayUrl: $('#relayUrl'),
    eventKind: $('#eventKind'),
    limitN: $('#limitN'),
    tagName: $('#tagName'),
    tagValue: $('#tagValue'),
    connectBtn: $('#connectBtn'),
    fetchBtn: $('#fetchBtn'),
    disconnectBtn: $('#disconnectBtn'),
    status: $('#status'),
    list: $('#articles')
  };

  let ws = null;
  let isOpen = false;
  let currentSubId = null;

  function setStatus(text, cls) {
    els.status.className = 'status-line' + (cls ? ` ${cls}` : '');
    els.status.textContent = `status: ${text}`;
  }

  function uiConnected(connected) {
    els.connectBtn.disabled = connected;
    els.disconnectBtn.disabled = !connected;
    els.fetchBtn.disabled = !connected;
    els.relayUrl.disabled = connected;
  }

  function connect() {
    const url = (els.relayUrl.value || '').trim();
    if (!url) {
      setStatus('please enter a relay url (wss://...)', 'warn');
      return;
    }
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus(`invalid websocket url: ${e.message}`, 'err');
      return;
    }

    setStatus('connecting…');
    uiConnected(false);

    ws.onopen = () => {
      isOpen = true;
      setStatus('connected', 'ok');
      uiConnected(true);
    };

    ws.onerror = (evt) => {
      setStatus('websocket error (see console)', 'err');
      console.error('websocket error', evt);
    };

    ws.onclose = () => {
      isOpen = false;
      setStatus('disconnected');
      uiConnected(false);
    };

    ws.onmessage = (msg) => {
      handleMessage(msg.data);
    };
  }

  function disconnect() {
    if (ws && isOpen) {
      try {
        if (currentSubId) {
          // close existing subscription
          const closeMsg = JSON.stringify(['CLOSE', currentSubId]);
          ws.send(closeMsg);
        }
        ws.close();
      } catch (e) {
        console.warn('error closing ws', e);
      }
    }
    currentSubId = null;
    isOpen = false;
    uiConnected(false);
    setStatus('disconnected');
  }

  function handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn('non-json message', raw);
      return;
    }

    const typ = data[0];

    if (typ === 'EVENT') {
      const evt = data[2];
      renderEvent(evt);
    } else if (typ === 'EOSE') {
      setStatus('received all results', 'ok');
    } else if (typ === 'OK') {
      // ["OK", <event-id>, <accepted:boolean>, <message:str>]
      const [, , accepted, msg] = data;
      if (!accepted) setStatus(`relay rejected: ${msg}`, 'warn');
    } else if (typ === 'NOTICE') {
      setStatus(`relay notice: ${data[1]}`, 'warn');
    }
  }

  function clearList() {
    els.list.innerHTML = '';
  }

  function renderEvent(evt) {
    // try to derive a title:
    // 1) find "title" tag
    // 2) else first non-empty line of content
    const titleTag = evt.tags?.find(t => t[0] === 'title');
    let title = titleTag?.[1] || '';
    const content = (evt.content || '').trim();
    if (!title) {
      const firstLine = (content.split('\n').find(line => line.trim().length) || '').trim();
      title = firstLine || '(untitled)';
    }

    const rest = content.startsWith(title) ? content.slice(title.length).trim() : content;

    const createdAt = new Date((evt.created_at || 0) * 1000);
    const pubkey = evt.pubkey?.slice(0, 12) || 'unknown';

    const li = document.createElement('li');
    li.className = 'article';
    li.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <div class="meta">pubkey ${escapeHtml(pubkey)} · ${createdAt.toLocaleString()}</div>
      <div class="content">${escapeHtml(rest)}</div>
    `;
    els.list.appendChild(li);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function submitQuery(ev) {
    ev.preventDefault();
    if (!ws || !isOpen) {
      setStatus('not connected', 'warn');
      return;
    }

    clearList();

    const kind = Number(els.eventKind.value);
    const limit = Number(els.limitN.value);

    if (!Number.isInteger(kind) || kind < 0) {
      setStatus('invalid kind (must be an integer ≥ 0)', 'warn');
      return;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      setStatus('invalid limit N', 'warn');
      return;
    }

    // build filter
    const filter = { kinds: [kind], limit };
    const tagName = (els.tagName.value || '').trim();
    const tagValue = (els.tagValue.value || '').trim();

    // nostr tag filter shape is {"#t": ["value"]} when filtering on tag "t"
    if (tagName && tagValue) {
      filter[`#${tagName}`] = [tagValue];
    }

    // open a new subscription id
    currentSubId = `sub-${Math.random().toString(36).slice(2, 10)}`;

    const req = ['REQ', currentSubId, filter];
    try {
      ws.send(JSON.stringify(req));
      setStatus(`requested events (kind ${kind}, limit ${limit}${tagName && tagValue ? `, #${tagName}=${tagValue}` : ''})…`);
    } catch (e) {
      setStatus(`send failed: ${e.message}`, 'err');
    }
  }

  // wire up UI
  els.connectBtn.addEventListener('click', connect);
  els.disconnectBtn.addEventListener('click', disconnect);
  els.form.addEventListener('submit', submitQuery);

  // convenience: if user pasted a relay url and presses Enter in that input, connect first
  els.relayUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isOpen) {
      e.preventDefault();
      connect();
    }
  });

})();