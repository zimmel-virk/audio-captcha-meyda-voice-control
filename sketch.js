// CM3065 – Exercise 2
// This sketch combines three things in one place:
// 1) a 4-digit audio CAPTCHA,
// 2) a music visualiser driven by Meyda features + my own beat/onset logic,
// 3) voice commands that change the background + shape style.
//

// -------------------------
// Audio location + exact filenames
// -------------------------
//folder and filenames up top so I can fix paths in one place if I move files later.
const AUDIO_FOLDER = "assets/";
const FILES = {
  sound1: "Ex2_sound1.wav",
  sound2: "Ex2_sound2.wav",
  sound3: "Ex2_sound3.wav",
  remix: "Kalte_Ohren_(_Remix_).mp3",
};

// -------------------------
// UI state
// -------------------------
// ui holds all the DOM handles I create in buildDOM() (buttons, labels, inputs, etc.)
let ui = {};
let p5Canvas;

// -------------------------
// Task 2.1: CAPTCHA state
// -------------------------
// captchaDigits is the “answer”, captchaAttempts is just a counter for feedback.
let captchaDigits = "";
let captchaAttempts = 0;

// Text-to-speech instance for speaking the digits.
let tts;

// CAPTCHA audio chain pieces (noise -> filter -> distortion -> gain)
let captchaNoise, captchaLPF, captchaDist, captchaGain;

// FFT used only to draw a quick spectrum for the CAPTCHA noise output.
let captchaFFT;

// Visual helper flags for showing spectrum briefly after generating a captcha.
let captchaVizOn = false;
let captchaVizUntil = 0;

// Separate DOM canvas under the CAPTCHA section (so the spectrum isn’t drawn on the main p5 canvas).
let captchaSpecCanvas = null;
let captchaSpecCtx = null;

// -------------------------
// Task 2.2: Music playback + Meyda
// -------------------------
// audioEl is the HTMLAudioElement I control with Play/Pause/Stop.
// mediaSource is the WebAudio MediaElementSourceNode that feeds Meyda.
let audioEl = null;
let mediaSource = null;
let meyda = null;

// Current selected track (key used in FILES + the nice label shown in the UI)
let currentKey = "sound1";
let currentLabel = "Sound 1";

// Feature bundle (Meyda features + my own flux value).
let feat = {
  rms: 0,
  spectralCentroid: 0,
  zcr: 0,
  spectralRolloff: 0,
  spectralFlatness: 0,
  flux: 0,
};

// Smoothed versions of the same features (keeps visuals from looking jittery).
let rmsS = 0, scS = 0, zcrS = 0, rollS = 0, flatS = 0, fluxS = 0;

// Previous spectrum snapshot for flux calculation.
let prevSpectrum = null;

// Visual objects (rects are the main shapes; bursts are the beat “pop” particles).
let rects = [];
let bursts = [];
let lastRebuildFrame = 0;

// Controls that affect the “feel” of the visuals.
let trailsOn = true;
let beatBurstsOn = true;
let intensity = 1.0;
let parallaxX = 0, parallaxY = 0;

// Beat/onset engine state.
// beatPulse is a softer glow, beatPunch is a sharper hit.
let beatPulse = 0;
let beatPunch = 0;
let onsetFloor = 0;
let onsetPeak = 1;
let lastOnsetFrame = -999;

// Small shake amount that spikes on stronger onsets.
let shake = 0;

// -------------------------
// Task 2.3: Voice control
// -------------------------
// speechRec listens for simple commands and onVoiceResult handles the parsing.
let speechRec = null;
let bgMode = "black";
let shapeMode = "square";
let useVoiceBg = true;

// ============================================================
// p5 entry points
// ============================================================
function setup() {
  // I build the UI first so I know where to mount the p5 canvas.
  buildDOM();

  // Main visual canvas lives inside the “Visual Output” card.
  p5Canvas = createCanvas(ui.canvasW, ui.canvasH);
  p5Canvas.parent("canvasWrap");

  // --- CAPTCHA chain setup ---
  // I generate audio CAPTCHA using filtered/distorted noise, then speak digits over it.
  captchaNoise = new p5.Noise("white");
  captchaLPF = new p5.LowPass();
  captchaDist = new p5.Distortion();
  captchaGain = new p5.Gain();

  // Build the chain manually so I control exactly what reaches the output.
  captchaNoise.disconnect();
  captchaNoise.connect(captchaLPF);
  captchaLPF.disconnect();
  captchaLPF.connect(captchaDist);
  captchaDist.disconnect();
  captchaDist.connect(captchaGain);
  captchaGain.connect();
  captchaGain.amp(0);

  // Text-to-speech for reading the generated 4 digits.
  tts = new p5.Speech();

  // FFT is only for the small CAPTCHA spectrum view.
  captchaFFT = new p5.FFT(0.85, 64);
  captchaFFT.setInput(captchaGain);

  // Hook into the little DOM canvas that sits under the CAPTCHA UI.
  captchaSpecCanvas = document.getElementById("captchaSpectrumCanvas");
  if (captchaSpecCanvas) {
    captchaSpecCtx = captchaSpecCanvas.getContext("2d");
  }

  // --- Voice recognition setup ---
  // Continuous means it keeps listening after a command instead of stopping each time.
  speechRec = new p5.SpeechRec("en-US");
  speechRec.continuous = true;
  speechRec.interimResults = false;
  speechRec.onResult = onVoiceResult;

  // Initial UI messages so it’s obvious what to do first.
  setCaptchaStatus("Press “Generate & Play CAPTCHA”. Type the 4 digits you hear.", "neutral");
  setVizStatus("Select a sound, then press Play (no autoplay).", "neutral");

  // --- Button wiring ---
  // I always resume the audio context right before doing anything audio related.
  ui.btnCaptchaPlay.mousePressed(() => { resumeAudioContextSync(); runNumberCaptcha(); });
  ui.btnCaptchaNew.mousePressed(() => newCaptchaOnly());
  ui.btnCaptchaCheck.mousePressed(() => checkCaptcha());

  ui.selSound.changed(() => {
    setSoundChoice(ui.selSound.value());
    setVizStatus(`Selected: ${currentLabel}. Press Play.`, "neutral");
  });

  ui.btnPlay.mousePressed(() => { resumeAudioContextSync(); startSelectedAudio(); });
  ui.btnPause.mousePressed(() => pauseAudio());
  ui.btnStop.mousePressed(() => stopAudio());

  ui.btnVoiceStart.mousePressed(() => { resumeAudioContextSync(); startVoice(); });
  ui.btnVoiceStop.mousePressed(() => stopVoice());

  ui.chkVoiceBg.changed(() => { useVoiceBg = ui.chkVoiceBg.elt.checked; });

  // Start with a default track + a first set of shapes.
  setSoundChoice("sound1");
  rebuildRects(70);
}

