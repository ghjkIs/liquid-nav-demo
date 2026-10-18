/*!
 * liquid-nav.js — raymarched SDF "liquid glass" active-tab indicator.
 * Vanilla ES module, no deps. Overlays a WebGL canvas BEHIND existing DOM tab buttons.
 *
 *   import { attachLiquidNav } from './liquid-nav.js';
 *   const nav = attachLiquidNav(barEl, { tabs: barEl.querySelectorAll('button'), active: 0 });
 *   nav.setActive(2);   nav.destroy();
 *
 * Or as a custom element:  <liquid-nav active="0"><button>..</button>...</liquid-nav>
 *   (dispatches 'liquid-change' {detail:{index}})
 */
const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAG = `
precision mediump float;
uniform vec2 uRes;      // canvas px
uniform float uDpr, uT;
uniform vec4 uBar;      // bar center xy, half size xy (px)
uniform vec3 uA;        // main blob x, y, halfwidth
uniform vec3 uB;        // detaching droplet (prev tab) x, y, radius
uniform vec3 uC;        // arriving droplet (target)  x, y, radius
uniform float uVel;     // signed velocity (px/frame-ish) -> stretch
uniform vec4 uHover;    // hover x, y, strength, start time
uniform float uRad, uTint;
uniform vec3 uCol;

float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float sdRBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}

// 2D field of the liquid indicator
float blob2(vec2 p){
  // domain distortion: hover ripple
  vec2 dh=p-uHover.xy; float rd=length(dh);
  float age=uT-uHover.w;
  p+= (rd>0.?dh/rd:vec2(0.)) * uHover.z*2.2*sin(rd*.18-age*9.)*exp(-rd*.03)*exp(-age*1.6);
  // gooey wobble on the main body proportional to speed
  float s=clamp(abs(uVel)*.06,0.,.6);
  vec2 q=p-uA.xy;
  q.y*=1.+s*.45;                                   // squash vertically when fast
  q.y+=sin(q.x*.09+uT*6.)*s*2.5;                   // surface wobble
  float h=uA.z*(1.+s*.9);                          // stretch along motion
  float d=sdRBox(q,vec2(h,uRad*(1.-s*.25)),uRad*(1.-s*.25));
  d=smin(d,length(p-uB.xy)-uB.z,uRad*.9);          // detaching droplet
  d=smin(d,length(p-uC.xy)-uC.z,uRad*.9);          // arriving droplet
  return d;
}
// extruded rounded slab -> 3D SDF
float map(vec3 p){
  float d=blob2(p.xy); float H=uRad*.55;
  vec2 w=vec2(d+H,abs(p.z)-0.);
  return min(max(w.x,w.y),0.)+length(max(w,0.))-H;
}
vec3 nrm(vec3 p){vec2 e=vec2(1.,0.);
  return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
vec3 env(vec3 d){ // cheap studio environment
  float y=d.y*.5+.5;
  vec3 c=mix(vec3(.08,.09,.12),vec3(.75,.8,.9),smoothstep(-.2,1.,d.z));
  c+=vec3(1.)*pow(max(dot(d,normalize(vec3(-.4,.7,.6))),0.),24.)*1.6;
  c+=uCol*.6*smoothstep(.2,1.,y)*(1.-abs(d.x));
  return c;
}
void main(){
  vec2 px=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;
  // quick 2D reject: outside the blob's influence -> transparent
  float d2=blob2(px);
  if(d2>3.){gl_FragColor=vec4(0.);return;}
  vec3 ro=vec3(px,uRad*2.), rd=vec3(0,0,-1);
  float t=0.; bool hit=false;
  for(int i=0;i<20;i++){float d=map(ro+rd*t); if(d<.05){hit=true;break;} t+=d; if(t>uRad*4.)break;}
  float edgeA=1.-smoothstep(-1.,1.,d2);
  if(!hit){gl_FragColor=vec4(uCol*.2*edgeA,.2*edgeA);return;}
  vec3 pos=ro+rd*t, n=nrm(pos); n.y=-n.y;           // screen y down -> flip
  vec3 v=-rd;
  float fr=.04+.96*pow(1.-max(dot(n,v),0.),5.);     // Schlick fresnel
  vec3 rfr=refract(-v,n,1./1.45);                   // glass refraction
  vec3 col=mix(env(rfr)*mix(vec3(1.),uCol,uTint),env(reflect(-v,n)),fr);
  float rim=pow(1.-n.z,3.);
  col+=rim*.25*uCol;
  // chromatic edge fringe
  col.r+=.08*rim*sin(pos.x*.05+uT); col.b+=.08*rim*cos(pos.x*.05-uT);
  float a=clamp(.55+fr*.9+rim*.35,0.,1.)*edgeA;
  gl_FragColor=vec4(col*a,a);                        // premultiplied
}`;

