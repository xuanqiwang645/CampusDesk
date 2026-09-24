/* Category-based grade scenarios. Pure calculation functions are also used by
   the UI; dates are a calendar aid and never substitute for school weights. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusGradePlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const nameKey = value => clean(value).toLowerCase();
  const number = value => value === null || value === undefined || clean(value) === '' ? null : Number.isFinite(Number(value)) ? Number(value) : NaN;
  const validScore = value => Number.isFinite(value) && value >= 0 && value <= 100;
  const key = course => JSON.stringify([String(course.id || course.name), nameKey(course.term).replace(/\s*\((?:current|current term)\)/g, '').trim()]);
  function categories(course, plan) {
    return (plan && plan.manual ? plan.categories || [] : course.gradeComponents || []).map(row => ({ name: clean(row.name), weight: number(row.weight), percentage: number(row.percentage) }));
  }
  function evaluate(course, plan = {}) {
    const rows = categories(course, plan), target = number(plan.target === undefined ? 90 : plan.target);
    const totalWeight = rows.reduce((sum, row) => sum + (Number.isFinite(row.weight) ? row.weight : 0), 0);
    const names = rows.map(row => nameKey(row.name));
    let reason = !rows.length ? 'missing-categories' : rows.some(row => !row.name || !Number.isFinite(row.weight) || row.weight <= 0 || row.weight > 100 || (row.percentage !== null && !validScore(row.percentage))) || new Set(names).size !== names.length ? 'invalid-category' : Math.abs(totalWeight - 100) > 0.01 ? 'weight-total' : null;
    const known = rows.filter(row => validScore(row.percentage) && row.weight > 0);
    const knownWeight = known.reduce((sum, row) => sum + row.weight, 0);
    const baseline = knownWeight > 0 ? known.reduce((sum, row) => sum + row.percentage * row.weight, 0) / knownWeight : validScore(number(course.percentage)) ? number(course.percentage) : null;
    let heldPoints = 0, adjustableWeight = 0, projected = 0;
    const components = rows.map(row => {
      const override = (plan.overrides || []).find(item => nameKey(item.name) === nameKey(row.name));
      const mode = validScore(row.percentage) && (!override || override.mode !== 'estimate') ? 'hold' : 'estimate';
      const explicit = override && number(override.score);
      const score = mode === 'hold' ? row.percentage : override && override.score !== null && override.score !== undefined && clean(override.score) !== '' ? explicit : baseline;
      if (mode === 'hold') heldPoints += row.percentage * row.weight / 100;
      else adjustableWeight += row.weight;
      if (!validScore(score)) projected = NaN;
      else projected += score * row.weight / 100;
      return { ...row, mode, score, automatic: mode === 'estimate' && (!override || override.score == null || clean(override.score) === '') };
    });
    const goalReason = reason || (!validScore(target) ? 'invalid-target' : null);
    const required = goalReason || adjustableWeight <= 0 ? null : (target - heldPoints) / (adjustableWeight / 100);
    const goalStatus = goalReason ? 'missing' : adjustableWeight <= 0 ? heldPoints >= target ? 'met' : 'fixed' : required <= 0 ? 'met' : required > 100 + 1e-9 ? 'unreachable' : 'possible';
    const projectionReason = reason || (!Number.isFinite(projected) ? 'missing-scores' : null);
    return { course, target, components, totalWeight, knownWeight, baseline, heldPoints, adjustableWeight,
      reason, goalReason, required, goalStatus, projectionReason, projectedPercent: projectionReason ? null : projected,
      minimum: reason ? null : heldPoints, maximum: reason ? null : heldPoints + adjustableWeight, source: plan.manual ? 'manual' : 'managebac' };
  }
  function aggregate(courses, plans, gradePoints) {
    const rows = courses.filter(course => course.isCurrentTerm !== false).map(course => evaluate(course, plans[key(course)] || {}));
    const included = rows.filter(row => row.projectedPercent !== null);
    return { rows, count: included.length, excluded: rows.length - included.length,
      gpa: included.length ? included.reduce((sum, row) => sum + gradePoints(row.projectedPercent), 0) / included.length : null,
      linearGPA: included.length ? included.reduce((sum, row) => sum + row.projectedPercent / 100 * 4, 0) / included.length : null,
      percentage: included.length ? included.reduce((sum, row) => sum + row.projectedPercent, 0) / included.length : null };
  }
  function parseCategoryText(input) {
    const text = String(input || '').slice(0, 30000).replace(/\r/g, '');
    const rows = [], lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const scoreLine = /^(?:[A-F][+-]?\s*)?[（(]?\d+(?:\.\d+)?\s*%[）)]?$|^[-–—]$/i;
    for (let i = 0; i < lines.length; i++) {
      if (scoreLine.test(lines[i])) continue;
      const match = lines[i].match(/^([^\t|]+?)\s*[（(]\s*(\d+(?:\.\d+)?)\s*%\s*[）)](.*)$/);
      if (!match) continue;
      const name = clean(match[1]), weight = Number(match[2]);
      if (/^(?:overall|total|category|总评|合计)$/i.test(name)) continue;
      let score = match[3].trim();
      if (!score && scoreLine.test(lines[i + 1] || '')) score = lines[++i];
      const mark = score.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*%/);
      rows.push({ name, weight, percentage: mark ? Number(mark[1]) : null });
    }
    return rows.slice(0, 40);
  }
  function create(options) {
    const { Core, getState, isEnglish, esc, persist, render, openCourse } = options;
    const drafts = new Map();
    let selected = '', error = '', courses = [], fresh = false;
    function refresh() { fresh = true; try { render(); } finally { fresh = false; } }
    const L = (zh, en) => isEnglish() ? en : zh;
    const pct = value => Number.isFinite(value) ? value.toFixed(2) + '%' : '—';
    const current = () => courses.find(course => key(course) === selected) || courses[0];
    function planFor(course) {
      const state = getState(), saved = (state.settings.gradePlans || {})[key(course)];
      return drafts.get(key(course)) || saved || { target: (state.settings.gradeGoals || {})[course.id]?.target ?? 90, manual: false, categories: [], overrides: [] };
    }
    function draft() {
      const course = current(); if (!course) return null;
      if (!drafts.has(key(course))) drafts.set(key(course), JSON.parse(JSON.stringify(planFor(course))));
      return drafts.get(key(course));
    }
    function reasonText(row) {
      const code = row.projectionReason || row.reason;
      if (code === 'weight-total') return L('类别权重总和须为 100%，当前为 ', 'Category weights must total 100%; currently ') + pct(row.totalWeight);
      if (code === 'invalid-category') return L('请检查类别名称是否重复，以及权重和成绩是否有效。', 'Check duplicate category names, weights and scores.');
      if (code === 'missing-scores') return L('为预测类别填写预期分数。', 'Enter expected scores for the estimated categories.');
      return L('尚未读取类别表。打开学科 Tasks 页同步，或在下方粘贴表格。', 'Category table not captured. Sync the subject Tasks page, or paste the table below.');
    }
    function results(course, plan) {
      const row = evaluate(course, plan);
      let goal = row.goalReason ? row.goalReason === 'invalid-target' ? L('目标须为 0–100%。', 'Target must be between 0 and 100%.') : reasonText(row) : row.goalStatus === 'met' ? L('保持所选类别均分时，目标已覆盖', 'Target is covered if held averages stay unchanged') : row.goalStatus === 'fixed' ? L('没有可调整类别；请将一个类别改为“预测”。', 'No adjustable categories. Set a category to “Estimate”.') : row.goalStatus === 'unreachable' ? L('当前假设下无法达到目标', 'Target is unreachable with these assumptions') : L('可调整类别需要的加权均分', 'Weighted average needed in adjustable categories');
      return '<div class="gp-results" aria-live="polite"><div><small>' + goal + '</small><strong>' + (row.required !== null ? pct(Math.max(0, row.required)) : '—') + '</strong><span>' + L('可调整类别权重 ', 'Adjustable category weight ') + pct(row.adjustableWeight) + '</span></div><div><small>' + L('当前情景的课程预测', 'Course projection for this scenario') + '</small><strong>' + pct(row.projectedPercent) + '</strong><span>' + (row.projectedPercent !== null ? L('参考绩点 ', 'Reference GPA ') + Core.gradePoints(row.projectedPercent).toFixed(2) + ' / 4.00 · ' + L('线性绩点 ', 'Linear GPA ') + Core.linearGradePoints(row.projectedPercent).toFixed(2) + ' / 4.00' : reasonText(row)) + '</span></div></div>' + (!row.reason ? '<p class="gp-formula">' + L('保持均分的加权贡献 ', 'Held contribution ') + row.heldPoints.toFixed(2) + ' + ' + L('预测类别均分 × ', 'adjustable average × ') + (row.adjustableWeight / 100).toFixed(4) + L(' = 课程总评。可达范围：', ' = course grade. Reachable range: ') + pct(row.minimum) + '–' + pct(row.maximum) + '</p>' : '');
    }
    function goal(inputCourses) {
      courses = inputCourses.filter(course => course.isCurrentTerm !== false);
      const course = current();
      if (!course) return '<section class="card gp-card"><h2>' + L('成绩目标模拟', 'Grade goal simulator') + '</h2><p>' + L('请先同步 ManageBac 当前学期课程。', 'Sync current-term ManageBac courses first.') + '</p></section>';
      selected = key(course);
      const plan = planFor(course), row = evaluate(course, plan), dirty = drafts.has(selected);
      const field = (id, value, attrs = '') => '<input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(value == null ? '' : String(value)) + '" ' + attrs + '>';
      const table = row.components.length ? '<div class="gp-table-wrap"><table class="gp-table"><thead><tr>' + [L('类别', 'Category'), L('权重 %', 'Weight %'), L('当前均分 %', 'Current average %'), L('计算方式', 'Mode'), L('预期均分 %', 'Expected average %')].map(label => '<th>' + label + '</th>').join('') + '</tr></thead><tbody>' + row.components.map((item, index) => '<tr><td>' + (plan.manual ? field('gp-name-' + index, item.name, 'data-gp-field="name" data-gp-row="' + index + '" aria-label="' + L('类别名称', 'Category name') + '"') : esc(item.name)) + '</td><td>' + (plan.manual ? field('gp-weight-' + index, plan.categories[index].weight, 'data-gp-field="weight" data-gp-row="' + index + '" aria-label="' + L('权重', 'Weight') + '"') : pct(item.weight)) + '</td><td>' + (plan.manual ? field('gp-mark-' + index, plan.categories[index].percentage, 'data-gp-field="percentage" data-gp-row="' + index + '" aria-label="' + L('当前均分', 'Current average') + '" placeholder="—"') : pct(item.percentage)) + '</td><td><select id="gp-mode-' + index + '" data-gp-field="mode" data-gp-row="' + index + '" aria-label="' + L('类别计算方式', 'Category mode') + '"><option value="hold"' + (item.mode === 'hold' ? ' selected' : '') + (!validScore(item.percentage) ? ' disabled' : '') + '>' + L('保持当前均分', 'Hold current average') + '</option><option value="estimate"' + (item.mode === 'estimate' ? ' selected' : '') + '>' + L('预测', 'Estimate') + '</option></select></td><td>' + field('gp-score-' + index, item.automatic ? '' : item.score, 'data-gp-field="score" data-gp-row="' + index + '" aria-label="' + L('预期均分', 'Expected average') + '" placeholder="' + (item.automatic && item.score !== null ? L('自动 ', 'Auto ') + item.score.toFixed(2) : '—') + '"' + (item.mode === 'hold' ? ' disabled' : '')) + (plan.manual ? '<button type="button" class="gp-remove" data-gp-action="remove" data-gp-row="' + index + '">' + L('移除', 'Remove') + '</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="gp-empty">' + reasonText(row) + '</p>';
      return '<section class="card gp-card"><div class="gp-heading"><h2>' + L('成绩目标模拟', 'Grade goal simulator') + '</h2><span>' + L('按学科 · 按类别', 'By course · by category') + '</span></div><p class="gp-intro">' + L('目标与学期预测共用下方类别数据。已评分的类别仍可能继续更新；“保持当前均分”只是你的计算假设。', 'Targets and semester projections share the category data below. Graded categories may still change; holding their current averages is a scenario assumption.') + '</p><form id="grade-plan-form" data-plan-key="' + esc(selected) + '"><div class="gp-toolbar"><label>' + L('选择学科', 'Course') + '<select id="gp-course">' + courses.map(item => '<option value="' + esc(key(item)) + '"' + (key(item) === selected ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('') + '</select></label><label>' + L('目标总评 %', 'Target grade %') + field('gp-target', plan.target, 'data-gp-field="target"') + '</label></div><div class="gp-source"><span>' + (plan.manual ? L('本机补充 · 未修改学校成绩', 'Local data · school grades unchanged') : 'ManageBac · ' + esc(course.term || L('学期待确认', 'Term unconfirmed'))) + '</span><span>' + L('网站当前总评 ', 'Current school grade ') + pct(number(course.percentage)) + '</span><button class="button button-light" type="button" data-gp-action="open">' + L('打开学科页面', 'Open course') + '</button></div>' + table + '<div class="gp-actions"><button type="button" class="button button-light" data-gp-action="manual">' + (plan.manual ? L('添加类别', 'Add category') : L('本机补充／修正', 'Edit local category data')) + '</button><button type="button" class="button button-light" data-gp-action="reset">' + L('恢复同步数据', 'Use synced data') + '</button></div><details id="gp-paste-details"><summary>' + L('从 Task Category Averages 粘贴表格', 'Paste Task Category Averages') + '</summary><p>' + L('复制弹窗的类别、权重与成绩文字。粘贴后先核对再保存。', 'Copy category names, weights and scores from the popup. Review the imported rows before saving.') + '</p><textarea id="gp-paste" rows="5" placeholder="Formative Assessment (20%)&#10;B (86.88%)&#10;Summative Assessment (35%)&#10;-&#10;Exams (45%)&#10;-">' + esc(plan.paste || '') + '</textarea><button type="button" class="button button-light" data-gp-action="paste">' + L('识别表格', 'Import table') + '</button></details><div id="gp-live-results">' + results(course, plan) + '</div><p id="gp-error" class="gp-error" role="status">' + esc(error) + '</p><div class="gp-save"><span id="gp-save-state">' + (dirty ? L('草稿 · 保存后更新学期预测', 'Draft · save to update the semester projection') : L('本机保存 · 与学期预测共用', 'Saved locally · shared with semester projection')) + '</span><button type="submit" class="button button-primary">' + L('保存并更新预测', 'Save & update projection') + '</button></div><p class="gp-footnote">' + L('留空的预测分数默认延续已评分类别的加权均分；没有类别成绩时使用网站总评。你可以逐项修改。权重总和必须为 100%。', 'Blank expected scores continue the weighted average of graded categories, or the school overall if no category has a score. You can change each estimate. Category weights must total 100%.') + '</p></form></section>';
    }
    function summary(inputCourses) {
      const report = aggregate(inputCourses, getState().settings.gradePlans || {}, Core.gradePoints);
      return '<div class="gp-results"><div><small>' + L('情景参考 GPA', 'Scenario GPA') + '</small><strong>' + (report.gpa === null ? '—' : report.gpa.toFixed(2) + ' / 4.00') + '</strong><span>' + L('按已纳入课程等权计算', 'Equally weighted across included courses') + '</span></div><div><small>' + L('情景线性 GPA', 'Scenario linear GPA') + '</small><strong>' + (report.linearGPA === null ? '—' : report.linearGPA.toFixed(2) + ' / 4.00') + '</strong><span>' + L('每科百分比 ÷ 100 × 4', 'Each course percent ÷ 100 × 4') + '</span></div><div><small>' + L('数据覆盖', 'Model coverage') + '</small><strong>' + report.count + ' / ' + report.rows.length + '</strong><span>' + L('门课程 · 缺失课程不计作零分', 'courses · missing courses are not scored as zero') + '</span></div></div><div class="gp-forecast-list">' + report.rows.map(row => '<article><div><strong>' + esc(row.course.name) + '</strong><small>' + (row.projectedPercent === null ? reasonText(row) : (row.source === 'manual' ? L('本机类别', 'Local categories') : 'ManageBac') + ' · ' + L('预测权重 ', 'Estimated weight ') + pct(row.adjustableWeight)) + '</small></div><b>' + pct(row.projectedPercent) + (row.projectedPercent !== null ? '<small>' + L('分档 ', 'Banded ') + Core.gradePoints(row.projectedPercent).toFixed(2) + ' · ' + L('线性 ', 'Linear ') + Core.linearGradePoints(row.projectedPercent).toFixed(2) + '</small>' : '') + '</b><button class="button button-light" type="button" data-gp-action="edit" data-gp-course="' + esc(key(row.course)) + '">' + L('调整', 'Adjust') + '</button></article>').join('') + '</div><p class="gp-footnote">' + L('显示本机情景估算：分档采用 90/80/70/60 → 4/3/2/1；线性按每科百分比 ÷ 100 × 4。两者均不含学分或 AP 加权，也不是学校官方 GPA。日期仅显示日历进度，不代表已完成的评分权重。', 'Local scenario estimates: banded 90/80/70/60 → 4/3/2/1; linear course percent ÷ 100 × 4. Neither includes credits or AP weighting or represents official school GPA. Dates show calendar progress, not completed grading weight.') + '</p>';
    }
    function updateResults() {
      const course = current(); if (!course) return;
      const node = document.getElementById('gp-live-results'); if (node) node.innerHTML = results(course, planFor(course));
      const label = document.getElementById('gp-save-state'); if (label) label.textContent = L('草稿 · 保存后更新学期预测', 'Draft · save to update the semester projection');
    }
    function input(el) {
      if (el.id === 'gp-paste') { draft().paste = el.value; return true; }
      const field = el.dataset && el.dataset.gpField; if (!field) return false;
      const plan = draft(); if (!plan) return true;
      if (field === 'target') plan.target = el.value;
      else {
        const index = Number(el.dataset.gpRow), items = categories(current(), plan), item = items[index]; if (!item) return true;
        if (['name', 'weight', 'percentage'].includes(field)) {
          if (!plan.manual) return true;
          if (field === 'name') { const override = plan.overrides.find(o => nameKey(o.name) === nameKey(item.name)); if (override) override.name = el.value; }
          plan.categories[index][field] = el.value;
        } else {
          let override = plan.overrides.find(o => nameKey(o.name) === nameKey(item.name));
          if (!override) { override = { name: item.name, mode: validScore(item.percentage) ? 'hold' : 'estimate', score: null }; plan.overrides.push(override); }
          override[field === 'mode' ? 'mode' : 'score'] = el.value;
          if (field === 'mode') { const score = document.getElementById('gp-score-' + index); if (score) { score.disabled = el.value === 'hold'; score.value = override.score == null ? '' : override.score; } }
        }
      }
      error = ''; updateResults(); return true;
    }
    function change(el) {
      if (el.id === 'gp-course') { selected = el.value; error = ''; refresh(); return true; }
      return input(el);
    }
    function click(el) {
      const action = el.dataset && el.dataset.gpAction; if (!action) return false;
      if (action === 'edit') { selected = el.dataset.gpCourse; error = ''; refresh(); document.getElementById('grade-plan-form')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; }
      const course = current(); if (!course) return true;
      if (action === 'open') { openCourse(course); return true; }
      const plan = draft();
      if (action === 'manual') { if (!plan.manual) { plan.categories = categories(course, plan); plan.manual = true; } else plan.categories.push({ name: '', weight: '', percentage: null }); if (!plan.categories.length) plan.categories.push({ name: '', weight: '', percentage: null }); }
      if (action === 'remove') { const removed = plan.categories.splice(Number(el.dataset.gpRow), 1)[0]; if (removed) plan.overrides = plan.overrides.filter(o => nameKey(o.name) !== nameKey(removed.name)); }
      if (action === 'reset') {
        const state = getState();
        if (state.settings.gradePlans) delete state.settings.gradePlans[key(course)];
        drafts.delete(key(course)); error = ''; persist(); refresh(); return true;
      }
      if (action === 'paste') {
        const rows = parseCategoryText(document.getElementById('gp-paste')?.value || plan.paste || '');
        if (!rows.length) error = L('未识别到“类别 (权重%)”。请复制完整表格，或手动添加类别。', 'No “Category (weight%)” rows found. Copy the complete table or add categories manually.');
        else { plan.categories = rows; plan.manual = true; plan.overrides = []; error = ''; }
      }
      refresh(); return true;
    }
    function submit(form) {
      if (form.id !== 'grade-plan-form') return false;
      const course = current(), plan = draft(), row = evaluate(course, plan);
      if (row.goalReason || row.projectionReason) { error = row.goalReason === 'invalid-target' ? L('目标须为 0–100%。', 'Target must be between 0 and 100%.') : reasonText(row); refresh(); return true; }
      const stored = { target: Number(plan.target), manual: Boolean(plan.manual), categories: plan.manual ? categories(course, plan) : [], overrides: (plan.overrides || []).map(o => ({ name: clean(o.name), mode: o.mode, score: validScore(number(o.score)) ? number(o.score) : null })) };
      const state = getState(); state.settings.gradePlans ||= {}; state.settings.gradePlans[key(course)] = stored;
      drafts.delete(key(course)); error = ''; persist(); refresh(); return true;
    }
    return { goal, summary, input, change, click, submit,
      retain: () => !fresh && drafts.has(selected) ? { node: document.getElementById('grade-plan-form'), english: isEnglish() } : null,
      restore: retained => { const node = retained && retained.node, currentForm = document.getElementById('grade-plan-form'); if (node && currentForm && retained.english === isEnglish() && node.dataset.planKey === currentForm.dataset.planKey) currentForm.replaceWith(node); } };
  }
  return { key, categories, evaluate, aggregate, parseCategoryText, create };
});
