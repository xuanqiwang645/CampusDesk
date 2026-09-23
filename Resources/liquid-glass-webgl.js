/* global THREE */

const MAX_RECTS = 32;
const MAX_CIRCLES = 16;
const root = document.documentElement;
const canvas = document.getElementById('liquid-glass-canvas');

function failGracefully(reason) {
  root.classList.remove('webgl-liquid-glass');
  root.classList.add('no-webgl-liquid-glass');
  if (canvas) canvas.hidden = true;
  console.warn('Liquid Glass disabled:', reason);
}

if (!canvas) {
  failGracefully('missing canvas');
} else {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required for textureLod');
    // This canvas is a decorative material layer behind sharp DOM content.
    // A 1.25x cap keeps it crisp while avoiding a 4x Retina pixel workload.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const backgroundScene = new THREE.Scene();
    const compositeScene = new THREE.Scene();
    const glassScene = new THREE.Scene();

    const backgroundMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) } },
      vertexShader: `
        precision highp float;
        in vec3 position;
        in vec2 uv;
        out vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        precision highp float;
        in vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;
        out vec4 outColor;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }
        void main() {
          vec2 uv = vUv;
          float aspect = uResolution.x / max(uResolution.y, 1.0);
          vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
          float drift = uTime * 0.025;
          vec3 base = mix(vec3(0.945, 0.955, 0.920), vec3(0.985, 0.975, 0.940), uv.y);
          float mint = exp(-3.1 * length(p - vec2(0.42 + 0.05 * sin(drift), 0.30)));
          float aqua = exp(-4.2 * length(p - vec2(-0.54, -0.28 + 0.04 * cos(drift * 1.3))));
          float amber = exp(-5.0 * length(p - vec2(0.12, -0.50)));
          vec2 gridUv = uv * vec2(24.0 * aspect, 24.0);
          vec2 line = smoothstep(vec2(0.965), vec2(0.995), abs(fract(gridUv) - 0.5) * 2.0);
          float grid = max(line.x, line.y) * 0.018;
          float grain = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
          vec3 color = base + mint * vec3(0.045, 0.105, 0.070) + aqua * vec3(0.018, 0.080, 0.065) + amber * vec3(0.050, 0.030, 0.005);
          color -= grid;
          color += grain;
          outColor = vec4(color, 1.0);
        }
      `
    });
    backgroundScene.add(new THREE.Mesh(geometry, backgroundMaterial));

    // Reuse the already-rendered background for the screen pass. Re-evaluating
    // the procedural background shader a second time used to double its cost.
    const compositeMaterial = new THREE.MeshBasicMaterial({ map: null, toneMapped: false });
    compositeScene.add(new THREE.Mesh(geometry, compositeMaterial));

    const rects = Array.from({ length: MAX_RECTS }, () => new THREE.Vector4(99, 99, 0, 0));
    const radii = new Float32Array(MAX_RECTS);
    const circles = Array.from({ length: MAX_CIRCLES }, () => new THREE.Vector3(99, 99, 0));
    const glassUniforms = {
      paintComposeRT: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uRectCount: { value: 0 },
      uCircleCount: { value: 0 },
      uRects: { value: rects },
      uRadii: { value: radii },
      uCircles: { value: circles },
      uIOR: { value: 1.46 },
      uDispersion: { value: 0.012 },
      uGlassThickness: { value: 0.082 },
      uNormalTransition: { value: 0.055 },
      uBackgroundDistance: { value: 0.72 }
    };

    const glassMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: glassUniforms,
      vertexShader: `
        precision highp float;
        in vec3 position;
        in vec2 uv;
        out vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        precision highp float;
        precision highp sampler2D;
        #define MAX_RECTS ${MAX_RECTS}
        #define MAX_CIRCLES ${MAX_CIRCLES}

        in vec2 vUv;
        uniform sampler2D paintComposeRT;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform int uRectCount;
        uniform int uCircleCount;
        uniform vec4 uRects[MAX_RECTS];
        uniform float uRadii[MAX_RECTS];
        uniform vec3 uCircles[MAX_CIRCLES];
        uniform float uIOR;
        uniform float uDispersion;
        uniform float uGlassThickness;
        uniform float uNormalTransition;
        uniform float uBackgroundDistance;
        out vec4 outColor;

        float sdCircle(vec2 p, float radius) { return length(p) - radius; }
        float sdRoundedBox(vec2 p, vec2 halfSize, float radius) {
          vec2 q = abs(p) - halfSize + radius;
          return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
        }
        float smin(float a, float b, float k) {
          float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
          return mix(b, a, h) - k * h * (1.0 - h);
        }
        float quintic(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

        vec2 animatedPoint(vec2 p) {
          float phase = uTime * 0.36;
          vec2 flow = vec2(
            sin(p.y * 3.1 + phase) + 0.45 * sin(p.x * 4.7 - phase * 0.63),
            cos(p.x * 2.8 - phase * 0.82) + 0.40 * sin(p.y * 5.2 + phase * 0.54)
          );
          return p + flow * 0.0014;
        }
        float glassSurfaceSdf(vec2 p) {
          vec2 q = animatedPoint(p);
          float d = 10.0;
          for (int i = 0; i < MAX_RECTS; ++i) {
            if (i >= uRectCount) break;
            vec4 shape = uRects[i];
            float item = sdRoundedBox(q - shape.xy, shape.zw, uRadii[i]);
            d = i == 0 ? item : smin(d, item, 0.010);
          }
          for (int i = 0; i < MAX_CIRCLES; ++i) {
            if (i >= uCircleCount) break;
            vec3 shape = uCircles[i];
            float item = sdCircle(q - shape.xy, shape.z);
            d = (uRectCount == 0 && i == 0) ? item : smin(d, item, 0.008);
          }
          return d;
        }
        float surfaceHeight(vec2 p) {
          float sdf = glassSurfaceSdf(p);
          float interior = max(-sdf, 0.0);
          float bevel = uNormalTransition * 0.82;
          float t = clamp(interior / max(bevel, 0.0001), 0.0, 1.0);
          return uGlassThickness * quintic(t);
        }
        vec3 surfaceNormal(vec2 p, float aspect) {
          float stepSize = clamp(uNormalTransition * 0.13, 0.003, 0.012);
          float hx = surfaceHeight(p + vec2(stepSize * aspect, 0.0)) - surfaceHeight(p - vec2(stepSize * aspect, 0.0));
          float hy = surfaceHeight(p + vec2(0.0, stepSize)) - surfaceHeight(p - vec2(0.0, stepSize));
          hx /= max(2.0 * stepSize * aspect, 0.0001);
          hy /= max(2.0 * stepSize, 0.0001);
          return normalize(vec3(-hx, -hy, 1.0));
        }
        vec2 traceBackground(vec2 p, float height, vec3 frontNormal, float ior, float aspect) {
          vec3 incident = vec3(0.0, 0.0, -1.0);
          vec3 insideRay = refract(incident, frontNormal, 1.0 / ior);
          float glassPath = height / max(-insideRay.z, 0.025);
          vec3 backPoint = vec3(p, height) + insideRay * glassPath;
          vec3 outsideRay = refract(insideRay, vec3(0.0, 0.0, 1.0), ior);
          if (dot(outsideRay, outsideRay) < 0.01) outsideRay = reflect(insideRay, vec3(0.0, 0.0, 1.0));
          float airPath = (-uBackgroundDistance - backPoint.z) / min(outsideRay.z, -0.025);
          vec2 hit = backPoint.xy + outsideRay.xy * airPath;
          return vec2(hit.x / aspect, hit.y) + 0.5;
        }
        float distributionGGX(vec3 n, vec3 h, float roughness) {
          float a = roughness * roughness;
          float a2 = a * a;
          float nh = max(dot(n, h), 0.0);
          float denom = nh * nh * (a2 - 1.0) + 1.0;
          return a2 / max(3.14159265 * denom * denom, 0.0001);
        }
        float geometrySchlick(float nv, float roughness) {
          float k = pow(roughness + 1.0, 2.0) / 8.0;
          return nv / max(nv * (1.0 - k) + k, 0.0001);
        }
        vec3 sampleDispersion(vec2 p, float height, vec3 n, float aspect, float lod, float edgeAmount) {
          vec2 uvG = traceBackground(p, height, n, uIOR, aspect);
          vec2 uvR = traceBackground(p, height, n, uIOR - uDispersion * edgeAmount, aspect);
          vec2 uvB = traceBackground(p, height, n, uIOR + uDispersion * edgeAmount, aspect);
          uvR = clamp(uvR, vec2(0.001), vec2(0.999));
          uvG = clamp(uvG, vec2(0.001), vec2(0.999));
          uvB = clamp(uvB, vec2(0.001), vec2(0.999));
          return vec3(textureLod(paintComposeRT, uvR, lod).r,
                      textureLod(paintComposeRT, uvG, lod).g,
                      textureLod(paintComposeRT, uvB, lod).b);
        }
        void main() {
          float aspect = uResolution.x / max(uResolution.y, 1.0);
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
          float sdf = glassSurfaceSdf(p);
          float aa = max(fwidth(sdf), 0.00065);
          float mask = 1.0 - smoothstep(-aa, aa, sdf);
          if (mask <= 0.001) { outColor = vec4(0.0); return; }

          float interior = max(-sdf, 0.0);
          float bevel = uNormalTransition * 0.82;
          float t = clamp(interior / max(bevel, 0.0001), 0.0, 1.0);
          float height = uGlassThickness * quintic(t);
          vec3 n = surfaceNormal(p, aspect);
          float faceWeight = smoothstep(0.72, 1.0, t);
          float outerWeight = 1.0 - smoothstep(0.0, bevel * 0.34, interior);
          float innerWeight = clamp(1.0 - faceWeight - outerWeight * 0.55, 0.0, 1.0);
          float edgeAmount = clamp(innerWeight + outerWeight, 0.0, 1.0);

          vec3 face = sampleDispersion(p, height, n, aspect, 0.20, 0.0);
          vec3 inner = sampleDispersion(p, height, n, aspect, 1.35, edgeAmount * 0.72);
          vec3 outer = sampleDispersion(p, height, n, aspect, 2.65, edgeAmount);
          vec3 refracted = face * faceWeight + inner * innerWeight + outer * outerWeight * (1.0 - innerWeight);
          refracted /= max(faceWeight + innerWeight + outerWeight * (1.0 - innerWeight), 0.001);

          vec3 view = vec3(0.0, 0.0, 1.0);
          vec3 light = normalize(vec3(-0.42, 0.58, 0.70));
          vec3 halfVector = normalize(view + light);
          float nv = max(dot(n, view), 0.0);
          float nl = max(dot(n, light), 0.0);
          float lh = max(dot(light, halfVector), 0.0);
          float f0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
          float fresnel = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
          float roughness = mix(0.12, 0.24, edgeAmount);
          float D = distributionGGX(n, halfVector, roughness);
          float G = geometrySchlick(nv, roughness) * geometrySchlick(nl, roughness);
          float F = f0 + (1.0 - f0) * pow(1.0 - lh, 5.0);
          float specular = D * G * F / max(4.0 * nv * nl, 0.001);
          float rim = pow(1.0 - nv, 2.4) * edgeAmount;
          vec3 color = refracted;
          color += vec3(0.94, 1.0, 0.975) * (specular * nl * 0.34 + rim * 0.10 + fresnel * outerWeight * 0.07);
          color = mix(color, vec3(0.91, 0.975, 0.94), 0.035 + outerWeight * 0.06);
          float alpha = mask * mix(0.56, 0.82, edgeAmount);
          outColor = vec4(color, alpha);
        }
      `
    });
    glassScene.add(new THREE.Mesh(geometry, glassMaterial));

    let paintComposeRT = null;
    let shapesDirty = true;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastFrame = -Infinity;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const glassSelectors = [
      '.sidebar', '.topbar', '.card', '.class-clock', '.connect-banner',
      '.board-hero', '.board-kpi', '.board-task-section', '.board-mini-card', '.board-task-card',
      '.button-light', '.icon-button', '.focus-button', '.check-button', '.board-check',
      '.brand-mark', '.nav-item > .icon', '.card-title > .icon', '.banner-icon', '.clock-mark', '.empty-illustration'
    ].join(',');

    function roundedRadius(element, rect) {
      const raw = getComputedStyle(element).borderTopLeftRadius;
      const parsed = Number.parseFloat(raw) || Math.min(rect.width, rect.height) * 0.16;
      return Math.min(parsed, rect.width * 0.5, rect.height * 0.5);
    }
    function updateShapes() {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      const aspect = width / height;
      const unique = [...new Set(document.querySelectorAll(glassSelectors))]
        .map(element => ({ element, rect: element.getBoundingClientRect() }))
        .filter(item => item.rect.width > 10 && item.rect.height > 10 && item.rect.bottom > 0 && item.rect.top < height && item.rect.right > 0 && item.rect.left < width);
      let rectCount = 0;
      let circleCount = 0;
      for (const item of unique) {
        const { element, rect } = item;
        const radiusPx = roundedRadius(element, rect);
        const isCircle = Math.abs(rect.width - rect.height) < 3 && radiusPx >= Math.min(rect.width, rect.height) * 0.44;
        const centerX = ((rect.left + rect.width * 0.5) / width - 0.5) * aspect;
        const centerY = 0.5 - (rect.top + rect.height * 0.5) / height;
        if (isCircle && circleCount < MAX_CIRCLES) {
          circles[circleCount++].set(centerX, centerY, Math.min(rect.width / width * aspect, rect.height / height) * 0.5);
        } else if (rectCount < MAX_RECTS) {
          rects[rectCount].set(centerX, centerY, rect.width / width * aspect * 0.5, rect.height / height * 0.5);
          radii[rectCount] = radiusPx / height;
          rectCount++;
        }
      }
      for (let i = rectCount; i < MAX_RECTS; i++) { rects[i].set(99, 99, 0, 0); radii[i] = 0; }
      for (let i = circleCount; i < MAX_CIRCLES; i++) circles[i].set(99, 99, 0);
      glassUniforms.uRectCount.value = rectCount;
      glassUniforms.uCircleCount.value = circleCount;
      shapesDirty = false;
    }
    function resize() {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      if (width === lastWidth && height === lastHeight && paintComposeRT) return;
      lastWidth = width;
      lastHeight = height;
      renderer.setSize(width, height, false);
      const pixelRatio = renderer.getPixelRatio();
      if (paintComposeRT) paintComposeRT.dispose();
      paintComposeRT = new THREE.WebGLRenderTarget(Math.ceil(width * pixelRatio), Math.ceil(height * pixelRatio), {
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        generateMipmaps: true,
        depthBuffer: false,
        stencilBuffer: false,
        colorSpace: THREE.SRGBColorSpace
      });
      backgroundMaterial.uniforms.uResolution.value.set(width, height);
      glassUniforms.uResolution.value.set(width, height);
      glassUniforms.paintComposeRT.value = paintComposeRT.texture;
      compositeMaterial.map = paintComposeRT.texture;
      compositeMaterial.needsUpdate = true;
      shapesDirty = true;
    }
    function renderFrame(milliseconds) {
      if (!reducedMotion.matches && milliseconds - lastFrame < 40) { requestAnimationFrame(renderFrame); return; }
      lastFrame = milliseconds;
      resize();
      if (shapesDirty) updateShapes();
      const seconds = milliseconds * 0.001;
      backgroundMaterial.uniforms.uTime.value = seconds;
      glassUniforms.uTime.value = seconds;

      // Pass 1 — Background into paintComposeRT. Three.js generates the mip chain.
      renderer.setRenderTarget(paintComposeRT);
      renderer.clear();
      renderer.render(backgroundScene, camera);
      // WebGLRenderer completes each render-target pass by generating the
      // configured mip chain before the target is sampled by the Glass pass.

      // Pass 2 — paintComposeRT to screen, then Glass reads only that texture.
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(compositeScene, camera);
      renderer.render(glassScene, camera);

      if (!reducedMotion.matches) requestAnimationFrame(renderFrame);
    }
    function invalidate() {
      shapesDirty = true;
      if (reducedMotion.matches) requestAnimationFrame(renderFrame);
    }

    addEventListener('resize', invalidate, { passive: true });
    addEventListener('scroll', invalidate, { passive: true });
    new MutationObserver(invalidate).observe(document.getElementById('app-shell'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-dashboard-theme'] });
    if ('ResizeObserver' in window) new ResizeObserver(invalidate).observe(document.getElementById('app-shell'));
    reducedMotion.addEventListener?.('change', invalidate);

    root.classList.add('webgl-liquid-glass');
    canvas.hidden = false;
    requestAnimationFrame(renderFrame);
  } catch (error) {
    failGracefully(error && error.message ? error.message : String(error));
  }
}
