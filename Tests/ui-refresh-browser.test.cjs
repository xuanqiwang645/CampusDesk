'use strict';
const { launchChromium } = require('./launch-chromium.cjs');
// Exercise the rendered UI using an isolated browser and synthetic school data.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
const schools = { seiue: 'https://example-school.seiue.com/', managebac: 'https://example-school.managebac.cn/' };
Core.configureSchools(schools);

function stateFor(dashboardTheme = 'board', colorTheme = 'sage', language = 'zh-CN') {
  const state = Core.emptyState();
  Object.assign(state.settings, { dashboardTheme, colorTheme, language, setupWizardCompleted: true });
  const task = (id, title, course) => ({ id, title, course, dueAt: '2030-10-09T10:30:00Z', status: 'open' });
  state.manualTasks = [task('personal', '整理明天的实验笔记与需要核对的问题', '个人安排')];
  const teamsURL = 'https://teams.microsoft.com/v2/';
  state.snapshots.teams[teamsURL] = { source: 'teams', url: teamsURL, title: 'Synthetic class', capturedAt: '2026-10-08T00:00:00Z', coverage: 'visible', warnings: [],
    tasks: [task('science', 'Review the experimental observations and prepare a short explanation', 'Science'), task('english', 'Read and annotate the next chapter', 'English')], posts: [] };
  const mbURL = schools.managebac + 'tasks';
  state.snapshots.managebac[mbURL] = { source: 'managebac', url: mbURL, title: 'Synthetic assignments', capturedAt: '2026-10-08T00:00:00Z', warnings: [], courses: [],
    tasks: [task('math', 'Complete the practice questions', 'Mathematics'), task('art', 'Organize reference materials for class', 'Art')], feedback: [], officialGPA: null };
  return Core.validateState(state);
}

async function fixture(run) {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ state, schools }) => {
      localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state));
      localStorage.setItem('campusdesk.school-config.v1', JSON.stringify(schools));
    }, { state: stateFor(), schools });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#overview');
    // This also supports independent development before index.html is wired up.
    if (!await page.locator('link[href="ui-refresh.css"]').count()) await page.addStyleTag({ path: path.resolve(__dirname, '../Resources/ui-refresh.css') });
    await page.locator('.board-task-column-left').waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('refreshed board keeps source and subject hierarchy, desktop columns and readable narrow cards', optional, async () => fixture(async page => {
  for (const language of ['zh-CN', 'en-US']) {
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), stateFor('board', 'sage', language));
    for (const width of [1440, 1024, 760, 580, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.locator('.board-panel').evaluate(panel => {
        const rect = node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }; };
        const left = panel.querySelector('.board-task-column-left'), right = panel.querySelector('.board-task-column-right');
        const header = panel.querySelector('.board-hero'), title = header.querySelector('h1');
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
          header: rect(header), title: rect(title), titleSize: parseFloat(getComputedStyle(title).fontSize),
          action: rect(header.querySelector('button')), clock: rect(panel.querySelector('.board-header-clock')),
          sources: [...left.children].map(node => node.dataset.domKey), rightSources: [...right.children].map(node => node.dataset.domKey),
          subjects: [...panel.querySelectorAll('.task-subject-group')].map(node => node.dataset.domKey), left: rect(left), right: rect(right),
          cards: [...panel.querySelectorAll('.board-task-card')].map(node => ({ ...rect(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
          metrics: [...panel.querySelectorAll('.board-statistics dl > div')].map(rect) };
      });
      const context = language + '/' + width + ': ' + JSON.stringify(layout);
      assert.deepEqual(layout.sources, ['source-manual', 'source-teams'], context);
      assert.deepEqual(layout.rightSources, ['source-managebac'], context);
      assert.equal(layout.subjects.length, 5, context);
      assert.ok(layout.pageWidth <= width + 1, 'the page must not overflow: ' + context);
      assert.ok(layout.title.left - layout.header.left >= 14 && layout.header.right - layout.action.right >= 14, 'heading and button need breathing room: ' + context);
      assert.ok(layout.titleSize <= 24 && layout.clock.top - layout.header.bottom >= 12, 'heading stays compact and separate from the countdown: ' + context);
      if (width > 760) assert.ok(layout.right.left >= layout.left.right, 'desktop source columns stay side by side: ' + context);
      else assert.ok(layout.right.top >= layout.left.bottom, 'narrow source columns follow the same reading order: ' + context);
      for (const card of layout.cards) {
        assert.ok(card.left >= 0 && card.right <= width + 1, context);
        assert.ok(card.scrollWidth <= card.clientWidth + 1, 'card contents must fit: ' + context);
        assert.ok(card.width >= 120, 'cards remain usable at intermediate widths: ' + context);
      }
      if (width <= 580) {
        assert.ok(layout.cards.every(card => card.width >= 250), context);
        assert.ok(Math.abs(layout.metrics[5].width - layout.metrics[4].width) < 1, 'the final KPI has the same width as its paired metric: ' + context);
      }
    }
  }
  if (process.env.UI_REFRESH_SCREENSHOT) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), stateFor());
    await page.screenshot({ path: process.env.UI_REFRESH_SCREENSHOT, fullPage: true });
  }
}));

