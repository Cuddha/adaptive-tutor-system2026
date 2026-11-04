#!/usr/bin/env node
/** 检查学习页是否正常加载数据、按钮可点 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const BASE = 'http://localhost:8325';
const PORT = 9950 + (process.pid % 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  const errors = [];
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
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push('[EXCEPTION] ' + (m.params.exceptionDetails?.exception?.description || ''));
      }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJS = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r?.result?.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');

    // 先注入登录态
    await send('Page.navigate', { url: `${BASE}/pages/index.html` });
    await sleep(2000);
    await evalJS(`(() => {
      localStorage.setItem('pbl.auth.user', JSON.stringify({ nickname: 'tester' }));
      localStorage.setItem('pbl.course.selected', JSON.stringify({ id: 'c-programming', name: 'C语言程序设计' }));
      return 1;
    })()`);

    // 打开学习页
    await send('Page.navigate', { url: `${BASE}/pages/learning_page.html?topic=1_1` });
    await sleep(6000);

    console.log('URL:', await evalJS(`location.pathname + location.search`));
    console.log('标题:', await evalJS(`document.title`));
    console.log('Level 卡片数:', await evalJS(`document.querySelectorAll('.level-card').length`));
    console.log('开始练习按钮:', await evalJS(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => (x.textContent || '').includes('开始练习'));
      return b ? (b.disabled ? '存在但禁用' : '存在且可点') : '未找到';
    })()`));
    console.log('数据是否加载成功:', await evalJS(`(() => {
      const el = document.querySelector('.header-title');
      return el ? el.textContent.trim().slice(0, 40) : 'no-title';
    })()`));

    console.log('\n--- Console 错误 ---');
    if (!errors.length) console.log('（无）');
    else errors.slice(0, 6).forEach((e) => console.log('  ' + e.slice(0, 160)));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('learning_check.png', Buffer.from(shot.data, 'base64'));
    console.log('\n截图: learning_check.png');
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
