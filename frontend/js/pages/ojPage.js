/**
 * C语言在线练习页
 * 三栏布局：题目列表 / 题目+代码 / AI 助教
 * 后端接口统一走 /oj-api/ 前缀（nginx 反代到 oj-backend:8000）
 */

const API = '/oj-api';

// ---------------- 状态 ----------------
let problems = [];
let current = null;
let currentLang = 'C';
let lastSubmissionId = null;
let diagnosis = null;
let submitting = false;
let diagnosing = false;
let codeCache = {};          // 按题目 id 记住代码
let errorLines = new Set();  // 编译错误行（红）
let warnLines = new Set();   // 编译警告行（黄）
let aiLines = new Set();     // AI 定位行（橙）

const $ = (id) => document.getElementById(id);

const TEMPLATES = {
  C: '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n',
  'C++': '#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  Python3: '# 请在下方编写代码\n',
};
// ---------------- 初始化 ----------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindLayout();
  bindEditor();
  bindChat();
  bindBack();

  await loadProblems();
  restoreLayout();

  // 顶部显示通过数
  updateProgress();
}

function bindBack() {
  $('backButton').addEventListener('click', () => {
    // C 语言课程没有对应的 learning_page 内容（那边的 topic 是 HTML 课的），
    // 所以回到选课页，可以重新选课或再次进入
    window.location.href = '/pages/course_selection.html';
  });
}