test('all palettes retain their colors and focus remains visible on reset title buttons and time wheels', optional, async () => fixture(async page => {
  for (const colorTheme of ['sage', 'ocean', 'ember', 'midnight']) {
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), stateFor('board', colorTheme));
    const title = page.locator('.board-task-card h3 button').first();
    await title.focus();
    const colors = await title.evaluate(node => {
      const root = getComputedStyle(document.documentElement), style = getComputedStyle(node);
      const probe = document.createElement('span'); probe.style.color = root.getPropertyValue('--accent-ink'); document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.style.color = root.getPropertyValue('--ink');
      const paletteInk = getComputedStyle(probe).color; probe.remove();
      return { focusVisible: node.matches(':focus-visible'), outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle, outlineColor: style.outlineColor,
        accent, titleColor: style.color, paletteInk, theme: document.documentElement.dataset.colorTheme, card: root.getPropertyValue('--card').trim(), ink: root.getPropertyValue('--ink').trim() };
    });
    assert.equal(colors.theme, colorTheme);
    assert.equal(colors.focusVisible, true);
    assert.equal(colors.outlineStyle, 'solid');
    assert.equal(colors.outlineWidth, '2px');
    assert.equal(colors.outlineColor, colors.accent);
    assert.equal(colors.titleColor, colors.paletteInk, 'task titles retain the palette\'s primary text contrast');
    const expected = { sage: ['#ffffff', '#203a37'], ocean: ['#ffffff', '#203b52'], ember: ['#fffdfa', '#3f3127'], midnight: ['#1a252c', '#e7eff2'] }[colorTheme];
    assert.deepEqual([colors.card, colors.ink], expected);
  }
  await page.locator('[data-action="add-task"]').first().click();
  await page.locator('#task-title').fill('Synthetic keyboard check');
  await page.locator('#task-due-date').fill('2030-10-09');
  await page.locator('#task-time-custom').check();
  await page.locator('#task-hour-wheel').press('Home');
  await page.locator('#task-hour-wheel').pressSequentially('18');
  await page.locator('#task-minute-wheel').press('Home');
  await page.locator('#task-minute-wheel').pressSequentially('30');
  assert.equal(await page.locator('#task-due-time').inputValue(), '18:30');
  const wheel = await page.locator('#task-minute-wheel').evaluate(node => ({ focus: node.matches(':focus-visible'), color: getComputedStyle(node).outlineColor }));
  assert.equal(wheel.focus, true);
  assert.equal(wheel.color, 'rgb(184, 234, 217)', 'midnight wheel uses the readable accent');
  await page.locator('#task-minute-wheel').press('Enter');
  assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), true);
  await page.locator('#task-form button[type="submit"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
  assert.equal(saved.manualTasks.at(-1).dueAt, '2030-10-09T10:30:00.000Z');
}));