function draw() {
  // All smoothing happens first so every part of the frame uses the same “current” values.
  smoothFeatures();

  // Parallax is optional — it gives a subtle “depth” shift when I move the mouse.
  updateParallax();

  // This is where the beat/onset logic updates beatPulse/beatPunch/shake.
  updateBeatOnsets();

  // CAPTCHA spectrum is drawn onto its own DOM canvas.
  drawCaptchaSpectrumDOM();

  // Background handling:
  // - trailsOn: paint a transparent background to leave trails behind.
  // - otherwise: clear fully each frame.
  if (trailsOn) {
    const bgc = useVoiceBg ? getBgColor(bgMode) : audioBgColor();
    bgc.setAlpha(18);
    background(bgc);
  } else {
    background(useVoiceBg ? getBgColor(bgMode) : audioBgColor());
  }

  // Shake is applied as a temporary translate so everything “jitters” slightly on punch.
  push();
  if (shake > 0.001) translate(random(-1, 1) * shake * 8, random(-1, 1) * shake * 8);

  // Main visual shapes (these react to energy/beat rather than relying on mouse input).
  updateAndDrawRects();

  pop();

  // Extra burst particles on beat (toggled with B).
  if (beatBurstsOn) {
    updateBursts();
    drawBursts();
  }
}

// ============================================================
// Optional interaction helpers
// ============================================================
function updateParallax() {
  // Mouse movement only nudges the scene; it’s not required for the visuals to “work”.
  const tx = map(mouseX, 0, width, -1, 1);
  const ty = map(mouseY, 0, height, -1, 1);
  parallaxX = lerp(parallaxX, tx, 0.04);
  parallaxY = lerp(parallaxY, ty, 0.04);
}

function mousePressed() { trailsOn = !trailsOn; }

function mouseWheel(e) {
  // Scroll adjusts intensity so I can quickly tame or exaggerate the motion.
  intensity += (e.deltaY > 0 ? -0.06 : 0.06);
  intensity = constrain(intensity, 0.5, 2.2);
  return false;
}

function keyPressed() {
  // Quick toggle for the beat burst particles.
  if (key === "b" || key === "B") beatBurstsOn = !beatBurstsOn;
}

// ============================================================
// Audio context wake-up
// ============================================================
function resumeAudioContextSync() {
  // Browsers keep the AudioContext suspended until there’s a user gesture.
  const ctx = getAudioContext();
  if (ctx && ctx.state !== "running") ctx.resume();
}

