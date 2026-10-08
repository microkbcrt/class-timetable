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
  var timer = null;

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

  /* ---------------- 左右滑动切周（跟手拖动 + 松手滑出/回弹动画） ---------------- */
  var slideDir = 0;      /* 下一次 render 的入场方向：1=新周从右入，-1=从左入 */
  var dragMoved = false; /* 拖动过 → 抑制随后的课程卡片 click */

  function goWeek(dir) {
    var t = activeWeek() + dir;
    if (t < 1) return;
    slideDir = dir;
    viewWeek = t;
    render();
  }

  function enableSwipe(el) {
    var startX = 0, startY = 0, dx = 0;
    var dragging = false, decided = false;

    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      dx = 0; dragging = true; decided = false; dragMoved = false;
      el.classList.remove('kb-drag-anime');
      el.classList.remove('kb-in-next', 'kb-in-prev');   /* 防入场动画残留锁住 transform */
    });

    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        if (Math.abs(my) > Math.abs(mx)) { dragging = false; return; }  /* 垂直手势交给滚动 */
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        el.classList.add('kb-dragging');
      }
      if (!dragging) return;
      dx = mx * 0.85;                                    /* 跟手阻尼 */
      if (dx > 0 && activeWeek() <= 1) dx *= 0.3;        /* 第 1 周再右拖 → 强阻尼 */
      el.style.transform = 'translateX(' + dx + 'px)';
      dragMoved = Math.abs(dx) > 6;
      if (e.cancelable) e.preventDefault();
    });

    function end() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('kb-dragging');
      var dir = dx < 0 ? 1 : -1;                          /* 左拖=下一周 */
      if (decided && Math.abs(dx) > 90 && activeWeek() + dir >= 1) {
        el.classList.add('kb-drag-anime');
        el.style.transform = 'translateX(' + (dir > 0 ? '-55%' : '55%') + ')';  /* 滑出 */
        setTimeout(function () { slideDir = dir; viewWeek = activeWeek() + dir; render(); }, 140);
        return;
      }
      el.classList.add('kb-drag-anime');                 /* 阈值内回弹 */
      el.style.transform = '';
      setTimeout(function () { el.classList.remove('kb-drag-anime'); dragMoved = false; }, 220);
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* ---------------- 导出日历 .ics（手机日历 APP 导入，逐次提醒） ---------------- */
  function icsEsc(t) {
    return String(t == null ? '' : t).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsStamp(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' +
      p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  }
  function icsDate(dateStr, hhmm) {
    return dateStr.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';
  }

  function exportIcs() {
    var s = doc.settings;
    var ps = periods();
    var termStart = U.parseDate(s.termStart || U.today());
    var maxW = 1;
    doc.courses.forEach(function (c) {
      (Array.isArray(c.weeks) ? c.weeks : []).forEach(function (w) { if (w > maxW) maxW = w; });
    });
    var stamp = icsStamp(new Date());
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//xuanku-panel//timetable//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEsc((s.term ? s.term + ' ' : '') + '课表')
    ];
    var count = 0;
    for (var di = 0; di < (maxW + 1) * 7; di++) {
      var dateStr = U.today(U.addDays(termStart, di));
      var plan = planFor(dateStr);
      if (plan.kind === 'off') continue;
      var dayNum = plan.kind === 'map' ? plan.srcDay : dayIdx(dateStr) + 1;
      var wk = plan.kind === 'map' ? plan.week : weekOfDate(dateStr);
      if (wk < 1) continue;
      doc.courses.filter(function (c) {
        if (c.day !== dayNum) return false;
        return Array.isArray(c.weeks) ? c.weeks.indexOf(wk) !== -1 : true;
      }).forEach(function (c) {
        var p0 = ps[c.start - 1], p1 = ps[c.end - 1];
        if (!p0 || !p1) return;
        var desc = '第' + wk + '周 · 第' + c.start + '-' + c.end + '节';
        if (c.teacher) desc += ' · ' + c.teacher;
        if (plan.kind === 'map' && plan.note) desc += ' · ' + plan.note;
        lines.push(
          'BEGIN:VEVENT',
          'UID:' + c.id + '-' + dateStr.replace(/-/g, '') + '-' + c.start + '@xuanku-panel',
          'DTSTAMP:' + stamp,
          'DTSTART:' + icsDate(dateStr, p0.start),
          'DTEND:' + icsDate(dateStr, p1.end),
          'SUMMARY:' + icsEsc(c.name + (plan.kind === 'map' ? '（补课）' : '')),
          'LOCATION:' + icsEsc(c.place || ''),
          'DESCRIPTION:' + icsEsc(desc),
          'BEGIN:VALARM',
          'TRIGGER:-PT10M',
          'ACTION:DISPLAY',
          'DESCRIPTION:' + icsEsc(c.name + ' 10 分钟后上课'),
          'END:VALARM',
          'END:VEVENT'
        );
        count++;
      });
    }
    lines.push('END:VCALENDAR');
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (s.term ? s.term + '-' : '') + '课表.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    try { Panel.ui.toast('已导出 ' + count + ' 条日程，打开手机日历导入即可', 'success'); } catch (e) {}
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!host) return;
    host.textContent = '';
    var s = doc.settings;
    var week = activeWeek();
    var now = new Date();
    var todayIdx = (now.getDay() + 6) % 7;
    var weekStart = U.addDays(U.mondayOf(now), (week - currentWeek()) * 7);
    var isCurWeek = week === currentWeek();
    var visible = doc.courses.filter(function (c) { return inWeek(c, week); });

    /* 每列日期的显示方案（调休补课 / 放假）；全部周概览时不套用调休方案 */
    var plans = [];
    for (var pi = 0; pi < 7; pi++) {
      plans.push(s.showAllWeeks ? { kind: 'normal' } : planFor(U.today(U.addDays(weekStart, pi))));
    }

    var bar = C('div', { class: 'card kb-bar' },
      C('div', { class: 'kb-week' },
        C('button', { class: 'kb-arrow', type: 'button', title: '上一周', html: Panel.iconHtml('chevronL'), onclick: function () { goWeek(-1); } }),
        C('div', { class: 'kb-week-text' },
          C('b', { text: '第 ' + week + ' 周' }),
          C('span', { text: U.fmtDate(weekStart) + ' - ' + U.fmtDate(U.addDays(weekStart, 6)) })),
        C('button', { class: 'kb-arrow', type: 'button', title: '下一周', html: Panel.iconHtml('chevronR'), onclick: function () { goWeek(1); } }),
        isCurWeek ? null : C('button', {
          class: 'chip kb-today-btn', type: 'button',
          onclick: function () { viewWeek = 0; render(); }
        }, '回到本周')),
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
          class: 'chip', type: 'button', title: '导出 .ics 日历文件，可导入手机日历提醒',
          onclick: function () { exportIcs(); }
        }, '导出日历'),
        BOOT.readOnly ? null :
          C('button', { class: 'chip', type: 'button', onclick: function () { Panel.navigate('settings'); } }, '课表设置')));

    host.appendChild(bar);

    host.appendChild(C('div', { class: 'kb-meta' },
      C('span', { text: s.student || '' }),
      C('span', { class: 'dot', text: '·' }),
      C('span', { text: s.studentNo || '' }),
      C('span', { class: 'dot', text: '·' }),
      C('span', { text: s.term || '' }),
      C('span', { class: 'dot', text: '·' }),
      C('span', { class: 'kb-extra-note', text: '本周 ' + visible.length + ' 节课' })));

    /* ---- 课表格子 ---- */
    var scroll = C('div', { class: 'card kb-scroll' });
    var grid = C('div', { class: 'kb-grid' });
    scroll.appendChild(grid);
    host.appendChild(scroll);
    if (slideDir) {
      var inClass = slideDir > 0 ? 'kb-in-next' : 'kb-in-prev';
      grid.classList.add(inClass);
      slideDir = 0;
      /* 动画结束立即摘掉：fill both 的 transform 会压过拖动的 inline transform */
      grid.addEventListener('animationend', function () { grid.classList.remove(inClass); }, { once: true });
    }
    if (!s.showAllWeeks) enableSwipe(grid);

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
        s.showAllWeeks ? null : C('span', { text: U.fmtDate(date) }),
        dpl.kind !== 'normal'
          ? C('span', { class: 'kb-badge' + (dpl.tone === 'off' ? ' kb-badge-off' : dpl.tone === 'rev' ? ' kb-badge-rev' : ''), text: dpl.badge })
          : null));
    }

    var ps = periods();
    var nowMin = nowMinutes();
    var nowRow = -1;
    ps.forEach(function (p, i) {
      if (isCurWeek && nowMin >= minutesOf(p.start) && nowMin < minutesOf(p.end)) nowRow = i;
    });

    ps.forEach(function (p, i) {
      var row = i + 2;
      grid.appendChild(C('div', {
        class: 'kb-slot' + (nowRow === i ? ' is-now' : ''),
        dataset: { row: String(row) },
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
            gridRow: (c.start + 1) + ' / span ' + (c.end - c.start + 1),
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
          c.end - c.start > 1 || c._lanes > 1 ? C('div', { class: 'kb-course-sub', text: c.period + ' 节' }) : null);
        grid.appendChild(card);
      });
    }

    host.appendChild(C('div', { class: 'kb-extra', text: s.extra || '' }));

    host.appendChild(buildToday(ps));
    updateNow();
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
      var start = minutesOf(p.start), end = minutesOf(p.end);
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
          C('div', { class: 'today-sub', text: p.start + '-' + p.end + ' · ' + (c.place || '待定') + (c.teacher ? ' · ' + c.teacher : '') })),
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
    host.querySelectorAll('[data-row]').forEach(function (node) {
      node.classList.toggle('is-now', row >= 0 && node.dataset.row === String(row + 2));
    });
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
      if (!r[1]) return;
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
      actions: [
        { label: '关闭', class: 'btn-ghost' },
        BOOT.readOnly ? null : {
          label: c.shared === false ? '✓ 个人选修 · 点击恢复公共' : '标为个人选修（不进公告）',
          class: c.shared === false ? 'btn-primary' : 'btn-ghost',
          onClick: function () {
            var prev = c.shared;
            var next = !(c.shared === false);
            if (next) delete c.shared; else c.shared = false;
            ctx.api.save(MOD, 'courses', c).then(function () {
              Panel.ui.toast(next ? '已恢复为全班公共课（进公告）' : '已标为个人选修，发布公告时将排除', 'success');
              render();
            }).catch(function (e) {
              if (prev === undefined) delete c.shared; else c.shared = prev;
              Panel.ui.toast('保存失败：' + e.message, 'error');
            });
          }
        },
        BOOT.readOnly ? null :
          { label: '打开设置', class: 'btn-primary', onClick: function () { Panel.navigate('settings'); } }
      ].filter(Boolean)
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
        if (timer) clearInterval(timer);
        timer = setInterval(function () { updateNow(); }, 30000);
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
      if (timer) clearInterval(timer);
      timer = null;
    }
  });
})();
