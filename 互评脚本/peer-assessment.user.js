// ==UserScript==
// @name         南开互评填写助手
// @namespace    local.nankai.peer-assessment
// @version      1.2.0
// @description  评分选择“好”，两个评价方面可自定义填写，支持从当前列表逐个提交。
// @match        https://fuxue.nankai.edu.cn/student/otherstu/*
// @match        https://fuxue.nankai.edu.cn/student/stuassess/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const PANEL_ID = 'nankai-peer-assessment-helper';
  if (document.getElementById(PANEL_ID)) return;
  const normalize = value => (value || '').replace(/\s+/g, '').replace(/[：:*＊]/g, '');
  const visible = element => !!element.getClientRects().length;
  const usable = element => !element.disabled && !element.readOnly && !element.closest(`#${PANEL_ID}`);
  const labelText = element => [
    ...Array.from(element.labels || [], label => label.textContent),
    element.getAttribute('aria-label'), element.getAttribute('title')
  ].filter(Boolean).map(normalize);

  // 支持选项标签，以及“好”作为表头、每行一组评分的表格。
  function isGoodRadio(radio) {
    if (labelText(radio).includes('好')) return true;
    const parent = radio.parentElement;
    if (parent && parent.querySelectorAll('input').length === 1 && normalize(parent.textContent) === '好') return true;
    const cell = radio.closest('td, th');
    const row = cell?.parentElement;
    const table = cell?.closest('table');
    if (!cell || !row || !table) return false;
    if (normalize(cell.textContent) === '好') return true;
    // 有跨列/跨行的表格不猜测列位置。
    if (Array.from(row.cells).some(c => c.colSpan !== 1 || c.rowSpan !== 1)) return false;
    return Array.from(table.rows).some(header => {
      if (header.rowIndex >= row.rowIndex || header.cells.length !== row.cells.length) return false;
      if (header.querySelector('input, select, textarea')) return false;
      if (Array.from(header.cells).some(c => c.colSpan !== 1 || c.rowSpan !== 1)) return false;
      return normalize(header.cells[cell.cellIndex]?.textContent) === '好';
    });
  }

  function fieldDescription(field) {
    const texts = [...labelText(field), field.getAttribute('placeholder') || ''];
    for (const id of (field.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      if (id) texts.push(field.ownerDocument.getElementById(id)?.textContent || '');
    }
    let container = field.parentElement;
    for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
      // 只读取单个文本框附近的说明，避免两个评价方面相互混淆。
      if (container.querySelectorAll('textarea, input[type="text"], input:not([type])').length !== 1) break;
      texts.push(container.textContent || '');
      if (container.previousElementSibling && !container.previousElementSibling.querySelector('input, textarea, select')) {
        texts.push(container.previousElementSibling.textContent || '');
      }
    }
    return normalize(texts.join(' '));
  }

  function setValue(field, value) {
    const { HTMLTextAreaElement, HTMLSelectElement, HTMLInputElement, Event } = field.ownerDocument.defaultView;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:16px;background:white;color:#222;border:1px solid #bbb;border-radius:10px;box-shadow:0 3px 16px #0002;max-width:320px;max-height:85vh;overflow:auto;font:14px/1.6 sans-serif';
  const title = document.createElement('strong');
  title.textContent = '互评填写助手';
  const status = document.createElement('div');
  status.textContent = '评分选“好”，请填写下面两个评价方面。单人填写和批量提交均使用这些内容。';
  status.setAttribute('role', 'status');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '按规则填写';
  button.style.cssText = 'margin-top:10px;padding:6px 14px;cursor:pointer';
  const commentsKey = 'nankai-peer-assessment:comments';
  let savedComments = {};
  try {
    const saved = JSON.parse(localStorage.getItem(commentsKey) || '{}');
    if (saved && typeof saved === 'object') savedComments = saved;
  } catch { /* 存储不可用时仍允许本次填写。 */ }
  const commentInputs = new Map();
  panel.append(title, status);
  const storageStatus = document.createElement('div');
  storageStatus.style.cssText = 'font-size:12px;color:#666';
  function saveComments() {
    const values = Object.fromEntries([...commentInputs].map(([aspect, input]) => [aspect, input.value]));
    try {
      localStorage.setItem(commentsKey, JSON.stringify(values));
      storageStatus.textContent = '评语已保存在此浏览器。批量提交使用开始时的内容。';
    } catch {
      storageStatus.textContent = '浏览器无法保存评语，本次仍可使用，刷新后需重新输入。';
    }
  }
  for (const aspect of ['好的方面', '需要改进的方面']) {
    const label = document.createElement('label');
    label.style.cssText = 'display:block;margin-top:10px';
    const caption = document.createElement('span');
    caption.textContent = aspect;
    const input = document.createElement('textarea');
    input.rows = 3;
    input.value = typeof savedComments[aspect] === 'string' ? savedComments[aspect] : 'good';
    input.placeholder = `请输入${aspect}`;
    input.style.cssText = 'display:block;box-sizing:border-box;width:100%;resize:vertical;padding:6px;font:inherit';
    input.addEventListener('input', saveComments);
    commentInputs.set(aspect, input);
    label.append(caption, input);
    panel.append(label);
  }
  panel.append(storageStatus, button);

  function getComments() {
    const values = {};
    for (const [aspect, input] of commentInputs) {
      if (!input.value.trim()) {
        input.focus();
        throw new Error(`请先填写“${aspect}”。`);
      }
      values[aspect] = input.value;
    }
    saveComments();
    return values;
  }
  document.body.append(panel);

  function fill(doc = document, commentValues = getComments()) {
    let scores = 0, skipped = 0, comments = 0;
    const groups = [];
    for (const radio of doc.querySelectorAll('input[type="radio"]')) {
      if (!usable(radio)) continue;
      // 自定义样式可能隐藏原生 radio，但所属区域仍然可见。
      if (!visible(radio) && !visible(radio.closest('label, td, .radio') || radio)) continue;
      if (!radio.name) { skipped++; continue; }
      let group = groups.find(g => g.name === radio.name && g.form === radio.form);
      if (!group) { group = { name: radio.name, form: radio.form, radios: [] }; groups.push(group); }
      group.radios.push(radio);
    }
    for (const group of groups) {
      const good = group.radios.filter(isGoodRadio);
      if (good.length !== 1) { skipped++; continue; }
      if (!good[0].checked) good[0].click();
      if (good[0].checked) scores++; else skipped++;
    }
    for (const select of doc.querySelectorAll('select')) {
      if (!usable(select) || !visible(select) || select.multiple) continue;
      const good = Array.from(select.options).filter(o => normalize(o.textContent) === '好' && !o.disabled && !o.parentElement.disabled);
      if (good.length === 1) { setValue(select, good[0].value); scores++; } else { skipped++; }
    }
    const fields = Array.from(doc.querySelectorAll('textarea, input[type="text"], input:not([type])'))
      .filter(field => usable(field) && visible(field));
    for (const aspect of ['好的方面', '需要改进的方面']) {
      const matched = fields.filter(field => fieldDescription(field).includes(aspect));
      if (matched.length === 1) { setValue(matched[0], commentValues[aspect]); comments++; }
    }
    return { scores, skipped, comments };
  }

  button.addEventListener('click', () => {
    try {
    const { scores, skipped, comments } = fill();
    status.textContent = `已选择 ${scores} 项“好”，填写 ${comments}/2 个评价方面。`
      + (skipped ? `有 ${skipped} 组评分无法明确识别，请手动检查。` : '')
      + (comments !== 2 ? '未识别的文本框请手动填写。' : '')
      + '请核对页面后手动提交。';
    } catch (error) {
      status.textContent = error.message;
    }
  });
  const batch = document.createElement('button');
  batch.type = 'button';
  batch.textContent = '从当前列表逐个提交';
  batch.style.cssText = button.style.cssText;
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = '停止后续提交';
  stop.disabled = true;
  panel.append(batch, stop);
  let stopped = false;
  let running = false;
  let frame;
  const ledgerKey = `nankai-peer-assessment:submitted:${location.pathname}`;
  // 当前标签页保留已成功/结果不明记录，结果不明的提交不自动重试。
  function readLedger() {
    try { return JSON.parse(sessionStorage.getItem(ledgerKey) || '{}'); }
    catch { throw new Error('无法读取提交记录，请检查浏览器存储设置。'); }
  }
  function record(url, state) {
    const ledger = readLedger();
    ledger[url] = state;
    sessionStorage.setItem(ledgerKey, JSON.stringify(ledger));
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  stop.addEventListener('click', () => { stopped = true; stop.disabled = true; });

  function collectStudents() {
    const mid = location.pathname.match(/\/stuassess\/id\/(\d+)\.html$/)?.[1];
    if (!mid) throw new Error('请先返回学生互评列表页再开始批量提交。');
    const ledger = readLedger();
    const students = new Map();
    for (const link of document.querySelectorAll('a[href]')) {
      const url = new URL(link.getAttribute('href'), location.href);
      const match = url.pathname.match(/^\/student\/otherstu\/mid\/(\d+)\/sid\/(\d+)\.html$/);
      if (url.origin !== location.origin || !match || match[1] !== mid) continue;
      const canonical = url.origin + url.pathname;
      const row = link.closest('tr, li');
      const done = row && /^(已评价|已评|评价完成|已完成)$/.test(normalize(row.querySelector('.status')?.textContent))
        || row && Array.from(row.querySelectorAll('td, span')).some(cell => /^(已评价|已评|评价完成)$/.test(normalize(cell.textContent)));
      if (done || ledger[canonical]) continue;
      students.set(canonical, { url: canonical, name: (link.textContent || '').trim() || `学生 ${match[2]}` });
    }
    return [...students.values()];
  }

  async function loadStudent(url) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { frame.onload = null; reject(new Error('学生页面加载超时。')); }, 20000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
      frame.src = url;
    });
    await pause(800);
    const doc = frame.contentDocument;
    if (!doc || frame.contentWindow.location.pathname !== new URL(url).pathname) {
      throw new Error('未能打开目标学生页面，可能需要重新登录。');
    }
    return doc;
  }

  function successMessages(doc) {
    if (!doc?.body) return [];
    return Array.from(doc.body.querySelectorAll('div, span, p, h1, h2, h3, td'))
      .filter(el => !el.children.length && visible(el))
      .map(el => normalize(el.textContent))
      .filter(text => /^(评价成功|提交成功|保存成功|操作成功)[！!。.]?$/.test(text));
  }

  batch.addEventListener('click', async () => {
    if (running) return;
    let completed = 0;
    try {
      const commentValues = getComments();
      const students = collectStudents();
      if (!students.length) { status.textContent = '当前列表没有可处理的学生链接；已记录的提交不会重复处理。分页需手动切换。'; return; }
      running = true; stopped = false;
      for (const input of commentInputs.values()) input.disabled = true;
      batch.disabled = button.disabled = true; stop.disabled = false;
      frame?.remove();
      frame = document.createElement('iframe');
      frame.title = '正在处理的学生互评页面';
      frame.style.cssText = 'position:fixed;left:12px;top:12px;width:calc(100vw - 390px);height:85vh;z-index:2147483646;background:white;border:2px solid #888';
      document.body.append(frame);
      for (const [index, student] of students.entries()) {
        if (stopped) break;
        status.textContent = `正在处理 ${index + 1}/${students.length}：${student.name}，已成功 ${completed} 人。`;
        const doc = await loadStudent(student.url);
        if (stopped) break;
        const result = fill(doc, commentValues);
        if (!result.scores || result.skipped || result.comments !== 2) {
          throw new Error(`表单识别不完整：评分 ${result.scores} 项，未识别 ${result.skipped} 组，评价 ${result.comments}/2 项。尚未提交当前学生。`);
        }
        const candidates = Array.from(doc.querySelectorAll('button, input[type="submit"], input[type="button"], a'))
          .filter(el => usable(el) && visible(el) && /^(提交|提交评价|提交评议|保存|保存评价)$/.test(normalize(el.value || el.textContent)));
        if (candidates.length !== 1) throw new Error('无法唯一识别提交按钮，尚未提交当前学生。');
        const submit = candidates[0];
        if (submit.form && !submit.form.checkValidity()) throw new Error('表单校验未通过，尚未提交当前学生。');
        if (successMessages(doc).length) throw new Error('页面已有成功提示，无法判断是否为本次提交，已暂停。');
        await pause(1200);
        if (stopped) break;
        record(student.url, 'pending');
        submit.click();
        let success = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          await pause(250);
          const current = frame.contentDocument;
          if (successMessages(current).length) { success = true; break; }
          if (current?.body && /(?:提交失败|保存失败|评价失败|登录失效)/.test(current.body.innerText)) break;
        }
        if (!success) throw new Error('未检测到明确的提交成功提示。请检查左侧页面或列表记录；该学生已记为结果不明，不会自动重试。');
        record(student.url, 'done');
        completed++;
        await pause(1000);
      }
      status.textContent = `${stopped ? '已停止' : '当前列表处理结束'}，确认成功 ${completed} 人。分页请切换后继续。`;
    } catch (error) {
      status.textContent = `已暂停，确认成功 ${completed} 人。${error.message}`;
    } finally {
      running = false;
      for (const input of commentInputs.values()) input.disabled = false;
      batch.disabled = button.disabled = false;
      stop.disabled = true;
    }
  });
})();