// ============================================================
// UI builder
// ============================================================
function buildDOM() {
  // Everything in the UI is created here so the HTML file stays simple.
  const app = select("#app");
  app.html(`
    <div class="header">
      <div>
        <h1>Exercise 2 – Audio CAPTCHA + Meyda Visualiser + Voice Control</h1>
        <small>Use B to burst visualization, scroll mouse to see intensity and click on visualization to change brightness and trace.</small>
      </div>
      <span class="badge">Audio: ${AUDIO_FOLDER}/…</span>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Task 2.1 – Audio CAPTCHA (Numbers)</h2>
        <div class="row">
          <button id="btnCaptchaPlay">Generate & Play CAPTCHA</button>
          <button id="btnCaptchaNew">New Digits Only</button>
        </div>

        <div class="row">
          <label style="width:100%;">Enter 4 digits</label>
          <input id="captchaInput" type="text" placeholder="e.g., 4281" />
        </div>

        <div class="row">
          <button id="btnCaptchaCheck">Submit</button>
          <span id="captchaBadge" class="badge">Attempts: 0</span>
        </div>
        <div id="captchaStatus" class="status"></div>

        <div style="margin-top:10px;">
          <canvas id="captchaSpectrumCanvas" width="340" height="70"
            style="width:100%; height:70px; border-radius:12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);">
          </canvas>
        </div>

        <hr style="border:none;border-top:1px solid var(--border); margin:14px 0;">

        <h2>Task 2.2 – Music Visualisation</h2>
        <div class="row">
          <label style="width:100%;">Choose sound</label>
          <select id="selSound">
            <option value="sound1">Ex2_sound1.wav</option>
            <option value="sound2">Ex2_sound2.wav</option>
            <option value="sound3">Ex2_sound3.wav</option>
            <option value="remix">Kalte_Ohren_(Remix).mp3</option>
          </select>
        </div>

        <div class="row">
          <button id="btnPlay">Play</button>
          <button id="btnPause">Pause</button>
          <button id="btnStop">Stop</button>
        </div>

        <div id="vizStatus" class="status"></div>

        <div class="row" style="margin-top:10px;">
          <label><input id="chkVoiceBg" type="checkbox" checked /> Use voice background</label>
        </div>

        <div class="row">
          <div class="hint">
            Click = trails, wheel = intensity, B = bursts
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border); margin:14px 0;">

        <h2>Task 2.3 – Voice Controller</h2>
        <div class="row">
          <button id="btnVoiceStart">Start Listening</button>
          <button id="btnVoiceStop">Stop</button>
          <span id="voiceBadge" class="badge">Voice: Not started</span>
        </div>

        <div class="row">
          <div class="hint">
            BG: <span class="kbd">black</span> <span class="kbd">white</span> <span class="kbd">red</span> <span class="kbd">blue</span> <span class="kbd">green</span><br/> <span 
            class="kbd">purple</span> <span
            class="kbd">pink</span> <span 
            class="kbd">orange</span> <span 
            class="kbd">yellow</span> <span 
            class="kbd">teal</span><br/> <span 
            class="kbd">grey</span><br/> 
            Shape: <span class="kbd">square</span> <span class="kbd">triangle</span> <span class="kbd">circle</span> <span class="kbd">pentagon</span>
            <span class="kbd">hexagon</span> <span 
            class="kbd">star</span> <span 
            class="kbd">diamond</span> <span 
            class="kbd">ring</span>
          </div>
        </div>

        <div class="row">
          <div class="hint">Last command: <span id="lastCmd" class="kbd">—</span></div>
        </div>
      </div>

      <div class="card">
        <h2>Visual Output</h2>
        <div id="canvasWrap" class="canvasWrap"></div>
        <div class="row" style="margin-top:10px;">
          <span class="badge">bg: <span id="bgLabel">black</span></span>
          <span class="badge">shape: <span id="shapeLabel">square</span></span>
          <span class="badge">sound: <span id="soundLabel">Sound 1</span></span>
        </div>
      </div>
    </div>
  `);

  // Grab every DOM element I’ll need later, once, and store it in ui.
  ui.btnCaptchaPlay = select("#btnCaptchaPlay");
  ui.btnCaptchaNew = select("#btnCaptchaNew");
  ui.btnCaptchaCheck = select("#btnCaptchaCheck");
  ui.captchaInput = select("#captchaInput");
  ui.captchaStatus = select("#captchaStatus");
  ui.captchaBadge = select("#captchaBadge");

  ui.selSound = select("#selSound");
  ui.btnPlay = select("#btnPlay");
  ui.btnPause = select("#btnPause");
  ui.btnStop = select("#btnStop");
  ui.vizStatus = select("#vizStatus");
  ui.chkVoiceBg = select("#chkVoiceBg");

  ui.btnVoiceStart = select("#btnVoiceStart");
  ui.btnVoiceStop = select("#btnVoiceStop");
  ui.voiceBadge = select("#voiceBadge");
  ui.lastCmd = select("#lastCmd");

  ui.bgLabel = select("#bgLabel");
  ui.shapeLabel = select("#shapeLabel");
  ui.soundLabel = select("#soundLabel");

  // Canvas size is defined here so the layout stays consistent.
  ui.canvasW = 740;
  ui.canvasH = 520;
}

// Status helpers
// These helpers just update the little status boxes in the UI.
// They clear old styling first, then apply the new “ok/bad” class, and finally replace the HTML message.
function setCaptchaStatus(msg, kind) {
  ui.captchaStatus.removeClass("ok");
  ui.captchaStatus.removeClass("bad");
  if (kind === "ok") ui.captchaStatus.addClass("ok");
  if (kind === "bad") ui.captchaStatus.addClass("bad");
  ui.captchaStatus.html(msg);
}

function setVizStatus(msg, kind) {
  ui.vizStatus.removeClass("ok");
  ui.vizStatus.removeClass("bad");
  if (kind === "ok") ui.vizStatus.addClass("ok");
  if (kind === "bad") ui.vizStatus.addClass("bad");
  ui.vizStatus.html(msg);
}

// Background colour map for voice mode.
// If the mode isn’t one of the named colours, it falls back to black.
function getBgColor(mode) {
  if (mode === "white") return color(245);
  if (mode === "red") return color(140, 20, 20);
  if (mode === "blue") return color(15, 30, 120);
  if (mode === "green") return color(10, 90, 40);
  if (mode === "purple") return color(90, 40, 140);
  if (mode === "pink") return color(170, 60, 120);
  if (mode === "orange") return color(180, 90, 20);
  if (mode === "yellow") return color(200, 170, 40);
  if (mode === "teal") return color(10, 120, 110);
  if (mode === "gray") return color(60);
  return color(0);
}

