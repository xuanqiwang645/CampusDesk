(function () {
  'use strict';
  // Local, optional time selection without native date/time popups.
  window.CampusTimeWheel = {
    create(root, output, onChange) {
      const toggle = root.querySelector('#task-time-custom');
      const help = root.querySelector('#task-wheel-help');
      let enabled = false, english = false;
      const wheels = ['hour', 'minute'].map((part, index) => {
        const node = root.querySelector('#task-' + part + '-wheel');
        const max = index === 0 ? 23 : 59;
        node.innerHTML = Array.from({ length: max + 1 }, (_, value) =>
          '<div id="task-' + part + '-' + value + '" class="task-wheel-option" role="option" aria-selected="false" data-value="' + value + '">' + String(value).padStart(2, '0') + '</div>').join('');
        const options = Array.from(node.children);
        const wheel = { node, options, max, value: max, digits: '', typedAt: 0 };
        const rowHeight = () => options[0].getBoundingClientRect().height || 40;
        function paint(value) {
          wheel.value = Math.max(0, Math.min(max, value));
          options.forEach((option, i) => option.setAttribute('aria-selected', String(i === wheel.value)));
          node.setAttribute('aria-activedescendant', options[wheel.value].id);
        }
        wheel.align = () => { node.scrollTop = wheel.value * rowHeight(); };
        wheel.read = () => paint(Math.round(node.scrollTop / rowHeight()));
        wheel.select = value => { paint(value); wheel.align(); };
        node.addEventListener('scroll', () => {
          if (!enabled) return;
          const previous = wheel.value;
          wheel.read();
          if (wheel.value !== previous) publish();
        }, { passive: true });
        node.addEventListener('click', event => {
          if (!enabled) return;
          const option = event.target.closest('[data-value]');
          if (!option || !node.contains(option)) return;
          wheel.select(Number(option.dataset.value));
          node.focus({ preventScroll: true });
          publish();
        });
        node.addEventListener('keydown', event => {
          if (!enabled || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
          const movements = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
          let next;
          if (Object.hasOwn(movements, event.key)) next = wheel.value + movements[event.key];
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = max;
          else if (/^\d$/.test(event.key)) {
            wheel.digits = Date.now() - wheel.typedAt < 900 ? (wheel.digits + event.key).slice(-2) : event.key;
            wheel.typedAt = Date.now();
            next = Number(wheel.digits);
            if (next > max) { wheel.digits = event.key; next = Number(event.key); }
          } else if (event.key === 'Enter' || event.key === ' ') {
            // Confirming a wheel must not submit the entire form.
            event.preventDefault(); return;
          } else return;
          event.preventDefault();
          if (!/^\d$/.test(event.key)) wheel.digits = '';
          wheel.select(next); publish();
        });
        return wheel;
      });
      function publish() {
        output.value = enabled ? wheels.map(wheel => String(wheel.value).padStart(2, '0')).join(':') : '';
        onChange();
      }
      function mode() {
        toggle.checked = enabled;
        root.dataset.enabled = String(enabled);
        wheels.forEach(wheel => {
          wheel.node.tabIndex = enabled ? 0 : -1;
          wheel.node.setAttribute('aria-disabled', String(!enabled));
        });
        help.textContent = enabled
          ? (english ? 'Scroll, click a number, or use ↑ ↓.' : '滚动、点选数字，或用 ↑ ↓ 调整。')
          : (english ? 'Defaults to 23:59 on the chosen date.' : '默认当天 23:59；勾选后可滚动调整。');
      }
      toggle.addEventListener('change', () => {
        enabled = toggle.checked;
        mode();
        if (!enabled) wheels.forEach(wheel => wheel.select(wheel.max));
        publish();
      });
      return {
        reset(useEnglish) {
          english = Boolean(useEnglish); enabled = false;
          wheels.forEach(wheel => { wheel.digits = ''; wheel.select(wheel.max); });
          mode(); output.value = '';
        },
        commit() {
          // Freeze the visible centre row even if the user submits mid-scroll.
          if (enabled) wheels.forEach(wheel => { wheel.read(); wheel.align(); });
          publish();
        }
      };
    }
  };
}());
