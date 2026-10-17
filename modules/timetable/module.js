/* 课表模块 · 模仿 WakeUp 课程表的周视图 */
(function () {
  'use strict';
  var MOD = 'timetable';
  var C = Panel.el, U = Panel.util;

  var PALETTE = [
    ['#5B7CFA', '#8AA4FF'], ['#38A3F1', '#73C4FF'], ['#E6A23C', '#F6C567'],
    ['#12A672', '#3ED197'], ['#E85694', '#F887B3'], ['#8B5CF6', '#B394FF'],
    ['#0FB5A5', '#43D2C2'], ['#3B82F6', '#78AAFF'], ['#F0752C', '#FF9D52'],
    ['#E5484D', '#F47067']
  ];
  var DAY_CN = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

  var doc = null;          // {settings, courses}
  var viewWeek = 0;        // 0 = 跟随当前周
  var host = null;         // 模块根节点
  var ctx = null;
  var timer = null;        // ticker 停止函数
  var todayHost = null;    // 今日课程卡片容器（定时整体刷新）

  var colorMap = {};
  function colorOf(name) { return colorMap[name] || PALETTE[0]; }

  /** 按课程名稳定分配颜色（步长 3 与调色板长度 10 互质，相邻课程不会同色） */
  function buildColors(courses) {
    var names = [];
    courses.forEach(function (c) { if (names.indexOf(c.name) === -1) names.push(c.name); });
    names.sort();
    colorMap = {};
    names.forEach(function (n, i) {
      colorMap[n] = PALETTE[(i * 3) % PALETTE.length];
    });
  }

  function periods() {
    var p = doc && doc.settings && doc.settings.periods;
    if (Array.isArray(p) && p.length) return p;
    var out = [], defs = [
      ['08:00', '08:40'], ['08:45', '09:25'], ['09:30', '10:10'], ['10:30', '11:10'],
      ['11:15', '11:55'], ['14:30', '15:10'], ['15:15', '15:55'], ['16:15', '16:55'],
      ['17:00', '17:40'], ['19:30', '20:10'], ['20:15', '20:55'], ['21:00', '21:40']
    ];
    defs.forEach(function (d, i) { out.push({ n: i + 1, start: d[0], end: d[1] }); });
    return out;
  }

  function currentWeek() {
    var s = doc.settings || {};
    if (s.weekOverride > 0) return s.weekOverride;
    var start = U.parseDate(s.termStart || U.today());
    if (isNaN(start.getTime())) return 1;
    var w = Math.round((U.mondayOf(new Date()) - U.mondayOf(start)) / 604800000) + 1;
    return Math.max(1, w);
  }

  function activeWeek() { return viewWeek > 0 ? viewWeek : currentWeek(); }

  function weekOptions() {
    var max = 20;
    if (doc.settings && Number(doc.settings.weekCount) > max) max = Number(doc.settings.weekCount);
    if (doc.courses) {
      doc.courses.forEach(function (c) {
        (c.weeks || []).forEach(function (w) { if (Number(w) > max) max = Number(w); });
      });
    }
    return Array.apply(null, { length: max }).map(function (_, i) { return i + 1; });
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function inWeek(course, week) {
    if (doc.settings.showAllWeeks) return true;
    if (!Array.isArray(course.weeks)) return true;
    return course.weeks.indexOf(week) !== -1;
  }

  /** 课程最早开课周（用于并排时周数靠前的排左栏） */
  function minWeek(c) {
    if (!Array.isArray(c.weeks) || !c.weeks.length) return 0;
    return c.weeks.reduce(function (m, w) { return w < m ? w : m; }, c.weeks[0]);
  }

  function minutesOf(hhmm) {
    var p = String(hhmm || '').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /* ---------------- 调休补课 / 放假（settings.swaps） ---------------- */
  function swapList() {
    var a = doc && doc.settings && doc.settings.swaps;
    return Array.isArray(a) ? a : [];
  }

  function fmtMD(dateStr) {
    var d = U.parseDate(dateStr);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** 日期 → 周内序号（0=周一） */
  function dayIdx(dateStr) { return (U.parseDate(dateStr).getDay() + 6) % 7; }

  /** 任意日期所在教学周（相对 termStart） */
  function weekOfDate(dateStr) {
    var s = doc.settings || {};
    var start = U.parseDate(s.termStart || U.today());
    if (isNaN(start.getTime())) return currentWeek();
    var w = Math.round((U.mondayOf(U.parseDate(dateStr)) - U.mondayOf(start)) / 604800000) + 1;
    return Math.max(1, w);
  }

  /**
   * 某日的显示方案。优先级：放假 > 补课 > 正常。
   * 返回 { kind:'off'|'map'|'normal', badge, tone, srcDay, week, from, note }
   * kind='map' 时该列按 from 日的星期与教学周渲染课表。
   */
  function planFor(dateStr) {
    var arr = swapList(), i, e;
    for (i = 0; i < arr.length; i++) {
      e = arr[i];
      if (e && e.mode === 'off' && e.date === dateStr) {
        return { kind: 'off', badge: '放假', tone: 'off' };
      }
    }
    for (i = 0; i < arr.length; i++) {
      e = arr[i];
      if (e && e.date === dateStr && e.from && (e.mode === 'swap' || e.mode === 'add')) {
        var sd = dayIdx(e.from);
        return {
          kind: 'map', from: e.from, srcDay: sd + 1, week: weekOfDate(e.from),
          badge: '补 ' + U.fmtDate(U.parseDate(e.from)) + ' ' + DAY_CN[sd].replace('星期', '周'),
          tone: 'map',
          note: (e.mode === 'swap' ? '对调补课' : '补课') + '：' + fmtMD(dateStr) +
            ' 按 ' + fmtMD(e.from) + '（' + DAY_CN[sd] + '）的课表上课'
        };
      }
    }
    for (i = 0; i < arr.length; i++) {
      e = arr[i];
      if (e && e.mode === 'swap' && e.from === dateStr && e.date) {
        var td = dayIdx(e.date);
        return {
          kind: 'map', from: e.date, srcDay: td + 1, week: weekOfDate(e.date),
          badge: '调休', tone: 'rev',
          note: '调休：' + fmtMD(dateStr) + ' 按 ' + fmtMD(e.date) +
            '（' + DAY_CN[td] + '）的课表上课'
        };
      }
    }
    return { kind: 'normal' };
  }

  /* ---------------- 左右滑动切周 ----------------
     自写 pointer 手势引擎在真机 WebView 上连修多版仍不可靠（触摸隐式捕获 / compositor
     接管 / 出界事件 / 快滑打断，一坑接一坑），2026-10-17 先换原生 scroll-snap，同日
     「手感实验室」三方案实测（同一真实课表：A 原生 snap / B Swiper / C Embla）后
     按用户手感判定整体换成 Embla 8 分页：拖拽、动量、中途抓停全由 Embla 处理，
     JS 只做 settle 后重建居中 + 拖后 click 抑制兜底。见 enableEmbla。 */
  var slideDir = 0;      /* 下一次 render 的入场方向（仅箭头/概览回退用）：1=从右入，-1=从左入 */
  var dragMoved = false; /* 鼠标拖卷过 → 抑制随后的课程卡片 click */
  var quietGrid = false; /* 滑动落定后的重建：课程卡片不做入场动画（页面已由滚动就位） */

  function goWeek(dir) {
    var t = activeWeek() + dir;
    if (t < 1 || t > weekOptions().length) return;
    if (!doc.settings.showAllWeeks && emblaInst && curPageWeeks.length >= 2) {
      var i = curPageWeeks.indexOf(activeWeek());
      /* 全周渲染后窗口就是 1-20 周：除首尾外始终有邻页，箭头走 Embla 原生平滑翻页
         （settle 走 syncChrome 轻更新，与手指滑动完全一致） */
      if (i >= 0 && (dir > 0 ? i < curPageWeeks.length - 1 : i > 0)) {
        if (dir > 0) emblaInst.scrollNext(); else emblaInst.scrollPrev();
        return;
      }
    }
    slideDir = dir;                              /* 概览模式/边界回退：保留入场动画 */
    viewWeek = t;
    render();
  }

  function sectionOf(n) { return n <= 5 ? 'morning' : n <= 9 ? 'afternoon' : 'evening'; }

  /**
   * 按实际作息生成网格行：第 1 行表头；每个时段前有独立分段行；
   * 同时段内超过 15 分钟的课间额外占一行，避免与 5 分钟课间一样高。
   */
  function periodLayout(ps) {
    var rows = {}, separators = [], row = 2;
    var lastSection = null, lastEnd = null;
    ps.forEach(function (p) {
      var section = sectionOf(p.n);
      if (lastSection === null || section !== lastSection) {
        separators.push({ type: 'section', row: row, section: section });
        row++;
      } else if (lastEnd !== null) {
        var gap = minutesOf(p.start) - lastEnd;
        if (gap >= 15) {
          separators.push({ type: 'break', row: row, minutes: gap, before: p.n });
          row++;
        }
      }
      rows[p.n] = row;
      row++;
      lastSection = section;
      lastEnd = minutesOf(p.end);
    });
    return { rows: rows, separators: separators };
  }

  function periodGridRow(ps, n) {
    return periodLayout(ps).rows[n];
  }

  /* ---- 横向切周控制器（Embla 8，2026-10-17 第五版）----
     手机上「手感实验室」（lab.html：同一张真实课表三栏 A 原生 snap / B Swiper / C Embla）
     实测用户判定：Embla 手感最爽、Swiper 次之、原生 snap 平庸 → 换 Embla。
     结构：.kb-scroll=视口(overflow:hidden)，.kb-track=container，.kb-page=slide；
     触摸/鼠标拖拽与动量、中途抓停全由 Embla 自己的物理处理（自写鼠标拖卷引擎删除）。
     JS 只做两件事：① settle（动量+吸附完全结束）读当前页 → 静默重建居中；
     ② pointer 轨迹 >6px 时置 dragMoved 兜底抑制课程卡 click（双保险，Embla 自带 click 防误触）。 */
  var emblaInst = null;      /* 当前 render 的 Embla 实例（每次 render 重建、旧的销毁） */
  var curPageWeeks = [];     /* 当前 embla 窗口内的周次（与页序对齐），供 goWeek 边界判断 */

  function loadEmbla(cb) {
    if (window.EmblaCarousel) return cb();
    var s = document.createElement('script');
    s.src = 'assets/vendor/embla/embla-carousel.umd.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function enableEmbla(scroll, week, weeks) {
    curPageWeeks = weeks;
    if (weeks.length < 2) return;
    function boot() {
      if (emblaInst) { try { emblaInst.destroy(); } catch (e) {} emblaInst = null; }
      var idx = Math.max(0, weeks.indexOf(week));
      scroll.classList.add('kb-embla');        /* 触发 .kb-track will-change: transform（常驻合成层） */
      emblaInst = EmblaCarousel(scroll, {
        align: 'start', startIndex: idx,
        loop: false, containScroll: false, dragFree: false, skipSnaps: false
      });
      emblaInst.on('settle', function () {
        if (!emblaInst) return;
        var i = emblaInst.selectedScrollSnap();
        var page = scroll.querySelectorAll('.kb-page')[i];
        var w = page ? Number(page.getAttribute('data-w')) : 0;
        if (!w || w === activeWeek()) return;
        viewWeek = w;
        syncChrome(w);                           /* 轻更新周条/节数/now 线，DOM 与实例不动 */
      });
      /* 拖动过 → 抑制随后的课程卡 click（每手势起点复位） */
      var sx = 0, moved = false, pid = -1;
      scroll.addEventListener('pointerdown', function (e) { sx = e.clientX; moved = false; pid = e.pointerId; }, true);
      scroll.addEventListener('pointermove', function (e) {
        if (e.pointerId === pid && Math.abs(e.clientX - sx) > 6) moved = true;
      }, true);
      scroll.addEventListener('pointerup', function () {
        if (moved) { dragMoved = true; setTimeout(function () { dragMoved = false; }, 160); }
        pid = -1; moved = false;
      }, true);
    }
    if (window.EmblaCarousel) boot(); else loadEmbla(boot);
  }

  /* 当前视角周对应网格（全周渲染后 host 里有 20 个 .kb-grid，now 高亮/now 线只挂视角页） */
  function activeGrid() {
    return host.querySelector('.kb-page[data-w="' + activeWeek() + '"] .kb-grid');
  }

  /* 滑动落定后的周条轻更新：只改文案/下拉值/回到本周按钮/节数，不重建 DOM 也不动 embla */
  function syncChrome(w) {
    var now = new Date();
    var weekStart = U.addDays(U.mondayOf(now), (w - currentWeek()) * 7);
    var bar = host.querySelector('.kb-bar');
    if (bar) {
      var txt = bar.querySelector('.kb-week-text');
      if (txt) {
        var b = txt.querySelector('b');
        if (b) b.textContent = '第 ' + w + ' 周';
        var span = txt.querySelector('span');
        if (span) span.textContent = U.fmtDate(weekStart) + ' - ' + U.fmtDate(U.addDays(weekStart, 6));
      }
      var sel = bar.querySelector('.kb-week-select');
      if (sel) sel.value = String(w);
      var isCur = w === currentWeek();
      var todayBtn = bar.querySelector('.kb-today-btn');
      if (isCur) { if (todayBtn) todayBtn.remove(); }
      else if (!todayBtn) {
        var tools = bar.querySelector('.kb-tools');
        if (tools) tools.appendChild(C('button', {
          class: 'chip kb-today-btn', type: 'button',
          onclick: function () { viewWeek = 0; render(); }
        }, '回到本周'));
      }
    }
    var visible = doc.courses.filter(function (c) { return inWeek(c, w); });
    var note = host.querySelector('.kb-extra-note');
    if (note) note.textContent = '本周 ' + visible.length + ' 节课';
    updateNow();
  }

  function subscriptionUrls() {
    var http = '';
    var configured = BOOT.webcalUrl ? String(BOOT.webcalUrl).trim() : '';
    if (configured) {
      http = configured.replace(/^webcal:/i, 'https:');
    } else if (Panel.github.mode() === 'php' && /^https?:$/.test(location.protocol)) {
      var url = new URL('api.php', location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('m', MOD);
      url.searchParams.set('a', 'ics');
      if (BOOT.token) url.searchParams.set('token', BOOT.token);
      http = url.href;
    }
    if (!http) return null;
    return { http: http, webcal: http.replace(/^https?:/i, 'webcal:') };
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (e) {}
      area.remove();
      copied ? resolve() : reject(new Error('浏览器拒绝了复制操作'));
    });
  }

  function showSubscription() {
    var urls = subscriptionUrls();
    if (!urls) {
      Panel.ui.toast('当前环境没有可用的日历订阅地址', 'error');
      return;
    }
    var input = C('input', {
      class: 'input kb-subscribe-url',
      type: 'text',
      value: urls.webcal,
      readonly: true,
      onFocus: function (e) { e.target.select(); }
    });
    Panel.ui.modal({
      title: '日历订阅',
      bodyClass: 'kb-subscribe-body',
      body: [
        C('div', {
          class: 'kb-subscribe-note',
          text: '复制订阅链接，在手机上导入，即可随时同步最新课表并获得系统级日程上课提醒（仅在安卓上实测）'
        }),
        C('div', { class: 'kb-subscribe-step', text: '导入方式：' }),
        C('div', { class: 'kb-subscribe-step', text: 'iPhone 订阅 [日历-日历-添加日历-添加订阅日历]' }),
        C('div', { class: 'kb-subscribe-step', text: '安卓设备订阅 [日历-添加日历/日程导入-URL导入/URL日历] (名字可能有不同)' }),
        input
      ],
      actions: [
        {
          label: '复制订阅链接',
          class: 'btn-primary',
          closeOnClick: false,
          onClick: function (close) {
            copyText(urls.webcal).then(function () {
              Panel.ui.toast('订阅链接已复制', 'success');
              close();
            }).catch(function (e) {
              Panel.ui.toast('复制失败：' + e.message, 'error');
            });
            return false;
          }
        }
      ]
    });
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!host) return;
    host.textContent = '';
    var s = doc.settings;
    var week = activeWeek();
    var now = new Date();
    var weekStart = U.addDays(U.mondayOf(now), (week - currentWeek()) * 7);
    var visible = doc.courses.filter(function (c) { return inWeek(c, week); });

    var bar = C('div', { class: 'card kb-bar' },
      C('div', { class: 'kb-week' },
        C('button', { class: 'kb-arrow', type: 'button', title: '上一周', html: Panel.iconHtml('chevronL'), onclick: function () { goWeek(-1); } }),
        C('select', {
          class: 'form-select kb-week-select',
          'aria-label': '选择教学周',
          onchange: function (e) {
            viewWeek = Number(e.target.value);
            render();
          }
        }, weekOptions().map(function (w) {
          return C('option', {
            value: String(w),
            selected: w === week,
            text: '第 ' + w + ' 周' + (w === currentWeek() ? '（本周）' : '')
          });
        })),
        C('div', { class: 'kb-week-text' },
          C('b', { text: '第 ' + week + ' 周' }),
          C('span', { text: U.fmtDate(weekStart) + ' - ' + U.fmtDate(U.addDays(weekStart, 6)) })),
        C('button', { class: 'kb-arrow', type: 'button', title: '下一周', html: Panel.iconHtml('chevronR'), onclick: function () { goWeek(1); } })),
      C('div', { class: 'kb-tools' },
        C('button', {
          class: 'chip' + (s.showAllWeeks ? ' active' : ''), type: 'button',
          onclick: function () {
            s.showAllWeeks = !s.showAllWeeks;
            ctx.api.set(MOD, 'settings.showAllWeeks', s.showAllWeeks).catch(function () {});
            render();
          }
        }, s.showAllWeeks ? '显示：全部周' : '显示：本周'),
        C('button', {
          class: 'chip', type: 'button', title: '订阅日历：复制链接到手机日历，随时同步最新课表',
          onclick: function () { showSubscription(); }
        }, '日历订阅'),
        BOOT.readOnly ? null :
          C('button', { class: 'chip', type: 'button', onclick: function () { Panel.navigate('settings'); } }, '课表设置'),
        /* 工具行在手机端是不换行的横向滚动行：回到本周放这里（margin-left:auto 靠右），
           出现/消失只横向伸缩，不会像挤在周条里那样顶高一整行 */
        week === currentWeek() ? null : C('button', {
          class: 'chip kb-today-btn', type: 'button',
          onclick: function () { viewWeek = 0; render(); }
        }, '回到本周')));

    host.appendChild(bar);

    host.appendChild(C('div', { class: 'kb-meta' },
      C('span', { text: s.student || '' }),
      C('span', { class: 'dot', text: '·' }),
      C('span', { text: s.studentNo || '' }),
      C('span', { class: 'dot', text: '·' }),
      C('span', { text: s.term || '' }),
      C('span', { class: 'dot', text: '·' }),
      C('span', { class: 'kb-extra-note', text: '本周 ' + visible.length + ' 节课' })));

    /* ---- 课表格子 ----
       滑动切周 = Embla 分页（第五版，手感实验室实测用户选定），并按用户建议
       1-20 周全部预渲染成 slides（1.0.19）：
       滑动/惯性全程纯合成，settle 后只轻更新周条文案（syncChrome），
       不再整棵重建 DOM —— 彻底消灭快甩跟不上的掉帧。 */
    var scroll = C('div', { class: 'card kb-scroll' });
    var track = C('div', { class: 'kb-track' });
    scroll.appendChild(track);
    host.appendChild(scroll);
    var pageWeeks = s.showAllWeeks ? [week] : weekOptions().slice();
    pageWeeks.forEach(function (w) {
      var page = C('div', { class: 'kb-page', 'data-w': w });
      var grid = C('div', { class: 'kb-grid' });
      page.appendChild(grid);
      track.appendChild(page);
      if (w !== week || quietGrid) grid.classList.add('kb-quiet');   /* 邻页/落定重建：卡片不播入场动画 */
      if (slideDir && w === week) {
        var inClass = slideDir > 0 ? 'kb-in-next' : 'kb-in-prev';
        grid.classList.add(inClass);
        /* 动画结束立即摘掉：fill both 的 transform 会压过后续 transform */
        grid.addEventListener('animationend', function () { grid.classList.remove(inClass); }, { once: true });
      }
      buildGrid(grid, w);
    });
    slideDir = 0;
    quietGrid = false;
    if (!s.showAllWeeks) enableEmbla(scroll, week, pageWeeks);
    else if (emblaInst) { try { emblaInst.destroy(); } catch (e) {} emblaInst = null; }

    todayHost = C('div', { class: 'kb-today-wrap' });
    todayHost.appendChild(buildToday(periods()));
    host.appendChild(todayHost);
    updateNow();
  }

  /**
   * 渲染一周的课表格子（render 的网格部分；拖动时预渲染相邻周也复用。
   * 只含节次网格本体：表头/节次列/课程卡，不含顶部周条与今日卡片）。
   */
  function buildGrid(grid, week) {
    var showAll = !!doc.settings.showAllWeeks;
    var now = new Date();
    var todayIdx = (now.getDay() + 6) % 7;
    var weekStart = U.addDays(U.mondayOf(now), (week - currentWeek()) * 7);
    var isCurWeek = week === currentWeek();
    var visible = doc.courses.filter(function (c) { return inWeek(c, week); });

    /* 每列日期的显示方案（调休补课 / 放假）；全部周概览时不套用调休方案 */
    var plans = [];
    for (var pi = 0; pi < 7; pi++) {
      plans.push(showAll ? { kind: 'normal' } : planFor(U.today(U.addDays(weekStart, pi))));
    }

    grid.appendChild(C('div', { class: 'kb-corner', text: '节次', style: { gridRow: '1', gridColumn: '1' } }));
    for (var d = 1; d <= 7; d++) {
      var date = U.addDays(weekStart, d - 1);
      var dpl = plans[d - 1];
      grid.appendChild(C('div', {
        class: 'kb-day' +
          (isCurWeek && d - 1 === todayIdx ? ' is-today' : '') +
          (dpl.kind !== 'normal' ? ' is-override' : '') +
          (dpl.kind === 'off' ? ' is-off' : ''),
        style: { gridRow: '1', gridColumn: String(d + 1) }
      },
        C('b', { text: DAY_CN[d - 1] }),
        showAll ? null : C('span', { text: U.fmtDate(date) }),
        dpl.kind !== 'normal'
          ? C('span', { class: 'kb-badge' + (dpl.tone === 'off' ? ' kb-badge-off' : dpl.tone === 'rev' ? ' kb-badge-rev' : ''), text: dpl.badge })
          : null));
    }

    var ps = periods();
    var nowMin = nowMinutes();
    var nowRow = -1;
    var layout = periodLayout(ps);
    ps.forEach(function (p, i) {
      if (isCurWeek && nowMin >= minutesOf(p.start) && nowMin < minutesOf(p.end)) nowRow = i;
    });

    layout.separators.forEach(function (item) {
      if (item.type === 'section') {
        var label = item.section === 'morning' ? '上午' : item.section === 'afternoon' ? '下午' : '晚上';
        grid.appendChild(C('div', {
          class: 'kb-section kb-section-' + item.section,
          dataset: { section: item.section },
          style: { gridRow: String(item.row), gridColumn: '1 / -1' }
        }, C('b', { text: label })));
      } else {
        grid.appendChild(C('div', {
          class: 'kb-break',
          dataset: { breakRow: String(item.row) },
          style: { gridRow: String(item.row), gridColumn: '1 / -1' }
        }, C('span', { text: item.minutes + ' 分钟' })));
      }
    });

    ps.forEach(function (p, i) {
      var row = layout.rows[p.n];
      grid.appendChild(C('div', {
        class: 'kb-slot' + (nowRow === i ? ' is-now' : ''),
        dataset: { row: String(row), periodIndex: String(i) },
        style: { gridRow: String(row), gridColumn: '1' }
      }, C('b', { text: p.n }), C('span', { text: p.start + '\n' + p.end })));

      for (var d2 = 1; d2 <= 7; d2++) {
        var cpl = plans[d2 - 1];
        grid.appendChild(C('div', {
          class: 'kb-cell' +
            (isCurWeek && d2 - 1 === todayIdx ? ' is-today' : '') +
            (nowRow === i ? ' is-now' : '') +
            (cpl.kind !== 'normal' ? ' is-override' : '') +
            (cpl.kind === 'off' ? ' is-off' : ''),
          dataset: { row: String(row), col: String(d2 + 1) },
          style: { gridRow: String(row), gridColumn: String(d2 + 1) }
        }));
      }
    });

    /* ---- 课程卡片（按天分组：仅时间真正冲突的课程并排，其余占满整列） ---- */
    for (var day = 1; day <= 7; day++) {
      var colPlan = plans[day - 1];
      if (colPlan.kind === 'off') continue;              /* 放假：该列不显示课表 */
      var list;
      if (colPlan.kind === 'map') {
        /* 补课/调休列：按来源日期的星期与教学周取课 */
        list = doc.courses.filter(function (c) { return c.day === colPlan.srcDay && inWeek(c, colPlan.week); });
      } else {
        list = visible.filter(function (c) { return c.day === day; });
      }
      /* 英语在左、日语在右：同段平局按 id 升序（c13 英语 < c22 日语）显式定序 */
      list = list.slice().sort(function (a, b) {
        return a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
      if (!list.length) continue;

      /* 时间段两两相交的课程归入同一组（传递合并） */
      var groups = [];
      list.forEach(function (c) {
        var merged = [c], rest = [];
        groups.forEach(function (g) {
          var hit = g.some(function (m) { return m.start <= c.end && c.start <= m.end; });
          if (hit) merged = merged.concat(g); else rest.push(g);
        });
        rest.push(merged);
        groups = rest;
      });

      /* 组内分配 lane（同时间段的按最早开课周从左到右），列宽只在组内均分 */
      groups.forEach(function (g) {
        var ordered = g.slice().sort(function (a, b) {
          return a.start - b.start || a.end - b.end || minWeek(a) - minWeek(b)
            || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        });
        var laneEnds = [];
        ordered.forEach(function (c) {
          var lane = -1;
          for (var i = 0; i < laneEnds.length; i++) {
            if (laneEnds[i] < c.start) { lane = i; break; }
          }
          if (lane === -1) { laneEnds.push(0); lane = laneEnds.length - 1; }
          laneEnds[lane] = c.end;
          c._lane = lane;
        });
        g.forEach(function (c) { c._lanes = laneEnds.length; });
      });

      list.forEach(function (c) {
        var cp = colPlan;
        var sw = cp.kind === 'map' ? cp.week : week;
        var w = 100 / c._lanes;
        var col = colorOf(c.name);
        var card = C('div', {
          class: 'kb-course',
          style: {
            '--c1': col[0], '--c2': col[1],
            gridRow: layout.rows[c.start] + ' / span ' +
              (layout.rows[c.end] - layout.rows[c.start] + 1),
            gridColumn: String(day + 1),
            width: 'calc(' + w + '% - 5px)',
            marginLeft: 'calc(' + (c._lane * w) + '% + 2px)',
            animationDelay: Math.min(0.3, c.start * 0.04) + 's'
          },
          onclick: function () {
            if (dragMoved) { dragMoved = false; return; }
            showDetail(c, sw, cp.kind === 'map' ? cp : null);
          }
        },
          C('div', { class: 'kb-course-name', text: c.name }),
          C('div', { class: 'kb-course-info' },
            C('span', { text: c.place || '待定' })),
          C('div', {
            class: 'kb-course-sub',
            text: c.start === c.end ? c.start + ' 节' : c.start + '–' + c.end + ' 节'
          }));
        grid.appendChild(card);
      });
    }
  }

  /* 重建今日课程卡片（含倒计时 / 进行中 / 已上完状态），供定时刷新调用 */
  function refreshToday() {
    if (!todayHost) return;
    todayHost.textContent = '';
    todayHost.appendChild(buildToday(periods()));
  }

  /* ---- 今日课程 / 下一节（始终按真实周次计算） ---- */
  function buildToday(ps) {
    var card = C('div', { class: 'card kb-today' });
    var now = new Date();
    var todayIdx = (now.getDay() + 6) % 7;
    var week = currentWeek();
    var pl = planFor(U.today(now));

    if (pl.kind === 'off') {
      card.appendChild(C('div', { class: 'card-title' },
        C('span', { text: '今日课程 · ' + DAY_CN[todayIdx] + ' ' + U.fmtDate(now) + '（放假）' }),
        C('span', { class: 'sub' })));
      card.appendChild(Panel.ui.empty('🎉', '今天放假', '调休放假，没有课'));
      return card;
    }

    var dayNum = todayIdx + 1;
    var title = '今日课程 · ' + DAY_CN[todayIdx] + ' ' + U.fmtDate(now) + '（第' + week + '周）';
    if (pl.kind === 'map') {
      dayNum = pl.srcDay;
      week = pl.week;
      title = '今日课程 · ' + DAY_CN[todayIdx] + ' ' + U.fmtDate(now) +
        '（调休补课 · 按' + fmtMD(pl.from) + DAY_CN[dayNum - 1] + '）';
    }

    var list = doc.courses
      .filter(function (c) {
        if (c.day !== dayNum) return false;
        return !Array.isArray(c.weeks) || c.weeks.indexOf(week) !== -1;
      })
      .sort(function (a, b) { return a.start - b.start; });

    var head = C('div', { class: 'card-title' },
      C('span', { text: title }),
      C('span', { class: 'sub', text: list.length ? list.length + ' 节' : '' }));
    card.appendChild(head);

    if (!list.length) {
      card.appendChild(Panel.ui.empty('🎉', '今天没有课', '好好安排自己的时间吧'));
      return card;
    }

    var nowMin = nowMinutes();
    var nextInfo = '';
    list.forEach(function (c) {
      var p = ps[c.start - 1] || ps.find(function (x) { return x.n === c.start; }) || { start: '--:--', end: '--:--' };
      /* 连堂课结束时间取最后一小节，而非首节（否则 8:00-10:10 会显示成 8:00-8:40、8:40 就判"已上完"） */
      var pe = ps[c.end - 1] || ps.find(function (x) { return x.n === c.end; }) || p;
      var start = minutesOf(p.start), end = minutesOf(pe.end);
      var status = nowMin >= end ? '已上完' : nowMin >= start ? '进行中' : '还有 ' + (start - nowMin) + ' 分钟';
      var cls = nowMin >= start && nowMin < end ? 'live' : nowMin >= end ? 'done' : 'soon';
      if (!nextInfo && nowMin < start) {
        var h = Math.floor((start - nowMin) / 60), m = (start - nowMin) % 60;
        nextInfo = '下一节：' + c.name + '（' + (h ? h + ' 小时 ' : '') + m + ' 分钟后）';
      }
      var col = colorOf(c.name);
      card.appendChild(C('div', { class: 'today-item' },
        C('i', { class: 'today-bar', style: { background: 'linear-gradient(180deg,' + col[0] + ',' + col[1] + ')' } }),
        C('div', { class: 'today-main' },
          C('div', { class: 'today-name', text: c.name }),
          C('div', { class: 'today-sub', text: p.start + '-' + pe.end + ' · ' + (c.place || '待定') + (c.teacher ? ' · ' + c.teacher : '') })),
        C('span', { class: 'today-status ' + cls, text: status })));
    });

    if (nextInfo) card.appendChild(C('div', { class: 'today-next', text: '⏰ ' + nextInfo }));
    return card;
  }

  /* ---- 当前节次高亮 ---- */
  function updateNow() {
    if (!host) return;
    var ps = periods();
    var now = new Date();
    var todayIdx = (now.getDay() + 6) % 7;
    var nowMin = nowMinutes();
    var isCurWeek = viewWeek === 0 || viewWeek === currentWeek();
    var row = -1;
    ps.forEach(function (p, i) {
      if (isCurWeek && nowMin >= minutesOf(p.start) && nowMin < minutesOf(p.end)) row = i;
    });
    var currentGridRow = row >= 0 ? periodGridRow(ps, ps[row].n) : -1;
    host.querySelectorAll('.is-now[data-row]').forEach(function (node) { node.classList.remove('is-now'); });
    var grid = activeGrid();
    if (grid && currentGridRow >= 0) {
      grid.querySelectorAll('[data-row]').forEach(function (node) {
        if (node.dataset.row === String(currentGridRow)) node.classList.add('is-now');
      });
    }
    updateNowLine(ps, nowMin);
  }

  function updateNowLine(ps, nowMin) {
    host.querySelectorAll('.kb-now-line').forEach(function (l) { l.remove(); });
    var grid = activeGrid();
    var start = minutesOf(ps[0].start);
    var end = minutesOf(ps[ps.length - 1].end);
    var isCurWeek = viewWeek === 0 || viewWeek === currentWeek();
    if (!grid || !isCurWeek || nowMin < start || nowMin > end) return;

    var line = C('div', { class: 'kb-now-line' });
    grid.appendChild(line);

    var gridTop = grid.getBoundingClientRect().top;
    var activeIdx = -1;
    ps.forEach(function (p, i) {
      if (nowMin >= minutesOf(p.start) && nowMin < minutesOf(p.end)) activeIdx = i;
    });

    var top;
    if (activeIdx >= 0) {
      var slot = grid.querySelector('[data-period-index="' + activeIdx + '"]');
      var rect = slot.getBoundingClientRect();
      var active = ps[activeIdx];
      var from = minutesOf(active.start), to = minutesOf(active.end);
      top = rect.top - gridTop + (nowMin - from) / Math.max(1, to - from) * rect.height;
    } else {
      var prevIdx = -1, nextIdx = -1;
      ps.forEach(function (p, i) {
        if (minutesOf(p.end) <= nowMin) prevIdx = i;
        if (nextIdx < 0 && minutesOf(p.start) > nowMin) nextIdx = i;
      });
      if (prevIdx < 0 || nextIdx < 0) { line.remove(); return; }
      var prev = grid.querySelector('[data-period-index="' + prevIdx + '"]').getBoundingClientRect();
      var next = grid.querySelector('[data-period-index="' + nextIdx + '"]').getBoundingClientRect();
      top = (prev.bottom + next.top) / 2 - gridTop;
    }

    line.style.top = top.toFixed(1) + 'px';
  }

  /* ---- 课程详情 ---- */
  function showDetail(c, week, ovr) {
    var col = colorOf(c.name);
    var ps = periods();
    var timeText = ps.filter(function (p) { return p.n >= c.start && p.n <= c.end; })
      .map(function (p) { return p.start + '-' + p.end; }).join(' / ');

    var head = C('div', {
      class: 'kb-detail-head',
      style: { background: 'linear-gradient(135deg,' + col[0] + ',' + col[1] + ')' }
    },
      C('div', { class: 'kb-detail-name', text: c.name }),
      C('div', { class: 'kb-detail-time', text: DAY_CN[c.day - 1] + ' · 第 ' + c.period + ' 节 · ' + timeText }));

    var rows = [
      ['周次', c.weekText || (c.weeks ? c.weeks.join(',') + '周' : '')],
      ['上课地点', (c.campus ? c.campus + ' · ' : '') + (c.place || '待定')],
      ['教师', c.teacher || '—'],
      ['考核方式', c.exam || '—'],
      ['学分', c.credit || '—'],
      ['总学时', c.hours || '—'],
      ['周学时', c.weekHours || '—'],
      ['学时组成', c.hoursCompose || '—'],
      ['教学班', c.class || '—'],
      ['教学班组成', c.group || '—']
    ];
    if (ovr && ovr.kind === 'map') rows.push(['调休补课', ovr.note]);
    var dl = C('dl', { class: 'kv' });
    rows.forEach(function (r) {
      if (!r || !r[1]) return;
      dl.appendChild(C('dt', { text: r[0] }));
      dl.appendChild(C('dd', { text: r[1] }));
    });

    var weekBadges = C('div', { class: 'row' },
      (c.weeks || []).map(function (w) {
        return C('span', { class: 'chip' + (w === week ? ' active' : '') }, '第' + w + '周');
      }));

    Panel.ui.modal({
      title: '课程详情',
      body: [head, dl, (c.weeks && c.weeks.length > 1 ? C('div', { class: 'detail-label', text: '开课周次' }) : null), weekBadges],
      actions: BOOT.readOnly ? null : [
        { label: '打开设置', class: 'btn-primary', onClick: function () { Panel.navigate('settings'); } }
      ]
    });
  }

  /* ---------------- 模块注册 ---------------- */
  Panel.registerModule({
    id: MOD,
    mount: function (el, context) {
      ctx = context;
      host = el;
      el.appendChild(ctx.ui.loading('正在读取课表…'));
      return ctx.api.get(MOD).then(function (data) {
        doc = data || {};
        doc.settings = doc.settings || {};
        doc.courses = Array.isArray(doc.courses) ? doc.courses : [];
        buildColors(doc.courses);
        render();
        if (timer) timer();
        /* 30s 刷新当前节高亮与今日课程倒计时；锁屏/休眠/后台切回前台会立即补跑，避免倒计时不准 */
        timer = U.ticker(function () { updateNow(); refreshToday(); }, 30000);
      }).catch(function (e) {
        el.textContent = '';
        el.appendChild(ctx.ui.empty('warn', '课表加载失败', e.message));
        throw e;
      });
    },
    activate: function () {
      if (!doc) return;
      ctx.api.get(MOD).then(function (data) {
        doc = data || doc;
        buildColors(doc.courses || []);
        render();
      }).catch(function () { render(); });
    },
    unmount: function () {
      if (timer) timer();
      timer = null;
    }
  });
})();