export function attachLiquidNav(container, opts = {}) {
  const o = Object.assign({ active: 0, color: [0.35, 0.65, 1.0], tint: 0.35,
    stiffness: 170, damping: 19, maxFps: 60, onChange: null, swipe: true }, opts);
  let tabs = Array.from(o.tabs || container.children);
  const cs = getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '0' });
  container.prepend(cv);
  tabs.forEach(t => { t.style.position ||= 'relative'; t.style.zIndex = '1'; });

  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) { container.classList.add('liquid-nav-fallback'); return fallback(); }
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = {}; ['uRes','uDpr','uT','uBar','uA','uB','uC','uVel','uHover','uRad','uTint','uCol']
    .forEach(n => U[n] = gl.getUniformLocation(pr, n));
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // ---- layout
  let geo = [], W = 0, H = 0, dpr = 1, rad = 20;
  function measure() {
    const r = container.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // cap for iGPUs (HD 520)
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    geo = tabs.map(t => { const b = t.getBoundingClientRect();
      return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2, w: b.width, h: b.height }; });
    rad = Math.min(...geo.map(g => g.h)) * 0.42;
  }
  // ---- state (spring)
  let active = clamp(o.active, 0, tabs.length - 1), prev = active;
  let x = 0, v = 0, drag = null, lastSwitch = -9, hover = [0, 0, 0, -9];
  measure(); x = geo[active].x;
  const ro = new ResizeObserver(() => { measure(); if (!drag) x = geo[active]?.x ?? x; kick(); });
  ro.observe(container);

  function setActive(i, silent) {
    i = clamp(i, 0, tabs.length - 1); if (i === active) return;
    prev = active; active = i; lastSwitch = now();
    tabs.forEach((t, k) => t.setAttribute('aria-selected', k === i));
    if (!silent) { o.onChange?.(i); container.dispatchEvent(new CustomEvent('liquid-change', { detail: { index: i }, bubbles: true })); }
    kick();
  }
  const onClick = e => { const i = tabs.findIndex(t => t.contains(e.target)); if (i >= 0) setActive(i); };
  const onMove = e => { const r = container.getBoundingClientRect();
    const hx = e.clientX - r.left, hy = e.clientY - r.top;
    if (drag) { x = clamp(hx - drag.off, geo[0].x, geo.at(-1).x); drag.moved ||= Math.abs(hx - drag.sx) > 6; }
    if (Math.hypot(hx - hover[0], hy - hover[1]) > 30 || hover[2] === 0) hover = [hx, hy, 1, now()];
    kick(); };
  const onLeave = () => { hover[2] = 0; };
  const onDown = e => { if (!o.swipe) return; const r = container.getBoundingClientRect(); const hx = e.clientX - r.left;
    if (Math.abs(hx - x) < geo[active].w * 0.7) { drag = { off: hx - x, sx: hx, moved: false }; container.setPointerCapture?.(e.pointerId); } };
  const onUp = () => { if (!drag) return; const moved = drag.moved; drag = null;
    if (moved) { let best = 0; geo.forEach((g, k) => { if (Math.abs(g.x - x) < Math.abs(geo[best].x - x)) best = k; }); setActive(best); }
    kick(); };
  container.addEventListener('click', onClick);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);

  // ---- loop (sleeps when settled)
  const t0 = performance.now(); const now = () => (performance.now() - t0) / 1000;
  let raf = 0, lastT = now(), idle = 0, lastDraw = 0;
  function kick() { idle = 0; if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; const t = now(); let dt = Math.min(t - lastT, 1 / 30); lastT = t;
    if (t - lastDraw < 1 / o.maxFps - 0.002) { raf = requestAnimationFrame(frame); return; }
    lastDraw = t;
    const g = geo[active]; if (!g) return;
    if (!drag) { const a = o.stiffness * (g.x - x) - o.damping * v; v += a * dt; x += v * dt; }
    else v = 0;
    const g0 = geo[prev] || g, since = t - lastSwitch;
    // detaching droplet: shrinks at old tab over ~0.45s; arriving droplet grows at target
    const det = Math.max(0, 1 - since / 0.45), dist = Math.abs(g.x - x);
    const arr = Math.min(1, dist / (g.w * 0.8));
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform1f(U.uDpr, dpr); gl.uniform1f(U.uT, t);
    gl.uniform4f(U.uBar, W / 2, H / 2, W / 2, H / 2);
    const hw = Math.max(rad, g.w * 0.5 - 6);
    gl.uniform3f(U.uA, x, g.y, hw);
    gl.uniform3f(U.uB, g0.x, g0.y, rad * 0.8 * det * det);
    gl.uniform3f(U.uC, g.x, g.y, rad * 0.65 * arr);
    gl.uniform1f(U.uVel, v / 60);
    gl.uniform4f(U.uHover, hover[0], hover[1], hover[2], hover[3]);
    gl.uniform1f(U.uRad, rad); gl.uniform1f(U.uTint, o.tint); gl.uniform3fv(U.uCol, o.color);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const moving = Math.abs(v) > 0.5 || Math.abs(g.x - x) > 0.3 || det > 0 || (hover[2] && t - hover[3] < 2.5) || drag;
    idle = moving ? 0 : idle + 1;
    if (idle < 3) raf = requestAnimationFrame(frame);
  }
  kick();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) o.stiffness = 600, o.damping = 50;

  return {
    setActive: i => setActive(i, true), get active() { return active; }, canvas: cv,
    setTabs(list) { tabs = Array.from(list); measure(); kick(); }, refresh() { measure(); kick(); },
    setColor(c) { o.color = c; kick(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); cv.remove();
      ['click','pointermove','pointerleave','pointerdown','pointerup','pointercancel'].forEach((ev, k) =>
        container.removeEventListener(ev, [onClick, onMove, onLeave, onDown, onUp, onUp][k]));
      gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  };
  function fallback() { // CSS pill if no WebGL
    const pill = document.createElement('div'); pill.className = 'liquid-nav-pill'; container.prepend(pill);
    const put = i => { const r = container.getBoundingClientRect(), b = tabs[i].getBoundingClientRect();
      Object.assign(pill.style, { position: 'absolute', left: b.left - r.left + 'px', top: b.top - r.top + 'px', width: b.width + 'px', height: b.height + 'px',
        borderRadius: '999px', background: 'rgba(255,255,255,.18)', transition: 'all .35s cubic-bezier(.3,1.4,.5,1)' }); };
    put(active); const c = e => { const i = tabs.findIndex(t => t.contains(e.target)); if (i >= 0) { active = i; put(i); o.onChange?.(i); } };
    container.addEventListener('click', c);
    return { setActive(i) { active = i; put(i); }, get active() { return active; }, refresh() { put(active); }, setTabs(l){tabs=Array.from(l);put(active);}, setColor(){}, destroy() { pill.remove(); container.removeEventListener('click', c); } };
  }
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ---- custom element wrapper
if (typeof customElements !== 'undefined' && !customElements.get('liquid-nav')) {
  customElements.define('liquid-nav', class extends HTMLElement {
    static get observedAttributes() { return ['active']; }
    connectedCallback() { requestAnimationFrame(() => {
      this.nav = attachLiquidNav(this, { tabs: this.querySelectorAll(':scope > button, :scope > a, :scope > [role=tab]'),
        active: +this.getAttribute('active') || 0 }); }); }
    attributeChangedCallback(n, a, b) { this.nav?.setActive(+b); }
    disconnectedCallback() { this.nav?.destroy(); this.nav = null; }
  });
}
