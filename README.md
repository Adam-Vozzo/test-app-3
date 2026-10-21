# RIFT — Adaptive Score Instrument

An adaptive game soundtrack you can play in the browser. RIFT runs an original
score in E Phrygian at 142 BPM through an SNES-style sample engine, and reshapes
the arrangement as an encounter unfolds: **Explore → Tension → Combat → Overdrive**.

It is a static site with no build step, so it runs directly on GitHub Pages.

## Features

- **Four intensity states.** Click a card or press <kbd>1</kbd>–<kbd>4</kbd>. Changes land on the next bar so the pulse never breaks, and a tom fill leads into each escalation.
- **Automatic encounter.** A 74-second arc of exploration, rising threat, battle and release drives the threat level, which picks the state. Drag the threat slider to take over by hand.
- **Live events.** Each event is quantised to the grid:
  - *Enemy down* (<kbd>K</kbd>) fires an accent.
  - *Arena cleared* (<kbd>C</kbd>) plays a fanfare and releases back to Explore.
  - *Low health* (<kbd>H</kbd>) closes a low-pass filter over the score and adds a heartbeat.
- **Six sound layers.** Atmosphere, low pulse, rhythm, percussion, melody and accents. Each has a live step view, a volume slider and an on/off switch.
- **Cartridge palettes.** There are 12 built-in banks voiced after classic SNES soundtracks. Choose a preset mix, apply one game to every layer, or click a layer's source to pick a cartridge and blend in a second one. Blended kits split their lanes; blended melodic parts double.
- **Load your own `.sf2` soundfonts.** Drop or browse a SoundFont 2 file, such as an SNES soundtrack rip. Presets are matched to each layer's role, and you can pick any preset per layer.
- **SNES sample engine.** Every built-in instrument is rendered as a short looped sample at 32 kHz (16 kHz for the lo-fi banks). Each one goes through a real BRR 4-bit ADPCM encode/decode, then plays back with per-voice pitch, ADSR and vibrato. All layers share an S-DSP-style feedback echo.
- **Direct stereo capture.** *Record capture* saves the master output as a 16-bit stereo WAV.
- **Remembers your settings.** Master volume, layer volumes, switches and cartridge choices are saved in your browser.

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>1</kbd>–<kbd>4</kbd> | Explore, Tension, Combat, Overdrive |
| <kbd>K</kbd> | Enemy down |
| <kbd>C</kbd> | Arena cleared |
| <kbd>H</kbd> | Toggle low health |
| <kbd>A</kbd> | Toggle automatic encounter |

## Publish on GitHub Pages

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the branch that holds these files and the **/ (root)** folder, then **Save**.
4. After a minute the site is live at `https://<user>.github.io/<repo>/`.

All paths are relative, so the site works from a project subpath. The empty
`.nojekyll` file tells Pages to serve the files as-is.

## Run locally

ES modules need to be served over HTTP rather than opened from disk:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project layout

```
index.html            page markup
css/style.css         styles
js/main.js            UI wiring, encounter logic, settings
js/score.js           states, chord progressions, patterns, stingers, encounter arc
js/audio/engine.js    Web Audio graph, echo, lookahead sequencer, transport
js/audio/synth.js     sample renderer (tones, plucks, mallets, FM, drums) and playback
js/audio/brr.js       SNES BRR codec
js/audio/banks.js     instrument recipes, drum kits, cartridge banks, mixes
js/audio/sf2.js       SoundFont 2 parser and player
js/audio/recorder.js  WAV capture
js/ui/scope.js        oscilloscope
```

## A note on the cartridges

RIFT ships no ROM data or ripped samples. The built-in banks are synthesised
approximations voiced after the instrumentation of each game's soundtrack. Game
titles are trademarks of their respective owners and are used only to describe
those palettes. For authentic samples, load a SoundFont you have the rights to use.
