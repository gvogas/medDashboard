export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function $(id) {
  return document.getElementById(id);
}

/** True when el takes typed text, so redrawing it would lose what is being typed. */
export function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(el.type);
}

export function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/** Render trusted view markup; dynamic text must still pass through esc().
 * Presentation values are applied through CSSOM under style-src-attr 'none'.
 */
export function setHTML(host, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const el of template.content.querySelectorAll('[data-accent], [data-width], [data-swatch]')) {
    for (const [attribute, property] of [['accent', '--c'], ['swatch', 'background-color']]) {
      const value = el.dataset[attribute];
      if (value && /^#[0-9a-f]{6}$/i.test(value)) el.style.setProperty(property, value);
    }
    if (el.dataset.width !== undefined) {
      const width = Number(el.dataset.width);
      if (Number.isFinite(width)) el.style.width = Math.max(0, Math.min(100, width)) + '%';
    }
  }
  host.replaceChildren(template.content);
}
