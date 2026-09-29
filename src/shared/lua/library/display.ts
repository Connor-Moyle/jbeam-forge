import type { ScriptTemplate, TemplateContext } from '../templates';
import { outputName } from '../templates';

/**
 * Head unit (fork): a phone-projection style infotainment screen on the
 * car's own screen mesh, in two looks (a dark Android-Auto-like launcher or
 * a CarPlay-like dock). The game draws the page onto the screen's material
 * as a live texture (the gauges/genericGauges controller) and sends it the
 * car's electrics; this script adds the keys that move between apps and
 * play music. Everything runs offline: maps are drawn, music is a playlist
 * of names with a progress bar.
 */

export const APPS = ['Home', 'Maps', 'Music', 'Phone', 'Car'] as const;

/** Electrics the page is sent. */
export function headUnitElectrics(name: string): string[] {
  return ['wheelspeed', 'rpm', 'rpmTacho', 'gear', 'fuel', 'watertemp', 'oiltemp', 'ignitionLevel', 'lights', 'odometer', 'steering', 'throttle', 'signal_L', 'signal_R', outputName(name, 'app'), outputName(name, 'play'), outputName(name, 'track'), outputName(name, 'on')];
}

/** The page: plain HTML, CSS and JS for the game's browser (and the app's preview). */
export function headUnitHtml(ctx: Pick<TemplateContext, 'name' | 'params'>): string {
  const p = ctx.params;
  const config = {
    theme: p.theme === 'carplay' ? 'carplay' : 'android',
    accent: typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#4f8cff',
    units: p.units === 'mph' ? 'mph' : 'kmh',
    clock: p.clock === '12' ? 12 : 24,
    brand: typeof p.brand === 'string' ? p.brand.slice(0, 40) : 'Drive',
    driver: typeof p.driver === 'string' ? p.driver.slice(0, 40) : 'Driver',
    tracks: (typeof p.tracks === 'string' ? p.tracks : '').split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 50),
    out: { app: outputName(ctx.name, 'app'), play: outputName(ctx.name, 'play'), track: outputName(ctx.name, 'track'), on: outputName(ctx.name, 'on') },
  };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Head unit</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1280px; height: 720px; overflow: hidden; background: #000; color: #eef1f6; font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  #screen { position: absolute; inset: 0; display: flex; background: #0e1116; transition: opacity .4s; }
  #screen.off { opacity: 0; }
  .rail { width: 110px; display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 22px 0; background: #161a21; }
  .rail .clock { font-size: 26px; font-weight: 600; }
  .rail .icon { width: 70px; height: 70px; border-radius: 22px; display: grid; place-items: center; background: #232a35; opacity: .55; transition: all .25s; }
  .rail .icon.on { opacity: 1; background: var(--accent); transform: scale(1.06); }
  .rail svg { width: 36px; height: 36px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .main { flex: 1; position: relative; padding: 26px; }
  .app { position: absolute; inset: 26px; display: none; }
  .app.on { display: block; animation: in .35s ease; }
  @keyframes in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .grid { display: grid; grid-template-columns: 1.4fr 1fr; grid-template-rows: 1fr 1fr; gap: 20px; height: 100%; }
  .card { background: #1a2029; border-radius: 26px; padding: 26px; position: relative; overflow: hidden; }
  .card h2 { font-size: 20px; font-weight: 500; opacity: .7; margin-bottom: 10px; }
  .big { font-size: 96px; font-weight: 300; line-height: 1; }
  .unit { font-size: 26px; opacity: .6; margin-left: 8px; }
  .row { display: flex; align-items: center; gap: 18px; }
  .art { width: 140px; height: 140px; border-radius: 18px; flex-shrink: 0; }
  .title { font-size: 34px; font-weight: 600; }
  .artist { font-size: 22px; opacity: .6; margin-top: 6px; }
  .bar { height: 8px; background: #2b3340; border-radius: 4px; overflow: hidden; margin-top: 24px; }
  .bar > i { display: block; height: 100%; background: var(--accent); width: 0; }
  canvas { width: 100%; height: 100%; border-radius: 26px; display: block; }
  .list div { display: flex; justify-content: space-between; padding: 20px 8px; border-bottom: 1px solid #252c37; font-size: 26px; }
  .list span { opacity: .55; font-size: 22px; }
  .gauges { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; height: 100%; }
  .meter { font-size: 64px; font-weight: 300; }
  .status { position: absolute; top: 0; right: 0; font-size: 20px; opacity: .6; }
  .banner { position: absolute; left: 26px; right: 26px; bottom: 26px; padding: 18px 26px; border-radius: 20px; background: var(--accent); font-size: 26px; font-weight: 600; }
  body.carplay #screen { background: linear-gradient(160deg, #1d2b44, #0b0f16 60%); }
  body.carplay .rail { background: rgba(255,255,255,.08); backdrop-filter: blur(20px); }
  body.carplay .rail .icon { border-radius: 18px; opacity: 1; background: #2c3a52; }
  body.carplay .rail .icon.on { background: var(--accent); box-shadow: 0 0 0 4px rgba(255,255,255,.35); }
  body.carplay .card { background: rgba(255,255,255,.08); border-radius: 22px; }
</style>
</head>
<body>
<div id="screen" class="off">
  <nav class="rail">
    <div class="clock" id="clock">12:00</div>
    <div class="icon" data-app="0"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg></div>
    <div class="icon" data-app="1"><svg viewBox="0 0 24 24"><path d="M12 2l7 20-7-4-7 4z"/></svg></div>
    <div class="icon" data-app="2"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
    <div class="icon" data-app="3"><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg></div>
    <div class="icon" data-app="4"><svg viewBox="0 0 24 24"><path d="M5 17h14M6 17l1.5-5h9L18 17M4 17v3h3v-3M17 17v3h3v-3"/><circle cx="8" cy="14.5" r=".5"/><circle cx="16" cy="14.5" r=".5"/></svg></div>
  </nav>
  <main class="main">
    <div class="status" id="brand"></div>
    <section class="app" data-app="0">
      <div class="grid">
        <div class="card" style="grid-row: span 2; padding: 0"><canvas id="homeMap" width="600" height="600"></canvas></div>
        <div class="card"><h2>Speed</h2><div><span class="big" id="speed">0</span><span class="unit" id="unit">km/h</span></div></div>
        <div class="card"><h2>Now playing</h2><div class="title" id="homeTitle">-</div><div class="artist" id="homeArtist"></div><div class="bar"><i id="homeBar"></i></div></div>
      </div>
    </section>
    <section class="app" data-app="1"><div class="card" style="height: 100%; padding: 0"><canvas id="map" width="1100" height="660"></canvas></div><div class="banner" id="turn">Continue straight</div></section>
    <section class="app" data-app="2">
      <div class="card" style="height: 100%">
        <div class="row"><div class="art" id="art"></div><div><div class="title" id="title">-</div><div class="artist" id="artist"></div></div></div>
        <div class="bar"><i id="bar"></i></div>
        <div class="list" id="queue" style="margin-top: 20px"></div>
      </div>
    </section>
    <section class="app" data-app="3"><div class="card list" style="height: 100%" id="calls"></div></section>
    <section class="app" data-app="4">
      <div class="gauges">
        <div class="card"><h2>Speed</h2><div class="meter" id="cSpeed">0</div></div>
        <div class="card"><h2>Engine</h2><div class="meter" id="cRpm">0</div><span class="unit">rpm</span></div>
        <div class="card"><h2>Gear</h2><div class="meter" id="cGear">N</div></div>
        <div class="card"><h2>Fuel</h2><div class="meter" id="cFuel">0%</div><div class="bar"><i id="fuelBar"></i></div></div>
        <div class="card"><h2>Coolant</h2><div class="meter" id="cTemp">0°</div></div>
        <div class="card"><h2>Trip</h2><div class="meter" id="cTrip">0.0</div><span class="unit" id="tripUnit">km</span></div>
      </div>
    </section>
  </main>
</div>
<script>
(function () {
  var CONFIG = ${json};
  var TRACKS = CONFIG.tracks.length ? CONFIG.tracks : ["Midnight Drive - The Overpass", "Coastline - Salt Flats", "Red Line - Apex", "Night Rain - Ferro", "Open Road - Wanderers"];
  document.body.className = CONFIG.theme;
  document.documentElement.style.setProperty("--accent", CONFIG.accent);
  var $ = function (id) { return document.getElementById(id); };
  $("brand").textContent = CONFIG.brand;
  $("unit").textContent = CONFIG.units === "mph" ? "mph" : "km/h";
  $("tripUnit").textContent = CONFIG.units === "mph" ? "mi" : "km";
  var calls = [["Mum", "Mobile · 2 min ago"], ["Workshop", "Missed · 1 h ago"], ["Alex", "Outgoing · yesterday"], ["Parts store", "Mobile · Monday"]];
  $("calls").innerHTML = calls.map(function (c) { return "<div>" + c[0] + "<span>" + c[1] + "</span></div>"; }).join("");
  var state = { e: {}, app: 0, heading: 0, x: 0, y: 0, trip: 0, startOdo: null, songT: 0, lastTrack: -1, last: Date.now() };

  function trackAt(i) { var t = TRACKS[((i % TRACKS.length) + TRACKS.length) % TRACKS.length].split(" - "); return { title: t[0], artist: t[1] || "" }; }
  function hue(i) { return (i * 67) % 360; }

  function drawMap(canvas, big) {
    var g = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
    g.fillStyle = CONFIG.theme === "carplay" ? "#dfe6ee" : "#1f2631"; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h * 0.68); g.rotate(-state.heading);
    var s = 90, ox = state.x % s, oy = state.y % s;
    g.strokeStyle = CONFIG.theme === "carplay" ? "#ffffff" : "#2e3847"; g.lineWidth = 22;
    for (var i = -12; i <= 12; i++) {
      g.beginPath(); g.moveTo(i * s - ox, -h * 2); g.lineTo(i * s - ox, h * 2); g.stroke();
      g.beginPath(); g.moveTo(-w * 2, i * s - oy); g.lineTo(w * 2, i * s - oy); g.stroke();
    }
    g.strokeStyle = CONFIG.accent; g.lineWidth = 16; g.lineCap = "round";
    g.beginPath(); g.moveTo(-ox, h); g.lineTo(-ox, -oy - s * 3); g.lineTo(s * 2 - ox, -oy - s * 3); g.stroke();
    g.restore();
    g.fillStyle = CONFIG.accent; g.beginPath(); g.moveTo(w / 2, h * 0.68 - 26); g.lineTo(w / 2 + 18, h * 0.68 + 18); g.lineTo(w / 2, h * 0.68 + 8); g.lineTo(w / 2 - 18, h * 0.68 + 18); g.closePath(); g.fill();
    if (big) { g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(24, 24, 260, 70); g.fillStyle = "#fff"; g.font = "600 34px sans-serif"; g.fillText(speedText() + " " + $("unit").textContent, 44, 72); }
  }

  function speedText() { var ms = state.e.wheelspeed || 0; return String(Math.round(CONFIG.units === "mph" ? ms * 2.23694 : ms * 3.6)); }

  function render() {
    var e = state.e, now = Date.now(), dt = Math.min(0.2, (now - state.last) / 1000); state.last = now;
    var on = e[CONFIG.out.on] === undefined ? (e.ignitionLevel || 0) >= 1 : e[CONFIG.out.on] > 0.5;
    $("screen").className = on ? "" : "off";
    var app = Math.max(0, Math.min(4, Math.round(e[CONFIG.out.app] || 0)));
    var icons = document.querySelectorAll(".rail .icon");
    for (var i = 0; i < icons.length; i++) icons[i].className = "icon" + (i === app ? " on" : "");
    var apps = document.querySelectorAll(".app");
    for (var j = 0; j < apps.length; j++) apps[j].className = "app" + (j === app ? " on" : "");
    var d = new Date(), hh = d.getHours(), mm = ("0" + d.getMinutes()).slice(-2);
    $("clock").textContent = (CONFIG.clock === 12 ? ((hh + 11) % 12 + 1) : hh) + ":" + mm;
    var speed = e.wheelspeed || 0;
    state.heading += (e.steering || 0) * 0.0006 * speed * dt * 10;
    state.x += Math.sin(state.heading) * speed * dt * 6; state.y -= Math.cos(state.heading) * speed * dt * 6;
    $("speed").textContent = speedText(); $("cSpeed").textContent = speedText();
    $("cRpm").textContent = String(Math.round((e.rpmTacho || e.rpm || 0) / 10) * 10);
    var gear = e.gear; $("cGear").textContent = gear === undefined ? "N" : (typeof gear === "number" ? (gear < 0 ? "R" : gear === 0 ? "N" : String(gear)) : String(gear));
    $("cFuel").textContent = Math.round((e.fuel || 0) * 100) + "%"; $("fuelBar").style.width = Math.round((e.fuel || 0) * 100) + "%";
    $("cTemp").textContent = Math.round(e.watertemp || 0) + "°";
    if (e.odometer !== undefined) { if (state.startOdo === null) state.startOdo = e.odometer; state.trip = (e.odometer - state.startOdo) / 1000; } else state.trip += speed * dt / 1000;
    $("cTrip").textContent = (CONFIG.units === "mph" ? state.trip * 0.621371 : state.trip).toFixed(1);
    var track = Math.round(e[CONFIG.out.track] || 0);
    if (track !== state.lastTrack) { state.lastTrack = track; state.songT = 0; }
    if ((e[CONFIG.out.play] || 0) > 0.5) state.songT += dt;
    var song = trackAt(track), pct = Math.min(100, state.songT / 2.1) + "%";
    $("title").textContent = song.title; $("artist").textContent = song.artist; $("homeTitle").textContent = song.title; $("homeArtist").textContent = song.artist;
    $("bar").style.width = pct; $("homeBar").style.width = pct;
    $("art").style.background = "linear-gradient(135deg, hsl(" + hue(track) + ",70%,55%), hsl(" + (hue(track) + 60) + ",70%,30%))";
    var q = ""; for (var k = 1; k <= 4; k++) { var n = trackAt(track + k); q += "<div>" + n.title + "<span>" + n.artist + "</span></div>"; } $("queue").innerHTML = q;
    var turn = Math.floor((state.y / -400)) % 3; $("turn").textContent = ["Continue straight for 400 m", "Turn right onto High Street", "Keep left at the fork"][((turn % 3) + 3) % 3];
    if (app === 0) drawMap($("homeMap"), false); if (app === 1) drawMap($("map"), true);
  }

  // The game's gauges controller calls these; the app's preview posts the same data.
  window.setup = function () {};
  window.updateData = function (data) { if (data && data.electrics) state.e = data.electrics; };
  window.addEventListener("message", function (ev) { if (ev.data && ev.data.electrics) state.e = ev.data.electrics; });
  setInterval(render, 50);
  render();
})();
</script>
</body>
</html>
`;
}

export const headUnit: ScriptTemplate = {
  id: 'head_unit',
  name: 'Head unit (phone projection)',
  category: 'Display',
  description: 'A working infotainment screen in the style of Android Auto or Apple CarPlay on your car’s own screen: home dashboard, a moving map, music with a playlist, phone and a car status page, lit when the ignition is on. Keys move between apps and play music.',
  needs: 'The head unit screen mesh (its material becomes the live screen)',
  name0: 'headunit',
  params: [
    { id: 'screen', label: 'Screen mesh', kind: 'mesh', default: '', hint: 'The glass of the display; it gets its own material showing the page' },
    { id: 'theme', label: 'Look', kind: 'choice', default: 'android', options: [{ value: 'android', label: 'Launcher (Android Auto style)' }, { value: 'carplay', label: 'Dock (CarPlay style)' }], scope: 'files' },
    { id: 'accent', label: 'Accent colour', kind: 'text', default: '#4f8cff', hint: 'A colour like #4f8cff', scope: 'files' },
    { id: 'units', label: 'Speed in', kind: 'choice', default: 'kmh', options: [{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }], scope: 'files' },
    { id: 'clock', label: 'Clock', kind: 'choice', default: '24', options: [{ value: '24', label: '24 hour' }, { value: '12', label: '12 hour' }], scope: 'files' },
    { id: 'brand', label: 'Name in the corner', kind: 'text', default: 'Drive', scope: 'files' },
    { id: 'tracks', label: 'Playlist', kind: 'text', default: 'Midnight Drive - The Overpass\nCoastline - Salt Flats\nRed Line - Apex\nNight Rain - Ferro\nOpen Road - Wanderers', hint: 'One “Title - Artist” per line', advanced: true, scope: 'files' },
    { id: 'width', label: 'Screen width', kind: 'number', default: 1280, min: 256, max: 2048, step: 64, unit: 'px', advanced: true, scope: 'files' },
    { id: 'height', label: 'Screen height', kind: 'number', default: 720, min: 128, max: 2048, step: 64, unit: 'px', advanced: true, scope: 'files' },
  ],
  outputs: [
    { suffix: 'app', label: 'App (0 home, 1 maps, 2 music, 3 phone, 4 car)', min: 0, max: 4 },
    { suffix: 'play', label: 'Music playing', min: 0, max: 1 },
    { suffix: 'track', label: 'Track number', min: 0, max: 50 },
    { suffix: 'on', label: 'Screen on', min: 0, max: 1 },
  ],
  actions: [
    { id: 'next', label: 'Screen: next app', key: 'lctrl period', call: 'nextApp(1)', desc: 'Next app on the head unit' },
    { id: 'prev', label: 'Screen: previous app', key: 'lctrl comma', call: 'nextApp(-1)', desc: 'Previous app on the head unit' },
    { id: 'home', label: 'Screen: home', key: 'lctrl slash', call: 'home()', desc: 'Back to the home screen' },
    { id: 'play', label: 'Music: play or pause', key: 'lctrl apostrophe', call: 'playPause()', desc: 'Play or pause the music' },
    { id: 'skip', label: 'Music: next track', key: 'lctrl rbracket', call: 'skip(1)', desc: 'Next track' },
  ],
  files: (ctx) => [{ path: `ui/${ctx.name}/index.html`, text: headUnitHtml(ctx) }],
  jbeam: (ctx) => {
    const section = `${ctx.name}_screen`;
    const w = typeof ctx.params.width === 'number' ? ctx.params.width : 1280;
    const h = typeof ctx.params.height === 'number' ? ctx.params.height : 720;
    return {
      controllers: [['gauges/genericGauges', { name: section }]],
      sections: {
        [section]: {
          configuration: { materialName: `@${ctx.slug}_${ctx.name}`, htmlPath: `local://local/vehicles/${ctx.slug}/ui/${ctx.name}/index.html`, displayWidth: w, displayHeight: h },
          displayData: { electrics: headUnitElectrics(ctx.name) },
        },
      },
    };
  },
  screen: { param: 'screen', texture: (ctx) => `@${ctx.slug}_${ctx.name}` },
  lua: `-- JBeam Forge: head unit keys (apps, music) and screen power.
-- The page itself is drawn by the gauges/genericGauges controller.
local M = {}
M.type = "auxiliary"

local APPS = 5
local outApp, outPlay, outTrack, outOn = "jbf_headunit_app", "jbf_headunit_play", "jbf_headunit_track", "jbf_headunit_on"
local app, playing, track = 0, 1, 0

local function init(jbeamData)
  outApp = jbeamData.out_app or outApp
  outPlay = jbeamData.out_play or outPlay
  outTrack = jbeamData.out_track or outTrack
  outOn = jbeamData.out_on or outOn
  app, playing, track = 0, 1, 0
end

local function updateGFX(dt)
  electrics.values[outApp] = app
  electrics.values[outPlay] = playing
  electrics.values[outTrack] = track
  electrics.values[outOn] = (electrics.values.ignitionLevel or 0) >= 1 and 1 or 0
end

local function nextApp(step)
  app = (app + (step or 1)) % APPS
end

local function home()
  app = 0
end

local function playPause()
  playing = 1 - playing
end

local function skip(step)
  track = math.max(0, track + (step or 1))
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.nextApp = nextApp
M.home = home
M.playPause = playPause
M.skip = skip
return M
`,
  test: {
    seconds: 12,
    tracks: [
      { name: 'ignitionLevel', points: [[0, 0], [0.5, 0], [0.51, 2], [12, 2]] },
      { name: 'wheelspeed', points: [[0, 0], [12, 22]] },
      { name: 'rpm', points: [[0, 800], [12, 3800]] },
      { name: 'fuel', points: [[0, 0.62], [12, 0.61]] },
      { name: 'watertemp', points: [[0, 60], [12, 88]] },
    ],
    presses: [{ at: 2, action: 'next' }, { at: 4, action: 'next' }, { at: 6, action: 'skip' }, { at: 8, action: 'next' }, { at: 9, action: 'next' }, { at: 11, action: 'home' }],
  },
};
