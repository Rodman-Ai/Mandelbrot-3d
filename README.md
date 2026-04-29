# Mandelbrot 3D Explorer

An interactive 3D Mandelbrot set game playable on desktop and mobile browsers — no installation required, runs entirely in WebGL.

## Live Demo

Open `index.html` in any modern browser. No build step, no server required.

## What It Is

The Mandelbrot set is rendered as a **3D landscape**: escape-time values are used both to colour the surface and to displace geometry vertically, creating mountain-like ridges and valleys that you can orbit, zoom, and explore.

A lightweight scoring system rewards deep dives into the fractal — milestones unlock as you push further into the infinite detail.

---

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Orbit (rotate view) | Left-click drag | Single-finger drag |
| Pan view | Right-click drag | Two-finger drag |
| Camera zoom | Scroll wheel | Pinch (2 fingers) |
| **Fractal zoom in** | **Scroll wheel** | **Pinch** |
| **Zoom into a point** | **Double-click** | **Double-tap** |

> **Fractal zoom** (scroll / pinch) zooms into the mathematical space of the set.  
> **Camera zoom** (OrbitControls) changes the 3D viewing angle only.

---

## Game Mechanics

| Element | Description |
|---|---|
| **Depth** | `floor(log₂(zoom))` — increases each time you zoom deeper |
| **Score** | Accumulates with depth; bonus points at milestone zooms |
| **Milestones** | Zoom thresholds that trigger trophy notifications and large point awards |

### Milestones

| Zoom Level | Trophy | Points |
|---|---|---|
| 10× | 🔭 Deep Diver | 100 |
| 100× | 🌀 Spiral Hunter | 250 |
| 1,000× | ⚡ Fractal Chaser | 500 |
| 10,000× | 🚀 Infinity Explorer | 1,000 |
| 1,000,000× | 🌌 Mandelbrot Master | 5,000 |

---

## Controls Panel

| Control | Effect |
|---|---|
| **Iterations** | Max escape-time iterations (32–512). Higher = more detail, lower = faster |
| **Height** | Vertical displacement scale of the 3D terrain |
| **Color** | Switch between 5 colour palettes |
| **Reset View** | Returns to default position and zoom |
| **Animate Colors** | Continuously cycles palette for a psychedelic effect |

### Colour Palettes

- **Neon** — full-spectrum rainbow cycle
- **Fire** — red → orange → white hot
- **Ice** — deep blue gradients
- **Gold** — warm amber tones
- **Psychedelic** — fast oscillating RGB

---

## Architecture

```
index.html     Entry point — canvas, HUD, controls panel markup
styles.css     All styling (dark sci-fi theme, responsive for mobile)
game.js        All logic — Three.js setup, GLSL shaders, game state, input
```

### Rendering Pipeline

1. **Heightmap pass** — a `512×512` `WebGLRenderTarget` renders Mandelbrot escape-time values to a floating-point texture using a flat screen-quad shader (`HM_FRAG`).
2. **3D plane pass** — a `256×256`-segment `PlaneGeometry` samples the heightmap texture in the vertex shader to displace geometry (`VERT_SHADER`), and uses a matching fragment shader (`FRAG_SHADER`) for colouring.
3. **OrbitControls** — Three.js `OrbitControls` handles camera rotation, pan, and damping.

### Shaders

| Shader | Purpose |
|---|---|
| `HM_VERT` / `HM_FRAG` | Screen-quad shader that bakes escape times into the heightmap RT |
| `VERT_SHADER` | Displaces mesh vertices by `heightmap.r × uHeightScale` |
| `FRAG_SHADER` | Smooth colouring using `n - log₂(log₂(‖z‖))` for band-free gradients |

Smooth colouring formula used in both shaders:
```glsl
float n = float(i) - log2(log2(dot(z, z))) + 4.0;
return n / float(uMaxIter);
```

---

## Performance Notes

- The heightmap rebakes whenever zoom, position, or iteration count changes. On slow devices, reduce **Iterations** or use a smaller browser window.
- `devicePixelRatio` is capped at `2×` to avoid GPU overload on high-DPI screens.
- The plane mesh uses 256 segments per side (~66k triangles) — reduce `PLANE_SEGS` in `game.js` for lower-end mobile devices.

---

## Browser Requirements

- WebGL 1.0 (all modern browsers since ~2012)
- Three.js r160 (loaded from CDN)
- No other dependencies

---

## Tips for Exploration

- Start by double-clicking on the **edge of the black region** — the boundary of the Mandelbrot set has infinite complexity.
- Zoom into the **"seahorse valley"** near `Re ≈ -0.75, Im ≈ 0.1` for classic spirals.
- The **"elephant valley"** near `Re ≈ 0.3, Im ≈ 0.01` produces layered elephant-trunk spirals.
- Increase **Iterations** as you zoom deeper to reveal finer detail.
- Enable **Animate Colors** and rotate the camera for a dramatic visual effect.
