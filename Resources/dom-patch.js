/* Incremental page updates. Keep live controls and chart-owned DOM mounted. */
(function () {
  'use strict';
  const composing = new WeakSet();
  document.addEventListener('compositionstart', event => composing.add(event.target));
  document.addEventListener('compositionend', event => composing.delete(event.target));
  const key = node => node.nodeType === 1 ? node.id || node.getAttribute('data-dom-key') || '' : '';
  const compatible = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
  function update(node, next) {
    if (node.nodeType !== 1) { if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue; return; }
    // KLineCharts owns these children (canvases, tooltip, interaction handlers).
    if (/^gpa-kline(?:-linear)?-chart$/.test(node.id)) return;
    const editing = node === document.activeElement || composing.has(node);
    const control = /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
    for (const attr of [...node.attributes]) {
      if ((editing && ['value', 'checked', 'selected'].includes(attr.name)) || (node.tagName === 'DETAILS' && attr.name === 'open')) continue;
      if (!next.hasAttribute(attr.name)) node.removeAttribute(attr.name);
    }
    for (const attr of [...next.attributes]) {
      if ((editing && ['value', 'checked', 'selected'].includes(attr.name)) || (node.tagName === 'DETAILS' && attr.name === 'open')) continue;
      if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
    }
    if (control && editing) return;
    children(node, next);
    if (control) {
      if (node.value !== next.value) node.value = next.value;
      if (node.tagName === 'INPUT' && node.checked !== next.checked) node.checked = next.checked;
    }
  }
  function children(parent, next) {
    const keyed = new Map([...parent.childNodes].filter(key).map(node => [key(node), node]));
    let cursor = parent.firstChild;
    for (const desired of [...next.childNodes]) {
      const desiredKey = key(desired);
      const candidate = desiredKey ? keyed.get(desiredKey) : cursor;
      if (candidate && compatible(candidate, desired)) {
        if (candidate !== cursor) {
          if (typeof parent.moveBefore === 'function' && candidate.parentNode === parent) parent.moveBefore(candidate, cursor);
          else if (candidate.contains?.(document.activeElement)) {
            // Re-inserting the focused ancestor cancels marked text in WebKit.
            // Move the intervening siblings after it instead, leaving it mounted.
            const after = candidate.nextSibling;
            while (cursor && cursor !== candidate) {
              const sibling = cursor.nextSibling;
              parent.insertBefore(cursor, after);
              cursor = sibling;
            }
          } else parent.insertBefore(candidate, cursor);
        }
        update(candidate, desired);
        cursor = candidate.nextSibling;
      } else {
        const added = desired.cloneNode(true);
        parent.insertBefore(added, cursor);
      }
    }
    while (cursor) { const nextSibling = cursor.nextSibling; cursor.remove(); cursor = nextSibling; }
  }
  window.CampusDOM = {
    patch(element, html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      children(element, template.content);
    }
  };
}());
