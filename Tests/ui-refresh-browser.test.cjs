'use strict';
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
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
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
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
          sources: [...left.children].map(node => node.dataset.domKey), rightSources: [...right.children].map(node => node.dataset.domKey),
          subjects: [...panel.querySelectorAll('.task-subject-group')].map(node => node.dataset.domKey), left: rect(left), right: rect(right),
          cards: [...panel.querySelectorAll('.board-task-card')].map(node => ({ ...rect(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
          metrics: [...panel.querySelectorAll('.board-kpi')].map(rect) };
      });
      const context = language + '/' + width + ': ' + JSON.stringify(layout);
      assert.deepEqual(layout.sources, ['source-manual', 'source-teams'], context);
      assert.deepEqual(layout.rightSources, ['source-managebac'], context);
      assert.equal(layout.subjects.length, 5, context);
      assert.ok(layout.pageWidth <= width + 1, 'the page must not overflow: ' + context);
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
