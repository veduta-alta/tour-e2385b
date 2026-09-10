/* ------------------------------------------------------------------
   Виртуальный тур на Marzipano
   ------------------------------------------------------------------ */
(function () {
'use strict';

var DATA    = window.TOUR_DATA;
var SCENES  = DATA.scenes;
var byId    = {};
SCENES.forEach(function (s) { byId[s.id] = s; });

var LEVELS  = [{ width: 1024 }, { width: 4096 }];
var RAD     = Math.PI / 180;

/* ============================ иконка ============================ */
/* Единая кнопка перехода: тёмное стекло, тёплая металлическая обводка,
   шеврон направления и пульсирующее кольцо. Одна на все переходы. */

var ICON = '<svg width="128" height="128" viewBox="0 0 96 96">\
  <defs>\
    <linearGradient id="gRing" x1="0" y1="0" x2="1" y2="1">\
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".96"/>\
      <stop offset="100%" stop-color="#c8a06a" stop-opacity=".85"/>\
    </linearGradient>\
    <radialGradient id="gGlass" cx="50%" cy="34%" r="70%">\
      <stop offset="0%"  stop-color="#ffffff" stop-opacity=".30"/>\
      <stop offset="100%" stop-color="#1a1c20" stop-opacity=".55"/>\
    </radialGradient>\
  </defs>\
  <circle class="hs-pulse" cx="48" cy="48" r="40" fill="none" stroke="#c8a06a" stroke-width="1.6"/>\
  <circle cx="48" cy="49.5" r="33" fill="rgba(12,14,18,.45)"/>\
  <circle cx="48" cy="48" r="31" fill="url(#gGlass)" stroke="url(#gRing)" stroke-width="2.2"/>\
  <path d="M48 31 65 51 57.5 51 48 40 38.5 51 31 51Z" fill="#fff"/>\
  <path d="M32 60 H64" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linecap="round"/>\
</svg>';

/* id градиентов должны быть уникальны на странице, иначе заливка «слипается» */
var iconSeq = 0;
function uniqueIcon() {
  var n = ++iconSeq;
  return ICON.replace(/(gRing|gGlass)/g, '$1_' + n);
}

/* ============================ вьювер ============================ */

var viewerOpts = {
  controls: { mouseViewMode: 'drag' },
  stage: { preserveDrawingBuffer: false }
};
var viewer = new Marzipano.Viewer(document.getElementById('pano'), viewerOpts);

var geometry = new Marzipano.EquirectGeometry(LEVELS);
var limiter  = Marzipano.RectilinearView.limit.traditional(4096, 110 * RAD, 120 * RAD);

var scenesRT = {};   // id -> { scene, view, data }
var current  = null;
var loaderHidden = false;

function sourceFor(id) {
  return new Marzipano.ImageUrlSource(function (tile) {
    var w = LEVELS[tile.z].width;
    return { url: 'tiles/' + id + '/' + w + '.jpg' };
  });
}

function buildScene(d) {
  var view  = new Marzipano.RectilinearView({ yaw: d.yaw0 * RAD, pitch: 0, fov: 85 * RAD }, limiter);
  var scene = viewer.createScene({
    source: sourceFor(d.id),
    geometry: geometry,
    view: view,
    pinFirstLevel: true
  });
  return { scene: scene, view: view, data: d };
}

SCENES.forEach(function (d) { scenesRT[d.id] = buildScene(d); });

/* ==================== слой кнопок перехода ====================
   Собственный слой вместо hotspotContainer из Marzipano: тот двигает
   хотспоты в событии afterRender, то есть уже после отрисовки кадра.
   Здесь позиции считаются в beforeRender — тем же значением view, которое
   сейчас уйдёт в рендер, так что кнопка и панорама идут кадр в кадр.
   Ничего не анимируется по времени: позиция за кадр считается заново,
   никаких CSS-переходов. */

var layerEl = document.createElement('div');
layerEl.className = 'hs-layer';
document.getElementById('pano').appendChild(layerEl);

var OFF_MARGIN = 90;    // на сколько стрелке можно уехать за кромку, прежде чем скрыться
var slots = [];         // переиспользуемые элементы

function makeSlot() {
  var root = document.createElement('div');
  root.className = 'hs';
  var inner = document.createElement('div');
  inner.className = 'hs-in';
  var main = document.createElement('div');
  main.className = 'hs-main';
  var lbl = document.createElement('span');
  lbl.className = 'lbl';
  main.appendChild(lbl);
  inner.appendChild(main);
  root.appendChild(inner);
  layerEl.appendChild(root);
  var slot = { root: root, inner: inner, main: main, lbl: lbl, link: null };
  main.addEventListener('click', function (e) {
    e.stopPropagation();
    if (slot.link) go(slot.link.to, slot.link.yaw);
  });
  slots.push(slot);
  return slot;
}

function bindHotspots(d) {
  while (slots.length < d.links.length) makeSlot();
  slots.forEach(function (slot, i) {
    var l = d.links[i];
    if (!l) { slot.link = null; slot.root.style.display = 'none'; return; }
    slot.link = l;
    slot.root.style.display = '';
    slot.main.innerHTML = uniqueIcon();
    slot.main.appendChild(slot.lbl);
    slot.lbl.textContent = 'Точка ' + l.to + ' · ' + l.d + ' м';
  });
}

/* Проекция направления на экран — та же математика, что у Marzipano,
   но считаем сами, чтобы получить координату и для точек за кадром. */
function layoutHotspots() {
  if (!current) return;
  var view = current.view;
  var W = viewer.stage().width(), H = viewer.stage().height();
  if (!W || !H) return;

  var yawC = view.yaw(), pitchC = view.pitch(), fov = view.fov();
  /* у RectilinearView fov() — вертикальный угол, поэтому фокусное
     расстояние считается от высоты кадра, а не от ширины */
  var focal = (H / 2) / Math.tan(fov / 2);
  var cx = W / 2, cy = H / 2;
  var sinYc = Math.sin(yawC), cosYc = Math.cos(yawC);
  var sinPc = Math.sin(pitchC), cosPc = Math.cos(pitchC);


  for (var i = 0; i < slots.length; i++) {
    var slot = slots[i], l = slot.link;
    if (!l) continue;

    var yt = l.yaw * RAD, pt = -l.pitch * RAD;      // pitch: положительный вниз
    var cp = Math.cos(pt), sp = Math.sin(pt);
    var vx = cp * Math.sin(yt), vy = -sp, vz = cp * Math.cos(yt);

    var x1 =  vx * cosYc - vz * sinYc;              // поворот к направлению камеры
    var z1 =  vx * sinYc + vz * cosYc;
    var y2 =  vy * cosPc + z1 * sinPc;
    var z2 = -vy * sinPc + z1 * cosPc;

    /* точка за спиной либо ушла за кромку — стрелка просто не показывается */
    if (z2 <= 0.02) { slot.root.style.display = 'none'; continue; }

    var px = cx + focal * (x1 / z2);
    var py = cy - focal * (y2 / z2);

    if (px < -OFF_MARGIN || px > W + OFF_MARGIN || py < -OFF_MARGIN || py > H + OFF_MARGIN) {
      slot.root.style.display = 'none';
      continue;
    }
    slot.root.style.display = '';
    slot.root.style.transform = 'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)';
  }
}

viewer.renderLoop().addEventListener('beforeRender', layoutHotspots);
window.addEventListener('resize', layoutHotspots);


/* ============================ навигация ============================ */

function go(id, arriveYaw) {
  var rt = scenesRT[id];
  if (!rt || rt === current) return;
  if (typeof arriveYaw === 'number') rt.view.setYaw(arriveYaw * RAD);
  rt.view.setPitch(0);
  rt.scene.switchTo({ transitionDuration: 900 });
  current = rt;
  document.getElementById('sceneName').textContent = rt.data.name;
  bindHotspots(rt.data);
  layoutHotspots();
  paintMap();
  if (!loaderHidden) {
    loaderHidden = true;
    setTimeout(function () { document.getElementById('loader').classList.add('hide'); }, 450);
  }
}

/* ============================ миникарта ============================ */

var mmDots  = document.getElementById('mmDots');
var mmLinks = document.getElementById('mmLinks');
var dotEls  = {};
var fovEl;

(function initMap() {
  /* рёбра */
  var seen = {}, svg = '';
  SCENES.forEach(function (s) {
    s.links.forEach(function (l) {
      var key = [s.id, l.to].sort(function (a, b) { return a - b; }).join('-');
      if (seen[key]) return;
      seen[key] = 1;
      var t = byId[l.to];
      svg += '<line x1="' + (s.x * 100) + '" y1="' + (s.y * 100) + '" x2="' + (t.x * 100) + '" y2="' + (t.y * 100) + '"/>';
    });
  });
  mmLinks.innerHTML = svg;

  /* конус обзора */
  fovEl = document.createElement('div');
  fovEl.className = 'fov';
  fovEl.innerHTML = '<svg viewBox="0 0 92 92"><defs><linearGradient id="fovGrad" x1="0" y1="1" x2="0" y2="0">\
    <stop offset="0%" stop-color="#ffe0ad" stop-opacity=".9"/>\
    <stop offset="100%" stop-color="#ffe0ad" stop-opacity=".05"/></linearGradient></defs>\
    <path d="M46 46 L18 4 A52 52 0 0 1 74 4 Z"/></svg>';
  mmDots.appendChild(fovEl);

  /* точки */
  SCENES.forEach(function (s) {
    var d = document.createElement('div');
    d.className = 'dot';
    d.style.left = (s.x * 100) + '%';
    d.style.top  = (s.y * 100) + '%';
    d.innerHTML  = '<i class="num">' + s.id + '</i><span class="tip">' + s.name + '</span>';
    d.addEventListener('click', function () { go(s.id); });
    mmDots.appendChild(d);
    dotEls[s.id] = d;
  });
})();

function paintMap() {
  var cur = current.data;
  var near = {};
  cur.links.forEach(function (l) { near[l.to] = 1; });
  SCENES.forEach(function (s) {
    var el = dotEls[s.id];
    el.classList.toggle('active', s.id === cur.id);
    el.classList.toggle('linked', !!near[s.id] && s.id !== cur.id);
  });
  fovEl.style.left = (cur.x * 100) + '%';
  fovEl.style.top  = (cur.y * 100) + '%';
}

/* ============================ компас + конус ============================ */

var rose = document.getElementById('compassRose');
function frame() {
  if (current) {
    var yaw = current.view.yaw() / RAD;              // = азимут на плане
    rose.setAttribute('transform', 'rotate(' + (-yaw) + ' 50 50)');
    fovEl.style.transform = 'rotate(' + yaw + 'deg)';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ============================ управление ============================ */

var order = SCENES.map(function (s) { return s.id; });
function step(delta) {
  var i = order.indexOf(current.data.id);
  go(order[(i + delta + order.length) % order.length]);
}
document.getElementById('btnPrev').onclick = function () { step(-1); };
document.getElementById('btnNext').onclick = function () { step(1); };

var autoBtn = document.getElementById('btnAuto');
var autorotate = Marzipano.autorotate({ yawSpeed: 0.035, targetPitch: 0, targetFov: 85 * RAD });
var spinning = false;
autoBtn.onclick = function () {
  spinning = !spinning;
  autoBtn.classList.toggle('on', spinning);
  if (spinning) { viewer.startMovement(autorotate); viewer.setIdleMovement(4000, autorotate); }
  else { viewer.stopMovement(); viewer.setIdleMovement(Infinity); }
};

document.getElementById('btnFs').onclick = function () {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};

document.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowRight' && e.shiftKey) step(1);
  if (e.key === 'ArrowLeft'  && e.shiftKey) step(-1);
  if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') toggleCalib();
});

/* сворачивание карты */
var mm = document.getElementById('minimap');
var mmRestore = document.getElementById('mmRestore');
document.getElementById('mmSize').onclick = function () { mm.classList.toggle('big'); };
document.getElementById('mmToggle').onclick = function () {
  mm.classList.add('gone');
  mmRestore.classList.add('show');
};
mmRestore.onclick = function () {
  mm.classList.remove('gone');
  mmRestore.classList.remove('show');
};

setTimeout(function () { document.getElementById('hint').classList.add('gone'); }, 7000);

/* ============================ калибровка ============================ */

var calib = document.getElementById('calib');
var calibOn = false, lastPick = null;
var edits = [];

function toggleCalib() {
  calibOn = !calibOn;
  calib.classList.toggle('on', calibOn);
}
document.getElementById('calibClose').onclick = toggleCalib;

document.getElementById('pano').addEventListener('click', function (e) {
  if (!calibOn || !current) return;
  var rect = viewer.domElement().getBoundingClientRect();
  var coords = current.view.screenToCoordinates({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  lastPick = { yaw: +(coords.yaw / RAD).toFixed(2), pitch: +(coords.pitch / RAD).toFixed(2) };
  document.getElementById('cYaw').textContent   = lastPick.yaw;
  document.getElementById('cPitch').textContent = lastPick.pitch;
  var box = document.getElementById('calibTargets');
  box.innerHTML = '<span>ведёт к:</span>';
  current.data.links.forEach(function (l) {
    var b = document.createElement('button');
    b.textContent = l.to;
    b.onclick = function () {
      edits.push({ scene: current.data.id, to: l.to, yaw: lastPick.yaw, pitch: lastPick.pitch });
      b.style.background = '#c8a06a'; b.style.color = '#191919';
    };
    box.appendChild(b);
  });
});

document.getElementById('calibExport').onclick = function () {
  var blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hotspot-edits.json';
  a.click();
};

/* ============================ старт ============================ */

var start = location.hash.replace('#', '') || SCENES[0].id;
go(byId[start] ? start : SCENES[0].id);

})();
