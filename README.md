# Audio CAPTCHA, Meyda Music Visualiser & Voice Control

A browser-based intelligent signal processing application built with **JavaScript, p5.js, p5.sound, Meyda and p5.speech**.

The project combines three audio/speech tasks in one interface:

1. a four-digit audio CAPTCHA;
2. a music visualiser driven by extracted audio features and custom onset detection;
3. speech-command control for visual background colours and shape styles.

All original project files are preserved unchanged.

## Task 1 — Four-Digit Audio CAPTCHA

The application generates a random four-digit code and speaks the digits using text-to-speech.

The CAPTCHA adds an audio masking layer using a processing chain:

```text
White Noise
    ↓
Low-Pass Filter
    ↓
Distortion
    ↓
Gain
    ↓
Output
```

The original implementation uses:

```text
p5.Noise
p5.LowPass
p5.Distortion
p5.Gain
p5.Speech
```

### CAPTCHA generation

Each time the CAPTCHA is played:

- a new four-digit number is generated;
- the digits are separated for clearer speech playback;
- speech rate and pitch are varied;
- the low-pass cutoff is randomised;
- the distortion amount is randomised;
- filtered/distorted white noise is played underneath the spoken digits;
- the user enters the digits into the input field;
- the number of attempts is tracked;
- the answer is checked against the generated code.

The application provides separate controls to:

- generate and play a CAPTCHA;
- generate new digits;
- submit an answer.

### CAPTCHA spectrum

A dedicated FFT visualisation displays the CAPTCHA masking-noise spectrum while the CAPTCHA is active.

The original configuration uses:

```text
FFT smoothing: 0.85
FFT bins:      64
```

The CAPTCHA spectrum is drawn on a separate HTML canvas so it remains independent of the main music visualisation.

## Task 2 — Meyda Music Visualisation

The second task plays supplied audio files and analyses them in real time.

The available project audio is:

```text
assets/Ex2_sound1.wav
assets/Ex2_sound2.wav
assets/Ex2_sound3.wav
assets/Kalte_Ohren_(_Remix_).mp3
```

The player provides:

- sound selection;
- play;
- pause;
- stop.

The browser `HTMLAudioElement` is connected to the Web Audio graph and analysed using **Meyda**.

## Extracted Audio Features

The Meyda analyser extracts:

```text
RMS
Spectral Centroid
Zero-Crossing Rate
Spectral Rolloff
Spectral Flatness
Amplitude Spectrum
```

The project also calculates its own frame-to-frame spectral-flux value from the amplitude spectrum.

Extracted features are smoothed before they are used to drive the graphics, reducing frame-to-frame visual jitter.

## Custom Beat / Onset Detection

The project implements its own onset-response system rather than relying only on raw feature values.

The onset engine combines:

```text
70% spectral-flux contribution
30% RMS energy contribution
```

It then maintains a moving floor and peak to normalise the onset signal.

The logic also includes:

- an adaptive threshold;
- stronger thresholding for quieter sections;
- a cooldown period to reduce repeated triggering;
- pulse decay;
- punch decay;
- beat-triggered camera shake;
- burst-particle generation.

The derived signals include:

```text
beatPulse
beatPunch
shake
```

These values control the strength and timing of the visual response.

## Audio-Reactive Visuals

The main p5 canvas reacts to the analysed music rather than depending only on manual interaction.

The visual system includes:

- moving geometric shapes;
- beat-driven size changes;
- beat-driven speed changes;
- particle/burst effects;
- optional visual trails;
- beat-triggered brightness flashes;
- subtle camera shake;
- mouse parallax;
- intensity adjustment.

The project maps spectral and energy information to the visual background.

For example, the audio-driven background uses:

- spectral centroid;
- spectral rolloff;
- RMS energy;
- beat pulse;
- beat punch.

### Track-dependent behaviour

When the selected audio changes, the application resets feature/onset state and rebuilds the visual field so previous-track feature peaks do not affect the new track.

The source also contains safe audio-path resolution logic that tries several relative folders and filename variants before starting playback.

## Task 3 — Voice-Controlled Visuals

The third task uses `p5.SpeechRec` for continuous English speech recognition:

```text
Language: en-US
Continuous recognition: enabled
Interim results: disabled
```

The recognised command text is displayed in the interface and parsed using keyword matching.

## Voice Background Commands

Supported colour keywords include:

```text
black
white
red
blue
green
purple
pink
orange
yellow
teal
gray / grey
```

When a recognised phrase contains one of these words, the visual background mode is updated.

## Voice Shape Commands

Supported shape keywords include:

```text
square
triangle
circle
pentagon
hexagon
star
diamond
ring
```

The selected shape style is displayed in the interface and used by the visual renderer.

A user can also disable voice-controlled background colouring and allow the music-analysis features to drive the background instead.

## Additional Visual Interaction

The original interface also includes direct interaction controls.

Examples documented in the source include:

```text
B                  toggle beat bursts
Mouse movement     visual parallax
Mouse wheel        intensity adjustment
Canvas click       visual brightness/trail interaction
```

## Project Structure

```text
audio-captcha-meyda-voice-control/
├── README.md
├── .gitignore
├── ORIGINAL_FILES_VERIFIED.txt
├── index.html
├── sketch.js
├── style.css
├── assets/
│   ├── Ex2_sound1.wav
│   ├── Ex2_sound2.wav
│   ├── Ex2_sound3.wav
│   └── Kalte_Ohren_(_Remix_).mp3
└── libraries/
    ├── meyda.min.js
    ├── p5.js
    ├── p5.min.js
    ├── p5.sound.min.js
    └── p5.speech.js
```

## Technologies

- JavaScript
- HTML
- CSS
- p5.js
- p5.sound
- p5.speech
- Meyda
- Web Audio API
- FFT analysis
- audio feature extraction
- speech recognition
- text-to-speech
- real-time generative visualisation

## Running the Project

The project should be served through a local web server rather than opened directly with `file://`.

From the project directory:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

in a modern browser.

Browser audio policies require a user interaction before audio begins, which is why playback is triggered through interface buttons.

The voice-control feature requires microphone permission and browser speech-recognition support.

## Original-File Preservation

All original HTML, JavaScript, CSS, library files, WAV files and MP3 audio were copied byte-for-byte without modifying their contents.

Only repository-support files were added:

```text
README.md
.gitignore
ORIGINAL_FILES_VERIFIED.txt
```

Operating-system metadata such as `.DS_Store` is excluded.

## Author

**Zimmel Javed Virk**  
BSc Computer Science — University of London
