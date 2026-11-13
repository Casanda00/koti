// Talking with Koti, hands free: Koti listens, notices when you've finished, answers out loud, and listens again.
// It ends when you tap End, close the conversation, or say nothing for a while. While Koti speaks, the microphone
// isn't recording (it would hear Koti); tap the circle to cut in. The microphone is asked for once per conversation.
// When you've finished is worked out from the sound level (makeVad), against the room's own noise.

export const VAD = { calibrateMs: 300, minSpeechMs: 250, silenceMs: 1100, startTimeoutMs: 8000, maxMs: 30000, floorFactor: 2.8, minLevel: 0.012 };

/* Decides from sound levels when someone started talking and when they stopped. push(level, ms since start) returns
   "wait" (no speech yet), "speech" (talking), "done" (finished after speaking), or "none" (nothing said in time). */
export function makeVad(o = {}) {
  const c = { ...VAD, ...o }; let floor = null, cal = [], above = 0, spoke = false, lastLoud = 0, lastT = 0;
  return {
    push(level, t) {
      const dt = Math.max(0, t - lastT); lastT = t;
      if (t < c.calibrateMs) { cal.push(level); return "wait"; }
      if (floor == null) floor = cal.length ? cal.reduce((a, b) => a + b, 0) / cal.length : 0;
      const loud = level > Math.max(c.minLevel, floor * c.floorFactor);
      if (loud) { above += dt; lastLoud = t; if (above >= c.minSpeechMs) spoke = true; }
      else { above = Math.max(0, above - dt); if (!spoke) floor = floor * 0.95 + level * 0.05; }
      if (spoke && (t - lastLoud >= c.silenceMs || t >= c.maxMs)) return "done";
      if (!spoke && t >= c.startTimeoutMs) return "none";
      return spoke ? "speech" : "wait";
    },
  };
}

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/* A conversation. onTurn(blob) sends what was said and resolves with { speech, text, end } to play (end: the conversation is over after it); onState(state)
   gets "starting", "listening", "thinking", "speaking", or "ended" with a reason ("quiet", "stopped", "error", "done"). */
export function createConversation({ onTurn, onState, play, stop }) {
  let stream = null, ctx = null, analyser = null, rec = null, alive = false, cutIn = null;
  const state = (s, x) => { try { onState && onState(s, x); } catch {} };

  function listenOnce() {
    return new Promise(resolve => {
      const type = TYPES.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
      const parts = [], vad = makeVad(), buf = new Float32Array(analyser.fftSize), t0 = performance.now();
      rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      let result = null;
      rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
      rec.onstop = () => resolve(result === "done" ? new Blob(parts, { type: rec.mimeType || type || "audio/webm" }) : null);
      rec.start(250);
      const tick = () => {
        if (!alive || !rec || rec.state !== "recording") return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const r = vad.push(Math.sqrt(sum / buf.length), performance.now() - t0);
        if (r === "done" || r === "none") { result = r; rec.stop(); return; }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  async function loop() {
    while (alive) {
      state("listening");
      const blob = await listenOnce();
      if (!alive) return;
      if (!blob) { end("quiet"); return; }
      state("thinking");
      let reply;
      try { reply = await onTurn(blob); } catch { end("error"); return; }
      if (!alive) return;
      if (reply && (reply.speech || reply.text)) {
        state("speaking");
        await Promise.race([play(reply), new Promise(r => { cutIn = r; })]);
        cutIn = null;
      }
      // They said that's all: after the goodbye, the conversation ends.
      if (reply && reply.end) { end("done"); return; }
    }
  }

  async function start() {
    alive = true; state("starting");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream); analyser = ctx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser);
    } catch (e) { end("mic"); return; }
    loop();
  }
  function end(reason = "stopped") {
    if (!alive && reason !== "mic") return;
    alive = false;
    try { if (rec && rec.state === "recording") rec.stop(); } catch {}
    try { stop && stop(); } catch {}
    try { stream && stream.getTracks().forEach(t => t.stop()); } catch {}
    try { ctx && ctx.close(); } catch {}
    stream = ctx = analyser = rec = null;
    state("ended", reason);
  }
  /* Cut in while Koti is speaking: stop it and listen. */
  function interrupt() { if (cutIn) { try { stop && stop(); } catch {} cutIn(); } }
  return { start, end, interrupt, get active() { return alive; } };
}