// Sound choice
// Updates the currently selected track key + the label shown in the UI.
// Also rebuilds the visual layout differently per track so each sound “feels” unique.
// Finally, it resets the beat/onset tracking so the new track starts clean (no leftover peaks).
function setSoundChoice(key) {
  currentKey = key;
  if (key === "sound1") currentLabel = "Sound 1";
  if (key === "sound2") currentLabel = "Sound 2";
  if (key === "sound3") currentLabel = "Sound 3";
  if (key === "remix") currentLabel = "Kalte Ohren (Remix)";
  ui.soundLabel.html(currentLabel);

  if (key === "sound1") rebuildRects(70);
  else if (key === "sound2") rebuildRects(90);
  else if (key === "sound3") rebuildRects(65);
  else rebuildRects(110);

  onsetFloor = 0;
  onsetPeak = 1;
  beatPulse = 0;
  beatPunch = 0;
  shake = 0;
  lastOnsetFrame = -999;
  prevSpectrum = null;
}

// Task 2.1 – CAPTCHA
// Generates a random 4-digit string using digits 0–9.
function make4Digits() {
  let s = "";
  for (let i = 0; i < 4; i++) s += String(floor(random(0, 10)));
  return s;
}

// Resets the CAPTCHA without playing it.
// This is useful if the user wants a new code but isn’t ready to listen yet.
function newCaptchaOnly() {
  captchaDigits = make4Digits();
  captchaAttempts = 0;
  ui.captchaBadge.html(`Attempts: ${captchaAttempts}`);
  ui.captchaInput.value("");
  setCaptchaStatus("New digits generated. Press “Generate & Play CAPTCHA”.", "neutral");
}

// Generates a new 4-digit code, plays the noise chain, and speaks the digits.
// While it plays, the small DOM spectrum is enabled for a short time so the user sees activity.
function runNumberCaptcha() {
  captchaDigits = make4Digits();
  captchaAttempts = 0;
  ui.captchaBadge.html(`Attempts: ${captchaAttempts}`);
  ui.captchaInput.value("");

  const speakText = captchaDigits.split("").join(" ");

  // Random rate/pitch makes it harder to “pattern match” the voice and keeps it more CAPTCHA-like.
  tts.setRate(random(0.80, 1.15));
  tts.setPitch(random(0.85, 1.25));

  // Enable the CAPTCHA spectrum visual for ~2.3 seconds.
  captchaVizOn = true;
  captchaVizUntil = millis() + 2300;

  // Randomise the noise shaping so each CAPTCHA has a different “texture”.
  captchaLPF.freq(random(900, 2200));
  captchaDist.set(random(0.12, 0.45), "2x");

  // Start noise and fade gain in quickly.
  captchaNoise.start();
  captchaGain.amp(0.0);
  captchaGain.amp(0.20, 0.05);

  setCaptchaStatus("Playing CAPTCHA… Enter the 4 digits and Submit.", "neutral");

  // Speak the digits with spaces so they’re clearly separated.
  tts.speak(speakText);

  // After ~2 seconds, fade out the noise and stop it.
  setTimeout(() => {
    captchaGain.amp(0.0, 0.10);
    setTimeout(() => { try { captchaNoise.stop(); } catch(e) {} }, 140);
  }, 2000);

  // Hard stop the spectrum visual after the window ends.
  setTimeout(() => {
    captchaVizOn = false;
  }, 2300);
}

// Checks the user input against the generated digits.
// Non-digits are stripped so things like spaces don’t break the comparison.
function checkCaptcha() {
  captchaAttempts += 1;
  ui.captchaBadge.html(`Attempts: ${captchaAttempts}`);

  const user = String(ui.captchaInput.value() || "").replace(/\D/g, "");

  if (user === captchaDigits) setCaptchaStatus(`✅ CAPTCHA PASSED.<br/>Correct: <b>${captchaDigits}</b>`, "ok");
  else setCaptchaStatus("❌ Incorrect. Generate & Play again for new digits.", "bad");
}

// CAPTCHA spectrum on a DOM canvas (kept separate from the main p5 visuals).
// When the CAPTCHA is inactive, it draws a faint idle line.
// When active, it draws bars from captchaFFT so the user can see the noise energy.
function drawCaptchaSpectrumDOM() {
  if (!captchaSpecCanvas || !captchaSpecCtx) return;

  const ctx = captchaSpecCtx;
  const w = captchaSpecCanvas.width;
  const h = captchaSpecCanvas.height;

  // Clear the previous frame completely.
  ctx.clearRect(0, 0, w, h);

  // Active = during the visible window (either the flag is on, or the timer hasn’t expired yet).
  const active = (captchaVizOn || millis() <= captchaVizUntil);

  // Soft rounded background panel.
  roundRect(ctx, 0, 0, w, h, 12);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();

  // Idle state: a simple line across the middle (keeps the box from looking “dead”).
  if (!active) {
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(14, Math.floor(h / 2), w - 28, 2);
    return;
  }

  // FFT bins come back as 0..255, then each bin becomes a vertical bar.
  const spec = captchaFFT.analyze();
  const n = spec.length;
  const barW = w / n;

  for (let i = 0; i < n; i++) {
    const v = spec[i] / 255;
    const bh = v * (h - 14);
    const bx = i * barW;
    const by = (h - 7) - bh;

    // Alpha rises with the bin energy so louder bins look brighter.
    const a = 0.25 + v * 0.75;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(bx + 1, by, Math.max(1, barW - 2), bh);
  }
}

