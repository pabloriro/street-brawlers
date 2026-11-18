'use strict';
// =====================================================================
//  STREET BRAWLERS - juego de pelea 2D en canvas (sin librerías)
// =====================================================================
const W = 960, H = 540, GROUND = 450, GRAV = 0.9;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menuEl = document.getElementById('menu');

// ---------------------------------------------------------------- input
const keys = {};
let pressed = {};
const GAME_KEYS = new Set(['KeyA','KeyD','KeyW','KeyS','KeyF','KeyG','KeyH',
  'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyK','KeyL','KeyJ','Enter','Space']);
addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const CTRL1 = { left:'KeyA', right:'KeyD', up:'KeyW', down:'KeyS', punch:'KeyF', kick:'KeyG', special:'KeyH' };
const CTRL2 = { left:'ArrowLeft', right:'ArrowRight', up:'ArrowUp', down:'ArrowDown', punch:'KeyK', kick:'KeyL', special:'KeyJ' };
const NEUTRAL = { left:false, right:false, up:false, down:false, punch:false, kick:false, special:false };

function readInput(c) {
  return {
    left: !!keys[c.left], right: !!keys[c.right], up: !!keys[c.up], down: !!keys[c.down],
    punch: !!pressed[c.punch], kick: !!pressed[c.kick], special: !!pressed[c.special]
  };
}

// ---------------------------------------------------------------- audio
let actx = null;
function tone(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, actx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), actx.currentTime + dur);
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  whoosh: () => tone(500, 0.12, 'sawtooth', 0.03, -350),
  hit:    () => { tone(180, 0.15, 'square', 0.12, -120); tone(90, 0.12, 'sawtooth', 0.1, -50); },
  block:  () => tone(300, 0.08, 'triangle', 0.1, -100),
  fire:   () => tone(250, 0.4, 'sawtooth', 0.06, 500),
  ko:     () => { tone(220, 0.8, 'sawtooth', 0.14, -180); },
  gong:   () => tone(440, 0.5, 'triangle', 0.1, 220)
};

// ---------------------------------------------------------------- ataques
const ATK = {
  punch:    { startup:4, active:4,  total:15, dmg:6,  reach:62, y0:-128, y1:-98, stun:14, push:4 },
  punchLow: { startup:5, active:4,  total:16, dmg:6,  reach:58, y0:-80,  y1:-45, stun:14, push:4 },
  kick:     { startup:8, active:5,  total:24, dmg:11, reach:90, y0:-100, y1:-45, stun:18, push:9 },
  kickLow:  { startup:9, active:5,  total:28, dmg:9,  reach:98, y0:-30,  y1:0,   stun:30, push:6, low:true, knock:true },
  punchAir: { startup:3, active:16, total:60, dmg:7,  reach:56, y0:-110, y1:-60, stun:14, push:4, air:true },
  kickAir:  { startup:5, active:16, total:60, dmg:9,  reach:78, y0:-75,  y1:-20, stun:16, push:6, air:true },
  special:  { startup:12, active:0, total:38, dmg:0,  spawn:12 }
};
const SPECIAL_COST = 30;

