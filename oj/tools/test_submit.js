#!/usr/bin/env node
/**
 * 自动在新 OJ 页面提交一段代码，抓判题结果并截图。
 * 用法：node test_submit.js [url] [out.png] [case]
 *   case: ac | wa | ce
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const URL_ = process.argv[2] || 'http://localhost:8325/pages/oj.html';
const OUT = process.argv[3] || 'oj_submit.png';
const CASE = process.argv[4] || 'ac';
const PORT = 9850 + (process.pid % 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CODES = {
  ac: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n',
  wa: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a - b);\n    return 0;\n}\n',
  ce: '#include <stdio.h>\n\nint main() {\n    int a = 1\n    return 0;\n}\n',
  re: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n',
  unknown: '#include <stdio.h>\n#error unsupported platform detected\nint main() { return 0; }\n',
};

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
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        console.log('[EXCEPTION]', m.params.exceptionDetails?.exception?.description || '');
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
    await send('Page.navigate', { url: URL_ });
    await sleep(6000);

    // 填代码
    const filled = await evalJS(`(() => {
      const ta = document.getElementById('codeInput');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(CODES[CASE])});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.length;
    })()`);
    console.log('填入代码长度:', filled);

    // 提交
    await evalJS(`document.getElementById('submitBtn').click(), 1`);
    await sleep(5000);

    // WA 用例顺手点一下「错误定位」，验证 LLM 链路
    if (CASE === 'wa') {
      const hasBtn = await evalJS(`!!document.getElementById('aiDiagBtn')`);
      console.log('AI 定位按钮存在:', hasBtn);
      if (hasBtn) {
        await evalJS(`document.getElementById('aiDiagBtn').click(), 1`);
        await sleep(7000);
      }
    }

    const result = await evalJS(`document.getElementById('resultPanel').innerText`);
    console.log('--- 结果面板 ---');
    console.log(result);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('已保存', OUT);
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