// ---------------- 题目列表 ----------------
async function loadProblems() {
  try {
    const res = await fetch(`${API}/problems`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    problems = await res.json();
    renderProblemList();
    $('ojCount').textContent = `${problems.length} 道`;

    const params = new URLSearchParams(window.location.search);
    const pid = Number(params.get('pid'));          // 从学习页点具体题目过来
    const chapter = Number(params.get('chapter'));  // 从学习页点「进入测试」过来

    const target = pid ? problems.find((p) => p.id === pid) : null;

    // 带 chapter 参数但没指定题目时，选中该章的第一道题
    let chapterFirstId = null;
    if (!target && chapter) {
      const box = document.querySelector(`.oj-chapter-items[data-ch="${chapter}"]`);
      const firstItem = box && box.querySelector('.oj-problem-item');
      if (firstItem) chapterFirstId = Number(firstItem.dataset.id);
    }

    const startId = target ? target.id : (chapterFirstId ?? (problems[0] ? problems[0].id : null));

    if (startId != null) {
      await selectProblem(startId);
    }
  } catch (err) {
    $('problemList').innerHTML =
      `<div class="oj-list-loading">题目加载失败：${err.message}</div>`;
  }
}

function renderProblemList() {
  // 按 source（如 "A · 输入输出与复杂度"）分组
  const groups = new Map();
  for (const p of problems) {
    const key = p.source || '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const frag = document.createDocumentFragment();
  let chapterNo = 0;

  for (const [groupName, items] of groups) {
    chapterNo += 1;
    const no = chapterNo;
    // "A · 输入输出与复杂度" → "输入输出与复杂度"
    const pureName = groupName.includes('·')
      ? groupName.split('·').slice(1).join('·').trim()
      : groupName;

    // 第一层：章节标题（点击 → 中间区域显示该章学习内容）
    const head = document.createElement('div');
    head.className = 'oj-chapter-head';
    head.dataset.ch = String(no);
    head.innerHTML =
      `<iconify-icon icon="mdi:book-open-variant" width="15" height="15" class="oj-ch-arrow"></iconify-icon>` +
      `<span class="oj-ch-name">第 ${no} 章 · ${escapeHtml(pureName)}</span>` +
      `<span class="oj-ch-count">${items.length}</span>`;
    head.addEventListener('click', () => selectChapter(no, pureName, items));
    frag.appendChild(head);

    // 第二层：该章题目（常显）
    const box = document.createElement('div');
    box.className = 'oj-chapter-items';
    box.dataset.ch = String(no);
    for (const p of items) {
      const el = document.createElement('div');
      el.className = 'oj-problem-item';
      el.dataset.id = String(p.id);
      el.innerHTML =
        `<span class="oj-p-title">${escapeHtml(p.title)}</span>` +
        `<span class="oj-diff" data-d="${escapeHtml(p.difficulty || '')}">${escapeHtml(p.difficulty || '')}</span>`;
      el.addEventListener('click', () => selectProblem(p.id));
      box.appendChild(el);
    }
    frag.appendChild(box);
  }

  const list = $('problemList');
  list.innerHTML = '';
  list.appendChild(frag);
}

/** 展开某一章的题目，其余章收起（保留函数，供旧逻辑调用） */
function expandChapter(no) {
  for (const box of document.querySelectorAll('.oj-chapter-items')) {
    box.classList.toggle('is-open', box.dataset.ch === String(no));
  }
  for (const head of document.querySelectorAll('.oj-chapter-head')) {
    head.classList.toggle('is-open', head.dataset.ch === String(no));
  }
}

/* ---------------- 章节学习内容（同页切换，不跳转） ---------------- */

async function selectChapter(no, name, items) {
  // 左栏：高亮章节、取消题目高亮
  for (const el of document.querySelectorAll('.oj-chapter-head')) {
    el.classList.toggle('is-active', el.dataset.ch === String(no));
  }
  for (const el of document.querySelectorAll('.oj-problem-item')) {
    el.classList.remove('is-active');
  }

  
  // 学习模式：收起代码区，把空间全给内容
  document.body.classList.add('is-lesson-mode');

  // 切到学习视图时清掉上一次的判题结果
  diagnosis = null;
  lastDetail = null;
  errorLines.clear();
  warnLines.clear();
  aiLines.clear();
  renderResult(null);

  $('problemTitle').textContent = `第 ${no} 章 · ${name}`;
  $('problemMeta').innerHTML = `<span>${items.length} 道练习</span>`;
  $('problemBody').innerHTML = '<div class="oj-empty">加载章节内容…</div>';

  try {
    const res = await fetch(`${API}/lessons/${no}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    renderLessonInto(d);
  } catch (err) {
    $('problemBody').innerHTML =
      `<div class="oj-empty">章节内容加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderLessonInto(d) {
  const points = (d.points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');

  const pitfalls = (d.pitfalls || []).map((p) => `
    <li>
      <iconify-icon icon="mdi:alert-circle-outline" width="15" height="15"></iconify-icon>
      <span>${escapeHtml(p)}</span>
    </li>`).join('');

  const problemLinks = (d.problems || []).map((pid) => {
    const p = problems.find((x) => x.id === pid);
    return `
      <div class="oj-lesson-problem" data-pid="${pid}">
        <iconify-icon icon="mdi:code-tags" width="15" height="15"></iconify-icon>
        <span class="oj-lesson-pid">#${pid}</span>
        <span>${escapeHtml(p ? p.title : '')}</span>
      </div>`;
  }).join('');

  $('problemBody').innerHTML = `
    <div class="oj-lesson">
      <div class="oj-lesson-intro">${escapeHtml(d.intro || '')}</div>

      ${d.definition ? `
        <div class="oj-sub-title">概念定义</div>
        <div class="oj-lesson-definition">${escapeHtml(d.definition)}</div>
      ` : ''}

      ${d.structure ? `
        <div class="oj-sub-title">结构示意</div>
        <pre class="oj-lesson-structure">${escapeHtml(d.structure)}</pre>
      ` : ''}

      <div class="oj-sub-title">本章要点</div>
      <ol class="oj-lesson-points">${points}</ol>

      ${d.example ? `
        <div class="oj-sub-title">代码示例</div>
        <pre class="oj-lesson-code">${escapeHtml(d.example)}</pre>
      ` : ''}

      ${pitfalls ? `
        <div class="oj-sub-title">常见错误</div>
        <ul class="oj-lesson-pitfalls">${pitfalls}</ul>
      ` : ''}

      ${problemLinks ? `
        <div class="oj-sub-title">本章练习</div>
        <div class="oj-lesson-problems">${problemLinks}</div>
      ` : ''}
    </div>
  `;

  for (const el of document.querySelectorAll('.oj-lesson-problem')) {
    el.addEventListener('click', () => selectProblem(Number(el.dataset.pid)));
  }
}

async function selectProblem(id) {
  const brief = problems.find((x) => x.id === id);
  if (!brief) return;

  // 切换前存下当前代码
  if (current) codeCache[current.id] = $('codeInput').value;
  current = brief;
  diagnosis = null;
  lastSubmissionId = null;
  errorLines.clear();
  aiLines.clear();
  warnLines.clear();
  renderResult(null);

  for (const el of document.querySelectorAll('.oj-problem-item')) {
    el.classList.toggle('is-active', el.dataset.id === String(id));
  }
  // 切回题目视图时，取消章节高亮
  for (const el of document.querySelectorAll('.oj-chapter-head')) {
    el.classList.remove('is-active');
  }
  // 退出学习模式，恢复代码区
  document.body.classList.remove('is-lesson-mode');
  // 恢复上下分栏高度
  $('problemPane').style.height = localStorage.getItem('oj.problemHeight')
    ? `${localStorage.getItem('oj.problemHeight')}px` : '';

  // 先用标题占位，再拉完整题面
  $('problemTitle').textContent = brief.title;
  $('problemBody').innerHTML = '<div class="oj-empty">加载题目…</div>';
  $('codeInput').value = codeCache[brief.id] || TEMPLATES[currentLang] || '';
  syncGutter();

  // 列表接口只给精简字段（id/title/难度…），description 这些要单独取
  try {
    const res = await fetch(`${API}/problems/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const full = await res.json();
    current = full;
    renderProblem(full);
  } catch (err) {
    $('problemBody').innerHTML =
      `<div class="oj-empty">题目加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderProblem(p) {
  $('problemTitle').textContent = p.title;
  $('problemMeta').innerHTML =
    `<span>时间限制 ${p.time_limit} ms</span>` +
    `<span>内存限制 ${p.memory_limit} MB</span>` +
    (p.knowledge ? `<span>${escapeHtml(p.knowledge)}</span>` : '');

  const samples = (p.samples || []).map((s, i) => `
    <div class="oj-sample">
      <div class="oj-sample-label">样例 ${i + 1} 输入</div><pre>${escapeHtml(s.input || '')}</pre>
      <div class="oj-sample-label" style="margin-top:6px">样例 ${i + 1} 输出</div><pre>${escapeHtml(s.output || '')}</pre>
    </div>
  `).join('');

  $('problemBody').innerHTML = `
    <div class="oj-desc">${p.description || ''}</div>
    ${p.input_description ? `<div class="oj-sub-title">输入格式</div><div class="oj-desc">${p.input_description}</div>` : ''}
    ${p.output_description ? `<div class="oj-sub-title">输出格式</div><div class="oj-desc">${p.output_description}</div>` : ''}
    ${samples ? `<div class="oj-sub-title">样例</div>${samples}` : ''}
  `;
}

function updateProgress() {
  $('ojProgress').textContent = `${problems.length} 道题`;
}

// ---------------- 编辑器 ----------------
function bindEditor() {
  const input = $('codeInput');
  const gutter = $('gutter');

  const sync = () => {
    syncGutter();
  };

  input.addEventListener('input', sync);
  input.addEventListener('scroll', () => {
    gutter.scrollTop = input.scrollTop;
  });
  input.addEventListener('keydown', (e) => {
    // Tab 插入 4 个空格
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.slice(0, start) + '    ' + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + 4;
      syncGutter();
    }
  });

  $('languageSelect').addEventListener('change', (e) => {
    currentLang = e.target.value;
    // 只有代码是空模板时才替换，避免覆盖用户写的内容
    const val = input.value.trim();
    const isTemplate = Object.values(TEMPLATES).some((t) => t.trim() === val);
    if (!val || isTemplate) {
      input.value = TEMPLATES[currentLang] || '';
      syncGutter();
    }
  });

  $('resetBtn').addEventListener('click', () => {
    if (!confirm('确定要清空当前代码吗？')) return;
    input.value = TEMPLATES[currentLang] || '';
    syncGutter();
    renderResult(null);
    errorLines.clear();
    aiLines.clear();
    warnLines.clear();
    syncGutter();
  });

  $('submitBtn').addEventListener('click', submit);
}

function syncGutter() {
  const input = $('codeInput');
  const gutter = $('gutter');
  const count = input.value.split('\n').length;

  let html = '';
  for (let i = 1; i <= count; i++) {
    let cls = '';
    if (errorLines.has(i)) cls = 'ln-err';
    else if (warnLines.has(i)) cls = 'ln-warn';
    else if (aiLines.has(i)) cls = 'ln-ai';
    html += `<span class="${cls}">${i}</span>`;
  }
  gutter.innerHTML = html;
  gutter.scrollTop = input.scrollTop;
}

// ---------------- 提交判题 ----------------
async function submit() {
  if (!current || submitting) return;
  const code = $('codeInput').value;
  const meaningful = code
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
  if (!meaningful.length) {
    alert('请先编写代码再提交');
    return;
  }

  submitting = true;
  diagnosis = null;
  errorLines.clear();
  aiLines.clear();
  warnLines.clear();
  syncGutter();
  renderResult({ status: 'Pending', message: '正在编译并运行…' });
  $('submitBtn').disabled = true;

  try {
    const res = await fetch(`${API}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problem_id: current.id,
        language: currentLang,
        code,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { submission_id } = await res.json();
    lastSubmissionId = submission_id;
    await poll(submission_id);
  } catch (err) {
    renderResult({ status: 'SE', message: `提交失败：${err.message}` });
  } finally {
    submitting = false;
    $('submitBtn').disabled = false;
  }
}

async function poll(sid) {
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      const res = await fetch(`${API}/submissions/${sid}`);
      const s = await res.json();
      if (s.status !== 'Pending') {
        const detail = s.detail && s.detail.status
          ? s.detail
          : { status: s.status, message: s.message };
        renderResult(detail);
        return;
      }
    } catch {
      /* 继续重试 */
    }
  }
  renderResult({ status: 'SE', message: '判题超时，请稍后重试' });
}

// ---------------- 结果渲染 ----------------
let lastDetail = null;

function renderResult(detail) {
  if (detail) lastDetail = detail;
  const box = $('resultPanel');

  if (!detail) {
    box.innerHTML = '';
    errorLines.clear();
    warnLines.clear();
    aiLines.clear();
    syncGutter();
    return;
  }

  // 行号标记：错误标红、警告标黄
  errorLines = new Set();
  for (const d of detail.diagnostics || []) {
    const n = d.fix_line || d.line;
    if (n) errorLines.add(n);
  }
  warnLines = new Set();
  for (const w of detail.warnings || []) {
    const n = w.fix_line || w.line;
    if (n) warnLines.add(n);
  }
  syncGutter();

  const statusText = {
    AC: '全部通过', WA: '答案错误', CE: '编译错误',
    RE: '运行时错误', TLE: '运行超时', MLE: '内存超限',
    Pending: '判题中', SE: '系统错误',
  };

  let html = `<div class="oj-result-inner">
    <div class="oj-status-row">
      <span class="oj-badge" data-s="${detail.status}">${statusText[detail.status] || detail.status}</span>
      <span class="oj-status-msg">${escapeHtml(detail.message || '')}</span>
    </div>`;

  // 编译诊断
  for (const d of detail.diagnostics || []) {
    html += `
      <div class="oj-diag">
        <div class="oj-diag-head">
          <span class="oj-diag-loc">${escapeHtml(lineLabel(d))}</span>
          <span class="oj-diag-type">${escapeHtml(d.type_zh || '编译错误')}</span>
          ${d.knowledge ? `<span class="oj-diag-know">${escapeHtml(d.knowledge)}</span>` : ''}
        </div>
        <div class="oj-diag-explain">${escapeHtml(d.explain || '')}</div>
        ${renderSnippet(d.snippet)}
      </div>`;
  }

  // 编译警告
  if ((detail.warnings || []).length) {
    html += `<div class="oj-warns">
      <div class="oj-warns-head">编译通过，但有 ${detail.warnings.length} 条警告</div>
      ${detail.warnings.map((w) => `
        <div class="oj-warn-item">
          <span>${escapeHtml(lineLabel(w))}</span>
          <span><b>${escapeHtml(w.type_zh || '')}</b></span>
          <span>${escapeHtml(w.explain || '')}</span>
        </div>`).join('')}
    </div>`;
  }

  // AI 定位
  if (diagnosis && (diagnosis.errors || []).length) {
    html += `<div class="oj-ai-diag">
      <div class="oj-ai-head">
        <iconify-icon icon="mdi:auto-fix" width="16" height="16"></iconify-icon>
        AI 定位 <span class="oj-ai-sum">${escapeHtml(diagnosis.summary || '')}</span>
      </div>
      ${diagnosis.errors.map((e) => `
        <div class="oj-ai-item">
          <div class="oj-ai-item-head">
            <span class="oj-ai-line">第 ${e.line} 行</span>
            <span class="oj-ai-type">${escapeHtml(e.type || '')}</span>
          </div>
          <div class="oj-ai-why">${escapeHtml(e.why || '')}</div>
        </div>`).join('')}
    </div>`;
  }

  // 错误定位按钮
  if (canDiagnose(detail) && !diagnosis) {
    html += `<div class="oj-ai-action">
      <button class="oj-btn" id="aiDiagBtn" ${diagnosing ? 'disabled' : ''}>
        ${diagnosing ? '正在分析代码…' : '错误定位'}
      </button>
      <span class="oj-ai-hint">让 AI 帮你找出哪几行有问题、为什么错</span>
    </div>`;
  }

  // 测试点
  if ((detail.cases || []).length) {
    html += `<div class="oj-cases">${detail.cases.map((c) => `
      <div class="oj-case">
        <span class="oj-case-badge" data-s="${c.status}">${c.status}</span>
        <span>测试点 #${c.index}</span>
        <span>${c.time_ms} ms</span>
        <span>${escapeHtml((c.message || '').slice(0, 80))}</span>
      </div>`).join('')}</div>`;
  }

  html += '</div>';
  box.innerHTML = html;

  const aiBtn = $('aiDiagBtn');
  if (aiBtn) aiBtn.addEventListener('click', diagnoseErrors);
}

function renderSnippet(snippet) {
  if (!snippet || !snippet.length) return '';
  const text = snippet.map((line) => {
    // GCC 的片段里 `^^^` 那行是错误位置，标红
    if (/^\s*\^+\s*$/.test(line)) return `<b>${escapeHtml(line)}</b>`;
    return escapeHtml(line);
  }).join('\n');
  return `<div class="oj-diag-code">${text}</div>`;
}

function lineLabel(d) {
  if (d.fix_line && d.fix_line !== d.line) return `改第 ${d.fix_line} 行`;
  if (!d.line) return '链接阶段';
  return d.col ? `第 ${d.line} 行 ${d.col} 列` : `第 ${d.line} 行`;
}

function canDiagnose(detail) {
  const st = detail.status;
  if (!st || st === 'AC' || st === 'CE' || st === 'Pending') return false;
  // 代码太短（只有框架）就不给按钮
  const meaningful = $('codeInput').value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('#') &&
      l !== '{' && l !== '}' && l !== 'return 0;' && !/^(int|void)\s+main/.test(l));
  return meaningful.length >= 2;
}

async function diagnoseErrors() {
  if (!current || !lastSubmissionId || diagnosing) return;
  diagnosing = true;
  const btn = $('aiDiagBtn');
  if (btn) { btn.disabled = true; btn.textContent = '正在分析代码…'; }

  try {
    const res = await fetch(`${API}/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problem_id: current.id,
        submission_id: lastSubmissionId,
      }),
    });
    const r = await res.json();
    if (!r.ok) {
      alert(r.error || '定位失败');
      return;
    }
    diagnosis = r;
    aiLines = new Set((r.errors || []).map((e) => e.line));
    syncGutter();
    renderResult(lastDetail);   // 带着原始结果重新渲染，追加 AI 区块
  } catch (err) {
    alert(`定位请求失败：${err.message}`);
  } finally {
    diagnosing = false;
  }
}

// ---------------- AI 聊天 ----------------
function bindChat() {
  const send = async () => {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    appendMsg('is-user', text);
    const loadingEl = appendMsg('is-ai', '思考中…');

    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          problem_id: current ? current.id : null,
          code: $('codeInput').value || null,
        }),
      });
      const r = await res.json();
      loadingEl.textContent = r.reply || '（无回复）';
    } catch (err) {
      loadingEl.textContent = `请求失败：${err.message}`;
    }
  };

  $('chatSendBtn').addEventListener('click', send);
  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  $('chatCloseBtn').addEventListener('click', () => toggleChat(false));
  $('chatToggleBtn').addEventListener('click', () => {
    toggleChat($('ojChat').classList.contains('is-hidden'));
  });
}

