/* CampusDesk presentation plugin SDK, API v1. Loaded from the signed app. */
(function () {
  'use strict';
  const root = document.documentElement;
  const host = window.CampusDeskPluginHost === true;
  const id = 'campusdesk.liquid-glass';
  const listeners = new Set(), registrations = new Map();
  let plugins = [], scheduled = false, lastLayout = '', panelSignature = '';
  const nativeSend = payload => {
    if (!host) return false;
    window.webkit?.messageHandlers?.campus?.postMessage({ action: 'plugin', ...payload });
    return true;
  };
  const english = () => root.lang?.startsWith('en');
  const copy = (zh, en) => english() ? en : zh;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const sdk = Object.freeze({
    apiVersion: 1,
    getPlugins: () => JSON.parse(JSON.stringify(plugins)),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    register(manifest, hooks = {}) {
      if (!manifest || manifest.apiVersion !== 1 || !/^[a-z][a-z0-9.-]{2,79}$/.test(manifest.id) || registrations.has(manifest.id)) throw new Error('Invalid or duplicate plugin manifest');
      registrations.set(manifest.id, { manifest: Object.freeze({ ...manifest }), hooks });
      return () => { hooks.deactivate?.(); registrations.delete(manifest.id); };
    },
    configure(pluginId, settings) { return nativeSend({ operation: 'configure', pluginId, settings }); },
    receive(event) {
      if (!event || event.apiVersion !== 1 || !Array.isArray(event.plugins)) return;
      plugins = event.plugins.slice(0, 32);
      const glass = plugins.find(plugin => plugin.id === id);
      root.classList.toggle('native-liquid-glass', glass?.active === true);
      window.CampusGlassInvalidate?.();
      lastLayout = ''; panelSignature = '';
      for (const plugin of plugins) {
        const registration = registrations.get(plugin.id);
        registration?.hooks.update?.(Object.freeze({ ...plugin }));
      }
      for (const listener of listeners) listener(sdk.getPlugins());
      schedule();
    }
  });
  window.CampusDeskPlugins = sdk;
  sdk.register({ id, name: 'Liquid Glass', version: '1.0.0', apiVersion: 1, capabilities: ['presentation.surfaces'] });

  function renderPanel() {
    const settings = document.getElementById('assistant-settings') || document.getElementById('appearance-settings');
    // The Theme Edition settings have a stable assistant anchor. Classic uses
    // the same settings route; this also works when AI is disabled.
    const settingsPage = document.querySelector('.settings-nav.active');
    if (!settingsPage || !host) return;
    const anchor = settings || document.querySelector('#content .settings-section');
    if (!anchor) return;
    const glass = plugins.find(plugin => plugin.id === id);
    if (!glass) return;
    let panel = document.getElementById('campus-plugin-settings');
    const signature = JSON.stringify([glass, english()]);
    if (panel && signature === panelSignature) return;
    if (!panel) { panel = document.createElement('section'); panel.id = 'campus-plugin-settings'; panel.className = 'card settings-section campus-plugin-settings'; anchor.after(panel); }
    panelSignature = signature;
    const values = glass.settings || {};
    panel.innerHTML = '<div class="plugin-heading"><div><p class="setup-eyebrow">PLUGINS · API 1</p><h2>' + copy('插件与液态玻璃', 'Plugins & Liquid Glass') + '</h2><p>' + copy('原生玻璃材质位于文字下方，调整透明度不会淡化文字。', 'Native glass sits below the text. Transparency changes the material while text stays sharp.') + '</p></div><span class="assistant-state-pill">' + copy(glass.active ? '原生玻璃已启用' : glass.supported ? '已关闭' : '需要 macOS 26', glass.active ? 'Native glass active' : glass.supported ? 'Off' : 'Requires macOS 26') + '</span></div>'
      + '<label class="plugin-toggle"><input type="checkbox" data-plugin-setting="enabled"' + (values.enabled ? ' checked' : '') + (!glass.supported ? ' disabled' : '') + '>' + copy('启用 Liquid Glass', 'Enable Liquid Glass') + '</label>'
      + '<div class="plugin-controls"><label>' + copy('玻璃透明度', 'Glass transparency') + '<input type="range" min="0" max="100" step="5" value="' + Number(values.transparency || 0) + '" data-plugin-setting="transparency"><output>' + Number(values.transparency || 0) + '%</output></label><div class="plugin-presets">' + [0, 50, 100].map(number => '<button type="button" class="button button-light" data-plugin-preset="' + number + '">' + number + '%</button>').join('') + '</div><label>' + copy('边缘圆角', 'Corner radius') + '<input type="range" min="0" max="52" value="' + Number(values.radius || 0) + '" data-plugin-setting="radius"><output>' + Number(values.radius || 0) + ' pt</output></label><label>' + copy('玻璃材质', 'Glass style') + '<select data-plugin-setting="style"><option value="regular"' + (values.style !== 'clear' ? ' selected' : '') + '>' + copy('标准', 'Regular') + '</option><option value="clear"' + (values.style === 'clear' ? ' selected' : '') + '>' + copy('通透', 'Clear') + '</option></select></label></div>'
      + '<small>' + copy('100% 隐藏玻璃层。系统“降低透明度”开启时使用清晰背景。', '100% hides the glass layer. Reduce Transparency uses the standard background.') + '</small><div class="plugin-manifests">' + plugins.map(plugin => '<span>' + escape(plugin.name) + ' ' + escape(plugin.version) + ' · API ' + Number(plugin.apiVersion) + '</span>').join('') + '</div>';
  }

  function layout() {
    scheduled = false;
    renderPanel();
    if (!root.classList.contains('native-liquid-glass') || document.hidden) return;
    const surfaces = [];
    for (const element of document.querySelectorAll('.sidebar,.topbar,.card,.class-clock,.connect-banner')) {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (rect.width < 4 || rect.height < 4 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight || style.visibility === 'hidden' || style.display === 'none') continue;
      // Nested cards are part of the parent surface, avoiding doubled edges.
      if (element.parentElement?.closest('.card')) continue;
      surfaces.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      if (surfaces.length === 48) break;
    }
    const payload = { operation: 'layout', pluginId: id, viewport: { width: innerWidth, height: innerHeight }, theme: root.dataset.colorTheme || 'sage', surfaces };
    const signature = JSON.stringify(payload);
    if (lastLayout !== signature) { lastLayout = signature; nativeSend(payload); }
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(layout); } }
  document.addEventListener('change', event => {
    const field = event.target.closest?.('[data-plugin-setting]');
    if (!field) return;
    const key = field.dataset.pluginSetting;
    const value = key === 'enabled' ? field.checked : key === 'style' ? field.value : Number(field.value);
    sdk.configure(id, { [key]: value });
  });
  document.addEventListener('input', event => {
    const field = event.target.closest?.('input[type="range"][data-plugin-setting]');
    if (field?.nextElementSibling) field.nextElementSibling.textContent = field.value + (field.dataset.pluginSetting === 'radius' ? ' pt' : '%');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-plugin-preset]');
    if (button) sdk.configure(id, { transparency: Number(button.dataset.pluginPreset) });
  });
  new MutationObserver(schedule).observe(document.getElementById('app-shell') || document.body, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['data-color-theme', 'lang', 'class'] });
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.getElementById('content'));
  addEventListener('resize', schedule, { passive: true });
  addEventListener('scroll', schedule, { passive: true, capture: true });
  document.addEventListener('visibilitychange', schedule);
  matchMedia('(prefers-reduced-transparency: reduce)').addEventListener?.('change', () => nativeSend({ operation: 'status' }));
  nativeSend({ operation: 'status' });
})();
