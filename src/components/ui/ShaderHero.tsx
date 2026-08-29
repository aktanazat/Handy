import React, { useEffect, useRef } from "react";

export interface ShaderHeroProps {
  /** Laid over the accent. The accent itself is decorative and unlabelled. */
  children?: React.ReactNode;
  className?: string;
  /**
   * Fraction of the band's width, measured from the leading edge, that the
   * content column owns. The accent paints nothing there — no beam, no prism,
   * no fan — so a caller that reserves the same fraction in CSS can never end
   * up with the accent drawn across its own text. One number owns the
   * boundary; see `--ov-hero-glow-share` in overview.css for the pairing.
   */
  clear?: number;
}

/* Content owns the leading 62% of the band by default, the accent the trailing
 * 38%. Callers that lay out differently pass their own share. */
const DEFAULT_CLEAR_SHARE = 0.62;

/* Fraction of the device pixel ratio the canvas actually renders at. The
 * effect is all soft gradients, so half-resolution upscaled by the compositor
 * is indistinguishable at arm's length and costs a quarter of the fragments. */
const RENDER_SCALE = 0.65;

/* A full-viewport triangle addressed by gl_VertexID: no vertex buffer, no
 * attribute state, nothing to delete on teardown. */
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/* Light through a prism, in the smallest terms that still read as physics
 * rather than as a gradient: one thin beam, a wireframe prism it strikes, and
 * a spectral fan leaving the far face. Turbulence bends the fan slightly and
 * a little grain breaks the banding a conic-gradient cannot avoid. */
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform vec2 u_res;
uniform float u_time;
uniform float u_dark;
uniform float u_clear;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * valueNoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

