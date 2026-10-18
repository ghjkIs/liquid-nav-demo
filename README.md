# liquid-nav

Raymarched SDF "liquid glass" active-tab indicator for a bottom pill navbar. Vanilla ES module, no dependencies.
Demo: `index.html`.

```js
import { attachLiquidNav } from './liquid-nav.js';
const nav = attachLiquidNav(barEl, { tabs: barEl.querySelectorAll('button'), active: 0, color: [.35,.65,1] });
nav.setActive(2); nav.refresh(); nav.destroy();
```
Or `<liquid-nav active="0"><button>…</button></liquid-nav>` (fires `liquid-change`).

Features: spring-driven gooey stretch, smooth-min droplets that detach/merge between tabs, drag/swipe to snap,
hover ripples (domain distortion), glass refraction + fresnel. Tuned for iGPUs (Intel HD 520): DPR capped at 1.5,
early 2D reject, 20-step march, render loop sleeps when settled, CSS fallback without WebGL.

## Home Assistant (navbar-card)
1. Copy `liquid-nav.js` to `/config/www/liquid-nav/`; add resource `/local/liquid-nav/liquid-nav.js?v=1` (JavaScript module).
2. Add a small loader resource that waits for `navbar-card`, finds the bar container and route buttons in its
   shadow root, and calls `attachLiquidNav(container, { tabs, active })` (active index from `location.pathname`).
3. Listen to HA's `location-changed` event and call `nav.setActive(i)`; navbar-card keeps handling navigation.
4. Call `nav.setTabs()/refresh()` if navbar-card re-renders; hide its native active pill via card-mod / `styles`.
Exact shadow-DOM selectors depend on your navbar-card version.
