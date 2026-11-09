/* Mini runtime para las pantallas del Mapa vivo de Norte Luz (versión web independiente).
   Interpreta las plantillas {{huecos}}, <sc-for> y <sc-if> y conecta los eventos onClick, onChange, etc. */
(function () {
  'use strict';

  class DCLogic {
    constructor() { this.props = {}; this.state = this.state || {}; }
    setState(upd, cb) {
      const prev = this.state;
      const part = typeof upd === 'function' ? upd(prev) : upd;
      if (part) this.state = Object.assign({}, prev, part);
      if (this.__rt) this.__rt.schedule(cb);
      else if (cb) cb();
    }
  }
  window.DCLogic = DCLogic;

  const TOKEN = /<sc-for\b([^>]*)>|<\/sc-for>|<sc-if\b([^>]*)>|<\/sc-if>/g;
  function attr(s, name) { const m = s.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')); return m ? m[1] : null; }
  function holePath(s) { const m = s && s.match(/\{\{\s*([^}]+?)\s*\}\}/); return m ? m[1] : null; }

  function parse(src) {
    const root = { kids: [] }; const stack = [root]; let last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      const top = stack[stack.length - 1];
      if (m.index > last) top.kids.push(src.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('<sc-for')) {
        const n = { type: 'for', list: holePath(attr(m[1], 'list')), as: attr(m[1], 'as') || 'item', kids: [] };
        top.kids.push(n); stack.push(n);
      } else if (t.startsWith('<sc-if')) {
        const n = { type: 'if', value: holePath(attr(m[2], 'value')), kids: [] };
        top.kids.push(n); stack.push(n);
      } else if (stack.length > 1) stack.pop();
      last = TOKEN.lastIndex;
    }
    if (last < src.length) stack[stack.length - 1].kids.push(src.slice(last));
    return root;
  }

  function lookup(scope, p) {
    if (p == null) return undefined;
    p = p.trim();
    if (p === 'true') return true; if (p === 'false') return false; if (p === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
    if (/^'.*'$|^".*"$/.test(p)) return p.slice(1, -1);
    return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
  }
  function truthy(v) { return !(v === false || v === 'false' || v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)); }
  function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  const EVT = { onclick: 'click', onchange: 'change', oninput: 'input', onpointerdown: 'pointerdown', onkeydown: 'keydown', onpointerup: 'pointerup', onpointermove: 'pointermove', ondblclick: 'dblclick', onsubmit: 'submit', onfocus: 'focusin', onblur: 'focusout', onwheel: 'wheel' };

  class Runtime {
    constructor(Comp, tpl, mount) {
      this.tree = parse(tpl);
      this.mount = mount;
      this.handlers = [];
      this.comp = new Comp();
      this.comp.__rt = this;
      this.pending = false; this.cbs = [];
      this.bind();
      this.render();
      if (typeof this.comp.componentDidMount === 'function') this.comp.componentDidMount();
    }
    schedule(cb) {
      if (cb) this.cbs.push(cb);
      if (this.pending) return;
      this.pending = true;
      queueMicrotask(() => { this.pending = false; this.render(); const c = this.cbs; this.cbs = []; c.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); });
    }
    fill(text, scope) {
      text = text.replace(/\s(on[A-Za-z]+)="\{\{\s*([^}]+?)\s*\}\}"/g, (m, name, p) => {
        const ev = EVT[name.toLowerCase()]; const fn = lookup(scope, p);
        if (!ev || typeof fn !== 'function') return '';
        this.handlers.push(fn);
        return ' data-dc-' + ev + '="' + (this.handlers.length - 1) + '"';
      });
      text = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, p) => { const v = lookup(scope, p); return v == null ? '' : esc(v); });
      return text.replace(/\s(checked|disabled|selected|hidden|open|readonly|required|multiple)="(false|)"/g, '').replace(/\s(checked|disabled|selected|hidden|open|readonly|required|multiple)="true"/g, ' $1');
    }
    emit(node, scope) {
      let out = '';
      for (const k of node.kids) {
        if (typeof k === 'string') out += this.fill(k, scope);
        else if (k.type === 'if') { if (truthy(lookup(scope, k.value))) out += this.emit(k, scope); }
        else {
          const list = lookup(scope, k.list) || [];
          for (let i = 0; i < list.length; i++) out += this.emit(k, Object.assign(Object.create(scope), { [k.as]: list[i], $index: i }));
        }
      }
      return out;
    }
    render() {
      let vals;
      try { vals = this.comp.renderVals ? this.comp.renderVals() : {}; } catch (e) { console.error(e); return; }
      this.handlers = [];
      const html = this.emit(this.tree, vals);
      const next = document.createElement('div');
      next.id = this.mount.id;
      next.innerHTML = html;
      if (window.morphdom) {
        morphdom(this.mount, next, {
          onBeforeElUpdated: (from, to) => {
            if (from.tagName === 'DETAILS' && from.open !== to.hasAttribute('open')) { if (from.open) to.setAttribute('open', ''); else to.removeAttribute('open'); }
            if (from.tagName === 'CANVAS' && from.width === +to.getAttribute('width') && from.height === +to.getAttribute('height')) return false;
            if (from === document.activeElement && from.tagName === 'INPUT' && from.type === 'range') { from.value = to.value; }
            return true;
          }
        });
      } else this.mount.innerHTML = html;
    }
    bind() {
      const root = this.mount;
      const fire = (attrName, e) => {
        let el = e.target; let stopped = false;
        while (el && el !== root.parentNode) {
          if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute(attrName)) {
            const fn = this.handlers[+el.getAttribute(attrName)];
            if (fn) {
              const cur = el;
              const proxy = new Proxy(e, {
                get(t, k) {
                  if (k === 'currentTarget') return cur;
                  if (k === 'stopPropagation') return () => { stopped = true; t.stopPropagation(); };
                  if (k === 'nativeEvent') return t;
                  const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
                }
              });
              try { fn(proxy); } catch (err) { console.error(err); }
              if (stopped) return;
            }
          }
          el = el.parentNode;
        }
      };
      ['click', 'pointerdown', 'pointerup', 'pointermove', 'keydown', 'dblclick', 'focusin', 'focusout'].forEach((t) => root.addEventListener(t, (e) => fire('data-dc-' + t, e)));
      root.addEventListener('wheel', (e) => fire('data-dc-wheel', e), { passive: false });
      root.addEventListener('submit', (e) => fire('data-dc-submit', e));
      root.addEventListener('input', (e) => {
        fire('data-dc-input', e);
        const t = e.target; const box = t && (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT');
        if (!box) fire('data-dc-change', e);
      });
      root.addEventListener('change', (e) => {
        const t = e.target; const box = t && (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT');
        if (box) fire('data-dc-change', e);
      });
    }
  }

  window.__dcBoot = function (Comp) {
    const tpl = document.getElementById('dc-template').textContent;
    const mount = document.getElementById('dc-root');
    window.__dc = new Runtime(Comp, tpl, mount);
  };
})();
