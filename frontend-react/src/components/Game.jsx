import { useEffect, useRef, useState } from 'react';
import Leaderboard from './Leaderboard.jsx';

// This component ports the original game's canvas engine (physics, procedural
// platforms, rendering, input, HUD) essentially line-for-line into a single
// effect that runs once on mount. It still reads/writes the DOM via
// document.getElementById for the HUD text/overlays exactly like the
// original script did — those elements are rendered by the JSX below with
// the same ids, so the behavior is unchanged. The only real differences are:
//   1. bestHeightSaved is seeded from the `user` prop (already known at
//      mount, since Game only renders once auth resolves) instead of an
//      'ascent:authready' window event.
//   2. Score syncing calls the onSubmitScore/onReportProgress props (backed
//      by AuthContext) instead of a global window.AscentAuth.
//   3. Everything is wrapped with proper cleanup for React's lifecycle
//      (removes listeners, cancels the animation frame) since effects can
//      re-run, unlike a plain <script> tag.
export default function Game({ user, onLogout, onSubmitScore, onReportProgress }) {
  const canvasWrapRef = useRef(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // ---------- Canvas & scaling ----------
    const canvas = document.getElementById('game');
    const gameArea = document.getElementById('gameArea');
    const ctx = canvas.getContext('2d');
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0, cssH = 0, GAME_WIDTH = 400, pxPerUnit = 1, viewH = 600;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = gameArea.getBoundingClientRect();
      cssW = rect.width;
      cssH = rect.height;
      GAME_WIDTH = Math.max(300, Math.min(cssW, 480));
      pxPerUnit = cssW / GAME_WIDTH;
      viewH = cssH / pxPerUnit;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      ctx.setTransform(dpr * pxPerUnit, 0, 0, dpr * pxPerUnit, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();
    let resizeObserver = null;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(gameArea);
    }

    // ---------- Audio (simple synth beeps) ----------
    let audioCtx = null, muted = false;
    function ensureAudio() {
      if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio support */ }
      }
    }
    function beep(freq, dur, type, vol) {
      if (muted || !audioCtx) return;
      try {
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime((vol || 0.12), t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + dur);
      } catch (e) { /* ignore audio failures */ }
    }
    function swoosh(power) {
      if (muted || !audioCtx) return;
      try {
        const t0 = audioCtx.currentTime;
        const dur = 0.17;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        const f0 = 240 + power * 260;
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(90, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(0.05 + power * 0.15, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + dur);
      } catch (e) { /* ignore audio failures */ }
    }
    const muteBtn = document.getElementById('muteBtn');
    function onMuteClick() {
      muted = !muted;
      muteBtn.textContent = muted ? '🔇' : '🔊';
    }
    muteBtn.addEventListener('click', onMuteClick);

    // ---------- Persistent best score ----------
    // localStorage is used as an instant/offline fallback; the server (via
    // onSubmitScore/onReportProgress, backed by AuthContext) is the source
    // of truth once the player is logged in.
    let bestHeightSaved = 0;
    try {
      const raw = localStorage.getItem('bestHeight');
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v.best === 'number') bestHeightSaved = v.best;
      }
    } catch (e) { /* storage unavailable (e.g. private browsing) — just skip persistence */ }

    // Trust the server's stored high score if it's ahead of this browser's
    // localStorage (e.g. the player has played on another device). `user` is
    // already resolved by the time Game mounts, so this replaces the old
    // 'ascent:authready' event listener.
    if (user && typeof user.highScore === 'number' && user.highScore > bestHeightSaved) {
      bestHeightSaved = user.highScore;
    }
    document.getElementById('bestNum').textContent = Math.round(bestHeightSaved) + 'm';

    function saveBest(val) {
      try { localStorage.setItem('bestHeight', JSON.stringify({ best: val })); } catch (e) { /* ignore */ }
    }

    // Called any time the player reaches a new personal-best altitude —
    // whether or not they go on to finish the whole climb. Updates the local
    // display immediately and pings the server so the account's high score
    // stays current even on runs that end without a full win.
    function recordPotentialNewBest(m) {
      if (m <= bestHeightSaved) return;
      bestHeightSaved = m;
      saveBest(bestHeightSaved);
      document.getElementById('bestNum').textContent = bestHeightSaved + 'm';
      if (typeof onReportProgress === 'function') {
        onReportProgress(m).catch(() => { /* offline — local save still stands */ });
      }
    }

    // ---------- Constants ----------
    const GRAVITY = 2600;
    const RESTITUTION = 0.76;
    const WALL_RESTITUTION = 0.84;
    const FRICTION_TANGENT = 0.9;
    const REST_TIME_NEEDED = 0.12;
    const BALL_RADIUS = 13;
    const MAX_PULL = 140;
    const MAX_LAUNCH_SPEED = 1650;
    const POWER = MAX_LAUNCH_SPEED / MAX_PULL;
    const TOTAL_HEIGHT = 6000;
    const PIX_PER_METER = 12; // for the on-screen "m" readout

    // ---------- Game state ----------
    let ball, platforms, checkpoint, cameraTop, cameraTargetInit;
    let dragging = false, dragStart = { x: 0, y: 0 }, dragCurrent = { x: 0, y: 0 };
    let bestY = 0; // most negative y reached (best altitude)
    let bounces = 0;
    let won = false;
    let shakeTime = 0, shakeMag = 0;
    let flashTime = 0;
    let trail = [];
    let stars = [];
    let started = false;
    let lastTime = null;

    // ---------- Admin-only trajectory debug tools ----------
    // `user` is already resolved by the time Game mounts, so this can be
    // read directly instead of listening for an auth-ready event.
    const isAdmin = !!(user && user.role === 'admin');
    let showTrajectory = false;
    let adminTrail = []; // full actual flight path since the last launch (admin-only)
    const trajectoryBtn = document.getElementById('trajectoryBtn');
    if (trajectoryBtn) trajectoryBtn.classList.toggle('hidden', !isAdmin);

    function metersOf(worldYNegated) { return Math.max(0, Math.round(worldYNegated / PIX_PER_METER)); }

    // On phones, keep the ball resting a quarter of the way up the screen
    // (instead of hugging the very bottom) so it's easy to see and grab.
    function floorMargin() {
      return cssW < 700 ? viewH * 0.25 : 90;
    }

    function makeStars() {
      stars = [];
      for (let i = 0; i < 140; i++) {
        stars.push({
          x: Math.random() * GAME_WIDTH,
          y: -Math.random() * TOTAL_HEIGHT * 1.15,
          r: Math.random() * 1.6 + 0.4,
          tw: Math.random() * Math.PI * 2,
        });
      }
    }

    function resetGame() {
      ball = {
        x: GAME_WIDTH / 2, y: -BALL_RADIUS, vx: 0, vy: 0, isResting: true, restTimer: 99, standingOn: null,
        squashAmt: 1, squashVel: 0, squashAngle: 0, rollAngle: 0,
      };
      platforms = [];
      // ground platform
      platforms.push({ x: 0, y: 0, w: GAME_WIDTH, h: 40, type: 'ground' });
      genState.highestGeneratedY = 0;
      genState.lastCenterX = GAME_WIDTH / 2;
      checkpoint = { x: ball.x, y: ball.y };
      bestY = ball.y;
      bounces = 0;
      won = false;
      trail = [];
      adminTrail = [];
      cameraTop = -(viewH - floorMargin());
      cameraTargetInit = cameraTop;
      makeStars();
      while (genState.highestGeneratedY > cameraTop - 500) generateNextBand();
      updateHud(true);
      document.getElementById('winOverlay').classList.add('hidden');
    }

    // ---------- Procedural generation ----------
    const genState = { highestGeneratedY: 0, lastCenterX: 0 };
    function lerp(a, b, t) { return a + (b - a) * t; }
    function rand(a, b) { return a + Math.random() * (b - a); }

    // Simple, two-rule horizontal placement (deliberately not physics-derived —
    // easier to reason about and to guarantee never leaves a gap or overlap
    // problem, at the cost of not adapting to the vertical gap size):
    //   1. Max horizontal distance from the previous platform's center is
    //      capped at the new platform's own length (width) — keeps platforms
    //      from drifting arbitrarily far apart sideways.
    //   2. That distance must also be at least one ball-diameter — excludes
    //      landing (almost) directly above the previous platform, which is
    //      exactly what causes the ball to clip the new platform's underside
    //      on a near-vertical launch and bounce back down instead of landing
    //      on top of it.
    // Together: never too far apart, and always leaves room to actually jump.
    function chooseNextCenterX(prevCenterX, newWidth) {
      const BALL_DIAMETER = BALL_RADIUS * 2;
      const maxDist = newWidth;
      const minDist = BALL_DIAMETER;

      const halfW = newWidth / 2;
      const lo = 14 + halfW;
      const hi = GAME_WIDTH - 14 - halfW;

      // valid offsets are [-maxDist,-minDist] ∪ [minDist,maxDist] from
      // prevCenterX, each further clamped to stay on-screen
      const ranges = [];
      const rLo = Math.max(prevCenterX + minDist, lo);
      const rHi = Math.min(prevCenterX + maxDist, hi);
      if (rLo <= rHi) ranges.push([rLo, rHi]);
      const lLo = Math.max(prevCenterX - maxDist, lo);
      const lHi = Math.min(prevCenterX - minDist, hi);
      if (lLo <= lHi) ranges.push([lLo, lHi]);

      if (ranges.length === 0) {
        // Only possible on a screen too narrow for even one ball-diameter of
        // offset — fall back to just respecting the max-distance cap so a
        // placement always exists.
        const lo2 = Math.max(prevCenterX - maxDist, lo);
        const hi2 = Math.min(prevCenterX + maxDist, hi);
        if (lo2 <= hi2) return rand(lo2, hi2);
        return (lo + hi) / 2; // last-resort fallback for a degenerate ultra-narrow screen
      }

      const total = ranges.reduce((sum, r) => sum + (r[1] - r[0]), 0);
      let roll = Math.random() * total;
      let chosen = ranges[ranges.length - 1];
      for (const r of ranges) {
        const w = r[1] - r[0];
        if (roll <= w) { chosen = r; break; }
        roll -= w;
      }
      return rand(chosen[0], chosen[1]);
    }

    function generateNextBand() {
      const altitude = -genState.highestGeneratedY;
      const t = Math.min(1, Math.max(0, altitude / TOTAL_HEIGHT));
      const gap = lerp(78, 148, t) + rand(-10, 10);
      const newY = genState.highestGeneratedY - gap;
      let width = lerp(132, 58, t) + rand(-8, 8);
      width = Math.max(42, width);

      const centerX = chooseNextCenterX(genState.lastCenterX, width);
      const x = centerX - width / 2;

      let type = 'normal';
      const hazardChance = t > 0.42 ? lerp(0, 0.22, (t - 0.42) / 0.58) : 0;
      const movingChance = t > 0.2 ? lerp(0, 0.32, (t - 0.2) / 0.8) : 0;
      const roll = Math.random();
      if (roll < hazardChance) type = 'hazard';
      else if (roll < hazardChance + movingChance) type = 'moving';

      const plat = { x, y: newY, w: width, h: 16, type };
      if (type === 'moving') {
        plat.vx = (Math.random() < 0.5 ? -1 : 1) * lerp(35, 95, t);
        plat.minX = Math.max(8, x - 70);
        plat.maxX = Math.min(GAME_WIDTH - width - 8, x + 70);
        if (plat.maxX < plat.minX) plat.maxX = plat.minX;
      }
      platforms.push(plat);
      genState.highestGeneratedY = newY;
      genState.lastCenterX = centerX;
    }

    function maybeGenerateMore() {
      while (genState.highestGeneratedY > cameraTop - 500) generateNextBand();
      // trim far-below platforms
      if (platforms.length > 5) {
        const cutoff = ball.y + viewH * 2.2;
        platforms = platforms.filter(p => p.type === 'ground' || p.y < cutoff);
      }
    }

    // ---------- Input ----------
    function screenToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const lx = (clientX - rect.left) / pxPerUnit;
      const ly = (clientY - rect.top) / pxPerUnit + cameraTop;
      return { x: lx, y: ly };
    }

    function onPointerDown(e) {
      ensureAudio();
      if (!started || won) return;
      if (!ball.isResting) return;
      const p = screenToWorld(e.clientX, e.clientY);
      dragging = true;
      dragStart = p;
      dragCurrent = p;
      canvas.classList.add('dragging');
      document.getElementById('introOverlay').classList.add('hidden');
    }
    function onPointerMove(e) {
      if (!dragging) return;
      dragCurrent = screenToWorld(e.clientX, e.clientY);
    }
    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('dragging');
      let dx = dragCurrent.x - dragStart.x;
      let dy = dragCurrent.y - dragStart.y;
      let len = Math.hypot(dx, dy);
      if (len < 8) return; // treat as tap, no launch
      if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; len = MAX_PULL; }
      const lvx = -dx * POWER;
      const lvy = -dy * POWER;
      ball.vx = lvx; ball.vy = lvy;
      ball.isResting = false;
      ball.restTimer = 0;
      ball.standingOn = null;
      if (isAdmin) adminTrail = [{ x: ball.x, y: ball.y }];
      swoosh(len / MAX_PULL);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const startBtn = document.getElementById('startBtn');
    function onStartClick() {
      ensureAudio();
      started = true;
      document.getElementById('introOverlay').classList.add('hidden');
    }
    startBtn.addEventListener('click', onStartClick);

    const playAgainBtn = document.getElementById('playAgainBtn');
    function onPlayAgainClick() {
      resetGame();
      document.getElementById('winOverlay').classList.add('hidden');
    }
    playAgainBtn.addEventListener('click', onPlayAgainClick);

    const restartBtn = document.getElementById('restartBtn');
    function onRestartClick() {
      resetGame();
    }
    restartBtn.addEventListener('click', onRestartClick);

    const leaderboardBtn = document.getElementById('leaderboardBtn');
    function onLeaderboardClick() {
      setShowLeaderboard(true);
    }
    leaderboardBtn.addEventListener('click', onLeaderboardClick);

    function onTrajectoryClick() {
      showTrajectory = !showTrajectory;
      trajectoryBtn.textContent = 'Trajectory: ' + (showTrajectory ? 'On' : 'Off');
      if (!showTrajectory) adminTrail = [];
    }
    if (trajectoryBtn) trajectoryBtn.addEventListener('click', onTrajectoryClick);

    // ---------- Physics ----------
    function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
      const closestX = Math.max(rx, Math.min(cx, rx + rw));
      const closestY = Math.max(ry, Math.min(cy, ry + rh));
      const dx = cx - closestX, dy = cy - closestY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= r * r) return null;
      const dist = Math.sqrt(distSq);
      let nx, ny;
      if (dist === 0) {
        // center inside rect: push out along smallest axis
        const left = cx - rx, right = (rx + rw) - cx;
        const top = cy - ry, bottom = (ry + rh) - cy;
        const m = Math.min(left, right, top, bottom);
        if (m === top) { nx = 0; ny = -1; } else if (m === bottom) { nx = 0; ny = 1; }
        else if (m === left) { nx = -1; ny = 0; } else { nx = 1; ny = 0; }
        return { nx, ny, pen: r };
      }
      nx = dx / dist; ny = dy / dist;
      return { nx, ny, pen: r - dist };
    }

    // Kept intact and fully working, but nothing calls it automatically
    // anymore (see the hazard/fall-off handling in physicsStep below). This
    // is here so a future "watch an ad to respawn at your checkpoint"
    // feature can just call this directly without rebuilding the reset logic.
    function respawnAtCheckpoint(hazard) {
      ball.x = checkpoint.x; ball.y = checkpoint.y;
      ball.vx = 0; ball.vy = 0;
      ball.isResting = true; ball.restTimer = 99; ball.standingOn = null;
      ball.squashAmt = 1; ball.squashVel = 0;
      if (hazard) {
        flashTime = 0.16;
        shakeTime = 0.25; shakeMag = 10;
        beep(140, 0.22, 'sawtooth', 0.15);
      }
    }

    function updateSquashSpring(dt) {
      // spring-driven jelly wobble: snaps flat on impact, springs back with a little overshoot
      const k = 210, d = 10;
      const accel = -k * (ball.squashAmt - 1) - d * ball.squashVel;
      ball.squashVel += accel * dt;
      ball.squashAmt += ball.squashVel * dt;
    }

    function physicsStep(dt) {
      if (won) return;
      if (dragging || ball.isResting) {
        return;
      }

      ball.vy += GRAVITY * dt;
      ball.vx *= 0.9997;
      ball.vy *= 0.9997;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (isAdmin && showTrajectory) {
        adminTrail.push({ x: ball.x, y: ball.y });
        if (adminTrail.length > 4000) adminTrail.shift(); // safety cap, not expected to matter in practice
      }

      let frameStanding = null;
      let hadContact = false;

      // walls
      if (ball.x - BALL_RADIUS < 0) {
        ball.x = BALL_RADIUS;
        ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
        hadContact = true;
        if (Math.abs(ball.vx) > 60) beep(220, 0.05, 'sine', 0.05);
      } else if (ball.x + BALL_RADIUS > GAME_WIDTH) {
        ball.x = GAME_WIDTH - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
        hadContact = true;
        if (Math.abs(ball.vx) > 60) beep(220, 0.05, 'sine', 0.05);
      }

      // platforms
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (p.y > ball.y + 200 || p.y < ball.y - 400) continue; // quick cull
        const col = circleRectCollision(ball.x, ball.y, BALL_RADIUS, p.x, p.y, p.w, p.h);
        if (!col) continue;

        ball.x += col.nx * col.pen;
        ball.y += col.ny * col.pen;

        const vn = ball.vx * col.nx + ball.vy * col.ny;
        if (vn < 0) {
          let vtx = ball.vx - vn * col.nx;
          let vty = ball.vy - vn * col.ny;
          vtx *= FRICTION_TANGENT; vty *= FRICTION_TANGENT;
          const nvn = -vn * RESTITUTION;
          ball.vx = vtx + nvn * col.nx;
          ball.vy = vty + nvn * col.ny;

          if (Math.abs(vn) > 90) {
            if (p.type === 'hazard') {
              // No more free reset to checkpoint — a hazard now just hurts
              // (flash/shake/buzz) and bounces you like a rough platform.
              // You keep whatever position/momentum you land with.
              flashTime = 0.16;
              shakeTime = 0.25; shakeMag = 10;
              beep(140, 0.22, 'sawtooth', 0.15);
            } else {
              bounces++;
              const impact = Math.min(1, Math.abs(vn) / 2400);
              ball.squashAmt = Math.max(0.42, 1 - impact * 0.62);
              ball.squashVel = 0;
              ball.squashAngle = Math.atan2(col.ny, col.nx);
              const f = 210 + Math.min(300, Math.abs(vn) / 5);
              beep(f, 0.08, 'triangle', Math.min(0.2, 0.05 + impact * 0.16));
            }
          }
        }
        hadContact = true;
        // Hazards are dangerous ground, never a safe place to "stand" —
        // they can't become your checkpoint or stop a fall into resting.
        if (col.ny < -0.55 && p.type !== 'hazard') frameStanding = p;
      }

      // moving platform carry
      if (frameStanding && frameStanding.type === 'moving') {
        ball.x += frameStanding.vx * dt;
      }

      // rest / rolling detection: once vertical motion has settled, let the ball
      // roll and lose horizontal speed gradually instead of stopping instantly
      if (hadContact && frameStanding && Math.abs(ball.vy) < 150) {
        ball.standingOn = frameStanding;
        ball.rollAngle += (ball.vx * dt) / BALL_RADIUS;
        ball.vx *= Math.pow(0.02, dt);

        if (Math.abs(ball.vx) < 14) {
          ball.restTimer += dt;
        } else {
          ball.restTimer = 0;
        }

        if (ball.restTimer >= REST_TIME_NEEDED) {
          const wasResting = ball.isResting;
          ball.isResting = true;
          ball.vx = 0; ball.vy = 0;
          if (!wasResting) beep(150, 0.09, 'sine', 0.07);
          if (ball.y < checkpoint.y) {
            checkpoint = { x: ball.x, y: ball.y };
            beep(660, 0.07, 'sine', 0.08);
            setTimeout(() => beep(880, 0.09, 'sine', 0.08), 70);
            recordPotentialNewBest(metersOf(-checkpoint.y));
          }
        }
      } else {
        ball.restTimer = 0;
      }

      if (ball.y < bestY) bestY = ball.y;

      // Hard floor — without the old "fell off screen" respawn, a long fall
      // needs a guaranteed backstop so the ball can never tunnel through the
      // thin ground platform in one big step at high fall speed. This isn't
      // a checkpoint respawn: it's just the bottom of the world. Landing
      // here means the whole run's progress above the ground is lost — you
      // start climbing again from scratch, which is the point.
      const floorY = -BALL_RADIUS;
      if (ball.y > floorY) {
        ball.y = floorY;
        ball.x = Math.min(GAME_WIDTH - BALL_RADIUS, Math.max(BALL_RADIUS, ball.x));
        ball.vx = 0; ball.vy = 0;
        ball.isResting = true; ball.restTimer = 99; ball.standingOn = null;
        ball.squashAmt = 1; ball.squashVel = 0;
      }

      // win check
      if (-ball.y >= TOTAL_HEIGHT) {
        won = true;
        ball.vx = 0; ball.vy = 0;
        onWin();
      }
    }

    function onWin() {
      const m = metersOf(-bestY);
      recordPotentialNewBest(m);
      document.getElementById('bestNum').textContent = bestHeightSaved + 'm';
      document.getElementById('winStats').textContent = 'Height reached: ' + m + 'm · Bounces: ' + bounces;
      document.getElementById('winOverlay').classList.remove('hidden');
      beep(523, 0.14, 'triangle', 0.15);
      setTimeout(() => beep(659, 0.16, 'triangle', 0.15), 120);
      setTimeout(() => beep(784, 0.22, 'triangle', 0.16), 260);

      // Report the completed run (with bounce count) so gamesPlayed/totalBounces
      // reflect an actual finish, not just a progress checkpoint.
      if (typeof onSubmitScore === 'function') {
        onSubmitScore(m, bounces).then((result) => {
          if (result && typeof result.highScore === 'number' && result.highScore > bestHeightSaved) {
            bestHeightSaved = result.highScore;
            saveBest(bestHeightSaved);
            document.getElementById('bestNum').textContent = bestHeightSaved + 'm';
            updateHud();
          }
        }).catch(() => { /* offline or server unavailable — local save still stands */ });
      }
    }

    // moving platforms update (independent of ball physics timing quirks)
    function updatePlatforms(dt) {
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (p.type !== 'moving') continue;
        p.x += p.vx * dt;
        if (p.x < p.minX) { p.x = p.minX; p.vx = Math.abs(p.vx); }
        if (p.x > p.maxX) { p.x = p.maxX; p.vx = -Math.abs(p.vx); }
      }
    }

    // ---------- Camera ----------
    function updateCamera(dt) {
      if (dragging) return;
      const target = ball.y - viewH * 0.62;
      const nt = Math.min(target, cameraTargetInit);
      cameraTop += (nt - cameraTop) * Math.min(1, dt * 3.4);
    }

    // ---------- HUD ----------
    function updateHud() {
      const liveM = metersOf(-ball.y);
      document.getElementById('liveNum').textContent = liveM + 'm';
      const currentM = metersOf(-checkpoint.y);
      document.getElementById('heightNum').textContent = currentM + 'm';
      document.getElementById('bounceCounter').textContent = 'Bounces: ' + bounces;
      const pct = Math.min(1, Math.max(0, (-bestY) / TOTAL_HEIGHT));
      document.getElementById('progressFill').style.height = (pct * 100) + '%';
      const bestPct = Math.min(1, bestHeightSaved * PIX_PER_METER / TOTAL_HEIGHT);
      document.getElementById('progressBest').style.bottom = (bestPct * 100) + '%';
    }

    // ---------- Rendering ----------
    function colorLerp(c1, c2, t) {
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    const PAL_A = [27, 16, 35];    // cave bottom
    const PAL_B = [46, 58, 107];   // dusk mid
    const PAL_C = [111, 177, 214]; // sky
    const PAL_D = [234, 246, 255]; // bright top

    function bgColorsForProgress(t) {
      // t 0..1 overall climb progress (based on camera)
      if (t < 0.45) {
        return [colorLerp(PAL_A, PAL_B, t / 0.45), colorLerp(PAL_A, PAL_B, Math.min(1, t / 0.45 + 0.18))];
      } else if (t < 0.8) {
        const tt = (t - 0.45) / 0.35;
        return [colorLerp(PAL_B, PAL_C, tt), colorLerp(PAL_B, PAL_C, Math.min(1, tt + 0.18))];
      } else {
        const tt = (t - 0.8) / 0.2;
        return [colorLerp(PAL_C, PAL_D, tt), colorLerp(PAL_C, PAL_D, Math.min(1, tt + 0.15))];
      }
    }

    function draw() {
      ctx.clearRect(0, 0, GAME_WIDTH, viewH);

      let shakeX = 0, shakeY = 0;
      if (shakeTime > 0) {
        shakeX = (Math.random() - 0.5) * shakeMag;
        shakeY = (Math.random() - 0.5) * shakeMag;
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);

      const progress = Math.min(1, Math.max(0, (-cameraTop) / TOTAL_HEIGHT));
      const [ctop, cbot] = bgColorsForProgress(progress);
      const grad = ctx.createLinearGradient(0, 0, 0, viewH);
      grad.addColorStop(0, ctop);
      grad.addColorStop(1, cbot);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, GAME_WIDTH, viewH);

      // stars (fade in with progress)
      if (progress > 0.15) {
        ctx.globalAlpha = Math.min(1, (progress - 0.15) / 0.5);
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          const sy = s.y - cameraTop;
          if (sy < -10 || sy > viewH + 10) continue;
          const tw = 0.5 + 0.5 * Math.sin(performance.now() / 600 + s.tw);
          ctx.globalAlpha = Math.min(1, (progress - 0.15) / 0.5) * (0.4 + 0.6 * tw);
          ctx.beginPath();
          ctx.arc(s.x, sy, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // trail
      for (let i = 0; i < trail.length; i++) {
        const t = trail[i];
        const sy = t.y - cameraTop;
        const a = (i / trail.length) * 0.35;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ff9d7a';
        ctx.beginPath();
        ctx.arc(t.x, sy, BALL_RADIUS * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // platforms
      for (const p of platforms) {
        const sy = p.y - cameraTop;
        if (sy < -60 || sy > viewH + 60) continue;
        drawPlatform(p, sy);
      }

      // goal flag
      const goalWorldY = -TOTAL_HEIGHT;
      const goalSy = goalWorldY - cameraTop;
      if (goalSy > -80 && goalSy < viewH + 80) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, goalSy); ctx.lineTo(GAME_WIDTH, goalSy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd166';
        ctx.font = '700 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🚩 TOP', GAME_WIDTH / 2, goalSy - 8);
        ctx.restore();
      }

      // drag elastic
      if (dragging) {
        let dx = dragCurrent.x - dragStart.x, dy = dragCurrent.y - dragStart.y;
        let len = Math.hypot(dx, dy);
        if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; len = MAX_PULL; }
        const bsy = ball.y - cameraTop;
        const pt = len / MAX_PULL;
        const lineColor = colorLerp([120, 220, 140], [255, 90, 90], pt);

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ball.x, bsy);
        ctx.lineTo(ball.x + dx, bsy + dy);
        ctx.stroke();
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(ball.x + dx, bsy + dy, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---------- Admin-only trajectory debug overlay ----------
      if (isAdmin && showTrajectory) {
        if (dragging) {
          drawPredictedTrajectory();
        }
        if (adminTrail.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,0,255,0.65)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          adminTrail.forEach((p, i) => {
            const sy = p.y - cameraTop;
            if (i === 0) ctx.moveTo(p.x, sy); else ctx.lineTo(p.x, sy);
          });
          ctx.stroke();
          ctx.restore();
        }
      }

      // ball
      drawBall();

      ctx.restore();
    }

    // Simulates the flight path the ball WOULD take if launched with the
    // current drag vector right now — pure ballistics, no collisions — so an
    // admin can see exactly where a shot is aimed before committing to it.
    // Uses the same integration as physicsStep for an accurate preview.
    function drawPredictedTrajectory() {
      let dx = dragCurrent.x - dragStart.x, dy = dragCurrent.y - dragStart.y;
      let len = Math.hypot(dx, dy);
      if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
      let vx = -dx * POWER, vy = -dy * POWER;
      let px = ball.x, py = ball.y;
      const stepDt = 1 / 60;
      const bottomCutoff = cameraTop + viewH + 300;

      ctx.save();
      ctx.strokeStyle = 'rgba(0,230,255,0.9)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py - cameraTop);
      for (let i = 0; i < 180; i++) { // up to 3 simulated seconds
        vy += GRAVITY * stepDt;
        vx *= 0.9997; vy *= 0.9997;
        px += vx * stepDt; py += vy * stepDt;
        ctx.lineTo(px, py - cameraTop);
        if (py > bottomCutoff) break;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    function drawPlatform(p, sy) {
      if (p.type === 'ground') {
        const g = ctx.createLinearGradient(0, sy, 0, sy + p.h + 40);
        g.addColorStop(0, '#4a3a55');
        g.addColorStop(1, '#241629');
        ctx.fillStyle = g;
        ctx.fillRect(0, sy, GAME_WIDTH, p.h + 40);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, sy, GAME_WIDTH, 3);
        return;
      }
      let fill, stroke;
      if (p.type === 'moving') { fill = '#3f9c8a'; stroke = '#2c7566'; }
      else if (p.type === 'hazard') { fill = '#e63950'; stroke = '#a5233a'; }
      else { fill = '#7c8f78'; stroke = '#5c6b58'; }

      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      roundRect(p.x + 2, sy + 4, p.w, p.h, 5);
      ctx.fill();

      ctx.fillStyle = fill;
      roundRect(p.x, sy, p.w, p.h, 5);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      roundRect(p.x, sy, p.w, p.h, 5);
      ctx.stroke();

      if (p.type === 'hazard') {
        ctx.fillStyle = '#ffd7dc';
        const spikeCount = Math.max(2, Math.floor(p.w / 16));
        const sw = p.w / spikeCount;
        for (let i = 0; i < spikeCount; i++) {
          ctx.beginPath();
          ctx.moveTo(p.x + i * sw, sy);
          ctx.lineTo(p.x + i * sw + sw / 2, sy - 7);
          ctx.lineTo(p.x + (i + 1) * sw, sy);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (p.type === 'moving') {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '700 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.vx > 0 ? '▶' : '◀', p.x + p.w / 2, sy + p.h / 2 + 3);
      }
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawBall() {
      const sy = ball.y - cameraTop;

      // squashed/stretched along the last impact axis (or neutral in flight),
      // driven by a spring so it snaps flat then wobbles back like real rubber
      ctx.save();
      ctx.translate(ball.x, sy);
      ctx.rotate(ball.squashAngle);
      ctx.scale(ball.squashAmt, 1 / ball.squashAmt);

      const g = ctx.createRadialGradient(-BALL_RADIUS * 0.35, -BALL_RADIUS * 0.4, 2, 0, 0, BALL_RADIUS * 1.3);
      g.addColorStop(0, '#ffb199');
      g.addColorStop(0.5, '#ff5d5d');
      g.addColorStop(1, '#b23a3a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // a small mark that spins with the ball so rolling actually reads as rolling
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#8a2b2b';
      const mx = ball.x + Math.cos(ball.rollAngle) * BALL_RADIUS * 0.62;
      const my = sy + Math.sin(ball.rollAngle) * BALL_RADIUS * 0.62;
      ctx.beginPath();
      ctx.arc(mx, my, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (ball.isResting) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 260);
        ctx.strokeStyle = '#ffe9c7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ball.x, sy, BALL_RADIUS + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---------- Main loop ----------
    let rafId = null;
    function loop(ts) {
      if (cancelled) return;
      if (lastTime === null) lastTime = ts;
      let dt = (ts - lastTime) / 1000;
      lastTime = ts;
      dt = Math.min(dt, 0.032);

      if (started) {
        const sub = dt / 2;
        updatePlatforms(dt);
        physicsStep(sub);
        physicsStep(sub);
        updateSquashSpring(dt);
        updateCamera(dt);
        maybeGenerateMore();

        trail.push({ x: ball.x, y: ball.y });
        if (trail.length > 8) trail.shift();
        if (Math.hypot(ball.vx, ball.vy) < 80) trail = [];

        if (shakeTime > 0) shakeTime -= dt;
        if (flashTime > 0) {
          flashTime -= dt;
          document.getElementById('flash').style.opacity = Math.max(0, flashTime / 0.16 * 0.35);
        } else {
          document.getElementById('flash').style.opacity = 0;
        }
        updateHud();
      }

      draw();
      rafId = requestAnimationFrame(loop);
    }

    resetGame();
    rafId = requestAnimationFrame(loop);

    // ---------- Cleanup (React-specific — the original was a fire-and-forget script) ----------
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      if (resizeObserver) resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      muteBtn.removeEventListener('click', onMuteClick);
      startBtn.removeEventListener('click', onStartClick);
      playAgainBtn.removeEventListener('click', onPlayAgainClick);
      restartBtn.removeEventListener('click', onRestartClick);
      leaderboardBtn.removeEventListener('click', onLeaderboardClick);
      if (trajectoryBtn) trajectoryBtn.removeEventListener('click', onTrajectoryClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="gameArea" ref={canvasWrapRef}>
      <canvas id="game"></canvas>
      <div id="flash"></div>

      <div className="hud" id="heightReadout">
        <div className="num" id="liveNum">0m</div>
        <div className="lbl">CURRENT <span id="heightNum">0m</span></div>
        <div className="lbl">BEST <span id="bestNum">0m</span></div>
      </div>

      <div id="progressTrack">
        <div id="progressGoal">🚩</div>
        <div id="progressFill"></div>
        <div id="progressBest"></div>
      </div>

      <div className="btn" id="restartBtn" title="Restart">↺</div>
      <div className="btn" id="muteBtn" title="Mute">🔊</div>
      <div className="pillBtn" id="leaderboardBtn">Leaderboard</div>
      <div className="pillBtn hidden" id="trajectoryBtn">Trajectory: Off</div>

      <div className="hud" id="bounceCounter">Bounces: 0</div>

      <div className="hud" id="userBar">
        {user && (
          <>
            Playing as <strong style={{ color: 'var(--ink)' }}>{user.username}</strong>
            &nbsp;·&nbsp;
            <span id="logoutBtn" style={{ pointerEvents: 'auto', cursor: 'pointer', textDecoration: 'underline' }} onClick={onLogout}>
              Log out
            </span>
          </>
        )}
      </div>

      <div className="overlay" id="introOverlay">
        <div className="card">
          <h1>Ascent</h1>
          <p>Drag anywhere and let go to launch the ball. It bounces off walls and ledges and settles once it slows down — then you can launch again. Climb as high as you can. The higher you go, the trickier it gets.</p>
          <button className="primary" id="startBtn">Start climbing</button>
        </div>
      </div>

      <div className="overlay hidden" id="winOverlay">
        <div className="card">
          <h1>You reached the top! 🎉</h1>
          <div className="big" id="winStats"></div>
          <p>The shaft opens up into open sky. Nice climb.</p>
          <button className="primary" id="playAgainBtn">Climb again</button>
        </div>
      </div>

      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
    </div>
  );
}
