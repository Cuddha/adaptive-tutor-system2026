#!/usr/bin/env node
/** 打开页面，抓 console 错误和未捕获异常 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const URL_ = process.argv[2];
const PORT = 9700 + (process.pid % 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
      await sleep(250);
    }
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));

    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        console.log(`[console.${m.params.type}] ${args}`);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        console.log(`[EXCEPTION] ${d.text} ${d.exception?.description || ''}`);
        if (d.lineNumber != null) console.log(`    at line ${d.lineNumber + 1}, col ${d.columnNumber + 1}`);
      }
      if (m.method === 'Log.entryAdded') {
        const e = m.params.entry;
        if (e.level === 'error') console.log(`[network] ${e.text} ${e.url || ''}`);
      }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL_ });
    await sleep(6000);

    const r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        problems: window.__probe_problems ?? null,
        bodyLen: document.getElementById('problemBody')?.innerHTML.length,
        titleTxt: document.getElementById('problemTitle')?.textContent,
        listCount: document.querySelectorAll('.oj-problem-item').length
      })`,
      returnByValue: true,
    });
    console.log('--- 状态 ---');
    console.log(r?.result?.value);
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
