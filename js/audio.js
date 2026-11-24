/* Sound engine: everything is synthesized with the Web Audio API.
 *
 * Palette: soft bell / kalimba plucks on a D-flat major pentatonic scale
 * (Db Eb F Ab Bb). Each match lands with a small
 * wooden knock; matches that cross a line ring a brighter bell. At high speed
 * the individual notes blur into a shimmer over a slow pad, and revealing π
 * opens it into a chord.
 */
window.Sound = (function () {
  'use strict';

  var SCALE = [61, 63, 65, 68, 70]; // Db4 Eb4 F4 Ab4 Bb4
  var ctx = null;
  var bus = null;
  var master = null;
  var enabled = true;
  var noiseBuf = null;
  var noiseLong = null;
  var pad = null;
  var padStopTimer = 0;
  var texAcc = 0;
  var lastPadAutomation = 0;
  var holdPadUntil = 0;
  var MASTER = 0.8;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function noteAt(i) {
    i = Math.max(-5, Math.min(24, i));
    var octave = Math.floor(i / 5);
    return SCALE[((i % 5) + 5) % 5] + 12 * octave;
  }

  function impulse(seconds, decay) {
    var sr = ctx.sampleRate;
    var len = Math.floor(sr * seconds);
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function unlock() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }

      master = ctx.createGain();
      master.gain.value = enabled ? MASTER : 0;

      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;

      bus = ctx.createGain();
      bus.gain.value = 0.9;

      var dry = ctx.createGain();
      dry.gain.value = 0.85;
      var verb = ctx.createConvolver();
      verb.buffer = impulse(2.8, 3.2);
      var wet = ctx.createGain();
      wet.gain.value = 0.34;

      bus.connect(dry);
      dry.connect(comp);
      bus.connect(verb);
      verb.connect(wet);
      wet.connect(comp);
      comp.connect(master);
      master.connect(ctx.destination);

      var len = Math.floor(ctx.sampleRate * 0.06);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var nd = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
      var lenL = Math.floor(ctx.sampleRate * 0.5);
      noiseLong = ctx.createBuffer(1, lenL, ctx.sampleRate);
      var nl = noiseLong.getChannelData(0);
      for (var j = 0; j < lenL; j++) nl[j] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function ready() { return !!ctx && enabled; }

  function connectOut(node, pan) {
    if (pan && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      p.connect(bus);
    } else {
      node.connect(bus);
    }
  }

  // One bell-ish pluck: sine fundamental, a fast-fading octave, and a short
  // inharmonic "tine" partial for the attack.
  function voice(midi, t, gain, decay, bright, pan) {
    var f = mtof(midi);
    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    connectOut(env, pan);

    var o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    o1.connect(env);

    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    var g2 = ctx.createGain();
    g2.gain.setValueAtTime(bright, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + decay * 0.35);
    o2.connect(g2);
    g2.connect(env);

    var o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = f * 4.07;
    var g3 = ctx.createGain();
    g3.gain.setValueAtTime(bright * 0.55, t);
    g3.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o3.connect(g3);
    g3.connect(env);

    var end = t + decay + 0.05;
    o1.start(t); o2.start(t); o3.start(t);
    o1.stop(end); o2.stop(end); o3.stop(end);
  }

  // A small wooden knock: a resonant noise burst over a quick falling thump.
  function knock(t, gain) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 4;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(bp);
    bp.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + 0.06);

    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.06);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(gain * 1.4, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(og);
    og.connect(bus);
    o.start(t);
    o.stop(t + 0.1);
  }

  // A match landing. Every match knocks on the floor; one that ends up across
  // a line also rings a bell. Steeper matches sit higher on the scale.
  function land(cross, steep, pan, delay) {
    if (!ready()) return;
    var t = ctx.currentTime + 0.01 + (delay || 0);
    var i = Math.round(steep * 6);
    if (cross) {
      knock(t, 0.08);
      var m = noteAt(i + 4);
      voice(m, t, 0.2, 1.7, 0.45, pan);
      voice(m + 12, t + 0.016, 0.055, 1.2, 0.2, -pan);
    } else {
      knock(t, 0.065);
      voice(noteAt(i), t, 0.06, 0.45, 0.15, pan);
    }
  }

  // The scratch-and-flare of striking a match, used when a run starts.
  function strike() {
    if (!ready()) return;
    var t = ctx.currentTime + 0.01;
    var src = ctx.createBufferSource();
    src.buffer = noiseLong;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(bp);
    bp.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + 0.5);
  }

  function ensurePad() {
    if (pad) return;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    f.Q.value = 0.7;
    var g = ctx.createGain();
    g.gain.value = 0.0001;
    f.connect(g);
    g.connect(bus);
    var oscs = [];
    var notes = [49, 56, 61, 65, 68, 75]; // Db3 Ab3 Db4 F4 Ab4 Eb5
    for (var n = 0; n < notes.length; n++) {
      for (var d = -1; d <= 1; d += 2) {
        var o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(notes[n]);
        o.detune.value = d * 7;
        var og = ctx.createGain();
        og.gain.value = notes[n] < 60 ? 0.12 : 0.07;
        o.connect(og);
        og.connect(f);
        o.start();
        oscs.push(o);
      }
    }
    pad = { f: f, g: g, oscs: oscs };
  }

  function stopPadSoon() {
    clearTimeout(padStopTimer);
    padStopTimer = setTimeout(function () {
      if (!pad) return;
      var p = pad;
      pad = null;
      p.oscs.forEach(function (o) { try { o.stop(); } catch (e) { /* already stopped */ } });
      try { p.g.disconnect(); } catch (e) { /* ignore */ }
    }, 4500);
  }

  // Called every frame while the simulation runs too fast to voice each number.
  function texture(dt, intensity) {
    if (!ready()) return;
    ensurePad();
    clearTimeout(padStopTimer);
    var now = ctx.currentTime;
    if (now - lastPadAutomation > 0.2 && now > holdPadUntil) {
      lastPadAutomation = now;
      pad.g.gain.setTargetAtTime(0.02 + 0.055 * intensity, now, 0.5);
      pad.f.frequency.setTargetAtTime(450 + 2800 * intensity, now, 0.6);
    }
    texAcc += (5 + 13 * intensity) * dt;
    var guard = 0;
    while (texAcc >= 1 && guard++ < 4) {
      texAcc -= 1;
      var i = 5 + Math.floor(Math.random() * (6 + 6 * intensity));
      voice(noteAt(i), now + Math.random() * 0.05, 0.028 + 0.04 * intensity,
        0.35 + Math.random() * 0.5, 0.3, Math.random() * 1.2 - 0.6);
    }
  }

  function idle() {
    texAcc = 0;
    if (!pad || !ctx) return;
    pad.g.gain.cancelScheduledValues(ctx.currentTime);
    pad.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
    stopPadSoon();
  }

  // e appears: a rising arpeggio and the pad opens up.
  function reveal() {
    if (!ready()) return;
    var t = ctx.currentTime + 0.02;
    [73, 77, 80, 85, 89].forEach(function (m, k) {
      voice(m, t + k * 0.12, 0.15, 2.8, 0.4, (k - 2) * 0.2);
    });
    voice(61, t, 0.12, 3.2, 0.2, 0);
    voice(49, t, 0.12, 3.2, 0.1, 0);
    if (pad) {
      holdPadUntil = t + 2.6;
      pad.g.gain.cancelScheduledValues(t);
      pad.g.gain.setTargetAtTime(0.13, t, 0.3);
      pad.f.frequency.setTargetAtTime(4200, t, 0.4);
    }
  }

  // The long run finishes: one resolved chord and the shimmer fades out.
  function finale() {
    if (!ready()) return;
    var t = ctx.currentTime + 0.03;
    [49, 61, 65, 68, 73, 75].forEach(function (m, k) {
      voice(m, t + k * 0.035, 0.12, 4.5, 0.3, (k - 2.5) * 0.15);
    });
    idle();
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(enabled ? MASTER : 0, ctx.currentTime, 0.05);
    if (!enabled) idle();
  }

  return {
    unlock: unlock,
    land: land,
    strike: strike,
    texture: texture,
    idle: idle,
    reveal: reveal,
    finale: finale,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; }
  };
})();