// Simple rounded-rectangle path helper for the CAPTCHA spectrum background.
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Task 2.2 – Audio + Meyda (stable)
// Starts playback for the currently selected track and boots Meyda on the media element.
// This uses a path resolver first to avoid “silent 404” problems.
function startSelectedAudio() {
  stopAudio();
  setVizStatus("Resolving audio path…", "neutral");

  resolveAudioSrc(currentKey).then((src) => {
    if (!src) {
      setVizStatus("❌ Audio not found (404). Your folder path is still wrong.", "bad");
      return;
    }

    // Create a fresh HTMLAudioElement each time so switching sounds is clean.
    audioEl = document.createElement("audio");
    audioEl.src = src;
    audioEl.crossOrigin = "anonymous";
    audioEl.loop = true;
    audioEl.preload = "auto";

    // Hook the audio element into WebAudio so Meyda can read from it.
    const ctx = getAudioContext();
    mediaSource = ctx.createMediaElementSource(audioEl);
    mediaSource.connect(ctx.destination);

    // Meyda analyzer runs continuously while audio is playing.
    // amplitudeSpectrum is included so flux can be computed safely here (no spectralFlux extractor).
    meyda = Meyda.createMeydaAnalyzer({
      audioContext: ctx,
      source: mediaSource,
      bufferSize: 512,
      featureExtractors: [
        "rms",
        "spectralCentroid",
        "zcr",
        "spectralRolloff",
        "spectralFlatness",
        "amplitudeSpectrum",
      ],
      callback: (f) => {
        // Guard every feature so visuals never get NaN or undefined.
        feat.rms = Number.isFinite(f.rms) ? f.rms : 0;
        feat.spectralCentroid = Number.isFinite(f.spectralCentroid) ? f.spectralCentroid : 0;
        feat.zcr = Number.isFinite(f.zcr) ? f.zcr : 0;
        feat.spectralRolloff = Number.isFinite(f.spectralRolloff) ? f.spectralRolloff : 0;
        feat.spectralFlatness = Number.isFinite(f.spectralFlatness) ? f.spectralFlatness : 0;

        // Flux = sum of positive changes between the current spectrum and previous spectrum.
        // This gives a reliable onset/beat-ish signal without using the unstable extractor.
        const spec = Array.isArray(f.amplitudeSpectrum) ? f.amplitudeSpectrum : null;
        if (spec && prevSpectrum && spec.length === prevSpectrum.length) {
          let sum = 0;
          for (let i = 0; i < spec.length; i++) {
            const d = spec[i] - prevSpectrum[i];
            if (d > 0) sum += d;
          }
          feat.flux = sum;
        } else {
          feat.flux = 0;
        }

        // Store a copy for the next callback.
        if (spec) prevSpectrum = spec.slice(0);
      }
    });

    // Play is triggered only by a user click (browser policy), otherwise it will reject.
    audioEl.play().then(() => {
      meyda.start();
      setVizStatus(`▶ Visualising: ${currentLabel}`, "ok");
    }).catch(() => {
      setVizStatus("Audio blocked. Click once anywhere, then press Play again.", "bad");
    });
  });
}

// Pauses the audio element but keeps everything ready to continue.
function pauseAudio() {
  if (!audioEl) return;
  audioEl.pause();
  setVizStatus(`⏸ Paused: ${currentLabel}`, "neutral");
}

// Full stop: shuts down Meyda, clears the audio element, and resets all feature/beat state.
function stopAudio() {
  try { if (meyda) meyda.stop(); } catch(e) {}
  meyda = null;

  if (audioEl) {
    audioEl.pause();
    audioEl.src = "";
    audioEl.load();
  }
  audioEl = null;

  // Reset all feature signals so visuals settle back to neutral instantly.
  feat = { rms: 0, spectralCentroid: 0, zcr: 0, spectralRolloff: 0, spectralFlatness: 0, flux: 0 };
  rmsS = scS = zcrS = rollS = flatS = fluxS = 0;
  beatPulse = 0;
  beatPunch = 0;
  shake = 0;
  prevSpectrum = null;
  bursts = [];

  setVizStatus("Stopped.", "neutral");
}

// Robust resolver (fixes 404)
// Tries a few safe folder/name variants (especially for the remix filename) and returns the first one that exists.
async function resolveAudioSrc(key) {
  const raw = FILES[key];

  const nameVariants =
    key === "remix"
      ? [
          raw,
          "Kalte_Ohren_(Remix).mp3",
          "Kalte_Ohren_( Remix ).mp3",
          "Kalte_Ohren_(Remix ).mp3",
          "Kalte_Ohren_( Remix).mp3",
        ]
      : [raw];

  // Base paths let the sketch work even if the project is served from a subfolder.
  const bases = [".", "..", "../.."];

  // Folder variants handle accidental “spaces turned into underscores” folder naming.
  const folders = [AUDIO_FOLDER, AUDIO_FOLDER.replaceAll(" ", "_")];

  for (const base of bases) {
    for (const folder of folders) {
      for (const nm of nameVariants) {
        const candidate = `${base}/${folder}/${nm}`;
        if (await urlExists(candidate)) return candidate;
      }
    }
  }
  return "";
}

