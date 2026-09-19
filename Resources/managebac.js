/* CampusDesk ManageBac adapter. Read-only DOM; no cookies, network, or private app state.
   Selectors verified against Beijing 101's rendered ManageBac task pages, 2026-09-18. */
(function (root) {
  'use strict';
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = node => node ? clean(node.innerText == null ? node.textContent : node.innerText) : '';
  const all = (node, selector) => Array.from(node.querySelectorAll(selector));
  const first = (node, selector) => node.querySelector(selector);
  function visible(node) {
    if (!node || node.closest('[hidden],[aria-hidden="true"]')) return false;
    if (node.getClientRects && node.getClientRects().length === 0) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    if (view && view.getComputedStyle) {
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }
  function safeURL(href, base) {
    try {
      if (!href || String(href).includes('#')) return null;
      const url = new URL(href, base), home = new URL(base);
      if (url.protocol !== 'https:' || url.origin !== home.origin || url.username || url.password) return null;
      if (!/^\/student\//.test(url.pathname) || /(?:logout|delete|destroy|dropbox|upload|edit|new)(?:\/|$)/i.test(url.pathname)) return null;
      // Do not preserve signed attachment links, credentials, or unrelated actions.
      if ([...url.searchParams.keys()].some(k => !/^(?:term|page|academic_year|year|view|filter)$/.test(k))) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function courseID(url) { return (String(url).match(/\/student\/classes\/(\d+)(?:\/|$)/) || [])[1] || null; }
  function taskID(url) { return (String(url).match(/\/core_tasks\/(\d+)(?:\/|$)/) || [])[1] || null; }
  function overallPercentage(label, value) {
    if (!/^(?:overall|overall grade|term overall|总评|总成绩)$/i.test(clean(label))) return null;
    const match = clean(value).match(/(?:^|[^\d.])(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!match) return null;
    const valueNumber = Number(match[1]);
    return valueNumber >= 0 && valueNumber <= 100 ? valueNumber : null;
  }
  function taskStatus(item) {
    // A pending dropbox badge can coexist with a recorded quiz grade.
    if (item.points && /\d\s*\/\s*\d/.test(item.points)) return 'graded';
    if (/^(?:submitted|已提交)$/i.test(item.badge)) return 'submitted';
    if (/not submitted|pending|未提交|待提交/i.test(item.badge + ' ' + item.assessment)) return 'pending';
    if (/^upcoming$/i.test(item.section)) return 'upcoming';
    return 'unknown';
  }
  function exactDate(value) {
    // A month/day card omits year and timezone; keep its original dueLabel instead.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value || '')) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  function nearbySection(card) {
    let node = card.previousElementSibling;
    while (node) {
      const heading = node.matches('h3') ? node : first(node, 'h3');
      if (heading) return text(heading);
      node = node.previousElementSibling;
    }
    return '';
  }
  function collect(doc, url) {
    const page = {
      url, title: doc.title || '', heading: text(first(doc, 'main h1, #main-content h1')),
      hasPassword: all(doc, 'input[type="password"]').some(visible),
      loginText: text(first(doc, 'main, #main-content, body')).slice(0, 1800),
      term: text(first(doc, 'select#term option:checked')),
      recognized: all(doc, 'main h2, #main-content h2').some(x => /^(?:All Tasks|Task Details|所有任务|任务详情)$/i.test(text(x))),
      links: [], overallRows: [], tasks: [], feedback: [], gpaRows: []
    };
    for (const a of all(doc, 'a[href]')) {
      if (!visible(a)) continue;
      const href = safeURL(a.getAttribute('href'), url);
      if (href) page.links.push({url:href, title:text(a)});
    }
    // Only explicit sidebar overall rows are eligible for whole-course grades.
    for (const label of all(doc, 'aside strong, [role="complementary"] strong, .list-item strong')) {
      if (!visible(label) || !/^(?:Overall|Overall Grade|Term Overall|总评|总成绩)$/i.test(text(label))) continue;
      const row = label.closest('.list-item, tr');
      if (!row || row.closest('.short-assignment, .task-score')) continue;
      const cells = all(row, '.cell, td');
      page.overallRows.push({label:text(label), value:cells.length > 1 ? text(cells[cells.length - 1]) : text(row)});
    }
    for (const card of all(doc, 'main .short-assignment, #main-content .short-assignment')) {
      if (!visible(card)) continue;
      const anchor = first(card, '.title a[href*="/core_tasks/"]');
      const cardURL = anchor ? safeURL(anchor.getAttribute('href'), url) : (taskID(url) ? url : null);
      if (!cardURL) continue;
      const titleNode = first(card, '.title');
      const datetime = first(card, '.due-date time[datetime], .date-badge time[datetime]');
      page.tasks.push({url:cardURL, title:anchor ? text(anchor) : text(titleNode),
        month:text(first(card,'.date-badge .month')), day:text(first(card,'.date-badge .day')),
        dueText:text(first(card,'.due-date')), datetime:datetime && datetime.getAttribute('datetime'),
        badge:text(first(card,'.badge-label')), points:text(first(card,'.task-score .points')),
        assessment:text(first(card,'.task-score')), section:nearbySection(card)});
    }
    // Restrict feedback to explicitly labeled feedback blocks. Discussions and task
    // instructions are not teacher feedback. No feedback was present in observed tasks.
    for (const heading of all(doc, 'main h2, main h3, main h4, main h5, main h6, main .feedback-label, main .teacher-comment-label')) {
      if (!visible(heading) || !/^(?:Teacher(?:'s)? (?:Feedback|Comments?)|Feedback|教师评语|老师反馈|教师反馈)$/i.test(text(heading))) continue;
      const block = heading.nextElementSibling;
      if (!block || !visible(block) || block.matches('form, textarea, input, button') || first(block,'textarea, input[type="text"]')) continue;
      const body = String(block.innerText == null ? block.textContent || '' : block.innerText).trim();
      if (!body || /^(?:No feedback|No comments|暂无评语|暂无反馈)[.!。]?$/i.test(body)) continue;
      const teacher = text(first(block,'.teacher-name, .author-name')) || null;
      const time = first(block,'time');
      page.feedback.push({text:body,teacher,date:time ? (time.getAttribute('datetime') || text(time)) : null});
    }
    // Official GPA is accepted only in a compact explicitly labeled DOM row with scale.
    for (const row of all(doc,'main tr, main .list-item')) {
      if (!visible(row)) continue;
      const rowText = text(row);
      if (/^(?:Cumulative GPA|Overall GPA|GPA|累计 GPA|平均绩点)\s*[:：]?\s*\d/i.test(rowText) && rowText.length < 120) page.gpaRows.push(rowText);
    }
    return page;
  }
  function fromProjection(page, capturedAt) {
    const result = {source:'managebac',url:page.url,title:page.title || '',capturedAt:capturedAt || new Date().toISOString(),
      loginRequired:false,parseError:false,courses:[],tasks:[],feedback:[],links:[],officialGPA:null,warnings:[]};
    let path = ''; try { path = new URL(page.url).pathname; } catch (_) {}
    result.loginRequired = Boolean(page.hasPassword || /\/(?:login|sign_in|signin|sessions)(?:\/|$)/i.test(path));
    if (result.loginRequired) { result.warnings.push('ManageBac 需要在应用内登录。'); return result; }
    if (/\/core_tasks(?:\/\d+)?\/?$/.test(path) && page.recognized === false) {
      result.parseError = true;
      result.warnings.push('任务页面尚未完整加载或页面布局发生变化，保留上次同步结果。');
      return result;
    }
    const currentID = courseID(page.url), currentTask = taskID(page.url);
    const term = clean(page.term) || null;
    const currentTerm = term ? /\bcurrent\b|当前|本学期/i.test(term) : false;
    const addLink = (kind, url, title) => {
      if (!result.links.some(x=>x.url===url)) result.links.push({kind,url,title:title || ''});
    };
    for (const item of page.links || []) {
      const url = safeURL(item.url, page.url); if (!url) continue;
      const pathname = new URL(url).pathname;
      if (/^\/student\/classes\/\d+\/core_tasks\/?$/.test(pathname)) {
        addLink('course',url,item.title);
      } else if (/^\/student\/classes\/\d+\/core_tasks\/\d+\/?$/.test(pathname)) {
        addLink('feedback',url,item.title);
      } else if (/^\/student\/(?:grades|reports|academics)\/?$/.test(pathname)) {
        addLink('grades',url,item.title);
      }
    }
    if (currentID && !currentTask && /\/core_tasks\/?$/.test(path)) {
      const values = (page.overallRows || []).map(x=>overallPercentage(x.label,x.value)).filter(x=>x!==null);
      const distinct = [...new Set(values)];
      const percentage = distinct.length === 1 ? distinct[0] : null;
      result.courses.push({id:currentID,name:clean(page.heading) || 'ManageBac 课程',percentage,term,
        isCurrentTerm:currentTerm,isCourseGrade:percentage!==null,url:page.url});
      if (distinct.length > 1) result.warnings.push('发现不一致的课程总评，已跳过该课程的 GPA 估算。');
      if (!term) result.warnings.push('页面未显示学期，课程分数暂不用于 GPA 估算。');
    }
    for (const task of page.tasks || []) {
      const url = safeURL(task.url,page.url), id = taskID(url);
      if (!id || !clean(task.title) || result.tasks.some(x=>x.id===id)) continue;
      const dueLabel = [clean([task.month,task.day].filter(Boolean).join(' ')),clean(task.dueText)].filter(Boolean).join(' · ') || null;
      result.tasks.push({id,title:clean(task.title),course:clean(page.heading) || null,dueAt:exactDate(task.datetime),dueLabel,
        status:taskStatus(task),url});
      addLink('feedback',url,clean(task.title));
    }
    for (const entry of page.feedback || []) {
      if (!clean(entry.text)) continue;
      result.feedback.push({id:(currentTask || page.url) + '-feedback-' + result.feedback.length,
        course:clean(page.heading) || null,teacher:entry.teacher || null,text:entry.text,date:entry.date || null,url:page.url});
    }
    for (const row of page.gpaRows || []) {
      const match = row.match(/^((?:Cumulative GPA|Overall GPA|GPA|累计 GPA|平均绩点))\s*[:：]?\s*(\d(?:\.\d+)?)\s*\/\s*(\d(?:\.\d+)?)(?:\s|$)/i);
      if (match && Number(match[2]) <= Number(match[3]) && Number(match[3]) > 0) {
        result.officialGPA = {value:Number(match[2]),scale:Number(match[3]),label:match[1]}; break;
      }
    }
    if (result.tasks.some(x=>x.dueLabel && !x.dueAt)) result.warnings.push('部分任务未显示完整年份或时区，保留原始截止时间；请以原页面为准。');
    if (!result.courses.length && !result.tasks.length && !result.links.length && !result.officialGPA) {
      result.parseError = true;
      result.warnings.push('当前页面没有可识别的课程或任务，请打开课程 Tasks 页面后同步。');
    }
    return result;
  }
  function extract(doc, url) {
    const documentToRead = doc || root.document;
    const currentURL = url || documentToRead.location.href;
    return fromProjection(collect(documentToRead,currentURL));
  }
  const api = {extract,collect,fromProjection,overallPercentage,taskStatus,exactDate,safeURL};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CampusManageBac = api;
})(typeof window !== 'undefined' ? window : null);