// ---------------------------------------------------------------- luchador
class Fighter {
  constructor(name, side, look, ctrl) {
    this.name = name; this.side = side; this.look = look; this.ctrl = ctrl;
    this.wins = 0;
    this.reset();
  }
  reset() {
    this.x = this.side === 0 ? 300 : W - 300;
    this.y = GROUND; this.vx = 0; this.vy = 0;
    this.facing = this.side === 0 ? 1 : -1;
    this.hp = 100; this.hpShow = 100; this.energy = 30;
    this.state = 'idle'; this.t = 0; this.atk = null; this.hasHit = false;
    this.hitstun = 0; this.blockT = 0; this.anim = 0;
    this.blocking = false; this.crouch = false;
    this.ko = false; this.koT = 0;
  }
  get air() { return this.y < GROUND - 0.5; }
  hurt() {
    const top = this.crouch && !this.air ? 90 : 150;
    return { x0: this.x - 22, x1: this.x + 22, y0: this.y - top, y1: this.y };
  }
  hitbox() {
    const a = this.atk;
    const x0 = this.facing === 1 ? this.x + 15 : this.x - a.reach;
    const x1 = this.facing === 1 ? this.x + a.reach : this.x - 15;
    return { x0, x1, y0: this.y + a.y0, y1: this.y + a.y1 };
  }
  startAttack(type) {
    let key = type;
    if (type !== 'special') {
      if (this.air) key = type + 'Air';
      else if (this.crouch) key = type + 'Low';
    }
    this.atk = { ...ATK[key] };
    this.state = 'attack'; this.t = 0; this.hasHit = false;
    if (type === 'special') { this.energy -= SPECIAL_COST; this.crouch = false; }
    if (type !== 'special') sfx.whoosh();
  }
  update(inp, opp) {
    this.anim++;
    if (this.blockT > 0) this.blockT--;
    this.energy = Math.min(100, this.energy + 0.06);
    const grounded = !this.air && this.vy >= 0;

    if (this.ko) {
      this.koT++;
    } else if (this.state === 'hit') {
      this.hitstun--;
      if (this.hitstun <= 0) this.state = 'idle';
    } else if (this.state === 'attack') {
      this.t++;
      if (this.atk.spawn !== undefined && this.t === this.atk.spawn) {
        projectiles.push({ x: this.x + this.facing * 45, y: this.y - 82, vx: this.facing * 8,
                           owner: this, r: 16, life: 140 });
        sfx.fire();
      }
      if (grounded && !this.atk.air) this.vx *= 0.7;
      if (this.t >= this.atk.total) { this.state = 'idle'; this.atk = null; }
    } else {
      // movimiento libre
      if (grounded) {
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        this.crouch = inp.down;
        const back = dir !== 0 && dir !== this.facing;
        this.blocking = back;
        if (this.crouch) { this.vx = 0; this.blocking = back; }
        else {
          this.vx = dir * (back ? 2.6 : 4.2);
          if (inp.up) { this.vy = -17; this.vx = dir * 4.5; this.crouch = false; this.state = 'idle'; }
        }
      }
      if (inp.special && grounded && this.energy >= SPECIAL_COST) this.startAttack('special');
      else if (inp.punch) this.startAttack('punch');
      else if (inp.kick) this.startAttack('kick');
      // mirar al rival
      if (grounded && this.state !== 'attack') this.facing = opp.x >= this.x ? 1 : -1;
    }
    if (this.state !== 'idle' || this.air) { if (this.state === 'attack' && !this.atk.air) this.blocking = false; }
    if (this.state === 'hit' || this.ko) this.blocking = false;
    if (this.state === 'attack' && this.atk.air === undefined) this.crouch = this.crouch && !this.air;

    // física
    if (this.air || this.vy < 0) this.vy += GRAV;
    this.x += this.vx; this.y += this.vy;
    if (this.y >= GROUND) {
      if (this.vy > 0 && (this.state === 'attack' && this.atk && this.atk.air)) { this.state = 'idle'; this.atk = null; }
      this.y = GROUND; this.vy = 0;
      if (this.state === 'hit' || this.ko) this.vx *= 0.85;
      else if (this.state === 'attack') this.vx = 0;
    }
    this.x = Math.max(40, Math.min(W - 40, this.x));
    this.hpShow += (this.hp - this.hpShow) * 0.06;
  }

