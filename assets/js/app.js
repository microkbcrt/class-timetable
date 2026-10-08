/* ============================================================
 * 炫酷个人面板 · 核心框架
 * - 模块系统：modules/<id>/module.json 声明，module.js 调用 Panel.registerModule 注册
 * - 路由：#/模块id
 * - API：Panel.api.get / set / save / remove / reset / custom
 * ============================================================ */
(function () {
  'use strict';

  var BOOT = window.__PANEL__ || { modules: [], default: '' };
  window.BOOT = BOOT;
  var META = Array.isArray(BOOT.modules) ? BOOT.modules : [];
  var metaMap = new Map(META.map(function (m) { return [m.id, m]; }));

  var registry = new Map();   // id -> 模块定义（由 module.js 注册）
  var views = new Map();      // id -> { el, mounted }
  var loading = new Map();    // id -> Promise
  var pendingNav = 0;

  /* ---------------- DOM 小工具 ---------------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (sk) {
            var sv = v[sk];
            if (sv === null || sv === undefined) return;
            if (sk.slice(0, 2) === '--') node.style.setProperty(sk, String(sv));
            else node.style[sk] = sv;
          });
        }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /* ---------------- SVG 图标注册表（miuix / HyperOS 线性风格） ---------------- */
  var SVG_ATTRS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor" stroke="none"/>',
    list: '<path d="M4 7l1.5 1.5L8 6M4 12l1.5 1.5L8 11M4 17l1.5 1.5L8 16"/><path d="M11 7h9M11 12h9M11 17h6"/>',
    timer: '<circle cx="12" cy="14" r="7.5"/><path d="M9 3h6M12 6.5V10"/><path d="M12 14l2.5-2"/>',
    run: '<circle cx="15" cy="4.5" r="1.6" fill="currentColor" stroke="none"/><path d="M13 8l-3 2 1 3-3 4"/><path d="M11 13l3 1 1 4"/><path d="M10 9.5l4.5 1.5"/>',
    book: '<path d="M12 6c-2-1.3-4.7-2-7.5-2v13c2.8 0 5.5.7 7.5 2 2-1.3 4.7-2 7.5-2V4c-2.8 0-5.5.7-7.5 2z"/><path d="M12 6v13"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    spark: '<path fill="currentColor" stroke="none" d="M12 2.5l2.1 5.9 5.9 2.1-5.9 2.1-2.1 5.9-2.1-5.9L4 10.5l5.9-2.1z"/>',
    box: '<path d="M5.5 5h13l3.5 7v7H2v-7z"/><path d="M22 12h-6l-2 3h-4l-2-3H2"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    pencil: '<path d="M17 3l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    chevronL: '<path d="M15 6l-6 6 6 6"/>',
    chevronR: '<path d="M9 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  var ICON_ALIAS = {
    '📭': 'box', '⚠️': 'warn', '📚': 'book', '🍅': 'timer', '🏃': 'run',
    '🎉': 'check', '📋': 'list', '✅': 'check', '✏️': 'pencil', '🗑️': 'trash',
    '☕': 'timer', '🌙': 'moon', '☀️': 'sun'
  };
  function iconHtml(name) {
    if (!name) return null;
    var key = ICONS[name] ? name : ICON_ALIAS[name];
    return key ? SVG_ATTRS + ICONS[key] + '</svg>' : null;
  }
  function svgNode(name, cls) {
    var html = iconHtml(name);
    if (html) return el('span', { class: cls || 'icon', html: html });
    return el('span', { class: cls || 'icon', text: name || '' }); // emoji 兜底
  }

  /* ---------------- 通用工具 ---------------- */
  var util = {
    uid: function () {
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    },
    pad: function (n) { return n < 10 ? '0' + n : '' + n; },
    today: function (d) {
      d = d || new Date();
      return d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate());
    },
    parseDate: function (str) {
      var p = String(str || '').split('-');
      return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
    },
    mondayOf: function (d) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var diff = (x.getDay() + 6) % 7;
      x.setDate(x.getDate() - diff);
      return x;
    },
    addDays: function (d, n) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      x.setDate(x.getDate() + n);
      return x;
    },
    fmtDate: function (d) {
      return (d.getMonth() + 1) + '/' + util.pad(d.getDate());
    },
    relDay: function (dateStr) {
      if (!dateStr) return null;
      var a = util.parseDate(dateStr), b = util.parseDate(util.today());
      var diff = Math.round((a - b) / 86400000);
      if (diff === 0) return { text: '今天', cls: 'badge-warn' };
      if (diff === 1) return { text: '明天', cls: 'badge-brand' };
      if (diff === -1) return { text: '已逾期', cls: 'badge-danger' };
      if (diff < 0) return { text: '逾期 ' + (-diff) + ' 天', cls: 'badge-danger' };
      if (diff <= 7) return { text: diff + ' 天后', cls: 'badge-ok' };
      return { text: (a.getMonth() + 1) + '/' + a.getDate(), cls: '' };
    },
    mmss: function (sec) {
      sec = Math.max(0, Math.round(sec));
      return util.pad(Math.floor(sec / 60)) + ':' + util.pad(sec % 60);
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    debounce: function (fn, ms) {
      var t; return function () {
        var a = arguments, self = this;
        clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 200);
      };
    }
  };

  /* ---------------- 网络 API：token 鉴权 + rev 版本 + 离线队列 ---------------- */
  var TOKEN = BOOT.token || '';
  var REV_KEY = 'panel.revs';
  var QUEUE_KEY = 'panel.queue';
  var CACHE_PREFIX = 'panel.cache.';
  var REMOTE_KEY = 'panel.remote';
  var REMOTE_TOK_KEY = 'panel.remoteToken';
  var REMOTE_REV_KEY = 'panel.remoteRevs';
  var DIRTY_KEY = 'panel.dirty';
  var flushing = false;
  var offlineWarned = false;

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 配额满时忽略 */ }
  }

  var revs = loadJSON(REV_KEY, {});
  var queue = loadJSON(QUEUE_KEY, []);

  function persistRevs() { saveJSON(REV_KEY, revs); }
  function persistQueue() { saveJSON(QUEUE_KEY, queue); }

  var remoteUrl = loadJSON(REMOTE_KEY, '') || '';
  var remoteToken = loadJSON(REMOTE_TOK_KEY, '') || '';
  var remoteRevs = loadJSON(REMOTE_REV_KEY, {});
  var dirtyMods = loadJSON(DIRTY_KEY, {});
  function persistRemoteRevs() { saveJSON(REMOTE_REV_KEY, remoteRevs); }
  function persistDirty() { saveJSON(DIRTY_KEY, dirtyMods); }
  function setRemote(url, token) {
    remoteUrl = String(url || '').trim().replace(/\/+$/, '');
    remoteToken = String(token || '').trim();
    saveJSON(REMOTE_KEY, remoteUrl);
    saveJSON(REMOTE_TOK_KEY, remoteToken);
  }
  function effectiveToken() { return remoteToken || TOKEN; }
  function markDirty(mod) { dirtyMods[mod] = 1; persistDirty(); }
  function clearDirty(mod) { if (dirtyMods[mod]) { delete dirtyMods[mod]; persistDirty(); } }
  function updateRemoteRevs(mod, rev) {
    rev = parseInt(rev, 10);
    if (!isNaN(rev)) { remoteRevs[mod] = rev; persistRemoteRevs(); }
  }
  function readCache(mod) { return loadJSON(CACHE_PREFIX + mod, null); }
  function writeCache(mod, doc) {
    if (doc && typeof doc === 'object') saveJSON(CACHE_PREFIX + mod, doc);
  }

  function qs(action, mod, path) {
    return 'api.php?m=' + encodeURIComponent(mod) + '&a=' + action +
      (path ? '&path=' + encodeURIComponent(path) : '');
  }

  function isOffline(err) {
    return !!err && (err instanceof TypeError || err.name === 'TypeError');
  }

  function notifyOffline() {
    if (offlineWarned) return;
    offlineWarned = true;
    try { ui.toast('网络不可用，改动已保存在本地，联网后自动同步', 'info'); } catch (e) {}
  }

  /** 原始 HTTP：网络失败 reject TypeError；其余返回 {status, rev, body} */
  function http(action, mod, path, body, method, base) {
    if (ghEnabled() && !base) { return localHandle(action, mod, path, body, method); }
    method = method || (action === 'get' ? 'GET' : 'POST');
    var headers = { 'X-Panel-Token': base ? effectiveToken() : TOKEN };
    var payload = null;
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body === undefined || body === null ? {} : body);
    }
    var url = qs(action, mod, path);
    if (body && body.id) url += '&id=' + encodeURIComponent(body.id);
    if (base) url = base + '/' + url;
    return fetch(url, { method: method, headers: headers, body: payload }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { status: res.status, rev: res.headers.get('X-Panel-Rev'), body: data };
      });
    });
  }
  function remoteHttp(action, mod, path, body, method) {
    return http(action, mod, path, body, method, remoteUrl);
  }

  /** 解析响应：记录 rev、抛出 409 / HTTP 错误，返回 data */
  function interpret(r, mod) {
    var rev = (r.rev !== null && r.rev !== undefined && r.rev !== '') ? parseInt(r.rev, 10) : NaN;
    if (!isNaN(rev)) {
      if (mod) { revs[mod] = rev; persistRevs(); }
      else { revs = {}; persistRevs(); } // 归属不明的 rev（多模块导入）→ 放弃版本检查，后续写入直接覆盖
    }
    if (r.status === 409) {
      var ce = new Error('数据在其它设备已被修改');
      ce.conflict = true;
      ce.serverDoc = (r.body && r.body.data && typeof r.body.data === 'object') ? r.body.data : null;
      throw ce;
    }
    if (!r.body || r.body.ok !== true) {
      var e = new Error(r.body && r.body.error ? r.body.error : '请求失败（HTTP ' + r.status + '）');
      e.status = r.status;
      throw e;
    }
    return r.body.data;
  }

  /* --- 远端（云端）同步：本地服务器为准、推送本地改动；云端有新数据则拉回本地 --- */
  function interpretRemote(r, mod) {
    updateRemoteRevs(mod, r.rev);
    if (r.status === 409) {
      var ce = new Error('云端数据在其它设备已被修改');
      ce.conflict = true;
      ce.serverDoc = (r.body && r.body.data && typeof r.body.data === 'object') ? r.body.data : null;
      throw ce;
    }
    if (!r.body || r.body.ok !== true) {
      var e = new Error(r.body && r.body.error ? r.body.error : '云端请求失败（HTTP ' + r.status + '）');
      e.status = r.status;
      throw e;
    }
    return r.body.data;
  }

  /** 云端更新 → 写入本地服务器（不标脏，避免镜像循环） */
  function pullMod(mod, doc) {
    var op = { mod: mod, action: 'set', path: '', body: { value: doc }, tries: 0, noDirty: true };
    return attempt(op).then(function () {
      return { pulled: true };
    }, function (err) {
      if (err && err.conflict) return { pulled: false, conflict: true };
      if (err && err.status) return { pulled: false, error: err.message };
      return Promise.reject(err);
    });
  }

  /** 推送本地文档到云端（带 baseRev）；409 → 云端优先拉回本地 */
  function pushMod(mod, doc) {
    var body = { value: doc };
    if (remoteRevs[mod] !== undefined && remoteRevs[mod] !== null && remoteRevs[mod] !== 0) {
      body.baseRev = remoteRevs[mod];
    }
    return remoteHttp('set', mod, '', body).then(function (r) {
      try {
        interpretRemote(r, mod);
      } catch (e) {
        if (e && e.conflict) {
          if (e.serverDoc === null || e.serverDoc === undefined) {
            clearDirty(mod);
            return { pushed: false, conflict: true };
          }
          return pullMod(mod, e.serverDoc).then(function (pr) {
            if (pr.pulled) clearDirty(mod);
            return { pushed: false, conflict: true, pulled: pr.pulled };
          });
        }
        if (e && e.status) return { pushed: false, error: e.message };
        throw e;
      }
      clearDirty(mod);
      return { pushed: true };
    });
  }

  function syncModRemote(mod) {
    if (dirtyMods[mod]) {
      return api.get(mod).then(function (doc) {
        return pushMod(mod, doc);
      }, function (err) {
        return { error: err.message };
      });
    }
    return remoteHttp('get', mod, '').then(function (r) {
      var rev = parseInt(r.rev, 10) || 0;
      var prev = remoteRevs[mod] || 0;
      updateRemoteRevs(mod, rev);
      if (r.body && r.body.ok && rev > prev) {
        return pullMod(mod, r.body.data);
      }
      return { upToDate: true };
    }, function (err) {
      if (err && err.status) return { error: err.message };
      return { offline: true };
    });
  }

  /** 对全部（或指定）模块执行一次双向同步 */
  function syncRemote(opts) {
    opts = opts || {};
    if (!remoteUrl) return Promise.resolve({ skipped: 'no-remote' });
    var mods = (opts.mods && opts.mods.length) ? opts.mods
      : META.map(function (m) { return m.id; });
    var out = {};
    var chain = Promise.resolve();
    mods.forEach(function (mod) {
      chain = chain.then(function () {
        return syncModRemote(mod).then(function (r) { out[mod] = r; });
      });
    });
    return chain.then(function () { return out; });
  }

  /* --- 本地镜像：与 lib/Storage.php 行为一致，用于离线乐观更新 --- */
  function getPathLocal(doc, path) {
    if (!path) return doc;
    var cur = doc;
    var segs = String(path).split('.');
    for (var i = 0; i < segs.length; i++) {
      if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, segs[i])) {
        cur = cur[segs[i]];
      } else { return null; }
    }
    return cur;
  }
  function setPathLocal(doc, path, value) {
    if (!path || !doc || typeof doc !== 'object') return;
    var segs = String(path).split('.');
    var ref = doc;
    for (var i = 0; i < segs.length - 1; i++) {
      if (!ref[segs[i]] || typeof ref[segs[i]] !== 'object') ref[segs[i]] = {};
      ref = ref[segs[i]];
    }
    ref[segs[segs.length - 1]] = value;
  }
  function genId() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-';
    for (var i = 0; i < 6; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }
  function saveLocal(doc, path, item) {
    var list = getPathLocal(doc, path);
    if (!Array.isArray(list)) list = [];
    var replaced = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i] === 'object' && String(list[i].id) === String(item.id)) {
        list[i] = item; replaced = true; break;
      }
    }
    if (!replaced) list.push(item);
    setPathLocal(doc, path, list);
    return item;
  }
  function removeLocal(doc, path, id) {
    var list = getPathLocal(doc, path);
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i] === 'object' && String(list[i].id) === String(id)) {
        var removed = list.splice(i, 1)[0];
        setPathLocal(doc, path, list);
        return removed;
      }
    }
    return null;
  }

  /** 把离线操作应用到本地缓存，返回与服务器一致的响应形状（无缓存返回 null） */
  function applyLocal(op) {
    var doc = readCache(op.mod);
    if (!doc || typeof doc !== 'object') return null;
    var result = null;
    if (op.action === 'set') {
      if (!op.path) {
        if (op.body.value && typeof op.body.value === 'object') doc = op.body.value;
        result = doc;
      } else {
        setPathLocal(doc, op.path, op.body.value);
        result = op.body.value;
      }
    } else if (op.action === 'save') {
      result = saveLocal(doc, op.path, op.body.value);
    } else if (op.action === 'remove') {
      result = removeLocal(doc, op.path, op.body.id);
    } else {
      return null;
    }
    saveJSON(CACHE_PREFIX + op.mod, doc);
    return result;
  }

  /** 带 baseRev 的写入：冲突自动重放（最多 3 次），断网则入队 + 乐观本地更新 */
  function persist(mod, action, path, body) {
    body = body || {};
    if (action === 'save' && body.value && typeof body.value === 'object' && !body.value.id) {
      body.value.id = genId();
    }
    var op = { mod: mod, action: action, path: path || '', body: body, tries: 0 };
    return attempt(op).then(function (data) {
      if (queue.length) setTimeout(flushQueue, 0);
      return data;
    });
  }

  function attempt(op) {
    if (revs[op.mod] !== undefined && revs[op.mod] !== null) op.body.baseRev = revs[op.mod];
    else delete op.body.baseRev;
    return http(op.action, op.mod, op.path, op.body).then(function (r) {
      var data = interpret(r, op.mod);
      if (op.noDirty !== true) markDirty(op.mod);
      return data;
    }).catch(function (err) {
      if (err && err.conflict) {
        if (err.serverDoc) writeCache(op.mod, err.serverDoc);
        if (++op.tries <= 3) return attempt(op);
        throw err;
      }
      if (isOffline(err)) {
        if (op.action === 'reset') return Promise.reject(new Error('恢复默认数据需要联网'));
        var result = applyLocal(op);
        if (result === null || result === undefined) {
          if (op.action === 'save' || op.action === 'set') result = op.body.value;
          else result = null;
        }
        queue.push({
          mod: op.mod, action: op.action, path: op.path,
          body: JSON.parse(JSON.stringify(op.body)), at: Date.now()
        });
        persistQueue();
        notifyOffline();
        return result;
      }
      throw err;
    });
  }

  /** 联网后按顺序回放本地队列 */
  function flushQueue() {
    if (flushing || !queue.length) return Promise.resolve(0);
    flushing = true;
    var done = 0;
    function step() {
      if (!queue.length) {
        flushing = false;
        offlineWarned = false;
        if (done) { try { ui.toast('已同步 ' + done + ' 条本地改动', 'success'); } catch (e) {} }
        if (remoteUrl) syncRemote();
        return Promise.resolve(done);
      }
      var op = queue[0];
      op.tries = 0;
      return attempt(op).then(function () {
        queue.shift(); persistQueue(); done++;
        return step();
      }, function (err) {
        flushing = false;
        if (isOffline(err)) return Promise.resolve(done); // 仍然断网，保留队列
        if (err && err.status === 404 && op.action === 'remove') {
          queue.shift(); persistQueue(); return step();   // 条目已在其它设备删除
        }
        queue.shift(); persistQueue();
        try { ui.toast('同步失败已丢弃：' + (err && err.message ? err.message : ''), 'error'); } catch (e) {}
        return step();
      });
    }
    return step();
  }

  /* ---------------- 本地优先 + GitHub 手动备份 ----------------
   * 每端数据独立、日常离线可用：
   *   · 无 PHP 模式（BOOT.backend.type==='github'，静态站/Android）：数据存本地
   *     localStorage panel.local.<模块>，默认值内嵌在 BOOT.defaults —— 本端独立。
   *   · PHP 模式（本地服务器/Electron）：数据在 data/<id>.json —— 本端独立。
   * GitHub 仅作备份/迁移：设置页「上传到 GitHub / 从 GitHub 拉取」（Panel.github.push/pull），
   * 读写仓库 <dir>/<id>.json（整体快照，不做实时同步、不追踪 rev）。
   * 令牌：localStorage panel.githubToken（设置页填写，PAT，勿写死）。
   * ------------------------------------------------------------------- */
  var GH = (BOOT.backend && BOOT.backend.type === 'github') ? BOOT.backend : null;
  var GH_DEFAULT = { owner: 'microkbcrt', repo: 'xuanku-panel', branch: 'main', dir: 'data' };
  var GH_TOKEN_KEY = 'panel.githubToken';
  var GH_API = 'https://api.github.com';

  function ghEnabled() { return !!GH; }
  function ghRepo() {
    try {
      var o = JSON.parse(localStorage.getItem('panel.githubRepo') || 'null');
      if (o && o.owner && o.repo) return Object.assign({}, GH_DEFAULT, o);
    } catch (e) {}
    return GH_DEFAULT;
  }
  function ghToken() {
    var t = '';
    try { t = localStorage.getItem(GH_TOKEN_KEY) || ''; } catch (e) {}
    if (!t) t = String(BOOT.githubToken || '');
    return t;
  }
  function ghHeaders() {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    var t = ghToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }
  function ghB64Encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function ghB64Decode(b64) { return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, '')))); }
  function ghParse(txt) { try { return txt ? JSON.parse(txt) : null; } catch (e) { return null; } }
  function ghContentsPath(rel) {
    var r = ghRepo();
    return '/repos/' + r.owner + '/' + r.repo + '/contents/' + rel + '?ref=' + (r.branch || 'main');
  }
  function ghGetFile(rel) { return ghGetFileTo(ghRepo(), rel); }

  /* --- 本地数据镜像（无 PHP 模式）：每端独立、离线可用 --- */
  var LOCAL_PREFIX = 'panel.local.';
  function localClone(o) { return (o && typeof o === 'object') ? JSON.parse(JSON.stringify(o)) : {}; }
  function ghDefaults(mod) {
    if (BOOT.defaults && BOOT.defaults[mod] && typeof BOOT.defaults[mod] === 'object') {
      return localClone(BOOT.defaults[mod]);
    }
    return {};
  }
  function readLocMod(mod) {
    try {
      var s = localStorage.getItem(LOCAL_PREFIX + mod);
      if (s) { var d = JSON.parse(s); if (d && typeof d === 'object') return d; }
    } catch (e) {}
    return ghDefaults(mod);
  }
  function writeLocMod(mod, doc) {
    try { localStorage.setItem(LOCAL_PREFIX + mod, JSON.stringify(doc)); } catch (e) {}
  }
  /* 无 PHP 模式的日常读写：全部落在本地镜像，语义与 api.php 一致 */
  function localHandle(action, mod, path, body) {
    body = body || {};
    if (action === 'get') {
      return Promise.resolve({ status: 200, body: { ok: true, data: getPathLocal(readLocMod(mod), path) } });
    }
    var doc = readLocMod(mod);
    if (action === 'set') {
      setPathLocal(doc, path, body.value);
      writeLocMod(mod, doc);
      return Promise.resolve({ status: 200, body: { ok: true, data: getPathLocal(doc, path) } });
    }
    if (action === 'save') {
      var item = body.value;
      if (item && typeof item === 'object' && !item.id) item.id = genId();
      saveLocal(doc, path, item);
      writeLocMod(mod, doc);
      return Promise.resolve({ status: 200, body: { ok: true, data: item } });
    }
    if (action === 'remove') {
      var removed = removeLocal(doc, path, body.id);
      if (removed === null) return Promise.resolve({ status: 404, body: { ok: false, error: '未找到条目：' + body.id } });
      writeLocMod(mod, doc);
      return Promise.resolve({ status: 200, body: { ok: true, data: removed } });
    }
    if (action === 'reset') {
      var d = ghDefaults(mod);
      writeLocMod(mod, d);
      return Promise.resolve({ status: 200, body: { ok: true, data: d } });
    }
    return Promise.resolve({ status: 400, body: { ok: false, error: '未知操作：' + action } });
  }

  /* --- GitHub Contents API：仅"上传/拉取备份"时使用 --- */
  function ghPutFileTo(r, rel, text, sha, message) {
    var body = { message: message, content: ghB64Encode(text), branch: r.branch || 'main' };
    if (sha) body.sha = sha;
    return fetch(GH_API + '/repos/' + r.owner + '/' + r.repo + '/contents/' + rel, {
      method: 'PUT',
      headers: Object.assign(ghHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) { return { status: res.status, data: ghParse(txt) }; });
    });
  }
  function ghGetFileTo(r, rel) {
    return fetch(GH_API + '/repos/' + r.owner + '/' + r.repo + '/contents/' + rel + '?ref=' + (r.branch || 'main'), { headers: ghHeaders() }).then(function (res) {
      return res.text().then(function (txt) {
        if (res.status === 200) {
          var j = ghParse(txt);
          if (j && j.type === 'file' && j.content) {
            return { exists: true, text: ghB64Decode(j.content), sha: j.sha };
          }
          return { exists: false, sha: null };
        }
        return { exists: false, sha: null, status: res.status };
      });
    }).catch(function () { return { exists: false, sha: null, offline: true }; });
  }
  function ghPutFile(rel, text, sha, message) { return ghPutFileTo(ghRepo(), rel, text, sha, message); }
  /* 上传已存在的文件需带 sha，否则 GitHub 返回 422：失败后取回 sha 再重试一次 */
  function ghPutSmartTo(r, rel, text, message) {
    return ghPutFileTo(r, rel, text, null, message).then(function (res) {
      if (res.status !== 422) return res;
      return ghGetFileTo(r, rel).then(function (g) {
        return (g && g.exists && g.sha) ? ghPutFileTo(r, rel, text, g.sha, message) : res;
      });
    });
  }
  function ghPutSmart(rel, text, message) { return ghPutSmartTo(ghRepo(), rel, text, message); }
  function ghHttpError(status, fallback) {
    var r = ghRepo();
    if (status === 401) return 'GitHub 令牌无效或未授权（401），请在设置页填写有效的 PAT';
    if (status === 403) return 'GitHub 拒绝访问（403），可能是令牌权限不足或触发限流';
    if (status === 404) return '找不到仓库 ' + r.owner + '/' + r.repo + '（或令牌无权访问）';
    return fallback || ('GitHub 返回 HTTP ' + status);
  }
  /* 当前模块的完整文档：PHP 模式读服务器数据，无 PHP 模式读本地镜像 */
  function readModDoc(id) {
    if (ghEnabled()) return Promise.resolve(readLocMod(id));
    return api.get(id);
  }
  function writeModDoc(id, doc) {
    if (ghEnabled()) { writeLocMod(id, doc); return Promise.resolve(); }
    return api.set(id, '', doc);
  }
  /* 上传：把本端全部模块数据写入 GitHub data/<id>.json（覆盖云端旧副本） */
  function ghPushAll() {
    var r = ghRepo();
    if (!ghToken()) return Promise.reject(new Error('请先在设置页填写 GitHub 令牌'));
    var done = [];
    return META.reduce(function (ch, m) {
      return ch.then(function () {
        return readModDoc(m.id).then(function (doc) {
          return ghPutSmart(r.dir + '/' + m.id + '.json', JSON.stringify(doc, null, 2), 'panel: 上传 ' + m.id).then(function (res) {
            if (res.status === 200 || res.status === 201) { done.push(m.id); return m.id; }
            throw new Error(ghHttpError(res.status, '上传 ' + m.id + ' 失败（HTTP ' + res.status + '）'));
          });
        });
      });
    }, Promise.resolve()).then(function () {
      try { localStorage.setItem('panel.githubLastPush', String(Date.now())); } catch (e) {}
      return { pushed: done };
    });
  }
  /* 拉取：从 GitHub 读回全部模块并覆盖本端本地数据 */
  function ghPullAll() {
    var r = ghRepo();
    if (!ghToken()) return Promise.reject(new Error('请先在设置页填写 GitHub 令牌'));
    var done = [], missing = [];
    return META.reduce(function (ch, m) {
      return ch.then(function () {
        return ghGetFile(r.dir + '/' + m.id + '.json').then(function (f) {
          if (!f.exists || !f.text) { missing.push(m.id); return; }
          var doc = ghParse(f.text);
          if (!doc || typeof doc !== 'object') { missing.push(m.id); return; }
          return writeModDoc(m.id, doc).then(function () { done.push(m.id); });
        });
      });
    }, Promise.resolve()).then(function () {
      var out = { pulled: done };
      if (missing.length) out.missing = missing;
      return out;
    });
  }
  /* 无 PHP 模式的导出/导入：读/写本地镜像（离线可用） */
  function ghCustom(mod, action, opts) {
    opts = opts || {};
    if (action === 'export') {
      var out = { exportedAt: new Date().toISOString(), modules: {} };
      META.forEach(function (m) { out.modules[m.id] = readLocMod(m.id); });
      return Promise.resolve({ status: 200, body: { ok: true, data: out } });
    }
    if (action === 'import') {
      var data = (opts.body && opts.body.data) || {};
      var restored = [];
      Object.keys(data).forEach(function (id) {
        if (metaMap.has(id) && data[id] && typeof data[id] === 'object') {
          writeLocMod(id, data[id]);
          restored.push(id);
        }
      });
      return Promise.resolve({ status: 200, body: { ok: true, data: { restored: restored } } });
    }
    return Promise.resolve({ status: 400, body: { ok: false, error: '未知操作：' + action } });
  }

  /* 公共只读站：模块首次 get 时拉取 backend.dataUrls[mod] 覆盖本地镜像，
   * 同学端刷新即见最新发布数据；拉取失败（离线/部署前）回落本地镜像与内嵌默认值。 */
  var dataUrlFetched = {};
  function fetchPublicData(mod) {
    var urls = (BOOT.backend && BOOT.backend.dataUrls) || {};
    var url = urls[mod];
    if (!url || dataUrlFetched[mod]) return Promise.resolve(false);
    dataUrlFetched[mod] = true;
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (doc) {
        if (doc && typeof doc === 'object' && !Array.isArray(doc) && Object.keys(doc).length) {
          writeLocMod(mod, doc);
          return true;
        }
        return false;
      })
      .catch(function () { return false; });
  }

  var api = {
    get: function (mod, path) {
      var warm = (path === '' || !path) && (BOOT.backend && BOOT.backend.dataUrls || {})[mod]
        ? fetchPublicData(mod) : Promise.resolve(false);
      return warm.then(function () {
        return http('get', mod, path || '').then(function (r) {
          var data = interpret(r, mod);
          if (!path && data && typeof data === 'object') writeCache(mod, data);
          if (queue.length) setTimeout(flushQueue, 0);
          return data;
        });
      }).catch(function (err) {
        if (isOffline(err)) {
          var cached = readCache(mod);
          if (cached !== null && cached !== undefined) { notifyOffline(); return cached; }
        }
        throw err;
      });
    },
    set: function (mod, path, value) { return persist(mod, 'set', path || '', { value: value }); },
    save: function (mod, path, value) { return persist(mod, 'save', path || '', { value: value }); },
    remove: function (mod, path, id) { return persist(mod, 'remove', path || '', { id: String(id) }); },
    reset: function (mod) { return persist(mod, 'reset', '', {}); },
    custom: function (mod, action, opts) {
      opts = opts || {};
      if (ghEnabled()) {
        return ghCustom(mod, action, opts).then(function (r) {
          var out = interpret(r, null);
          if (action === 'import') { revs = {}; persistRevs(); }
          return out;
        });
      }
      var method = (opts.method || 'POST').toUpperCase();
      var body = (method === 'GET' || method === 'HEAD') ? undefined
        : (opts.body === undefined ? {} : opts.body);
      var headers = { 'X-Panel-Token': TOKEN };
      var payload = null;
      if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      var url = 'api.php?m=' + encodeURIComponent(mod) + '&a=' + action +
        (opts.path ? '&path=' + encodeURIComponent(opts.path) : '');
      return fetch(url, { method: method, headers: headers, body: payload }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          var out = interpret({ status: res.status, rev: null, body: data }, null);
          if (action === 'import') { revs = {}; persistRevs(); }
          return out;
        });
      });
    }
  };

  /* ---------------- UI 组件 ---------------- */
  var modalRoot = document.getElementById('modal-root');
  var toastRoot = document.getElementById('toast-root');
  var modalStack = [];

  var ui = {
    el: el,
    $: $,

    toast: function (msg, type) {
      var t = el('div', { class: 'toast ' + (type || 'info') },
        svgNode(type === 'success' ? 'check' : type === 'error' ? 'close' : 'info', 'toast-icon'), msg);
      toastRoot.appendChild(t);
      setTimeout(function () {
        t.classList.add('out');
        setTimeout(function () { t.remove(); }, 320);
      }, 2400);
    },

    modal: function (opt) {
      opt = opt || {};
      var body = el('div', { class: 'modal-body' });
      append(body, typeof opt.body === 'function' ? opt.body() : opt.body);

      var foot = null;
      var close = function () { destroy(); };

      var box = el('div', { class: 'modal' },
        el('div', { class: 'modal-head' },
          el('h3', { text: opt.title || '' }),
          el('button', { class: 'modal-close', type: 'button', 'aria-label': '关闭', html: iconHtml('close') || '✕', onclick: close })),
        body);

      if (opt.actions && opt.actions.length) {
        foot = el('div', { class: 'modal-foot' });
        opt.actions.forEach(function (a) {
          var btn = el('button', {
            type: 'button',
            class: 'btn ' + (a.class || ''),
            onclick: function () {
              var r = a.onClick ? a.onClick(close, box) : undefined;
              if (r !== false && a.closeOnClick !== false) close();
            }
          }, a.label);
          foot.appendChild(btn);
        });
        box.appendChild(foot);
      }

      var overlay = el('div', {
        class: 'modal-overlay',
        onmousedown: function (e) { if (e.target === overlay && opt.dismissible !== false) close(); }
      }, box);

      function onKey(e) {
        if (e.key === 'Escape' && modalStack[modalStack.length - 1] === handle && opt.dismissible !== false) {
          close();
        }
      }

      function destroy() {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        modalStack = modalStack.filter(function (m) { return m !== handle; });
        if (opt.onClose) opt.onClose();
      }

      modalRoot.appendChild(overlay);
      document.addEventListener('keydown', onKey);

      var handle = { close: close, root: overlay, body: body, box: box };
      modalStack.push(handle);

      setTimeout(function () {
        var first = body.querySelector('input,textarea,select,button');
        if (first && opt.focus !== false) { try { first.focus(); } catch (e) {} }
      }, 60);

      return handle;
    },

    confirm: function (msg, opt) {
      opt = opt || {};
      return new Promise(function (resolve) {
        var done = false;
        var m = ui.modal({
          title: opt.title || '请确认',
          body: el('div', { class: 'confirm-text', text: msg }),
          dismissible: true,
          onClose: function () { if (!done) resolve(false); },
          actions: [
            { label: '取消', class: 'btn-ghost', onClick: function () { done = true; resolve(false); } },
            {
              label: opt.okText || '确定',
              class: opt.danger ? 'btn-danger' : 'btn-primary',
              onClick: function () { done = true; resolve(true); }
            }
          ]
        });
        return m;
      });
    },

    empty: function (icon, text, hint) {
      return el('div', { class: 'empty' },
        iconHtml(icon)
          ? el('div', { class: 'empty-icon', html: iconHtml(icon) })
          : el('div', { class: 'empty-icon', text: icon || '📭' }),
        el('div', { class: 'empty-text', text: text || '暂无内容' }),
        hint ? el('div', { class: 'empty-hint', text: hint }) : null);
    },

    loading: function (text) {
      return el('div', { class: 'loading' }, el('div', { class: 'spinner' }), el('div', { text: text || '加载中…' }));
    },

    progress: function (percent) {
      var p = Math.max(0, Math.min(100, Number(percent) || 0));
      return el('div', { class: 'progress' }, el('i', { style: { width: p.toFixed(1) + '%' } }));
    },

    /** 表单弹窗：fields = [{name,label,type,value,required,placeholder,options,min,max,step,rows}] */
    form: function (opt) {
      var values = {};
      var wrap = el('div', { class: 'form-grid' });
      (opt.fields || []).forEach(function (f) {
        var input;
        if (f.type === 'select') {
          input = el('select', { class: 'input', name: f.name });
          (f.options || []).forEach(function (o) {
            var ov = typeof o === 'object' ? o.value : o;
            var ol = typeof o === 'object' ? o.label : o;
            input.appendChild(el('option', { value: ov, text: ol }));
          });
        } else if (f.type === 'textarea') {
          input = el('textarea', { class: 'input', name: f.name, rows: f.rows || 3, placeholder: f.placeholder || '' });
        } else {
          input = el('input', {
            class: 'input', name: f.name, type: f.type || 'text',
            placeholder: f.placeholder || '', min: f.min, max: f.max, step: f.step
          });
        }
        var initial = f.value !== undefined && f.value !== null ? String(f.value) : '';
        input.value = initial;
        wrap.appendChild(el('div', { class: 'field' },
          el('label', {}, f.label + (f.required ? ' *' : '')), input));
      });

      var errorLine = el('div', { class: 'form-error', style: { display: 'none' } });
      var baseActions = (opt.actions && opt.actions.length)
        ? opt.actions
        : [{ label: opt.cancelText || '取消', class: 'btn-ghost' }];

      var m = ui.modal({
        title: opt.title || '编辑',
        body: [wrap, errorLine],
        actions: baseActions.concat([{
          label: '保存',
          class: 'btn-primary',
          closeOnClick: false,
          onClick: function (close) {
            var data = {};
            var invalid = null;
            (opt.fields || []).forEach(function (f) {
              var node = wrap.querySelector('[name="' + f.name + '"]');
              var v = node ? String(node.value || '').trim() : '';
              if (f.required && !v && !invalid) invalid = f.label;
              data[f.name] = f.type === 'number' ? (v === '' ? null : Number(v)) : v;
            });
            if (invalid) {
              errorLine.style.display = '';
              errorLine.textContent = '请填写：' + invalid;
              ui.toast('请填写：' + invalid, 'error');
              return false;
            }
            var r = opt.onSubmit ? opt.onSubmit(data, close) : undefined;
            if (r === false) return false;
            if (r && typeof r.then === 'function') {
              r.then(function () { close(); }).catch(function (e) {
                errorLine.style.display = '';
                errorLine.textContent = e.message || String(e);
                ui.toast(e.message || '保存失败', 'error');
              });
              return false;
            }
            close();
            return true;
          }
        }])
      });
      return m;
    }
  };

  /* ---------------- 模块加载 ---------------- */
  function ensureLoaded(id) {
    if (registry.has(id)) return Promise.resolve(registry.get(id));
    if (loading.has(id)) return loading.get(id);

    var meta = metaMap.get(id);
    if (!meta) return Promise.reject(new Error('未知模块：' + id));

    var p = new Promise(function (resolve, reject) {
      if (meta.css && !document.querySelector('link[data-mod-css="' + id + '"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'modules/' + id + '/' + meta.css;
        link.dataset.modCss = id;
        document.head.appendChild(link);
      }
      var script = document.createElement('script');
      script.src = 'modules/' + id + '/' + meta.js;
      script.dataset.modJs = id;
      script.onload = function () {
        if (registry.has(id)) resolve(registry.get(id));
        else reject(new Error('模块脚本未调用 Panel.registerModule：' + id));
      };
      script.onerror = function () { reject(new Error('模块脚本加载失败：' + id)); };
      document.head.appendChild(script);
      setTimeout(function () {
        if (!registry.has(id)) reject(new Error('模块加载超时：' + id));
      }, 8000);
    });

    loading.set(id, p);
    return p;
  }

  function ensureView(id) {
    var v = views.get(id);
    if (!v) {
      var section = el('section', { class: 'view', dataset: { mod: id } });
      document.getElementById('viewport').appendChild(section);
      v = { el: section, mounted: false };
      views.set(id, v);
    }
    return v;
  }

  /* ---------------- 导航 ---------------- */
  function setActiveNav(id) {
    document.querySelectorAll('#sidenav .nav-item, #tabbar .tab-item').forEach(function (node) {
      node.classList.toggle('active', node.dataset.mod === id);
    });
  }

  function showMeta(meta) {
    document.getElementById('view-title').textContent = meta.name;
    document.getElementById('view-desc').textContent = meta.description || '';
    document.title = meta.name + ' · ' + (BOOT.appName || '个人面板');
  }

  function navigate(id, pushHash) {
    if (!metaMap.has(id)) id = BOOT.default || (META[0] && META[0].id);
    if (!id) return;
    if (Panel.currentId === id && views.get(id) && views.get(id).mounted) return;

    var token = ++pendingNav;
    var meta = metaMap.get(id);
    var view = ensureView(id);
    setActiveNav(id);
    showMeta(meta);

    if (pushHash !== false && location.hash !== '#/' + id) {
      history.replaceState(null, '', '#/' + id);
    }

    views.forEach(function (v, k) { v.el.classList.toggle('active', k === id); });
    Panel.currentId = id;

    if (!view.mounted) {
      clear(view.el);
      view.el.appendChild(ui.loading('正在加载「' + meta.name + '」…'));
      ensureLoaded(id).then(function (def) {
        if (token !== pendingNav) return;
        clear(view.el);
        view.mounted = true;
        return Promise.resolve(def.mount ? def.mount(view.el, ctxFor(id)) : undefined);
      }).catch(function (err) {
        if (token !== pendingNav) return;
        clear(view.el);
        view.el.appendChild(errorView(err, id));
        ui.toast(err.message, 'error');
      });
    } else {
      var def = registry.get(id);
      if (def && def.activate) { try { def.activate(view.el); } catch (e) { console.error(e); } }
    }
  }

  function errorView(err, id) {
    return el('div', { class: 'card' },
      ui.empty('warn', '模块加载失败', err.message || String(err)),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('button', { class: 'btn btn-primary', onclick: function () { retry(id); } }, '重试')));
  }

  function retry(id) {
    loading.delete(id);
    registry.delete(id);
    var view = views.get(id);
    if (view) { view.mounted = false; clear(view.el); }
    navigate(id, false);
  }

  function ctxFor(id) {
    var meta = metaMap.get(id);
    return {
      meta: meta,
      api: api,
      ui: ui,
      util: util,
      el: el,
      boot: BOOT,
      reload: function () { retry(id); },
      toast: ui.toast
    };
  }

  /* ---------------- 外壳渲染 ---------------- */
  function buildNav() {
    var sidenav = document.getElementById('sidenav');
    var tabbar = document.getElementById('tabbar');
    clear(sidenav); clear(tabbar);

    META.forEach(function (meta) {
      sidenav.appendChild(el('button', {
        class: 'nav-item', type: 'button', dataset: { mod: meta.id },
        onclick: function () { navigate(meta.id); }
      },
        svgNode(meta.icon || '🧩', 'nav-icon'),
        el('span', { text: meta.name }),
        meta.description ? el('span', { class: 'nav-desc', text: meta.description.slice(0, 2) }) : null));

      tabbar.appendChild(el('button', {
        class: 'tab-item', type: 'button', dataset: { mod: meta.id },
        onclick: function () { navigate(meta.id); }
      },
        svgNode(meta.icon || '🧩', 'tab-icon'),
        el('span', { text: meta.name })));
    });
  }

  function buildClock() {
    var time = document.querySelector('#clock .clock-time');
    var date = document.querySelector('#clock .clock-date');
    if (!time) return;
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    function tick() {
      var d = new Date();
      time.textContent = util.pad(d.getHours()) + ':' + util.pad(d.getMinutes()) + ':' + util.pad(d.getSeconds());
      date.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week[d.getDay()];
    }
    tick();
    setInterval(tick, 1000);
  }

  function buildTheme() {
    var btn = document.getElementById('theme-toggle');
    function paint() {
      var light = document.documentElement.dataset.theme === 'light';
      btn.innerHTML = iconHtml(light ? 'sun' : 'moon') || (light ? '☀️' : '🌙');
    }
    btn.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('panel.theme', next); } catch (e) {}
      paint();
    });
    paint();
  }

  function boot() {
    buildNav();
    buildClock();
    buildTheme();

    var profile = BOOT.profile || {};
    var nameEl = document.getElementById('side-name');
    var noEl = document.getElementById('side-no');
    var avatar = document.getElementById('side-avatar');
    var sub = document.getElementById('brand-sub');
    if (profile.student) { nameEl.textContent = profile.student; avatar.textContent = profile.student.slice(0, 1); }
    if (profile.studentNo) noEl.textContent = profile.studentNo;
    if (profile.term) sub.textContent = profile.term;

    window.addEventListener('hashchange', function () {
      var id = location.hash.replace(/^#\//, '');
      if (id) navigate(id, false);
    });

    var initial = location.hash.replace(/^#\//, '');
    navigate(initial || BOOT.default, false);

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.toast('快捷入口：点击下方 / 左侧导航切换功能', 'info');
      }
    });

    // 同步：联网事件 + 启动时回放离线队列 + 云端双向同步
    function syncAfterFlush() {
      return flushQueue().then(function () { if (remoteUrl) syncRemote(); });
    }
    window.addEventListener('online', function () { syncAfterFlush(); });
    if (queue.length) setTimeout(syncAfterFlush, 800);
    else if (remoteUrl) setTimeout(syncRemote, 1800);
  }

  /* ---------------- 对外接口 ---------------- */
  var Panel = window.Panel = {
    boot: BOOT,
    meta: META,
    currentId: null,
    registerModule: function (def) {
      if (!def || !def.id) throw new Error('Panel.registerModule 缺少 id');
      registry.set(def.id, def);
      var view = views.get(def.id);
      if (view && !view.mounted && Panel.currentId === def.id) navigate(def.id, false);
      return Panel;
    },
    navigate: navigate,
    reload: retry,
    api: api,
    /** 同步状态：Panel.sync.pending() 待同步条数 / flush() 立即回放 / revs() 版本表 */
    sync: {
      flush: flushQueue,
      pending: function () { return queue.length; },
      queue: function () { return queue.slice(); },
      revs: function () { return revs; },
      cache: readCache,
      remote: syncRemote,
      setRemote: setRemote,
      markDirty: markDirty,
      remoteState: function () {
        return { url: remoteUrl, token: remoteToken, revs: remoteRevs, dirty: Object.keys(dirtyMods) };
      }
    },
    /** GitHub 备份（所有端）：令牌 / 仓库 / 上传 / 拉取（手动，不做实时同步） */
    github: {
      available: function () { return true; },
      mode: function () { return GH ? 'local' : 'php'; },
      config: function () {
        var c = ghRepo();
        return { owner: c.owner, repo: c.repo, branch: c.branch || 'main', dir: c.dir || 'data', token: ghToken() };
      },
      repo: function () { var c = ghRepo(); return c.owner + '/' + c.repo; },
      token: ghToken,
      setToken: function (t) { try { localStorage.setItem(GH_TOKEN_KEY, String(t || '').trim()); } catch (e) {} },
      clearToken: function () { try { localStorage.removeItem(GH_TOKEN_KEY); } catch (e) {} },
      setRepo: function (cfg) {
        cfg = cfg || {};
        if (cfg.owner && cfg.repo) {
          try { localStorage.setItem('panel.githubRepo', JSON.stringify(cfg)); } catch (e) {}
        }
      },
      lastPush: function () {
        try { return Number(localStorage.getItem('panel.githubLastPush')) || 0; } catch (e) { return 0; }
      },
      test: function () {
        var r = ghRepo();
        return fetch(GH_API + '/repos/' + r.owner + '/' + r.repo, { headers: ghHeaders() }).then(function (res) {
          return res.json().catch(function () { return null; }).then(function (j) {
            if (res.status === 200) return { ok: true, private: !!(j && j.private), canWrite: !!(j && j.permissions && j.permissions.push) };
            throw new Error(ghHttpError(res.status));
          });
        });
      },
      push: ghPushAll,
      pull: ghPullAll,
      /** 发布任意文本到指定仓库文件（公共课表等）：需已保存的 PAT 有该仓库写权限 */
      putTo: function (owner, repo, branch, rel, text, message) {
        if (!owner || !repo || !rel) return Promise.reject(new Error('putTo 缺少仓库或文件路径'));
        if (!ghToken()) return Promise.reject(new Error('请先在设置页填写 GitHub 令牌'));
        var r = { owner: owner, repo: repo, branch: branch || 'main' };
        return ghPutSmartTo(r, rel, text, message || 'panel: 发布数据').then(function (res) {
          if (res.status === 200 || res.status === 201) return res.data;
          throw new Error(ghHttpError(res.status, '发布失败（HTTP ' + res.status + '）'));
        });
      }
    },
    ui: ui,
    util: util,
    el: el,
    /** 图标：Panel.icon('calendar') → SVG 节点（未知名回落为 emoji 文本） */
    icon: function (name, cls) { return svgNode(name, cls); },
    iconHtml: iconHtml,
    /** 扩展入口：模块可在注册后动态追加能力，例如 Panel.extend('todos', { quickAdd(){...} }) */
    extend: function (id, extra) {
      var def = registry.get(id);
      if (def) Object.assign(def, extra);
      else {
        Panel.registerModule(Object.assign({ id: id, mount: function () {} }, extra));
      }
      return Panel;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
