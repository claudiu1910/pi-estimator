/* Estimating π with Buffon's needle: drop matches of length 1 on a floor of
 * lines 1 apart. A match crosses a line with probability 2/π, so
 * 2 × drops ÷ crossings converges to π.
 *
 * The simulation never uses π. Directions come from rejection-sampling a point
 * in the unit disc, and the crossing test only multiplies. Math.PI is used for
 * drawing (the reference line and the 0°–90° axis) and for "off by".
 */
(function () {
  'use strict';

  var PI = Math.PI; // display only
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- look ----------
  var ROSE = ['#e8566f', '#c9508f', '#f0717a', '#b65aa0', '#db4a5e', '#e27596'];
  var GOLD = '#f5c062';
  var HEAD = '#ff5a3c';
  var MISS_DOT = '#e0506e';
  var FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';

  // ---------- pacing ----------
  var L_MIN = Math.log10(0.5);   // speed is stored as log10(matches per second)
  var L_MAX = 8.3;
  var L_START = Math.log10(2);
  var ANIM_DPS = 28;             // at or below this, every match falls, lands and sounds
  var STOP_AT = 1e8;
  var REVEAL_AT = 1e6;
  var MARKS_AT = 1e5;
  var LAZZ_N = 3408;
  var FALL_MS = reduceMotion ? 1 : 460;
  var TRACE_M = 480;
  var TRACE_SUB = 2;
  var FRAME_BUDGET_MS = 8;
  var MAX_MATCHES = 2600;
  var MAX_DOTS = 6000;
  var DOTS_PER_FRAME = 1200;

  // ---------- state ----------
  var S = { drops: 0, hits: 0, lazz: null };
  var matches = [];      // recent matches lying on the floor (world units)
  var dots = [];         // recent (angle, distance) samples, for replotting
  var newDots = [];      // samples not yet painted onto the dot plot
  var pops = [];         // ring animations on the dot plot
  var dotsPlotted = 0;
  var pts = [];          // running-estimate samples for the trace
  var L = L_START;
  var accel = true;
  var running = false;
  var finished = false;
  var carry = 0;
  var eRevealed = false; // "π revealed"
  var revealAt = 0;
  var marksOn = false;
  var lineFlash = { k: 0, at: -1e9 };
  var pendingDrops = 0;
  var nextDropAt = 0;
  var viewOverride = null;
  var view = 'floor';
  var viewMix = 0;       // 0 = floor, 1 = trace
  var zoomDps = 2;
  var measuredDps = 0;
  var cam = { D: 0 };    // pixels per match length
  var dom = null;
  var texOn = false;
  var capPhase = 0;
  var notebookDirty = true;
  var stageInView = true;
  var lastLandAt = -1e9;

  // ---------- DOM ----------
  function $(s) { return document.querySelector(s); }
  var el = {
    stageWrap: $('#stageWrap'),
    hint: $('#stageHint'),
    pill: $('#trialPill'),
    offby: $('#offby'),
    offbyVal: $('#offbyVal'),
    offbyAfter: $('#offbyAfter'),
    avg: $('#avg'),
    avgSub: $('#avgSub'),
    avgE: $('#avgE'),
    share: $('#spaceShare'),
    btnAdd: $('#btnAdd'),
    btnTen: $('#btnTen'),
    btnRun: $('#btnRun'),
    runLabel: $('#runLabel'),
    btnReset: $('#btnReset'),
    btnSound: $('#btnSound'),
    speed: $('#speed'),
    speedVal: $('#speedVal'),
    accel: $('#accel'),
    caps: Array.prototype.slice.call(document.querySelectorAll('.cap')),
    viewBtns: Array.prototype.slice.call(document.querySelectorAll('.viewtoggle button')),
    yours: $('#yours'),
    sr: $('#srStatus')
  };

  // A sharp canvas plus a half-resolution twin that CSS blurs into a glow.
  function Layer(canvas, glow) {
    this.c = canvas;
    this.gc = glow;
    this.ctx = canvas.getContext('2d');
    this.g = glow.getContext('2d');
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
  }
  Layer.prototype.resize = function () {
    var r = this.c.getBoundingClientRect();
    var w = Math.max(1, r.width);
    var h = Math.max(1, r.height);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var gs = 0.5;
    this.gc.width = Math.max(1, Math.round(w * gs));
    this.gc.height = Math.max(1, Math.round(h * gs));
    this.g.setTransform(gs, 0, 0, gs, 0, 0);
  };
  Layer.prototype.clear = function () {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.g.clearRect(0, 0, this.w, this.h);
  };

  var stageL = new Layer($('#stage'), $('#stageGlow'));
  var spaceL = new Layer($('#space'), $('#spaceGlow'));
  var acc = document.createElement('canvas'); // the dot plot accumulates here
  var accCtx = acc.getContext('2d');

  // ---------- helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function kf(dt, rate) { return 1 - Math.exp(-dt * rate); }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function plural(n, word, many) { return n === 1 ? word : (many || word + 's'); }
  function fmtCompact(x) {
    if (x < 1000) return String(Math.round(x));
    if (x < 1e6) return (x / 1e3).toFixed(x < 1e4 ? 1 : 0) + 'k';
    if (x < 1e9) return (x / 1e6).toFixed(x < 1e7 ? 1 : 0) + 'M';
    return (x / 1e9).toFixed(1) + 'B';
  }
  function dropsWords(n) {
    if (n < 1e6) return fmtInt(n) + ' ' + plural(n, 'match', 'matches');
    var big = n >= 1e9;
    var v = n / (big ? 1e9 : 1e6);
    var s = v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
    return s + (big ? ' billion' : ' million') + ' matches';
  }
  function decimalsFor(n) { return n < 1e3 ? 2 : n < 1e5 ? 3 : n < 1e7 ? 4 : 5; }
  function estimate() { return S.hits ? 2 * S.drops / S.hits : NaN; }
  var textCache = new Map();
  function setText(node, s) {
    if (textCache.get(node) === s) return;
    textCache.set(node, s);
    node.textContent = s;
  }
  function setHTML(node, s) {
    if (textCache.get(node) === s) return;
    textCache.set(node, s);
    node.innerHTML = s;
  }
  function announce(msg) { el.sr.textContent = msg; }

  // ---------- floor geometry ----------
  // World units: one unit = one match length = the gap between lines.
  // Lines sit at integer y. The camera zooms about the middle of the stage,
  // which is the middle of a row (world y = CAM_Y), so at the base zoom three
  // full rows fit with half a row of margin above and below.
  var CAM_Y = 0.5;
  function floorCenterY() { return stageL.h / 2; }
  function baseD() { return clamp(stageL.h / 4, 46, 130); }
  function targetD(dps) { return clamp(baseD() / Math.pow(Math.max(dps, 2) / 2, 0.42), 7, baseD()); }

  // Random spot for a new match: a random whole row whose matches stay on
  // screen, plus a uniform offset inside it, so the distance to the nearest
  // line is exactly uniform.
  function placeDrop() {
    var D = cam.D || baseD();
    var cy = floorCenterY();
    var top = CAM_Y + (0 - cy) / D;
    var bot = CAM_Y + (stageL.h - cy) / D;
    var kMin = Math.ceil(top + 0.5);
    var kMax = Math.floor(bot - 1.5);
    if (kMax < kMin) { kMin = kMax = 0; }
    var k = kMin + Math.floor(Math.random() * (kMax - kMin + 1));
    var halfW = stageL.w / 2 / D;
    return {
      x: (Math.random() * 2 - 1) * Math.max(0.1, halfW - 0.6),
      y: k + Math.random()
    };
  }

  // ---------- simulation ----------
  function recordLazz() {
    S.lazz = { hits: S.hits, est: 2 * LAZZ_N / S.hits };
    notebookDirty = true;
  }

  function addDot(theta, dist, cross, at) {
    var d = { t: theta, d: dist, c: cross, at: at };
    newDots.push(d);
    dots.push(d);
    if (dots.length > MAX_DOTS + 1000) dots.splice(0, dots.length - MAX_DOTS);
    if (newDots.length > 6000) newDots.splice(0, newDots.length - 6000);
  }

  function pushPoint() {
    if (S.drops < 50 || !S.hits) return;
    pts.push(2 * S.drops / S.hits);
    if (pts.length > 4000) pts.splice(0, pts.length - TRACE_M - 200);
  }

  // Drops one match onto the visible floor, counts it, and keeps it for drawing.
  function addDrop(now, animate, fade) {
    var p = placeDrop();
    var a, b, r2;
    do {
      a = 2 * Math.random() - 1;
      b = 2 * Math.random() - 1;
      r2 = a * a + b * b;
    } while (r2 > 1 || r2 < 1e-12);
    var r = Math.sqrt(r2);
    var ux = a / r;
    var uy = b / r;
    var h = 0.5 * Math.abs(uy);
    var lo = Math.floor(p.y - h);
    var hiK = Math.floor(p.y + h);
    var cross = lo !== hiK;
    var m = {
      x: p.x, y: p.y, ux: ux, uy: uy, cross: cross,
      born: animate ? now : -1e9,
      fadeAt: fade ? now : 0,
      spin: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3),
      head: Math.random() < 0.5 ? 1 : -1,
      ci: (Math.random() * ROSE.length) | 0,
      ix: 0, iy: hiK
    };
    if (cross && uy !== 0) m.ix = p.x + ux * (hiK - p.y) / uy;
    matches.push(m);
    if (matches.length > MAX_MATCHES + 400) matches.splice(0, matches.length - MAX_MATCHES);

    var f = p.y - Math.floor(p.y);
    addDot(Math.atan2(Math.abs(uy), Math.abs(ux)), Math.min(f, 1 - f), cross, animate ? now + FALL_MS : 0);

    S.drops++;
    if (cross) S.hits++;
    if (S.drops === LAZZ_N) recordLazz();

    if (animate) {
      var halfW = stageL.w / 2 / (cam.D || baseD());
      Sound.land(cross, Math.abs(uy), clamp(p.x / halfW, -1, 1) * 0.5, FALL_MS / 1000);
      lastLandAt = now + FALL_MS;
      if (cross) lineFlash = { k: hiK, at: now + FALL_MS };
      setTimeout(popAvg, FALL_MS);
      pushPoint();
      if (!running) {
        announce('Match ' + S.drops + (cross ? ' crosses a line. ' : ' misses. ') +
          S.hits + ' of ' + S.drops + ' cross. Estimate ' + (S.hits ? estimate().toFixed(2) : 'not yet available') + '.');
      }
    }
    return m;
  }

  // The fast path: same experiment, no floor placement, no allocation.
  function bulkDrops(n) {
    var hits = 0;
    for (var i = 0; i < n; i++) {
      var a, b, r2;
      do {
        a = 2 * Math.random() - 1;
        b = 2 * Math.random() - 1;
        r2 = a * a + b * b;
      } while (r2 > 1 || r2 < 1e-12);
      var x = Math.random() * 0.5;           // distance from the middle to the nearest line
      if (x * x * r2 <= 0.25 * b * b) hits++; // x <= ½·|sin θ|, squared
    }
    S.drops += n;
    S.hits += hits;
  }

  function runBatch(k, now, deadline, recordN, fade) {
    if (k <= 0) return;
    if (S.drops < LAZZ_N && S.drops + k >= LAZZ_N) {
      var pre = LAZZ_N - S.drops;
      bulkDrops(pre);
      recordLazz();
      k -= pre;
    }
    var rec = Math.min(k, recordN);
    k -= rec;
    var dn = Math.min(k, DOTS_PER_FRAME);
    k -= dn;

    // drops that also land on the dot plot
    for (var i = 0; i < dn; i++) {
      var a, b, r2;
      do {
        a = 2 * Math.random() - 1;
        b = 2 * Math.random() - 1;
        r2 = a * a + b * b;
      } while (r2 > 1 || r2 < 1e-12);
      var x = Math.random() * 0.5;
      var cross = x * x * r2 <= 0.25 * b * b;
      S.drops++;
      if (cross) S.hits++;
      addDot(Math.atan2(Math.abs(b), Math.abs(a)), x, cross, 0);
    }

    var slice = Math.ceil(k / TRACE_SUB);
    var stop = false;
    for (var part = 0; part < TRACE_SUB && k > 0 && !stop; part++) {
      var todo = Math.min(slice, k);
      while (todo > 0) {
        var chunk = Math.min(todo, 65536);
        bulkDrops(chunk);
        todo -= chunk;
        k -= chunk;
        if (performance.now() > deadline) { stop = true; break; }
      }
      pushPoint();
    }

    for (var r = 0; r < rec; r++) addDrop(now, false, fade);
    pushPoint();
  }

  function accelRate() {
    if (S.drops < 10) return 0.02;
    if (L < 1.1) return 0.12;
    return 0.45;
  }

  function step(now, dt) {
    var dps = Math.pow(10, L);
    if (dps <= ANIM_DPS) {
      carry += dps * dt;
      var guard = 0;
      while (carry >= 1 && guard++ < 4) {
        carry -= 1;
        addDrop(now, true, false);
      }
      if (carry > 2) carry = 1;
      measuredDps = dps;
      return;
    }
    carry += dps * dt;
    var k = Math.floor(carry);
    carry -= k;
    if (accel && !finished && S.drops < STOP_AT) k = Math.min(k, STOP_AT - S.drops);
    if (k <= 0) return;
    var before = S.drops;
    var needOnFloor = (view === 'floor' || viewMix < 0.999) ? Math.min(400, Math.ceil(k)) : 0;
    runBatch(k, now, performance.now() + FRAME_BUDGET_MS, needOnFloor, dps < 300);
    if (dt > 0) measuredDps += ((S.drops - before) / dt - measuredDps) * 0.15;
  }

  // ---------- actions ----------
  function manualMode() {
    zoomDps = 2;
    if (!viewOverride) view = 'floor';
  }

  function actionAdd() {
    Sound.unlock();
    if (running) setRunning(false);
    pendingDrops = 0;
    manualMode();
    addDrop(performance.now(), true, false);
  }

  function actionTen() {
    Sound.unlock();
    if (running) setRunning(false);
    manualMode();
    pendingDrops += 10;
    nextDropAt = Math.min(nextDropAt, performance.now());
  }

  function setRunning(on) {
    running = on;
    el.btnRun.classList.toggle('is-running', on);
    setText(el.runLabel, on ? 'Pause' : 'Run');
    el.btnRun.setAttribute('aria-label', on ? 'Pause (Enter)' : 'Run (Enter)');
  }

  function actionRun() {
    Sound.unlock();
    pendingDrops = 0;
    if (!running) Sound.strike();
    setRunning(!running);
  }

  function actionReset() {
    setRunning(false);
    finished = false;
    S.drops = 0;
    S.hits = 0;
    S.lazz = null;
    matches = [];
    dots = [];
    newDots = [];
    pops = [];
    dotsPlotted = 0;
    accCtx.setTransform(1, 0, 0, 1, 0, 0);
    accCtx.clearRect(0, 0, acc.width, acc.height);
    accCtx.setTransform(spaceL.dpr, 0, 0, spaceL.dpr, 0, 0);
    pts = [];
    dom = null;
    L = L_START;
    accel = true;
    el.accel.checked = true;
    carry = 0;
    eRevealed = false;
    marksOn = false;
    pendingDrops = 0;
    viewOverride = null;
    view = 'floor';
    zoomDps = 2;
    measuredDps = 0;
    lineFlash = { k: 0, at: -1e9 };
    notebookDirty = true;
    el.offby.classList.remove('is-final');
    Sound.idle();
    texOn = false;
    syncSlider();
    announce('Reset.');
  }

  function setView(v) {
    viewOverride = v;
    view = v;
  }

  function toggleSound() {
    var on = !Sound.isEnabled();
    Sound.setEnabled(on);
    if (on) Sound.unlock();
    el.btnSound.setAttribute('aria-pressed', String(on));
    el.btnSound.setAttribute('aria-label', on ? 'Sound on (M)' : 'Sound off (M)');
    try { localStorage.setItem('pi-estimator-sound', on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  }

  function popAvg() {
    if (reduceMotion) return;
    el.avg.classList.remove('pop');
    void el.avg.offsetWidth;
    el.avg.classList.add('pop');
  }

  // ---------- per-frame updates ----------
  function checkMilestones(now) {
    if (!eRevealed && S.drops >= REVEAL_AT) {
      eRevealed = true;
      revealAt = now;
      Sound.reveal();
      announce('A million matches. The estimate is ' + estimate().toFixed(4) + ', and π is 3.14159.');
    }
    if (!marksOn && S.drops >= MARKS_AT) marksOn = true;
    if (running && accel && !finished && S.drops >= STOP_AT) {
      finished = true;
      setRunning(false);
      Sound.finale();
      el.offby.classList.add('is-final');
      announce('100 million matches. Estimate ' + estimate().toFixed(5) +
        ', off from π by ' + Math.abs(estimate() - PI).toFixed(5) + '.');
    }
  }

  function updateView(dt) {
    if (!viewOverride && running) {
      var dps = Math.pow(10, L);
      if (S.drops >= 400 && dps > 600) view = 'trace';
      else if (dps <= 60) view = 'floor';
    }
    var target = view === 'trace' ? 1 : 0;
    viewMix += (target - viewMix) * kf(dt, reduceMotion ? 40 : 3.5);
    if (Math.abs(target - viewMix) < 0.002) viewMix = target;
    if (viewMix === 0) dom = null;
    for (var i = 0; i < el.viewBtns.length; i++) {
      var b = el.viewBtns[i];
      var on = b.getAttribute('data-view') === view;
      if (b.classList.contains('is-on') !== on) {
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }

  function updateCamera(dt) {
    var t = targetD(zoomDps);
    if (!cam.D) cam.D = t;
    cam.D += (t - cam.D) * kf(dt, reduceMotion ? 40 : 2.5);
  }

  function updateSound(dt) {
    var dps = Math.pow(10, L);
    if (running && dps > ANIM_DPS) {
      Sound.texture(dt, clamp((L - 1.4) / 6.4, 0, 1));
      texOn = true;
    } else if (texOn) {
      Sound.idle();
      texOn = false;
    }
  }

  // ---------- drawing: the floor ----------
  function drawFloor(now, alpha) {
    var ctx = stageL.ctx, g = stageL.g, w = stageL.w, h = stageL.h;
    var D = cam.D;
    var cx = w / 2;
    var cy = floorCenterY();

    ctx.save();
    g.save();
    ctx.globalAlpha = alpha;
    g.globalAlpha = alpha;

    // floorboards: faint alternating planks between the lines
    var kTop = Math.floor(CAM_Y + (0 - cy) / D);
    var kBot = Math.ceil(CAM_Y + (h - cy) / D);
    var lineA = 0.16 + 0.3 * clamp((D - 7) / 60, 0, 1);
    for (var k = kTop; k <= kBot; k++) {
      var y = cy + (k - CAM_Y) * D;
      if (k % 2 === 0) {
        ctx.fillStyle = 'rgba(240,110,120,0.035)';
        ctx.fillRect(0, y, w, D);
      }
      var fl = 0;
      if (k === lineFlash.k && !reduceMotion) {
        var tf = now - lineFlash.at;
        if (tf >= 0) fl = Math.exp(-tf / 320);
      }
      ctx.fillStyle = 'rgba(255,255,255,' + (lineA + 0.5 * fl).toFixed(3) + ')';
      ctx.fillRect(0, Math.round(y), w, 1);
      g.fillStyle = fl > 0.02
        ? 'rgba(255,220,150,' + (0.25 + 0.75 * fl).toFixed(3) + ')'
        : 'rgba(255,170,170,' + (lineA * 0.7).toFixed(3) + ')';
      g.fillRect(0, y - 1.5, w, 3);
    }

    // a reference bracket: the gap between lines is one match long
    var bA = clamp((D - 34) / 30, 0, 1);
    if (bA > 0) {
      var y0 = cy - CAM_Y * D, y1 = y0 + D;
      ctx.globalAlpha = alpha * bA * 0.75;
      ctx.fillStyle = '#f0d2d0';
      ctx.fillRect(10, y0 + 3, 1, D - 6);
      ctx.fillRect(6, y0 + 3, 9, 1);
      ctx.fillRect(6, y1 - 4, 9, 1);
      ctx.font = 'italic 600 13px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ℓ', 16, (y0 + y1) / 2);
    }

    // matches
    var n = matches.length;
    var lw = clamp(D * 0.045, 0.8, 4);
    var showHead = D >= 18;
    var showX = D >= 22;
    var bands = [1, 0.7, 0.45, 0.25];
    var paths = {};
    var heads = new Path2D();
    var sparks = new Path2D();
    var anyHead = false, anySpark = false;
    var animating = [];

    for (var i = 0; i < n; i++) {
      var m = matches[i];
      var age = now - m.born;
      if (age < FALL_MS + 240 || (m.fadeAt && now - m.fadeAt < 160)) { animating.push(m); continue; }
      var rank = n - 1 - i;
      var band = rank < 250 ? 0 : rank < 900 ? 1 : rank < 1700 ? 2 : 3;
      var col = m.cross ? GOLD : ROSE[m.ci];
      var key = col + '|' + band;
      var p = paths[key] || (paths[key] = { path: new Path2D(), col: col, a: bands[band] });
      var sx = cx + m.x * D, sy = cy + (m.y - CAM_Y) * D;
      var hx = m.ux * D * 0.5, hy = m.uy * D * 0.5;
      p.path.moveTo(sx - hx, sy - hy);
      p.path.lineTo(sx + hx, sy + hy);
      if (showHead && band < 2) {
        var ex = sx + m.head * hx, ey = sy + m.head * hy;
        heads.moveTo(ex + lw * 1.2, ey);
        heads.arc(ex, ey, lw * 1.2, 0, 6.2832);
        anyHead = true;
      }
      if (showX && m.cross && band < 2) {
        var px = cx + m.ix * D, py = cy + (m.iy - CAM_Y) * D;
        sparks.moveTo(px + 2.4, py);
        sparks.arc(px, py, 2.4, 0, 6.2832);
        anySpark = true;
      }
    }

    ctx.lineCap = 'round';
    g.lineCap = 'round';
    for (var key2 in paths) {
      var q = paths[key2];
      var isGold = q.col === GOLD;
      ctx.globalAlpha = alpha * q.a * 0.92;
      ctx.strokeStyle = q.col;
      ctx.lineWidth = lw;
      ctx.stroke(q.path);
      g.globalAlpha = alpha * q.a * (isGold ? 0.95 : 0.6);
      g.strokeStyle = q.col;
      g.lineWidth = lw * 2.2;
      g.stroke(q.path);
    }
    if (anyHead) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = HEAD;
      ctx.fill(heads);
      g.globalAlpha = alpha * 0.9;
      g.fillStyle = HEAD;
      g.fill(heads);
    }
    if (anySpark) {
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = '#fff4d6';
      ctx.fill(sparks);
      g.globalAlpha = alpha;
      g.fillStyle = '#ffd88a';
      g.fill(sparks);
    }

    // matches still falling or fading in, drawn one by one
    for (var j = 0; j < animating.length; j++) drawFalling(animating[j], now, alpha, D, cx, cy, lw, showHead, showX);

    ctx.restore();
    g.restore();
  }

  function drawFalling(m, now, alpha, D, cx, cy, lw, showHead, showX) {
    var ctx = stageL.ctx, g = stageL.g, h = stageL.h;
    var a = alpha;
    var ux = m.ux, uy = m.uy;
    var lift = 0, sc = 1, goldT = m.cross ? 1 : 0;
    var age = now - m.born;
    if (m.fadeAt) a *= clamp((now - m.fadeAt) / 160, 0, 1);
    if (age < FALL_MS) {
      var p = clamp(age / FALL_MS, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      var rot = (1 - e) * m.spin;
      var c = Math.cos(rot), s = Math.sin(rot);
      var rx = ux * c - uy * s;
      var ry = ux * s + uy * c;
      ux = rx;
      uy = ry;
      lift = (1 - e) * (h * 0.5);
      sc = 1 + 0.45 * (1 - e);
      a *= Math.min(1, p * 2.5);
      goldT = 0;
    } else if (m.cross && age < FALL_MS + 240) {
      goldT = (age - FALL_MS) / 240;
    }
    var sx = cx + m.x * D, sy = cy + (m.y - CAM_Y) * D - lift;
    var hx = ux * D * 0.5 * sc, hy = uy * D * 0.5 * sc;
    var base = ROSE[m.ci];

    ctx.lineCap = 'round';
    g.lineCap = 'round';
    ctx.lineWidth = lw * sc;
    g.lineWidth = lw * sc * 2.2;
    ctx.beginPath();
    ctx.moveTo(sx - hx, sy - hy);
    ctx.lineTo(sx + hx, sy + hy);
    g.beginPath();
    g.moveTo(sx - hx, sy - hy);
    g.lineTo(sx + hx, sy + hy);
    if (goldT < 1) {
      ctx.globalAlpha = a * (1 - goldT) * 0.92;
      ctx.strokeStyle = base;
      ctx.stroke();
      g.globalAlpha = a * (1 - goldT) * 0.6;
      g.strokeStyle = base;
      g.stroke();
    }
    if (goldT > 0) {
      ctx.globalAlpha = a * goldT;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
      g.globalAlpha = a * goldT;
      g.strokeStyle = GOLD;
      g.stroke();
    }
    if (showHead) {
      var ex = sx + m.head * hx, ey = sy + m.head * hy;
      ctx.globalAlpha = a;
      ctx.fillStyle = HEAD;
      ctx.beginPath();
      ctx.arc(ex, ey, lw * 1.2 * sc, 0, 6.2832);
      ctx.fill();
      g.globalAlpha = a * 0.9;
      g.fillStyle = HEAD;
      g.beginPath();
      g.arc(ex, ey, lw * 1.2 * sc, 0, 6.2832);
      g.fill();
    }
    if (showX && m.cross && goldT > 0) {
      var px = cx + m.ix * D, py = cy + (m.iy - CAM_Y) * D;
      var burst = reduceMotion ? 1 : 1 + 2.2 * (1 - goldT);
      ctx.globalAlpha = a * goldT;
      ctx.fillStyle = '#fff4d6';
      ctx.beginPath();
      ctx.arc(px, py, 2.4 * burst, 0, 6.2832);
      ctx.fill();
      g.globalAlpha = a;
      g.fillStyle = '#ffd88a';
      g.beginPath();
      g.arc(px, py, 5 * burst, 0, 6.2832);
      g.fill();
    }
  }

  // ---------- drawing: running-estimate trace ----------
  function niceTicks(lo, hi) {
    var span = hi - lo;
    if (!(span > 0)) return { ticks: [], dec: 0 };
    var raw = span / 6;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var r = raw / mag;
    var stepV = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
    var dec = Math.max(0, -Math.floor(Math.log10(stepV) + 1e-9));
    var out = [];
    for (var t = Math.ceil(lo / stepV) * stepV; t <= hi + 1e-12; t += stepV) out.push(t);
    return { ticks: out, dec: dec };
  }

  function drawTrace(now, alpha, dt) {
    var ctx = stageL.ctx, g = stageL.g, w = stageL.w, h = stageL.h;
    var padL = 16, padR = 16, axisY = 36, top = axisY + 16, bottom = h - 34;
    var n = pts.length;
    var start = Math.max(0, n - TRACE_M);

    var mn = Infinity, mx = -Infinity;
    for (var i = start; i < n; i++) {
      var pv = pts[i];
      if (pv < mn) mn = pv;
      if (pv > mx) mx = pv;
    }
    if (n === 0) { mn = 3.0; mx = 3.3; }
    if (eRevealed) { mn = Math.min(mn, PI); mx = Math.max(mx, PI); }
    var pad = (mx - mn) * 0.22;
    var lo = mn - pad, hi = mx + pad;
    var MIN_SPAN = 0.01;
    if (hi - lo < MIN_SPAN) {
      var mid = (lo + hi) / 2;
      lo = mid - MIN_SPAN / 2;
      hi = mid + MIN_SPAN / 2;
    }
    if (!dom) dom = { lo: lo, hi: hi };
    else {
      var kk = kf(dt, reduceMotion ? 40 : 2.2);
      dom.lo += (lo - dom.lo) * kk;
      dom.hi += (hi - dom.hi) * kk;
    }
    var x0 = padL, xw = w - padL - padR;
    var dlo = dom.lo, dspan = dom.hi - dom.lo;
    function X(v) { return x0 + (v - dlo) / dspan * xw; }

    ctx.save();
    g.save();

    ctx.globalAlpha = alpha;
    g.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,180,180,0.45)';
    ctx.fillRect(x0, axisY, xw, 1);
    g.fillStyle = 'rgba(255,90,100,0.6)';
    g.fillRect(x0, axisY - 1, xw, 3);
    var tk = niceTicks(dom.lo, dom.hi);
    ctx.font = '500 10.5px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var t = 0; t < tk.ticks.length; t++) {
      var tx = X(tk.ticks[t]);
      if (tx < x0 + 12 || tx > x0 + xw - 12) continue;
      var ea = Math.min(1, (tx - x0) / 40, (x0 + xw - tx) / 40);
      ctx.globalAlpha = alpha * ea * 0.85;
      ctx.fillStyle = '#ecc4c2';
      ctx.fillText(tk.ticks[t].toFixed(tk.dec), tx, axisY - 8);
      ctx.fillRect(Math.round(tx), axisY - 3, 1, 4);
      ctx.globalAlpha = alpha * ea * 0.05;
      ctx.fillRect(Math.round(tx), axisY + 1, 1, bottom - axisY);
    }

    if (eRevealed) {
      var since = now - revealAt;
      var eA = reduceMotion ? 1 : Math.min(1, since / 700);
      var grow = reduceMotion ? 1 : 1 - Math.pow(1 - Math.min(1, since / 1200), 3);
      var xe = X(PI);
      var yA = axisY + 20;
      var yB = yA + (bottom + 4 - yA) * grow;
      ctx.globalAlpha = alpha * eA;
      ctx.fillStyle = GOLD;
      ctx.fillRect(xe - 0.75, yA, 1.5, yB - yA);
      g.globalAlpha = alpha * eA;
      g.fillStyle = GOLD;
      g.fillRect(xe - 2.5, yA, 5, yB - yA);
      ctx.font = '700 15px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('π', xe, axisY + 3);
      g.font = '700 15px ' + FONT;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText('π', xe, axisY + 3);
    }

    if (n >= 2) {
      var dy = (bottom - top) / (TRACE_M - 1);
      var grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, 'rgba(255,160,160,0)');
      grad.addColorStop(0.3, 'rgba(255,160,160,0.55)');
      grad.addColorStop(1, 'rgba(255,228,225,1)');
      var ggrad = g.createLinearGradient(0, top, 0, bottom);
      ggrad.addColorStop(0, 'rgba(255,60,80,0)');
      ggrad.addColorStop(0.3, 'rgba(255,60,80,0.6)');
      ggrad.addColorStop(1, 'rgba(255,100,110,1)');

      ctx.beginPath();
      g.beginPath();
      var py = bottom - (n - 1 - start) * dy;
      var px = X(pts[start]);
      ctx.moveTo(px, py);
      g.moveTo(px, py);
      for (var q = start + 1; q < n; q++) {
        var y = bottom - (n - 1 - q) * dy;
        var x = X(pts[q]);
        ctx.lineTo(x, py);
        ctx.lineTo(x, y);
        g.lineTo(x, py);
        g.lineTo(x, y);
        py = y;
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      ctx.stroke();
      g.globalAlpha = alpha;
      g.strokeStyle = ggrad;
      g.lineWidth = 3.5;
      g.stroke();

      var hx = X(pts[n - 1]);
      ctx.beginPath();
      ctx.arc(hx, bottom, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      g.beginPath();
      g.arc(hx, bottom, 9, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,170,170,0.9)';
      g.fill();
      ctx.font = '500 10.5px ' + FONT;
      ctx.fillStyle = 'rgba(245,210,210,0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('estimate', hx, bottom + 9);
    } else {
      ctx.globalAlpha = alpha * 0.7;
      ctx.font = '500 13px ' + FONT;
      ctx.fillStyle = '#b98f92';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('The running estimate appears after 50 matches.', w / 2, (top + bottom) / 2);
    }

    ctx.restore();
    g.restore();
  }

  // ---------- drawing: the dot plot (angle vs distance) ----------
  function spaceBox() {
    var w = spaceL.w, h = spaceL.h;
    var x0 = 30, x1 = w - 10, y0 = 30, y1 = h - 20;
    return { x0: x0, x1: x1, y0: y0, y1: y1, w: x1 - x0, h: y1 - y0 };
  }
  function dotXY(B, d) {
    return { x: B.x0 + (d.t / (PI / 2)) * B.w, y: B.y1 - (d.d / 0.5) * B.h };
  }

  function resizeSpace() {
    spaceL.resize();
    acc.width = spaceL.c.width;
    acc.height = spaceL.c.height;
    accCtx.setTransform(spaceL.dpr, 0, 0, spaceL.dpr, 0, 0);
    // replot what we still remember
    var keepCount = dotsPlotted;
    dotsPlotted = 0;
    paintDots(dots, true);
    dotsPlotted = Math.max(keepCount, dots.length);
  }

  function paintDots(list, replot) {
    if (!list.length) return;
    var B = spaceBox();
    var count = replot ? Math.max(dotsPlotted, list.length) : dotsPlotted;
    var a = clamp(0.85 * Math.sqrt(400 / (400 + count)), 0.05, 0.85);
    var r = count < 300 ? 4.5 : count < 2000 ? 3 : count < 20000 ? 1.8 : 1.3;
    accCtx.globalAlpha = a;
    var gold = [], blue = [];
    for (var i = 0; i < list.length; i++) (list[i].c ? gold : blue).push(list[i]);
    accCtx.fillStyle = MISS_DOT;
    for (var j = 0; j < blue.length; j++) {
      var p = dotXY(B, blue[j]);
      accCtx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }
    accCtx.fillStyle = GOLD;
    for (var k = 0; k < gold.length; k++) {
      var q = dotXY(B, gold[k]);
      accCtx.fillRect(q.x - r / 2, q.y - r / 2, r, r);
    }
    accCtx.globalAlpha = 1;
  }

  function drawSpace(now) {
    var ctx = spaceL.ctx, g = spaceL.g, w = spaceL.w, h = spaceL.h;
    var B = spaceBox();

    // paint the samples that have landed
    if (newDots.length) {
      var ready = [], keep = [];
      for (var i = 0; i < newDots.length; i++) {
        var d = newDots[i];
        if (d.at <= now) {
          ready.push(d);
          if (d.at > 0) {
            var p = dotXY(B, d);
            pops.push({ x: p.x, y: p.y, c: d.c, at: d.at });
          }
        } else keep.push(d);
      }
      newDots = keep;
      dotsPlotted += ready.length;
      paintDots(ready, false);
    }

    // faint fill under the curve, fading as dots arrive
    var hintA = clamp(1 - dotsPlotted / 500, 0, 1);
    var curve = new Path2D();
    for (var s = 0; s <= 64; s++) {
      var th = (s / 64) * (PI / 2);
      var cxp = B.x0 + (s / 64) * B.w;
      var cyp = B.y1 - Math.sin(th) * B.h;
      if (s === 0) curve.moveTo(cxp, cyp); else curve.lineTo(cxp, cyp);
    }
    if (hintA > 0) {
      var under = new Path2D(curve);
      under.lineTo(B.x1, B.y1);
      under.lineTo(B.x0, B.y1);
      under.closePath();
      ctx.globalAlpha = 0.07 * hintA + 0.02;
      ctx.fillStyle = GOLD;
      ctx.fill(under);
    }

    ctx.globalAlpha = 1;
    ctx.drawImage(acc, 0, 0, w, h);

    // box
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,170,170,0.28)';
    ctx.fillRect(B.x0, Math.round(B.y1), B.w, 1);
    ctx.fillRect(Math.round(B.x0), B.y0, 1, B.h);
    ctx.fillStyle = 'rgba(255,170,170,0.12)';
    ctx.fillRect(B.x0, Math.round(B.y0), B.w, 1);
    ctx.fillRect(Math.round(B.x1), B.y0, 1, B.h);

    // curve x = ½ sin θ
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke(curve);
    g.globalAlpha = 0.9;
    g.strokeStyle = '#ffe2a8';
    g.lineWidth = 4;
    g.stroke(curve);

    // labels
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#f2d3d1';
    ctx.font = '500 11px ' + FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('0°', B.x0, B.y1 + 5);
    ctx.textAlign = 'right';
    ctx.fillText('90°', B.x1, B.y1 + 5);
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.6;
    ctx.fillText('angle with the lines →', B.x0 + B.w / 2, B.y1 + 5);
    ctx.globalAlpha = 0.8;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', B.x0 - 6, B.y1);
    ctx.fillText('½', B.x0 - 6, B.y0);
    if (hintA > 0) {
      ctx.globalAlpha = 0.75 * hintA;
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = GOLD;
      ctx.fillText('crosses a line', B.x0 + B.w * 0.74, B.y1 - B.h * 0.3);
      ctx.fillStyle = '#ff8fa3';
      ctx.fillText('misses', B.x0 + B.w * 0.18, B.y0 + B.h * 0.28);
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 11px ' + FONT;
      ctx.fillText('distance = ½ sin(angle)', B.x0 + B.w * 0.42, B.y0 + 10);
    }

    // rings for freshly landed dots
    if (pops.length) {
      var live = [];
      for (var j = 0; j < pops.length; j++) {
        var pp = pops[j];
        var age = now - pp.at;
        if (age > 650 || reduceMotion) continue;
        live.push(pp);
        var t = age / 650;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = pp.c ? GOLD : '#ff8fa3';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 3 + 12 * t, 0, 6.2832);
        ctx.stroke();
        g.globalAlpha = 1 - t;
        g.fillStyle = pp.c ? GOLD : '#ff6f86';
        g.beginPath();
        g.arc(pp.x, pp.y, 7, 0, 6.2832);
        g.fill();
      }
      pops = live;
    }
    ctx.globalAlpha = 1;
    g.globalAlpha = 1;
  }

  // ---------- text ----------
  function updatePill(now) {
    var show = S.drops > 0 && viewMix < 0.5 && (!running || Math.pow(10, L) <= ANIM_DPS * 1.5);
    if (!show) { el.pill.classList.remove('is-on'); return; }
    var last = matches[matches.length - 1];
    var landed = last && now - last.born >= FALL_MS;
    var html = '<span class="eq">' + fmtInt(S.hits) + '</span> of ' + fmtInt(S.drops) + ' ' +
      plural(S.drops, 'match', 'matches') + ' cross a line';
    if (last && last.born > 0) {
      html += landed
        ? (last.cross ? ' · <span class="pass">the last one crosses</span>' : ' · the last one misses')
        : ' · falling…';
    }
    setHTML(el.pill, html);
    el.pill.classList.add('is-on');
  }

  function speedText() {
    var dps = Math.pow(10, L);
    if (dps < 100) return (dps < 10 ? dps.toFixed(1) : String(Math.round(dps))) + ' matches/s';
    if (running && measuredDps > 0 && measuredDps < dps * 0.7) return 'max · ' + fmtCompact(measuredDps) + ' matches/s';
    return fmtCompact(dps) + ' matches/s';
  }

  function setCaption(p) {
    if (p === capPhase) return;
    capPhase = p;
    for (var i = 0; i < el.caps.length; i++) {
      el.caps[i].classList.toggle('is-on', Number(el.caps[i].getAttribute('data-cap')) === p);
    }
  }

  function updateYours() {
    if (!notebookDirty || !el.yours) return;
    notebookDirty = false;
    if (!S.lazz) {
      el.yours.innerHTML = 'Drop 3,408 matches above (a run gets there in about 15 seconds) and your result shows up here.';
      return;
    }
    var off = Math.abs(S.lazz.est - PI);
    el.yours.innerHTML = 'Your first 3,408 matches: ' + fmtInt(S.lazz.hits) + ' crossed, so π ≈ 2 × 3,408 ÷ ' +
      fmtInt(S.lazz.hits) + ' = <b>' + S.lazz.est.toFixed(5) + '</b>, off by ' + off.toFixed(4) +
      '. Lazzarini was off by 0.0000003.';
  }

  function updateText(now) {
    if (!S.hits) {
      setText(el.avg, '—');
      el.avg.classList.add('is-empty');
      if (S.drops) {
        setHTML(el.avgSub, fmtInt(S.drops) + ' ' + plural(S.drops, 'match', 'matches') + ', no crossings yet');
      } else {
        setHTML(el.avgSub, 'the estimate of π will show up here');
      }
    } else {
      setText(el.avg, estimate().toFixed(decimalsFor(S.drops)));
      el.avg.classList.remove('is-empty');
      setHTML(el.avgSub, '2 × ' + fmtInt(S.drops) + ' ' + plural(S.drops, 'match', 'matches') + ' ÷ ' +
        fmtInt(S.hits) + ' ' + plural(S.hits, 'crossing'));
    }
    el.avgE.classList.toggle('is-on', eRevealed);

    if (S.drops) {
      var share = S.hits / S.drops * 100;
      var html = 'crossing: <b>' + share.toFixed(S.drops < 1e4 ? 1 : 2) + '%</b>';
      if (marksOn) html += ' · exact 2/π = 63.66%';
      setHTML(el.share, html);
    } else {
      setHTML(el.share, 'gold dots are matches that cross a line');
    }

    var showOff = eRevealed && viewMix > 0.5;
    el.offby.classList.toggle('is-on', showOff);
    if (showOff) {
      setText(el.offbyVal, 'off by ' + Math.abs(estimate() - PI).toFixed(5));
      setText(el.offbyAfter, 'after ' + dropsWords(S.drops));
    }

    updatePill(now);
    setText(el.speedVal, speedText());
    setCaption(eRevealed ? 2 : (S.drops >= 8 || (running && L > 1.3)) ? 1 : 0);
    el.hint.classList.toggle('is-hidden', S.drops > 0 || running);
    updateYours();
  }

  function syncSlider() {
    var v = Math.round((L - L_MIN) / (L_MAX - L_MIN) * 1000);
    if (Number(el.speed.value) !== v) el.speed.value = String(v);
    el.speed.style.setProperty('--p', (v / 10).toFixed(1) + '%');
  }

  // ---------- main loop ----------
  var last = performance.now();
  var lastText = 0;
  function frame(now) {
    var dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (running) {
      if (accel) {
        L = Math.min(L_MAX, L + dt * accelRate());
        syncSlider();
      }
      zoomDps = Math.pow(10, L);
      step(now, dt);
    }
    if (pendingDrops > 0 && now >= nextDropAt) {
      addDrop(now, true, false);
      pendingDrops--;
      nextDropAt = now + (reduceMotion ? 40 : 110);
    }

    checkMilestones(now);
    updateView(dt);
    updateSound(dt);
    updateCamera(dt);

    stageL.clear();
    if (viewMix < 0.999) drawFloor(now, 1 - viewMix);
    if (viewMix > 0.001) drawTrace(now, viewMix, dt);
    spaceL.clear();
    drawSpace(now);

    if (now - lastText > 50) {
      lastText = now;
      updateText(now);
    }
    requestAnimationFrame(frame);
  }

  // ---------- wiring ----------
  function blurAfterMouse(btn) {
    btn.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse') btn.blur();
    });
  }

  el.btnAdd.addEventListener('click', actionAdd);
  el.btnTen.addEventListener('click', actionTen);
  el.btnRun.addEventListener('click', actionRun);
  el.btnReset.addEventListener('click', actionReset);
  el.btnSound.addEventListener('click', toggleSound);
  [el.btnAdd, el.btnTen, el.btnRun, el.btnReset, el.btnSound].forEach(blurAfterMouse);

  el.stageWrap.addEventListener('click', actionAdd);

  el.viewBtns.forEach(function (b) {
    blurAfterMouse(b);
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });

  el.speed.addEventListener('input', function () {
    L = L_MIN + (L_MAX - L_MIN) * Number(el.speed.value) / 1000;
    accel = false;
    el.accel.checked = false;
    if (running) zoomDps = Math.pow(10, L);
    syncSlider();
  });

  el.accel.addEventListener('change', function () { accel = el.accel.checked; });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    var tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return;
    var k = e.key;
    if ((k === ' ' || k === 'Enter') && !stageInView) return;
    switch (k) {
      case ' ':
      case 'n':
      case 'N':
        e.preventDefault();
        actionAdd();
        break;
      case 'd':
      case 'D':
        actionTen();
        break;
      case 'Enter':
      case 'p':
      case 'P':
        e.preventDefault();
        actionRun();
        break;
      case 'r':
      case 'R':
        actionReset();
        break;
      case 'm':
      case 'M':
        toggleSound();
        break;
      case 'v':
      case 'V':
        setView(view === 'trace' ? 'floor' : 'trace');
        break;
      default:
        break;
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      Sound.idle();
      texOn = false;
    }
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      stageInView = entries[0].isIntersecting;
    }, { threshold: 0.25 }).observe(el.stageWrap);
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(function () { stageL.resize(); }).observe(el.stageWrap);
    new ResizeObserver(resizeSpace).observe(document.querySelector('.space'));
  } else {
    window.addEventListener('resize', function () { stageL.resize(); resizeSpace(); });
  }
  stageL.resize();
  resizeSpace();

  try {
    if (localStorage.getItem('pi-estimator-sound') === '0') {
      Sound.setEnabled(false);
      el.btnSound.setAttribute('aria-pressed', 'false');
      el.btnSound.setAttribute('aria-label', 'Sound off (M)');
    }
  } catch (e) { /* storage unavailable */ }

  syncSlider();
  updateText(performance.now());
  requestAnimationFrame(frame);
})();