  // --------------------------------------------------------- dibujo
  draw() {
    const look = this.look;
    const air = this.air;
    const cr = this.crouch && !air;
    ctx.save();
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    const sh = Math.max(0.4, 1 - (GROUND - this.y) / 300);
    ctx.beginPath(); ctx.ellipse(this.x, GROUND + 4, 42 * sh, 9 * sh, 0, 0, 7); ctx.fill();

    ctx.translate(this.x, this.y);
    ctx.scale(this.facing, 1);
    if (this.ko) {
      const k = Math.min(this.koT / 18, 1);
      ctx.translate(0, -10 * k); ctx.rotate(-k * Math.PI / 2);
    } else if (this.state === 'hit') ctx.rotate(-0.14);

    const hipY = cr ? -42 : -72, shY = cr ? -88 : -122, headY = shY - 20;
    let fFoot = { x: 16, y: 0 }, bFoot = { x: -16, y: 0 };
    let fHand = { x: 34, y: shY + 14 }, bHand = { x: 20, y: shY + 4 };
    let bob = 0;

    if (cr) { fFoot = { x: 30, y: 0 }; bFoot = { x: -26, y: 0 }; }
    else if (air) { fFoot = { x: 22, y: -34 }; bFoot = { x: -12, y: -20 }; }
    else if (Math.abs(this.vx) > 0.5 && this.state === 'idle') {
      const s = Math.sin(this.anim * 0.28) * 18;
      fFoot = { x: 14 + s, y: -Math.max(0, Math.cos(this.anim * 0.28)) * 8 };
      bFoot = { x: -14 - s, y: -Math.max(0, -Math.cos(this.anim * 0.28)) * 8 };
    } else { bob = Math.sin(this.anim * 0.1) * 2; }

    if (this.state === 'attack' && this.atk) {
      const a = this.atk, t = this.t;
      const e = t < a.startup ? t / a.startup
              : t < a.startup + a.active ? 1
              : Math.max(0, 1 - (t - a.startup - a.active) / Math.max(1, a.total - a.startup - a.active));
      const eAir = a.air ? Math.min(1, t / a.startup) : e;
      if (a === null) {}
      if (a.reach && a.y1 !== undefined) {
        const isKick = a.dmg >= 9 && (a.y0 > -105 && a.reach > 70);
        if (isKick) {
          const ty = (a.y0 + a.y1) / 2;
          fFoot = { x: 14 + (a.reach - 26) * eAir, y: ty * eAir };
          fHand = { x: 26, y: shY + 14 };
        } else {
          fHand = { x: 30 + (a.reach - 36) * eAir, y: (a.y0 + a.y1) / 2 * (0.3 + 0.7 * eAir) + (1 - eAir) * (shY + 12) * 0.7 };
          if (!a.air || true) fHand.y = (a.y0 + a.y1) / 2 * eAir + (shY + 14) * (1 - eAir);
        }
      } else { // especial
        fHand = { x: 30 + 22 * e, y: shY + 14 }; bHand = { x: 24 + 22 * e, y: shY + 8 };
      }
    } else if (this.blocking || this.blockT > 0) {
      fHand = { x: 30, y: headY + 4 }; bHand = { x: 24, y: headY + 14 };
    } else if (this.state === 'hit' || this.ko) {
      fHand = { x: -10, y: shY + 24 }; bHand = { x: -26, y: shY + 14 };
    }

    const gi = look.gi, skin = look.skin;
    const limb = (a, b, c, w, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    };
    const leg = (foot, col) => {
      const hip = { x: 0, y: hipY + bob };
      const kneeBend = cr ? 12 : air ? 6 : 6;
      const knee = { x: (hip.x + foot.x) / 2 + kneeBend, y: (hip.y + foot.y) / 2 + (cr ? 4 : 0) };
      limb(hip, knee, foot, 15, col);
      // pie
      ctx.strokeStyle = skin; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(foot.x, foot.y - 2); ctx.lineTo(foot.x + 10, foot.y - 2); ctx.stroke();
    };
    const arm = (hand, col, glove) => {
      const sh = { x: 4, y: shY + 6 + bob };
      const elbow = { x: (sh.x + hand.x) / 2, y: (sh.y + hand.y) / 2 + 12 };
      limb(sh, elbow, hand, 11, col);
      ctx.fillStyle = glove; ctx.beginPath(); ctx.arc(hand.x, hand.y, 9, 0, 7); ctx.fill();
    };

    // capa trasera
    leg(bFoot, look.pants);
    arm(bHand, skin, look.glove);
    // torso
    ctx.strokeStyle = gi; ctx.lineWidth = 30; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, hipY + bob); ctx.lineTo(2, shY + 8 + bob); ctx.stroke();
    ctx.fillStyle = look.belt; ctx.fillRect(-15, hipY - 8 + bob, 30, 8);
    ctx.fillStyle = skin; ctx.fillRect(-3, shY - 6 + bob, 8, 12);
    // pierna delantera
    leg(fFoot, look.pants);
    // cabeza
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(5, headY + bob, 16, 0, 7); ctx.fill();
    ctx.fillStyle = look.hair;
    ctx.beginPath(); ctx.arc(3, headY - 3 + bob, 17, Math.PI * 1.02, Math.PI * 2.05); ctx.fill();
    ctx.fillStyle = look.band; ctx.fillRect(-12, headY - 8 + bob, 34, 5);
    ctx.beginPath(); ctx.moveTo(-12, headY - 6 + bob); ctx.lineTo(-26, headY - 1 + bob + Math.sin(this.anim * 0.2) * 3);
    ctx.lineTo(-12, headY - 2 + bob); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(11, headY - 1 + bob, 4, 4);
    if (this.state === 'hit' || this.ko) { ctx.fillRect(9, headY + 8 + bob, 8, 2); }
    // brazo delantero
    arm(fHand, skin, look.glove);