// Simple existence check using fetch.
// If it returns ok, the file is reachable from the server (Live Server / localhost).
async function urlExists(url) {
  try {
    const res = await fetch(encodeURI(url), { method: "GET" });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Task 2.3 – Voice
// Starts the speech recogniser and updates the badge so it’s obvious it’s listening.
function startVoice() {
  try {
    speechRec.start();
    ui.voiceBadge.html("Voice: Listening…");
  } catch (e) {
    ui.voiceBadge.html("Voice: blocked (allow mic)");
  }
}

// Stops speech recognition and updates the badge.
function stopVoice() {
  try { speechRec.stop(); } catch(e) {}
  ui.voiceBadge.html("Voice: Stopped");
}

// Handles a recognised voice result.
// The command text is shown in the UI, then matched with simple includes() checks for bg + shape keywords.
function onVoiceResult() {
  if (!speechRec.resultValue) return;

  const cmd = String(speechRec.resultString || "").toLowerCase();
  ui.lastCmd.html(cmd);

  // Background keywords
  if (cmd.includes("black")) bgMode = "black";
  if (cmd.includes("white")) bgMode = "white";
  if (cmd.includes("red")) bgMode = "red";
  if (cmd.includes("blue")) bgMode = "blue";
  if (cmd.includes("green")) bgMode = "green";
  if (cmd.includes("purple")) bgMode = "purple";
  if (cmd.includes("pink")) bgMode = "pink";
  if (cmd.includes("orange")) bgMode = "orange";
  if (cmd.includes("yellow")) bgMode = "yellow";
  if (cmd.includes("teal")) bgMode = "teal";
  if (cmd.includes("gray") || cmd.includes("grey")) bgMode = "gray";


  // Shape keywords
  if (cmd.includes("square")) shapeMode = "square";
  if (cmd.includes("triangle")) shapeMode = "triangle";
  if (cmd.includes("circle")) shapeMode = "circle";
  if (cmd.includes("pentagon")) shapeMode = "pentagon";
  if (cmd.includes("hexagon")) shapeMode = "hexagon";
  if (cmd.includes("star")) shapeMode = "star";
  if (cmd.includes("diamond")) shapeMode = "diamond";
  if (cmd.includes("ring")) shapeMode = "ring";

  // Push updates back into the UI badges.
  ui.bgLabel.html(bgMode);
  ui.shapeLabel.html(shapeMode);
}


// Feature smoothing
// The raw Meyda features jump around a lot frame-to-frame, so these lerp() lines act like a soft “shock absorber”.
// Each feature gets its own smoothing speed based on how noisy it is (flux is smoothed a bit more aggressively).
function smoothFeatures() {
  rmsS  = lerp(rmsS,  feat.rms, 0.18);
  scS   = lerp(scS,   feat.spectralCentroid, 0.12);
  zcrS  = lerp(zcrS,  feat.zcr, 0.16);
  rollS = lerp(rollS, feat.spectralRolloff, 0.12);
  flatS = lerp(flatS, feat.spectralFlatness, 0.12);
  fluxS = lerp(fluxS, feat.flux, 0.35);
}

// Beat/onset engine
// Turns “flux + energy” into two signals:
// - beatPunch: a sharp hit used for quick flashes and speed spikes
// - beatPulse: a softer glow that hangs around a bit longer
// It also auto-adapts to different tracks by tracking a moving floor/peak range.
function updateBeatOnsets() {
  // Flux is scaled down into 0..1 (the divider is tuned to these files).
  const fluxN = constrain(fluxS / 900, 0, 1);

  // RMS energy is boosted and clamped so quiet parts still register.
  const energy = constrain(rmsS * 5.0 * intensity, 0, 1);

  // Blend flux (attacks/onsets) with overall energy (loudness).
  const onsetRaw = fluxN * 0.70 + energy * 0.30;

  // Dynamic baseline tracking so the threshold behaves across different songs.
  onsetFloor = lerp(onsetFloor, onsetRaw, 0.03);
  onsetPeak = max(lerp(onsetPeak, onsetRaw, 0.015), onsetFloor + 0.02);

  // Normalise onset into 0..1 using the moving floor/peak window.
  let onsetN = (onsetRaw - onsetFloor) / (onsetPeak - onsetFloor);
  onsetN = constrain(onsetN, 0, 1);

  // Slightly higher threshold when the track is quiet (reduces false triggers).
  const threshold = 0.22 + (1.0 - energy) * 0.08;

  // Cooldown prevents double-triggers on the same hit.
  const cooldown = 6;

  // Natural decay so the visuals fall back smoothly when there’s no beat.
  beatPulse *= 0.90;
  beatPunch *= 0.72;
  shake *= 0.78;

  // If we cross threshold and we’re past the cooldown, treat it as a beat/onset.
  if (onsetN > threshold && frameCount - lastOnsetFrame > cooldown) {
    lastOnsetFrame = frameCount;

    // Punch is the “instant hit”, pulse is the softer glow that can stack.
    beatPunch = 1.0;
    beatPulse = max(beatPulse, onsetN);

    // Small camera shake to sell the impact.
    shake = max(shake, 0.65);

    // Spawn a burst ring near the centre so the beat is visible even without mouse input.
    bursts.push({
      x: width * 0.5 + random(-160, 160),
      y: height * 0.5 + random(-160, 160),
      r: 12,
      life: 1.0
    });
  } else {
    // No hard trigger: still keep a gentle pulse from the onset value.
    beatPulse = max(beatPulse, onsetN * 0.55);
  }
}

// Background (brightness POP)
// Builds a background colour from spectral centroid + rolloff + overall energy,
// then adds an extra “flash” on beats using beatPulse/beatPunch.
function audioBgColor() {
  const c = constrain(scS / 5000, 0, 1);
  const r = constrain(rollS / 8000, 0, 1);
  const e = constrain(rmsS * 5.0 * intensity, 0, 1);

  // Base brightness comes from the spectral shape (brighter = more high-end energy).
  const base = map(c, 0, 1, 10, 130);

  // Rolloff lifts brightness when the spectrum spreads further up.
  const lift = map(r, 0, 1, 0, 95);

  // Energy glow is overall loudness contribution.
  const energyGlow = map(e, 0, 1, 0, 70);

  // Flash is the beat-driven pop (punch hits harder than pulse).
  const flash = map(beatPulse, 0, 1, 0, 110) + map(beatPunch, 0, 1, 0, 140);

  // Final brightness is clamped so it never blows out permanently.
  const b = constrain(base + lift + energyGlow + flash, 0, 255);

  // Slight tinting based on centroid/rolloff so different tracks look different.
  return color(
    b * (0.82 + 0.18 * c),
    b * (0.86 + 0.14 * r),
    b
  );
}

// Visual objects: beat drives size+speed automatically
// Rebuilds the moving shape field (used when the sound changes or when zcr suggests a different density).
function rebuildRects(n) {
  rects = [];
  for (let i = 0; i < n; i++) rects.push(makeRect());
  lastRebuildFrame = frameCount;
}

// Creates one moving “shape particle” with its own size, spin, velocity, and depth layer.
// The layer value is used as a parallax multiplier so some shapes feel closer than others.
function makeRect() {
  return {
    x: random(width),
    y: random(height),
    w: random(40, 220),
    h: random(40, 220),
    rot: random(TWO_PI),
    spin: random(-1, 1),
    hue: random(0, 360),
    layer: random(0.2, 1.0),
    vx: random(-0.6, 0.6),
    vy: random(-0.6, 0.6),
  };
}

// Main visual loop for the shape field.
// Everything is driven by audio features + the beat signals:
// - energy controls size + opacity
// - zcr controls object count + rotation feel
// - centroid/rolloff influence brightness and hue shift
// - beatPunch/beatPulse add speed spikes and size “hits”
function updateAndDrawRects() {
  const energy = constrain(rmsS * 5.0 * intensity, 0, 1);
  const energyMin = max(0.10, energy);

  const centroid = constrain(scS / 5000, 0, 1);
  const roll = constrain(rollS / 8000, 0, 1);
  const zcr = constrain(zcrS * 6.0, 0, 1);
  const flat = constrain(flatS, 0, 1);

  // Dynamically adjust the amount of shapes based on zcr.
  // This keeps busy tracks “full” and calmer tracks less cluttered.
  const target = floor(map(zcr, 0, 1, 24, 95));
  if (frameCount - lastRebuildFrame > 12) {
    if (target > rects.length + 12) rebuildRects(target);
    if (target < rects.length - 16) rects = rects.slice(0, target);
  }

  // Speed + size punch comes straight from beat signals.
  const speedBoost = 1.0 + beatPunch * 4.5 + beatPulse * 1.4;
  const punch = 1.0 + beatPunch * 1.25 + beatPulse * 0.40;

  // Size scales with loudness and then gets hit harder on beats.
  const sizeScale = map(energyMin, 0, 1, 0.70, 2.10) * punch;

  // Rotation rate increases with zcr + energy, then spikes on beats.
  const rotSpeed = (map(zcr, 0, 1, 0.004, 0.095) + map(energyMin, 0, 1, 0.0, 0.03)) * speedBoost;

  // Brightness comes from spectral balance, plus beat-driven flash.
  const baseBright = map(centroid * 0.6 + roll * 0.4, 0, 1, 45, 100);
  const brightness = constrain(baseBright + beatPulse * 18 + beatPunch * 36, 0, 100);

  // Flatness pushes saturation (noisy/flat spectra look more saturated).
  const satBase = map(flat, 0, 1, 25, 95);
  const sat = constrain(satBase + beatPunch * 14, 0, 100);

  // Opacity rises with energy, and jumps on beat hits so the field “pops”.
  const opacity = constrain(map(energyMin, 0, 1, 65, 205) + beatPulse * 40 + beatPunch * 85, 0, 255);
  const strokeOpacity = constrain(map(energyMin, 0, 1, 95, 240) + beatPulse * 35 + beatPunch * 70, 0, 255);

  // Border thickness is driven by flatness, then boosted slightly by beatPunch.
  const borderW = map(flat, 0, 1, 1.1, 10.0) * (1.0 + beatPunch * 1.2);

  // Use HSB so hue/sat/brightness control feels direct and musical.
  colorMode(HSB, 360, 100, 100, 255);

  for (let rObj of rects) {
    // Base drift plus a tiny random wobble, all boosted by the beat speed.
    rObj.x += rObj.vx * speedBoost + random(-0.15, 0.15) * speedBoost;
    rObj.y += rObj.vy * speedBoost + random(-0.15, 0.15) * speedBoost;

    // Parallax makes closer layers move more with the mouse.
    rObj.x += parallaxX * 2.0 * rObj.layer;
    rObj.y += parallaxY * 2.0 * rObj.layer;

    // Rotation with per-object spin direction and depth scaling.
    rObj.rot += rotSpeed * rObj.spin * (0.5 + rObj.layer);

    // Wrap-around so shapes recycle instead of bouncing off edges.
    if (rObj.x < -260) rObj.x = width + 260;
    if (rObj.x > width + 260) rObj.x = -260;
    if (rObj.y < -260) rObj.y = height + 260;
    if (rObj.y > height + 260) rObj.y = -260;

    // Hue shifts slightly with centroid and punches forward on beats.
    const hue = (rObj.hue + map(centroid, 0, 1, -35, 35) + beatPunch * 18) % 360;

    fill(hue, sat, brightness, opacity);
    stroke(hue, sat, min(100, brightness + 12), strokeOpacity);
    strokeWeight(borderW * (0.55 + rObj.layer));

    push();
    translate(rObj.x, rObj.y);
    rotate(rObj.rot);
    drawShape(shapeMode, 0, 0, rObj.w * sizeScale, rObj.h * sizeScale);
    pop();
  }

  // Switch back to normal RGB so other drawing code behaves as expected.
  colorMode(RGB, 255);

  // White flash ring at the centre on strong punches (quick “impact” cue).
  if (beatPunch > 0.01) {
    noStroke();
    fill(255, 255, 255, 120 * beatPunch);
    circle(width * 0.5, height * 0.5, 140 + 300 * beatPunch);
  }
}

// Draws the currently selected shape type.
// Square/triangle/pentagon are explicit, and anything else falls back to ellipse.
function drawShape(mode, x, y, w, h) {
  if (mode === "square") {
    rectMode(CENTER);
    rect(x, y, w, h);
    return;
  }
  if (mode === "triangle") {
    const hw = w * 0.5;
    const hh = h * 0.5;
    triangle(x, y - hh, x - hw, y + hh, x + hw, y + hh);
    return;
  }
  if (mode === "pentagon") {
    polygon(x, y, min(w, h) * 0.52, 5);
    return;
  }
    if (mode === "hexagon") {
    polygon(x, y, min(w, h) * 0.52, 6);
    return;
  }
  if (mode === "diamond") {
    const hw = w * 0.5;
    const hh = h * 0.5;
    quad(x, y - hh, x + hw, y, x, y + hh, x - hw, y);
    return;
  }
  if (mode === "ring") {
    ellipseMode(CENTER);
    const d = min(w, h);
    strokeWeight(max(2, d * 0.08));
    noFill();
    ellipse(x, y, d, d);
    return;
  }
  if (mode === "star") {
    star(x, y, min(w, h) * 0.22, min(w, h) * 0.52, 5);
    return;
  }
  ellipseMode(CENTER);
  ellipse(x, y, w, h);
}

// Generic polygon helper (used for pentagon and star).
function polygon(x, y, radius, npoints) {
  beginShape();
  for (let a = 0; a < TWO_PI; a += TWO_PI / npoints) {
    vertex(x + cos(a) * radius, y + sin(a) * radius);
  }
  endShape(CLOSE);
}
function star(x, y, radius1, radius2, npoints) {
  const angle = TWO_PI / npoints;
  const halfAngle = angle / 2.0;
  beginShape();
  for (let a = 0; a < TWO_PI; a += angle) {
    vertex(x + cos(a) * radius2, y + sin(a) * radius2);
    vertex(x + cos(a + halfAngle) * radius1, y + sin(a + halfAngle) * radius1);
  }
  endShape(CLOSE);
}


// Bursts
// Beat “rings” expand and fade out over time.
// They’re intentionally simple so they stay smooth even when lots of them spawn.
function updateBursts() {
  for (let b of bursts) {
    b.r += 20 + beatPunch * 26;
    b.life *= 0.90;
  }
  bursts = bursts.filter(b => b.life > 0.06);
}

function drawBursts() {
  const energy = constrain(rmsS * 5.0 * intensity, 0, 1);
  const a = map(energy, 0, 1, 35, 120) + beatPunch * 140;

  noFill();
  for (let b of bursts) {
    // Outer ring
    stroke(255, 255, 255, a * b.life);
    strokeWeight(2 + beatPunch * 3);
    circle(b.x, b.y, b.r);

    // Inner thicker ring for extra punch
    stroke(255, 255, 255, (a * 0.7) * b.life);
    strokeWeight(6 + beatPunch * 5);
    circle(b.x, b.y, b.r * 0.6);
  }
}

// window resize
// Kept as an empty stub so resizing doesn’t crash anything (and it’s easy to extend later if needed).
function windowResized() {}
