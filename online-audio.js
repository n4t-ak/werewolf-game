/* MOONLIT VILLAGE — online-only music and SFX, no external audio assets.
   Does not read roles, player information, Firebase or game state.
   Browser audio starts only after clicking the existing sound button. */
(() => {
  'use strict';
  const button = document.getElementById('mv-sound-toggle');
  const root = document.getElementById('online-game');
  if (!button || !root) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    button.disabled = true;
    button.textContent = '♪ このブラウザは音声に非対応です';
    return;
  }

  const SCENES = {
    'online-menu-screen': 'lobby',
    'online-create-screen': 'lobby',
    'online-join-screen': 'lobby',
    'lobby-screen': 'lobby',
    'online-role-reveal': 'night',
    'online-night-screen': 'night',
    'online-day-screen': 'day',
    'online-discussion-screen': 'day',
    'online-vote-screen': 'vote',
    'online-vote-result-screen': 'result',
    'online-game-over-screen': 'victory'
  };
  const THEMES = {
    lobby:   { root: 164.81, intervals: [0, 3, 7, 10], speed: 3800, low: 0.040 },
    night:   { root: 110.00, intervals: [0, 1, 5, 7],  speed: 4600, low: 0.050 },
    day:     { root: 146.83, intervals: [0, 3, 7, 12], speed: 3300, low: 0.033 },
    vote:    { root: 123.47, intervals: [0, 1, 6, 7],  speed: 3000, low: 0.053 },
    result:  { root: 130.81, intervals: [0, 5, 7, 10], speed: 3900, low: 0.030 },
    victory: { root: 174.61, intervals: [0, 4, 7, 12], speed: 4400, low: 0.044 }
  };

  let ctx = null, master = null, enabled = false, scene = 'lobby';
  let drone = [], ambience = null, melodyTimer = null, noteIndex = 0;
  let lastScene = null, lastActionSound = 0;
  const musicGain = 0.42;

  function audio() {
    if (!ctx) {
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = 0.62;
      master.connect(ctx.destination);
    }
    return ctx;
  }
  function tone(freq, duration = 0.25, volume = 0.11, type = 'sine', delay = 0) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), start + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
  }
  function stopMusic() {
    if (melodyTimer !== null) { clearInterval(melodyTimer); melodyTimer = null; }
    if (ctx && ambience) {
      const now = ctx.currentTime;
      ambience.gain.cancelScheduledValues(now);
      ambience.gain.setTargetAtTime(0.0001, now, 0.18);
    }
    const old = drone;
    drone = [];
    for (const oscillator of old) {
      try { oscillator.stop(ctx.currentTime + 0.9); } catch (_) {}
    }
    ambience = null;
  }
  function startMusic(nextScene) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    stopMusic();
    scene = nextScene;
    noteIndex = 0;
    const theme = THEMES[scene] || THEMES.lobby;
    ambience = ctx.createGain();
    ambience.gain.value = 0.0001;
    ambience.connect(master);
    ambience.gain.setTargetAtTime(theme.low * musicGain, ctx.currentTime, 0.75);
    for (const ratio of [0.5, 1, Math.pow(2, 7 / 12)]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = ratio === 0.5 ? 'sine' : 'triangle';
      oscillator.frequency.value = theme.root * ratio;
      oscillator.connect(ambience);
      oscillator.start();
      drone.push(oscillator);
    }
    const melody = () => {
      if (!enabled || ctx.state !== 'running' || document.hidden) return;
      const interval = theme.intervals[noteIndex % theme.intervals.length];
      const octave = noteIndex % 8 >= 4 ? 2 : 1;
      const frequency = theme.root * octave * Math.pow(2, interval / 12);
      tone(frequency, 1.8, 0.032 * musicGain, 'sine');
      noteIndex++;
    };
    melody();
    melodyTimer = setInterval(melody, theme.speed);
  }
  function detectScene() {
    for (const [id, value] of Object.entries(SCENES)) {
      const el = document.getElementById(id);
      if (el && !el.hidden && !(el.closest('[hidden]') && el.closest('[hidden]') !== el)) {
        // The lobby entry contains nested screens; the lobby entry itself is omitted here.
        return value;
      }
    }
    return 'lobby';
  }
  // Game phase screens always take precedence over the entry menu screens.
  function currentScene() {
    for (const id of ['online-game-over-screen','online-vote-result-screen','online-vote-screen',
      'online-discussion-screen','online-day-screen','online-night-screen','online-role-reveal','lobby-screen']) {
      const el = document.getElementById(id);
      if (el && !el.hidden) return SCENES[id];
    }
    return detectScene();
  }
  function effect(type) {
    if (!enabled) return;
    switch (type) {
      case 'select': tone(440, 0.10, 0.045, 'sine'); tone(660, 0.13, 0.026, 'sine', 0.06); break;
      case 'confirm': tone(392, 0.18, 0.05); tone(523.25, 0.25, 0.05, 'sine', 0.11); break;
      case 'vote': tone(196, 0.32, 0.065, 'triangle'); tone(155.56, 0.44, 0.040, 'sine', 0.12); break;
      case 'night': tone(164.81, 0.75, 0.06, 'sine'); tone(123.47, 0.95, 0.03, 'sine', 0.14); break;
      case 'day': tone(392, 0.30, 0.04); tone(523.25, 0.4, 0.045, 'sine', 0.16); break;
      case 'victory': [261.63,329.63,392,523.25].forEach((f,i)=>tone(f,0.65,0.060,'sine',i*0.16)); break;
    }
  }
  function updateScene() {
    const next = currentScene();
    if (next === lastScene) return;
    const previous = lastScene;
    lastScene = next;
    if (!enabled) return;
    startMusic(next);
    if (previous === null) return;
    if (next === 'night') effect('night');
    else if (next === 'day' || next === 'result') effect('day');
    else if (next === 'victory') effect('victory');
    else if (next === 'vote') effect('vote');
  }
  function updateButton() {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? '♪ 音楽・効果音：オン' : '♪ 音楽・効果音：オフ';
  }
  button.addEventListener('click', async () => {
    if (enabled) {
      enabled = false;
      stopMusic();
      if (ctx) await ctx.suspend().catch(() => {});
    } else {
      try {
        await audio().resume();
        enabled = true;
        lastScene = null;
        updateScene();
        effect('confirm');
      } catch (error) {
        console.warn('音声を開始できませんでした', error);
        enabled = false;
      }
    }
    updateButton();
  });
  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || !enabled || target.disabled) return;
    const now = Date.now();
    if (now - lastActionSound < 90) return;
    lastActionSound = now;
    if (target.matches('#online-submit-vote')) effect('vote');
    else if (target.matches('#online-submit-night,#online-night-submit,#online-submit-action')) effect('confirm');
    else if (target.matches('.mv-target-card')) effect('select');
    else if (target.matches('#online-chat-send,#wolf-chat-send')) effect('confirm');
    else effect('select');
  }, true);
  const observer = new MutationObserver(() => updateScene());
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => {
    if (!enabled || !ctx) return;
    if (document.hidden) {
      stopMusic();
    } else {
      ctx.resume().then(() => startMusic(currentScene())).catch(() => {});
    }
  });
  window.addEventListener('pagehide', () => { stopMusic(); if (ctx) ctx.close().catch(() => {}); });
  updateButton();
  updateScene();
})();