    // aura del hadouken
    if (this.state === 'attack' && this.atk && this.atk.spawn !== undefined) {
      const g = ctx.createRadialGradient(fHand.x + 6, fHand.y, 2, fHand.x + 6, fHand.y, 26);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(80,170,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fHand.x + 6, fHand.y, 26, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- estado del juego
const p1 = new Fighter('KAITO', 0,
  { gi:'#d63a2f', pants:'#f1f1f1', belt:'#111', skin:'#f0b98a', hair:'#1a1a1a', band:'#fff', glove:'#d63a2f' }, CTRL1);
const p2 = new Fighter('BRUNO', 1,
  { gi:'#2a62d6', pants:'#e9e9e9', belt:'#222', skin:'#e2a577', hair:'#e8c33a', band:'#d63a2f', glove:'#2a62d6' }, CTRL2);

let projectiles = [], particles = [], bursts = [];
let phase = 'menu', phaseT = 0, round = 1, timer = 99, tick = 0, msg = '', sub = '';
let vsCPU = true, difficulty = 0.7, shake = 0, frame = 0;

function startMatch(cpu) {
  vsCPU = cpu;
  difficulty = parseFloat(document.getElementById('difficulty').value);
  p1.wins = 0; p2.wins = 0; round = 1;
  menuEl.classList.add('hidden');
  newRound();
}
function newRound() {
  p1.reset(); p2.reset();
  projectiles = []; particles = []; bursts = [];
  p1.ai = p2.ai = null;
  phase = 'intro'; phaseT = 0; timer = 99; tick = 0;
  msg = 'ROUND ' + round; sub = '';
  sfx.gong();
}
function showMenu() { phase = 'menu'; menuEl.classList.remove('hidden'); }
document.getElementById('btn1p').onclick = () => startMatch(true);
document.getElementById('btn2p').onclick = () => startMatch(false);

function endRound(reason) {
  phase = 'roundover'; phaseT = 0;
  let w = null;
  if (p1.hp > p2.hp) w = p1; else if (p2.hp > p1.hp) w = p2;
  msg = reason === 'ko' ? 'K.O.!' : 'TIEMPO';
  if (w) { w.wins++; sub = w.name + ' GANA'; } else { sub = 'EMPATE'; }
  if (reason === 'ko') sfx.ko();
  roundWinner = w;
}
let roundWinner = null;

// ---------------------------------------------------------------- efectos
function spawnSparks(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 14 + Math.random() * 14, color, size: 2 + Math.random() * 3 });
  }
}

// ---------------------------------------------------------------- combate
function overlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }

function canBlock(def, low) {
  return !def.air && def.blocking && def.state === 'idle' && (!low || def.crouch);
}

function dealHit(att, def, atk, cx, cy) {
  if (canBlock(def, atk.low)) {
    def.hp -= atk.dmg * 0.12;
    def.vx = att.facing * atk.push * 0.8; def.blockT = 8;
    spawnSparks(cx, cy, 6, '#9cf'); sfx.block(); shake = 3;
    att.energy += 3;
  } else {
    def.hp -= atk.dmg;
    def.state = 'hit'; def.hitstun = atk.stun; def.atk = null; def.crouch = false;
    def.vx = att.facing * atk.push;
    if (atk.knock) def.vy = -9; else if (atk.dmg >= 10 && !def.air) def.vy = -5;
    att.energy += 8; def.energy += 5;
    spawnSparks(cx, cy, 14, '#ffd23f'); sfx.hit(); shake = 6;
    bursts.push({ x: cx, y: cy, life: 10 });
  }
  if (def.hp <= 0) {
    def.hp = 0; def.ko = true; def.state = 'ko'; def.koT = 0; def.atk = null;
    def.vx = att.facing * 6; def.vy = -11; shake = 14;
    if (phase === 'fight') endRound('ko');
  }
}

function checkMelee(a, b) {
  if (a.state !== 'attack' || !a.atk || !a.atk.dmg || a.hasHit || b.ko) return;
  const t = a.t, A = a.atk;
  if (t < A.startup || t >= A.startup + A.active) return;
  const hb = a.hitbox(), hu = b.hurt();
  if (overlap(hb, hu)) {
    a.hasHit = true;
    const cx = (Math.max(hb.x0, hu.x0) + Math.min(hb.x1, hu.x1)) / 2;
    const cy = (Math.max(hb.y0, hu.y0) + Math.min(hb.y1, hu.y1)) / 2;
    dealHit(a, b, A, cx, cy);
  }
}