test('board checklist stacks compact rows within a subject and preserves favorite, deadline and completion actions', optional, async () => fixture(async page => {
  const state = stateFor('board', 'sage', 'en-US');
  state.manualTasks = [
    { id: 'sketch', title: 'Draw sketch', course: 'Design Workshop', dueAt: '2030-10-09T10:30:00Z', status: 'open' },
    { id: 'revise', title: 'Revise notes', course: 'Design Workshop', dueAt: null, status: 'open' }
  ];
  await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), state);
  const group = page.locator('[data-dom-key="source-manual"] [data-dom-key="subject-Design Workshop"]');
  const rows = group.locator('[data-dom-key^="task-"]');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await rows.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect();
      return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width,
        listWidth: list.width, shadow: getComputedStyle(node).boxShadow, text: node.innerText };
    }));
    assert.equal(layout.length, 2);
    assert.equal(layout[0].left, layout[1].left);
    assert.ok(layout[1].top >= layout[0].bottom, 'tasks occupy separate rows at ' + width);
    for (const row of layout) {
      assert.ok(row.height > 0 && row.height <= 95, 'short task row at ' + width + ': ' + row.height);
      assert.ok(Math.abs(row.width - row.listWidth) <= 2, 'each task fills its subject list');
      assert.equal(row.shadow, 'none', 'rows are not separate elevated tiles');
      assert.doesNotMatch(row.text, /Design Workshop|Personal/i, 'the source and subject are already identified by the group');
    }
  }
  const favorite = group.locator('[data-action="toggle-focus-subject"]');
  await favorite.click();
  assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')).settings.focusSubjects), ['Design Workshop']);
  const undated = group.locator('[data-dom-key="task-revise"]');
  await undated.getByRole('button', { name: 'Set a deadline' }).click();
  await page.locator('#manual-due-date').fill('2031-04-06');
  await page.locator('#manual-due-time').fill('13:40');
  await page.locator('[data-action="save-manual-task-due"]').click();
  await page.locator('[data-action="close-detail"]').click();
  assert.equal(Number(await undated.getAttribute('data-due-ms')), Date.parse('2031-04-06T13:40:00+08:00'));
  assert.match(await undated.innerText(), /13:40/);
  await undated.locator('[data-action="toggle-task"]').click();
  assert.equal(await undated.count(), 0);
  assert.equal(await group.locator('[data-dom-key="task-sketch"]').count(), 1);
}));

