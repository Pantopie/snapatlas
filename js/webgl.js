const _cube = (() => {
  let gl, prog, vBuf, iBuf, tex, raf;
  let uMVP, uTile, uUVScale, uAspect, aPos, aUV;
  let texScaleX = 1,
    texScaleY = 1; // fraction of POT canvas holding real pixels
  let texOrigW = 1,
    texOrigH = 1; // original (pre-pad) texture dimensions
  let angleY = 0,
    angleX = 0.4;
  let camDist = 2.4;
  let tileVal = 2.0; // 50% UV scale → 2 repeats per face
  let autoRotate = true;
  let userAutoRotate = true; // user preference — timer only re-enables if this is true
  let autoRestartTimer = null;
  let dragging = false,
    lastMX = 0,
    lastMY = 0;

  const VS = `
          attribute vec3 aPos;
          attribute vec2 aUV;
          uniform mat4 uMVP;
          uniform float uTile;
          uniform float uAspect;
          varying vec2 vUV;
          void main() {
            gl_Position = uMVP * vec4(aPos, 1.0);
            vUV = vec2(aUV.x * uTile, aUV.y * uTile * uAspect);
          }`;

  const FS = `
          precision mediump float;
          uniform sampler2D uTex;
          uniform vec2 uUVScale;
          varying vec2 vUV;
          void main() {
            gl_FragColor = texture2D(uTex, fract(vUV) * uUVScale);
          }`;

  // Column-major 4×4 helpers
  /** @param {Float32Array} a @param {Float32Array} b @returns {Float32Array} */
  function mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let row = 0; row < 4; row++)
        for (let k = 0; k < 4; k++)
          r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
    return r;
  }
  /**
   * @param {number} fov
   * @param {number} aspect
   * @param {number} near
   * @param {number} far
   * @returns {Float32Array}
   */
  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2),
      nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  }
  /** @param {number} a @returns {Float32Array} */
  function rotY(a) {
    const c = Math.cos(a),
      s = Math.sin(a),
      m = new Float32Array(16);
    m[0] = c;
    m[2] = -s;
    m[5] = 1;
    m[8] = s;
    m[10] = c;
    m[15] = 1;
    return m;
  }
  /** @param {number} a @returns {Float32Array} */
  function rotX(a) {
    const c = Math.cos(a),
      s = Math.sin(a),
      m = new Float32Array(16);
    m[0] = 1;
    m[5] = c;
    m[6] = s;
    m[9] = -s;
    m[10] = c;
    m[15] = 1;
    return m;
  }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {Float32Array}
   */
  function trans(x, y, z) {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }

  /** @returns {boolean} */
  function _init() {
    gl = cubeCanvas.getContext("webgl");
    if (!gl) return false;

    /** @param {number} type @param {string} src @returns {WebGLShader} */
    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    uMVP = gl.getUniformLocation(prog, "uMVP");
    uTile = gl.getUniformLocation(prog, "uTile");
    uAspect = gl.getUniformLocation(prog, "uAspect");
    uUVScale = gl.getUniformLocation(prog, "uUVScale");
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
    aPos = gl.getAttribLocation(prog, "aPos");
    aUV = gl.getAttribLocation(prog, "aUV");

    // Cube: 6 faces × 4 verts, interleaved [x,y,z,u,v]
    const h = 0.5;
    // prettier-ignore
    const verts = new Float32Array([
            // Front (z=+h)
            -h,-h, h, 0,1,   h,-h, h, 1,1,   h, h, h, 1,0,  -h, h, h, 0,0,
            // Back  (z=-h)
             h,-h,-h, 0,1,  -h,-h,-h, 1,1,  -h, h,-h, 1,0,   h, h,-h, 0,0,
            // Left  (x=-h)
            -h,-h,-h, 0,1,  -h,-h, h, 1,1,  -h, h, h, 1,0,  -h, h,-h, 0,0,
            // Right (x=+h)
             h,-h, h, 0,1,   h,-h,-h, 1,1,   h, h,-h, 1,0,   h, h, h, 0,0,
            // Top   (y=+h)
            -h, h, h, 0,1,   h, h, h, 1,1,   h, h,-h, 1,0,  -h, h,-h, 0,0,
            // Bottom(y=-h)
            -h,-h,-h, 0,1,   h,-h,-h, 1,1,   h,-h, h, 1,0,  -h,-h, h, 0,0,
          ]);
    const idx = new Uint16Array(
      Array.from({ length: 6 }, (_, f) => {
        const b = f * 4;
        return [b, b + 1, b + 2, b, b + 2, b + 3];
      }).flat(),
    );

    vBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    iBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    tex = gl.createTexture();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    cubeCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (_touchInProgress) return;
      if (e.ctrlKey) {
        camDist = Math.max(0.8, Math.min(6, camDist * (1 + e.deltaY * 0.05)));
      } else if (e.deltaX !== 0 && e.deltaY !== 0) {
        angleY += e.deltaX * 0.02;
        angleX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angleX + e.deltaY * 0.02));
        autoRotate = false;
        clearTimeout(autoRestartTimer);
        if (userAutoRotate) autoRestartTimer = setTimeout(() => { autoRotate = true; }, 1500);
      } else {
        camDist = Math.max(0.8, Math.min(6, camDist + e.deltaY * 0.004));
      }
    }, { passive: false });

    cubeCanvas.addEventListener("mousedown", (e) => {
      dragging = true;
      lastMX = e.clientX;
      lastMY = e.clientY;
      autoRotate = false;
      clearTimeout(autoRestartTimer);
      cubeCanvas.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastMX,
        dy = e.clientY - lastMY;
      lastMX = e.clientX;
      lastMY = e.clientY;
      angleY += dx * 0.007;
      angleX = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, angleX + dy * 0.007),
      );
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      cubeCanvas.style.cursor = "grab";
      if (userAutoRotate) autoRestartTimer = setTimeout(() => {
        autoRotate = true;
      }, 1500);
    });

    cubeCanvas.style.cursor = "grab";
    return true;
  }

  // Pad src into a POT canvas (no stretching). Stores scale + original dims.
  /**
   * @param {HTMLCanvasElement} src
   * @returns {HTMLCanvasElement}
   */
  function _padToPow2(src) {
    const w = ceilPow2(src.width),
      h = ceilPow2(src.height);
    texOrigW = src.width;
    texOrigH = src.height;
    texScaleX = src.width / w;
    texScaleY = src.height / h;
    if (w === src.width && h === src.height) return src;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(src, 0, 0); // top-left, no stretch
    return c;
  }

  /** @param {HTMLCanvasElement} canvas */
  function _uploadTexture(canvas) {
    const src = _padToPow2(canvas); // WebGL1 requires POT for mipmaps
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    // CLAMP_TO_EDGE — tiling is handled manually in the shader via fract()*uUVScale
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function _frame() {
    const w = cubeCanvas.clientWidth,
      h = cubeCanvas.clientHeight;
    if (cubeCanvas.width !== w || cubeCanvas.height !== h) {
      cubeCanvas.width = w;
      cubeCanvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.024, 0.027, 0.031, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (autoRotate) angleY += 0.002;
    const mvp = mul(
      perspective(Math.PI / 3, w / h, 0.1, 10),
      mul(trans(0, 0, -camDist), mul(rotY(angleY), rotX(angleX))),
    );

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);

    const stride = 5 * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 12);

    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniform1f(uTile, tileVal);
    gl.uniform1f(uAspect, texOrigW / texOrigH);
    gl.uniform2f(uUVScale, texScaleX, texScaleY);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    raf = requestAnimationFrame(_frame);
  }

  return {
    /**
     * @param {HTMLCanvasElement} [textureCanvas]
     * @param {number} [scalePercent]
     */
    start(textureCanvas, scalePercent = 50) {
      if (!gl && !_init()) return;
      tileVal = 100 / scalePercent;
      if (textureCanvas) _uploadTexture(textureCanvas);
      if (!raf) raf = requestAnimationFrame(_frame);
    },
    stop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      clearTimeout(autoRestartTimer);
      dragging = false;
      autoRotate = true;
      userAutoRotate = true;
    },
    /** @param {boolean} enabled */
    setAutoRotate(enabled) {
      userAutoRotate = enabled;
      autoRotate = enabled;
      clearTimeout(autoRestartTimer);
    },
    /** @param {HTMLCanvasElement} canvas */
    setTexture(canvas) {
      if (gl && canvas) _uploadTexture(canvas);
    },
    /** @param {number} scalePercent */
    setScale(scalePercent) {
      tileVal = 100 / scalePercent;
    },
  };
})();