function updateProjectiles() {
  for (const p of projectiles) {
    p.x += p.vx; p.life--;
    const foe = p.owner === p1 ? p2 : p1;
    const hu = foe.hurt();
    if (!foe.ko && p.x + p.r > hu.x0 && p.x - p.r < hu.x1 && p.y + p.r > hu.y0 && p.y - p.r < hu.y1) {
      dealHit(p.owner, foe, { dmg: 13, push: 7, stun: 22, low: false }, p.x, p.y);
      p.life = 0;
      spawnSparks(p.x, p.y, 10, '#8cf');
    }
    if (p.x < -40 || p.x > W + 40) p.life = 0;
  }
  // choque entre proyectiles
  for (let i = 0; i < projectiles.length; i++)
    for (let j = i + 1; j < projectiles.length; j++) {
      const a = projectiles[i], b = projectiles[j];
      if (a.owner !== b.owner && Math.abs(a.x - b.x) < 30 && Math.abs(a.y - b.y) < 30) {
        a.life = b.life = 0; spawnSparks(a.x, a.y, 16, '#fff'); sfx.block();
      }
    }
  projectiles = projectiles.filter(p => p.life > 0);
}

// ---------------------------------------------------------------- IA
function aiInput(f, o) {
  const ai = f.ai || (f.ai = { t: 0, inp: {}, fire: null });
  const inp = { ...NEUTRAL };
  if (ai.t > 0) { ai.t--; Object.assign(inp, ai.inp); return inp; }
  const lv = difficulty, r = Math.random();
  const dist = Math.abs(o.x - f.x), toward = o.x > f.x ? 1 : -1;
  const mv = d => { if (d > 0) ai.inp.right = true; else ai.inp.left = true; };
  const grounded = !f.air;
  ai.inp = {}; let fire = null;

  const fb = projectiles.find(p => p.owner !== f && Math.abs(p.x - f.x) < 230 && Math.sign(f.x - p.x) === Math.sign(p.vx));
  if (fb && grounded && Math.random() < 0.55 * lv) { ai.inp.up = true; mv(toward); ai.t = 2; }
  else if (dist > 330) {
    if (f.energy >= SPECIAL_COST && r < 0.35 * lv) { fire = 'special'; ai.t = 28; }
    else { mv(toward); ai.t = 14; if (r > 0.93) ai.inp.up = true; }
  } else if (dist > 135) {
    mv(toward); ai.t = 8 + Math.floor(Math.random() * 10);
    if (r < 0.08) ai.inp.up = true;
    else if (r > 0.9 && lv > 0.5) { fire = 'kick'; ai.t = 12; }
  } else {
    if (o.state === 'attack' && Math.random() < 0.6 * lv) {
      mv(-toward); ai.inp.down = Math.random() < 0.4; ai.t = 14;
    } else if (r < 0.3) { fire = 'punch'; ai.t = 10; }
    else if (r < 0.5) { fire = 'kick'; ai.t = 14; }
    else if (r < 0.62) { ai.inp.down = true; fire = 'kick'; ai.t = 18; }
    else if (r < 0.72) { mv(-toward); ai.t = 20; }
    else if (r < 0.8) { ai.inp.up = true; mv(toward); ai.t = 2; }
    else ai.t = Math.floor(10 * (2 - lv));
  }
  Object.assign(inp, ai.inp);
  if (fire) inp[fire] = true;
  return inp;
}