test('board statistics preserve open/completed counts and distinguish school GPA from estimates', optional, async () => fixture(async page => {
  const state = stateFor('board', 'midnight', 'en-US');
  const mb = Object.values(state.snapshots.managebac)[0];
  const currentTime = Date.now();
  for (const task of Object.values(state.snapshots.teams)[0].tasks) task.dueAt = new Date(currentTime + 14 * 86400000).toISOString();
  mb.tasks[0].dueAt = new Date(currentTime - 60000).toISOString();
  mb.tasks[1].dueAt = new Date(currentTime + 86400000).toISOString();
  state.taskChecks.personal = true;
  mb.courses = [{ id: 'chem', name: 'Chemistry', term: 'Term 1 (current)', percentage: 90, isCurrentTerm: true, isCourseGrade: true }];
  const apply = () => page.evaluate(state => CampusDesk.receive({ type: 'state', state }), state);
  const read = selector => page.locator(selector + ' > div').evaluateAll(nodes => nodes.map(node => [
    node.querySelector('dt').textContent, node.querySelector('dd').textContent
  ]));
  await apply();
  assert.deepEqual(await read('.board-task-totals'), [['Open','4'], ['Overdue','1'], ['Due in 7 days','1'], ['Marked done','1']]);
  assert.deepEqual(await read('.board-grade-totals'), [['Banded GPA estimate','3.70 / 4'], ['Linear GPA estimate','3.60 / 4']]);

  mb.officialGPA = { value: 4.62, scale: 5 };
  state.settings.language = 'zh-CN'; await apply();
  assert.deepEqual(await read('.board-grade-totals'), [['学校 GPA','4.62 / 5'], ['线性参考 GPA','3.60 / 4']]);
  mb.officialGPA.scale = null; mb.officialGPA.value = 0; await apply();
  assert.deepEqual((await read('.board-grade-totals'))[0], ['学校 GPA','0.00']);
  delete mb.officialGPA; mb.courses = []; await apply();
  assert.deepEqual(await read('.board-grade-totals'), [['分档参考 GPA','—'], ['线性参考 GPA','—']]);

  state.settings.language = 'en-US'; mb.officialGPA = { value: 100, scale: 100 }; await apply();
  for (const width of [1440, 1220, 900, 761, 760, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const bounds = await page.locator('.board-statistics').evaluate(strip => ({
      height: strip.getBoundingClientRect().height,
      clipped: [...strip.querySelectorAll('dt, dd')].some(node => node.scrollWidth > node.clientWidth + 1),
      groups: [...strip.children].map(node => {
        const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      })
    }));
    assert.equal(bounds.clipped, false, 'labels, full GPA values and their scales fit at ' + width);
    const [tasks, grades] = bounds.groups;
    if (width <= 760) assert.ok(grades.top > tasks.bottom, 'task and GPA groups stack at ' + width);
    else assert.ok(grades.left >= tasks.right - 1, 'groups share one row at ' + width);
    if (width >= 1220) assert.ok(bounds.height < 90, 'compact row leaves room for tasks');
  }
}));

test('toolbar and primary actions show press, focus and accessible solid states in all palettes', optional, async () => fixture(async page => {
  const primary = page.locator('.board-section-heading button[data-action="add-task"]');
  const secondary = page.locator('.board-section-heading button[data-action="go-tasks"]');
  const complete = page.locator('.board-check').first();
  const sync = page.locator('#sync-button');
  const style = (button, property) => button.evaluate((node, property) => getComputedStyle(node)[property], property);
  for (const [index, palette] of ['sage', 'ocean', 'ember', 'midnight'].entries()) {
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), stateFor('board', palette, index % 2 ? 'en-US' : 'zh-CN'));
    for (const control of [primary, secondary, sync, complete]) {
      assert.match(await style(control, 'backgroundImage'), /linear-gradient/, palette);
      assert.ok(await control.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    }
    assert.notEqual(await style(primary, 'backgroundColor'), await style(secondary, 'backgroundColor'));
    assert.match(await style(secondary, 'backdropFilter'), /blur/);
    assert.equal(await style(complete, 'backdropFilter'), 'none', 'no blur per task');
    assert.ok(await page.locator('.board-side-column .calendar-import-actions .button').evaluate(node =>
      node.getBoundingClientRect().right <= node.closest('.card').getBoundingClientRect().right + 1), 'calendar action fits its card');
  }
  await secondary.focus();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await primary.evaluate(node => node.matches(':focus-visible')), 'keyboard navigation reaches Add to-do');
  assert.equal(await style(primary, 'outlineStyle'), 'solid');
  assert.equal(await style(primary, 'outlineWidth'), '2px');
  if (process.env.CAMPUS_BUTTON_SCREENSHOT) await page.screenshot({ path: process.env.CAMPUS_BUTTON_SCREENSHOT });
  await primary.hover();
  await page.mouse.down();
  assert.notEqual(await style(primary, 'transform'), 'none');
  await page.mouse.up();
  assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), true);
  await page.locator('#task-dialog [data-action="close-task"]').first().click();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await primary.hover();
  await page.mouse.down();
  assert.equal(await style(primary, 'transform'), 'none');
  await page.mouse.move(1, 1);
  await page.mouse.up();
  const cdp = await page.context().newCDPSession(page);
  for (const feature of [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-contrast', value: 'more' }]) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [feature] });
    assert.equal(await page.evaluate(({ name, value }) => matchMedia('(' + name + ':' + value + ')').matches, feature), true);
    for (const control of [primary, secondary, complete, sync]) {
      assert.equal(await style(control, 'backgroundImage'), 'none');
      assert.equal(await style(control, 'boxShadow'), 'none');
      assert.equal(await style(control, 'backdropFilter'), 'none');
    }
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await page.evaluate(() => CampusDesk.receive({ type: 'status', source: 'managebac', message: 'Reading', busy: true }));
  assert.equal(await sync.isDisabled(), true);
  assert.equal(await style(sync, 'backgroundImage'), 'none');
  assert.equal(await style(sync, 'boxShadow'), 'none');
  const completedID = await complete.getAttribute('data-id');
  await complete.click();
  await secondary.click();
  await page.locator('[data-action="task-filter"][data-filter="done"]').click();
  const completed = page.locator('.todo-complete-button[data-id="' + completedID + '"]');
  assert.equal(await completed.getAttribute('aria-pressed'), 'true');
  assert.equal(await style(completed, 'color'), 'rgb(255, 255, 255)');
  assert.equal(await style(completed, 'backdropFilter'), 'none');
  assert.match(await style(page.locator('[data-action="task-filter"][data-filter="done"]'), 'backgroundImage'), /linear-gradient/);
}));