// Distance to the segment ab, the one primitive both the beam and the prism
// outline are built from.
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// A cosine palette pulled most of the way back toward white: real dispersion
// off a small facet is pastel, and a saturated rainbow would read as a logo.
vec3 spectrum(float t) {
  vec3 band = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  return mix(vec3(1.0), band, 0.62);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  p.y = -p.y;

  // Containment: every optical term is multiplied by this, so nothing the
  // shader draws reaches the content column. Without it the beam is an
  // unbounded segment and paints a 1px line across the card behind the copy.
  float inside = smoothstep(u_clear, u_clear + 0.05, uv.x);
  float span = (1.0 - u_clear) * aspect;

  // Prism inside the reserved region: room to its left for the beam to arrive,
  // to its right for the fan to open.
  vec2 apex = vec2((u_clear - 0.5) * aspect + span * 0.42, 0.02);
  float drift = sin(u_time * 0.18) * 0.012;

  // Beam: a finite segment ending on the near face, its length a fraction of
  // the reserved region. That is what makes it a beam and not a streak.
  float reach = span * 0.44;
  vec2 entry = apex + vec2(-reach, reach * 0.72 + drift);
  float beamDistance = segment(p, entry, apex);
  float beam = pow(0.0045 / (beamDistance + 0.0045), 1.7);
  beam *= smoothstep(0.0, 0.18, apex.x - p.x + 0.05);

  // Prism: a wireframe triangle, present enough to explain the fan.
  vec2 v0 = apex + vec2(-0.055, 0.075);
  vec2 v1 = apex + vec2(-0.055, -0.075);
  vec2 v2 = apex + vec2(0.075, 0.0);
  float edge = min(min(segment(p, v0, v1), segment(p, v1, v2)), segment(p, v2, v0));
  float prism = pow(0.0024 / (edge + 0.0024), 1.5);

  // Exit fan: hue sweeps across the opening angle, turbulence bends it.
  vec2 q = p - v2;
  float radius = length(q);
  float angle = atan(q.y, q.x);
  angle += (fbm(q * 5.0 + vec2(u_time * 0.05, u_time * 0.02)) - 0.5) * 0.05;
  float spread = 0.17;
  float centre = -0.14 + drift * 0.6;
  float across = 1.0 - abs(angle - centre) / spread;
  float radial = smoothstep(0.0, 0.05, radius) * exp(-radius * 1.7);
  float fan = pow(max(across, 0.0) * radial, 1.35);
  float hue = clamp((angle - centre + spread) / (2.0 * spread), 0.0, 1.0);

  // Glint (beam + prism edges) and the dispersion band, both inheriting the
  // containment window, so the leading edge needs no fade of its own.
  float mask = inside;
  mask *= smoothstep(0.0, 0.10, uv.y) * smoothstep(1.0, 0.90, uv.y);
  mask *= smoothstep(1.0, 0.94, uv.x);
  float glint = (beam * 0.9 + prism * 0.35) * mask;
  float band = clamp(fan, 0.0, 1.0) * mask;

  // Warm paper in light, near-black in dark. On paper the spectrum has to
  // DARKEN the sheet to be seen: adding near-white light to a near-white
  // surface is what read as a smudge. Dark adds both, which is what makes dark
  // carry the effect.
  vec3 backdrop = mix(vec3(0.902, 0.890, 0.874), vec3(0.035, 0.035, 0.039), u_dark);
  vec3 tint = spectrum(hue) * mix(0.72, 1.30, u_dark);
  vec3 colour = mix(backdrop, tint, band * mix(0.95, 1.0, u_dark));
  colour += glint * mix(0.45, 1.0, u_dark);

  colour += (hash(gl_FragCoord.xy + fract(u_time) * 331.0) - 0.5) * 0.014;
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}`;

const compile = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("ShaderHero: shader failed", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
};

/**
 * The decorative accent behind the capture hero.
 *
 * Two layers over one container, which is Vercel's own progressive-enhancement
 * pattern: a conic-gradient placeholder paints on the first frame with zero
 * JavaScript, and a WebGL2 canvas fades in over it once its shader compiles.
 * If WebGL is unavailable the placeholder simply stays, so there is no
 * fallback branch to maintain.
 *
 * The loop only runs when it can be seen: it stops on window blur, on a hidden
 * document, when scrolled out of view, and permanently after one frame under
 * prefers-reduced-motion. Elapsed time accumulates only while running, so
 * resuming continues the motion instead of jumping.
 */
export const ShaderHero: React.FC<ShaderHeroProps> = ({
  children,
  className = "",
  clear = DEFAULT_CLEAR_SHARE,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (!vertex || !fragment || !program) return;

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    // The shader objects are only needed until the program links.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("ShaderHero: link failed", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);
    const uResolution = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uDark = gl.getUniformLocation(program, "u_dark");
    const uClear = gl.getUniformLocation(program, "u_clear");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let elapsed = 0;
    let lastFrame = 0;
    let frame = 0;
    let onScreen = true;
    let disposed = false;

    const draw = () => {
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(
        uDark,
        document.documentElement.dataset.theme === "light" ? 0 : 1,
      );
      gl.uniform1f(uClear, clear);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.dataset.ready = "true";
    };

    const tick = (now: number) => {
      elapsed += Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      draw();
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame === 0) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const start = () => {
      if (disposed || frame !== 0) return;
      if (reduceMotion.matches || !onScreen || document.hidden) return;
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const sync = () => {
      if (reduceMotion.matches || !onScreen || document.hidden) {
        stop();
        // One frame still paints, so a paused hero is a still image rather
        // than a hole where the accent should be.
        if (!disposed && onScreen) draw();
        return;
      }
      start();
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const ratio = (window.devicePixelRatio || 1) * RENDER_SCALE;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      draw();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    visibility.observe(host);

    const theme = new MutationObserver(() => {
      if (frame === 0) draw();
    });
    theme.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
    });

    window.addEventListener("blur", stop);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    reduceMotion.addEventListener("change", sync);

    resize();
    sync();

    return () => {
      disposed = true;
      stop();
      resizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      reduceMotion.removeEventListener("change", sync);
      /* Deleting the program releases what this mount allocated. The context
       * itself is deliberately left alive: getContext() hands back the SAME
       * object for a given canvas, so a WEBGL_lose_context call here would
       * poison the canvas for the very next mount — which under StrictMode is
       * immediate, and leaves the hero permanently blank. Dropping the
       * reference is enough; the context dies with its canvas. */
      gl.deleteProgram(program);
    };
  }, [clear]);

  return (
    <div
      ref={hostRef}
      className={`shader-hero ${className}`}
      /* The same fraction the shader clamps itself to, published as a custom
       * property so a caller's padding and the accent's containment cannot
       * drift apart. */
      /* SAFETY: a custom property is a valid inline style, but
         React.CSSProperties only indexes the known property names. */
      style={
        { "--shader-hero-clear": `${clear * 100}%` } as React.CSSProperties
      }
    >
      <div
        className="shader-hero-layer shader-hero-placeholder"
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="shader-hero-layer shader-hero-canvas"
        aria-hidden="true"
      />
      <div className="shader-hero-content">{children}</div>
    </div>
  );
};