// ---------------------------------------------------------------- bucle principal
function update() {
  frame++;
  if (phase === 'menu') { pressed = {}; return; }

  // cámara lenta en el K.O.
  if (phase === 'roundover' && phaseT < 60 && (p1.ko || p2.ko) && frame % 2) return;

  const fighting = phase === 'fight';
  const i1 = fighting ? readInput(CTRL1) : NEUTRAL;
  const i2 = fighting ? (vsCPU ? aiInput(p2, p1) : readInput(CTRL2)) : NEUTRAL;
  p1.update(i1, p2); p2.update(i2, p1);

  // empujar si se solapan en el suelo
  if (!p1.air && !p2.air) {
    const dx = p2.x - p1.x, min = 44;
    if (Math.abs(dx) < min) {
      const push = (min - Math.abs(dx)) / 2 * Math.sign(dx || 1);
      p1.x -= push; p2.x += push;
      p1.x = Math.max(40, Math.min(W - 40, p1.x)); p2.x = Math.max(40, Math.min(W - 40, p2.x));
    }
  }

  checkMelee(p1, p2); checkMelee(p2, p1);
  updateProjectiles();

  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life--; }
  particles = particles.filter(p => p.life > 0);
  for (const b of bursts) b.life--;
  bursts = bursts.filter(b => b.life > 0);
  if (shake > 0) shake *= 0.85;

  phaseT++;
  if (phase === 'intro') {
    if (phaseT === 70) { msg = '¡PELEA!'; sfx.gong(); }
    if (phaseT >= 120) { phase = 'fight'; msg = ''; phaseT = 0; }
  } else if (phase === 'fight') {
    tick++;
    if (tick % 60 === 0) timer--;
    if (timer <= 0 && phase === 'fight') endRound('time');
  } else if (phase === 'roundover') {
    if (phaseT > 200) {
      if (p1.wins >= 2 || p2.wins >= 2) {
        phase = 'matchover'; phaseT = 0;
        msg = (p1.wins >= 2 ? p1.name : p2.name) + ' ES EL CAMPEÓN';
        sub = 'Presiona ENTER para volver al menú';
      } else { if (roundWinner || true) round++; newRound(); }
    }
  } else if (phase === 'matchover') {
    if (pressed['Enter'] || pressed['Space']) showMenu();
  }
  pressed = {};
}

// ---------------------------------------------------------------- render
let bg = null;
function buildBG() {
  bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  const c = bg.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#2b1055'); sky.addColorStop(0.55, '#d4476b'); sky.addColorStop(1, '#ffb86b');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  // sol
  c.fillStyle = '#ffe6a3'; c.beginPath(); c.arc(W / 2, 270, 90, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,230,163,.25)'; c.beginPath(); c.arc(W / 2, 270, 130, 0, 7); c.fill();
  // montañas
  const mount = (col, base, amp, seed) => {
    c.fillStyle = col; c.beginPath(); c.moveTo(0, GROUND);
    for (let x = 0; x <= W; x += 20) c.lineTo(x, base - Math.abs(Math.sin(x * 0.012 + seed)) * amp - Math.sin(x * 0.04 + seed) * 12);
    c.lineTo(W, GROUND); c.fill();
  };
  mount('#4a2a6b', 330, 110, 1); mount('#2d1a4a', 370, 80, 3);
  // pagoda
  c.fillStyle = '#1b1030';
  const pag = (cx, by, s) => {
    for (let i = 0; i < 3; i++) {
      const w = (120 - i * 28) * s, y = by - i * 46 * s;
      c.fillRect(cx - w / 2 + 10 * s, y - 34 * s, w - 20 * s, 34 * s);
      c.beginPath(); c.moveTo(cx - w / 2 - 20 * s, y - 34 * s); c.lineTo(cx, y - 56 * s);
      c.lineTo(cx + w / 2 + 20 * s, y - 34 * s); c.lineTo(cx + w / 2, y - 28 * s); c.lineTo(cx - w / 2, y - 28 * s); c.fill();
    }
  };
  pag(170, GROUND - 40, 1.1); pag(800, GROUND - 40, 0.9);
  // público
  for (let row = 0; row < 3; row++) {
    for (let x = -10; x < W + 20; x += 26) {
      const y = GROUND - 22 + row * 9 + ((x * 7 + row * 13) % 5);
      c.fillStyle = ['#10081c', '#170c2a', '#1e1036'][row];
      c.beginPath(); c.arc(x + (row % 2) * 12, y, 11, 0, 7); c.fill();
      c.fillRect(x + (row % 2) * 12 - 11, y, 22, 20);
    }
  }
  // suelo
  const fl = c.createLinearGradient(0, GROUND, 0, H);
  fl.addColorStop(0, '#8a5a34'); fl.addColorStop(1, '#3d2414');
  c.fillStyle = fl; c.fillRect(0, GROUND, W, H - GROUND);
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const y = GROUND + 6 + i * i * 2.6 + i * 4;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }
  for (let x = -W; x < W * 2; x += 90) { c.beginPath(); c.moveTo(W / 2 + (x - W / 2) * 0.35, GROUND); c.lineTo(x, H); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(0, GROUND, W, 3);
}