test('reduced motion and low power keep hover feedback stationary without hiding Liquid Glass', optional, async () => fixture(async page => {
  for (const mode of ['reduced-motion', 'low-power']) {
    await page.emulateMedia({ reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference' });
    if (mode === 'low-power') {
      const state = stateFor(); state.settings.graphicsMode = 'low-power';
      await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), state);
    }
    await page.locator('.board-task-card').first().hover();
    const result = await page.locator('.board-task-card').first().evaluate(node => ({ transform: getComputedStyle(node).transform, transition: getComputedStyle(node).transitionDuration }));
    assert.equal(result.transform, 'none', mode);
    assert.equal(result.transition, '0s', mode);
  }
  // The visual sheet must not hide or take ownership of the opt-in GPU layer.
  // Actual renderer execution and lifecycle are covered in liquid-glass-browser.
  const glass = await page.evaluate(() => {
    document.documentElement.classList.add('webgl-liquid-glass');
    const canvas = document.getElementById('liquid-glass-canvas'); canvas.hidden = false;
    const style = getComputedStyle(canvas);
    return { display: style.display, pointerEvents: style.pointerEvents, zIndex: style.zIndex };
  });
  assert.notEqual(glass.display, 'none');
  assert.equal(glass.pointerEvents, 'none');
  assert.equal(glass.zIndex, '0');
}));

test('shared chrome fits core pages in both layouts and navigation remains reachable in a short window', optional, async () => fixture(async page => {
  for (const dashboardTheme of ['classic', 'board']) for (const language of ['zh-CN', 'en-US']) {
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), stateFor(dashboardTheme, 'sage', language));
    for (const route of ['overview', 'tasks', 'schedule', 'settings']) {
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.locator('[data-page="' + route + '"]').first().click();
      for (const width of [1024, 760, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const result = await page.evaluate(() => {
          const topbar = document.querySelector('.topbar'), toolbar = document.querySelector('.toolbar');
          return { pageWidth: document.documentElement.scrollWidth, width: innerWidth, topbarRight: topbar.getBoundingClientRect().right,
            toolbarRight: toolbar.getBoundingClientRect().right, contentWidth: document.getElementById('content').clientWidth, contentScrollWidth: document.getElementById('content').scrollWidth };
        });
        const context = [dashboardTheme, language, route, width].join('/') + ': ' + JSON.stringify(result);
        assert.ok(result.pageWidth <= width + 1, context);
        assert.ok(result.toolbarRight <= result.topbarRight, context);
        assert.ok(result.contentScrollWidth <= result.contentWidth + 1, context);
      }
    }
  }
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.locator('#nav .nav-item').last().focus();
  await page.keyboard.press('Tab');
  const nav = await page.locator('.settings-nav').evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, height: innerHeight,
    overflow: getComputedStyle(node.closest('.sidebar')).overflowY, focus: node.matches(':focus-visible') }));
  assert.equal(nav.overflow, 'auto');
  assert.ok(nav.top >= 0 && nav.bottom <= nav.height, JSON.stringify(nav));
  assert.equal(nav.focus, true);
}));