function appendMsg(cls, text) {
  const el = document.createElement('div');
  el.className = `oj-msg ${cls}`;
  el.textContent = text;
  const body = $('chatBody');
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

function toggleChat(show) {
  const chat = $('ojChat');
  if (!show) {
    chat.classList.add('is-hidden');
    $('splitterRight').style.display = 'none';
  } else {
    chat.classList.remove('is-hidden');
    $('splitterRight').style.display = '';
  }
}

// ---------------- 布局拖拽 ----------------
function bindLayout() {
  const layout = $('ojLayout');

  // 左栏宽度
  dragV($('splitterLeft'), (dx) => {
    const sb = $('ojSidebar');
    const w = Math.min(Math.max(sb.offsetWidth + dx, 170), 380);
    sb.style.width = `${w}px`;
    localStorage.setItem('oj.sidebarWidth', String(w));
  }, () => $('ojSidebar').offsetWidth);

  // 右栏宽度（方向相反）
  dragV($('splitterRight'), (dx) => {
    const chat = $('ojChat');
    const w = Math.min(Math.max(chat.offsetWidth - dx, 260), 480);
    chat.style.width = `${w}px`;
    localStorage.setItem('oj.chatWidth', String(w));
  }, () => $('ojChat').offsetWidth);

  // 中栏上下
  dragH($('splitterH'), (dy) => {
    const pane = $('problemPane');
    const maxH = Math.max(140, $('ojWorkspace').clientHeight - 200);
    const h = Math.min(Math.max(pane.offsetHeight + dy, 120), maxH);
    pane.style.height = `${h}px`;
    localStorage.setItem('oj.problemHeight', String(h));
  }, () => $('problemPane').offsetHeight);

  // 折叠左栏
  const setSidebar = (hidden) => {
    $('ojSidebar').classList.toggle('is-hidden', hidden);
    $('splitterLeft').style.display = hidden ? 'none' : '';
    $('sidebarFab').classList.toggle('is-hidden', !hidden);
    localStorage.setItem('oj.sidebarHidden', hidden ? '1' : '0');
  };

  $('collapseBtn').addEventListener('click', () => setSidebar(true));
  $('sidebarFab').addEventListener('click', () => setSidebar(false));

  function dragV(handle, onMove, getStart) {
    if (!handle) return;
    handle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      layout.classList.add('is-dragging');
      let last = ev.clientX;
      const move = (e) => {
        onMove(e.clientX - last);
        last = e.clientX;
      };
      const up = () => {
        layout.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function dragH(handle, onMove, getStart) {
    if (!handle) return;
    handle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      layout.classList.add('is-dragging');
      let last = ev.clientY;
      const move = (e) => {
        onMove(e.clientY - last);
        last = e.clientY;
      };
      const up = () => {
        layout.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }
}

function restoreLayout() {
  const sw = Number(localStorage.getItem('oj.sidebarWidth'));
  if (sw >= 170 && sw <= 380) $('ojSidebar').style.width = `${sw}px`;

  // 恢复左栏折叠状态
  if (localStorage.getItem('oj.sidebarHidden') === '1') {
    $('ojSidebar').classList.add('is-hidden');
    $('splitterLeft').style.display = 'none';
    $('sidebarFab').classList.remove('is-hidden');
  }

  const cw = Number(localStorage.getItem('oj.chatWidth'));
  if (cw >= 260 && cw <= 480) $('ojChat').style.width = `${cw}px`;

  const ph = Number(localStorage.getItem('oj.problemHeight'));
  if (ph > 100) $('problemPane').style.height = `${ph}px`;
  else {
    const ws = $('ojWorkspace');
    if (ws) $('problemPane').style.height = `${Math.round(ws.clientHeight * 5 / 11)}px`;
  }
}

// ---------------- 工具 ----------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