function bigText(text, y, size, color) {
  ctx.save();
  ctx.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.lineWidth = size / 8; ctx.strokeStyle = '#000'; ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = color; ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function drawBar(x, w, f, flip) {
  const y = 24, h = 26;
  ctx.fillStyle = '#000'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = '#4a0f0f'; ctx.fillRect(x, y, w, h);
  const fw = w * Math.max(0, f.hpShow) / 100, hw = w * Math.max(0, f.hp) / 100;
  const col = f.hp > 50 ? '#3ddc5a' : f.hp > 25 ? '#ffc933' : '#ff4a3d';
  ctx.fillStyle = '#ffd23f';
  if (flip) ctx.fillRect(x + w - fw, y, fw, h); else ctx.fillRect(x, y, fw, h);
  ctx.fillStyle = col;
  if (flip) ctx.fillRect(x + w - hw, y, hw, h); else ctx.fillRect(x, y, hw, h);
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  if (flip) ctx.fillRect(x + w - hw, y, hw, h / 3); else ctx.fillRect(x, y, hw, h / 3);
  // energía
  const ey = y + h + 8, ew = w * f.energy / 100;
  ctx.fillStyle = '#000'; ctx.fillRect(x - 2, ey - 2, w * 0.6 + 4, 12);
  ctx.fillStyle = f.energy >= SPECIAL_COST ? '#4db8ff' : '#2a5c88';
  const full = w * 0.6, fillw = full * f.energy / 100;
  if (flip) ctx.fillRect(x + w - fillw, ey, fillw, 8); else ctx.fillRect(x, ey, fillw, 8);
  // nombre y victorias
  ctx.font = '900 18px "Arial Black", sans-serif'; ctx.fillStyle = '#fff';
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.fillText(f.name, flip ? x + w : x, ey + 34);
  for (let i = 0; i < 2; i++) {
    const cx = flip ? x + w - 110 - i * 22 : x + 110 + i * 22;
    ctx.fillStyle = i < f.wins ? '#ffd23f' : 'rgba(0,0,0,.5)';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, ey + 28, 7, 0, 7); ctx.fill(); ctx.stroke();
  }
}

function render() {
  if (!bg) buildBG();
  ctx.save();
  if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  ctx.drawImage(bg, 0, 0);

  // el que está más abajo en z (el que ataca) se dibuja encima
  const order = p1.state === 'attack' ? [p2, p1] : [p1, p2];
  order.forEach(f => f.draw());

  for (const p of projectiles) {
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r * 2);
    g.addColorStop(0, '#fff'); g.addColorStop(0.35, '#7cd6ff'); g.addColorStop(1, 'rgba(40,120,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(120,200,255,.35)';
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(p.x - p.vx * i * 1.8, p.y, p.r - i * 3, 0, 7); ctx.fill(); }
  }
  for (const b of bursts) {
    const k = 1 - b.life / 10, r = 14 + k * 26;
    ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.moveTo(b.x + Math.cos(a) * r * 0.5, b.y + Math.sin(a) * r * 0.5);
      ctx.lineTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
    }
    ctx.stroke();
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / 12); ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (phase !== 'menu') {
    drawBar(40, 380, p1, false);
    drawBar(540, 380, p2, true);
    // reloj
    ctx.fillStyle = '#000'; ctx.fillRect(W / 2 - 34, 16, 68, 50);
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.strokeRect(W / 2 - 34, 16, 68, 50);
    ctx.font = '900 34px "Arial Black", sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = timer <= 10 ? '#ff4a3d' : '#fff';
    ctx.fillText(String(Math.max(0, timer)).padStart(2, '0'), W / 2, 53);

    if (msg) {
      const pop = phase === 'intro' || phase === 'roundover' ? Math.min(1, (phaseT % 70 + 1) / 8) : 1;
      bigText(msg, 250, 70 + (1 - pop) * 40, phase === 'roundover' ? '#ff4a3d' : '#ffd23f');
      if (sub) bigText(sub, 310, 32, '#fff');
    }
  } else {
    // en el menú, los luchadores posan de fondo
    p1.draw(); p2.draw();
  }
}

function loop(now) {
  loop.acc = (loop.acc || 0) + Math.min(now - (loop.last || now), 100);
  loop.last = now;
  const step = 1000 / 60;
  while (loop.acc >= step) { update(); loop.acc -= step; }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
