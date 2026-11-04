#!/usr/bin/env node
/**
 * 模拟「选完课 → 填昵称主题 → 点开始学习」全流程，看最终跳到哪个页面。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const BASE = 'http://localhost:8325';
const PORT = 9900 + (process.pid % 80);
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
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));

    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (args.includes('开始学习') || m.params.type === 'error') {
          console.log(`  [console.${m.params.type}] ${args}`);
        }
      }
      if (m.method === 'Runtime.exceptionThrown') {
        console.log('  [EXCEPTION]', m.params.exceptionDetails?.exception?.description || '');
      }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJS = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r?.exceptionDetails) return `ERR: ${r.exceptionDetails.text}`;
      return r?.result?.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');

    // 1. 先打开一次，写入登录态和课程，再刷新
    await send('Page.navigate', { url: `${BASE}/pages/index.html` });
    await sleep(2500);
    await evalJS(`(() => {
      localStorage.setItem('pbl.auth.user', JSON.stringify({ nickname: 'tester', createdAt: new Date().toISOString() }));
      localStorage.setItem('pbl.course.selected', JSON.stringify({ id: 'c-programming', name: 'C语言程序设计', selectedAt: new Date().toISOString() }));
      return 'injected';
    })()`);

    await send('Page.navigate', { url: `${BASE}/pages/index.html` });
    await sleep(3500);

    console.log('课程读取:', await evalJS(`localStorage.getItem('pbl.course.selected')`));
    console.log('当前 URL:', await evalJS(`location.pathname + location.search`));

    // 2. 填昵称
    console.log('昵称输入框:', await evalJS(`!!document.getElementById('nickname-input')`));
    await evalJS(`(() => {
      const el = document.getElementById('nickname-input');
      if (!el) return 'no-input';
      el.value = 'tester';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    })()`);

    // 3. 选主题
    console.log('主题选项:', await evalJS(`(() => {
      const s = document.getElementById('theme-selector');
      if (!s) return 'no-select';
      const opts = Array.from(s.options).map(o => o.value).filter(Boolean);
      if (opts.length) { s.value = opts[0]; s.dispatchEvent(new Event('change', { bubbles: true })); }
      return JSON.stringify(opts.slice(0, 5));
    })()`));

    await sleep(500);
    console.log('按钮可点击:', await evalJS(`(() => {
      const b = document.getElementById('start-button');
      return b ? !b.disabled : 'no-button';
    })()`));

    // 4. 点开始学习
    await evalJS(`document.getElementById('start-button')?.click(), 1`);
    await sleep(6000);

    console.log('最终 URL:', await evalJS(`location.pathname + location.search`));
    console.log('页面标题:', await evalJS(`document.title`));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('jump_test.png', Buffer.from(shot.data, 'base64'));
    console.log('截图: jump_test.png');
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
