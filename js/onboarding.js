// ── ONBOARDING SYSTEM ─────────────────────────────────────────────────────
//
// Data-driven, action-gated tutorial system.
// Add new tutorials via onboarding.register(descriptor).
//
// Tutorial descriptor shape:
//   {
//     id: string,                        // unique id; LS key = "snapatlas_ob_<id>"
//     steps: [{
//       id:        string,               // matched by onboarding.advance(tutorialId, stepId)
//       targets:   () => Element[],      // factory — called at display time (never at parse time)
//       title:     string,
//       desc:      string,
//       skippable: boolean,
//     }],
//   }

const _TUTORIALS = {};
let _active = null;   // { tutorial, stepIdx, rings[], card, ro, onResize }

// ── REGISTRY ──────────────────────────────────────────────────────────────

/** Register a tutorial descriptor. */
function _register(tutorial) {
  _TUTORIALS[tutorial.id] = tutorial;
}

/**
 * Start a tutorial if it hasn't been completed/dismissed yet.
 * Also skips if an existing project is already loaded.
 * @param {string} id
 */
function _start(id) {
  if (localStorage.getItem(`snapatlas_ob_${id}`) || localStorage.getItem("snapatlas_project")) {
    initAnalyticsBanner(); // returning user — show analytics consent directly
    return;
  }
  const tutorial = _TUTORIALS[id];
  if (!tutorial) { initAnalyticsBanner(); return; }
  _active = { tutorial, stepIdx: 0, highWater: 0, rings: [], card: null, ro: null };
  _showStep(0);
}

// ── ADVANCE ───────────────────────────────────────────────────────────────

/**
 * Signal that a user action completed a step.
 * @param {string} tutorialId
 * @param {string} stepId
 */
function _advance(tutorialId, stepId) {
  if (!_active) return;
  if (_active.tutorial.id !== tutorialId) return;
  const step = _active.tutorial.steps[_active.stepIdx];
  if (!step || step.id !== stepId) return;
  const next = _active.stepIdx + 1;
  if (next >= _active.tutorial.steps.length) {
    _complete();
  } else {
    _active.highWater = Math.max(_active.highWater, next);
    _active.stepIdx = next;
    _showStep(next);
  }
}

// ── STEP DISPLAY ──────────────────────────────────────────────────────────

const _INSET = 6;       // px — breathing room around target
const _GAP   = 12;      // px — gap between ring and card
const _MAX_RETRIES = 40; // rAF retries when target not yet in DOM

// Monotonic counter — incremented on each _showStep call so stale retries self-cancel
let _generation = 0;

function _showStep(idx, _retries = 0, _gen = ++_generation) {
  if (!_active) return;
  if (_gen !== _generation) return; // stale retry — a newer step has taken over

  const step = _active.tutorial.steps[idx];
  const targets = step.targets().filter(Boolean);

  // Inspector elements may not be in the DOM yet — retry via rAF
  if (targets.length === 0) {
    if (_retries >= _MAX_RETRIES) return; // give up silently
    requestAnimationFrame(() => _showStep(idx, _retries + 1, _gen));
    return;
  }

  _clearRings();
  targets.forEach(el => {
    const ring = document.createElement("div");
    ring.className = "ob-ring";
    document.body.appendChild(ring);
    _active.rings.push(ring);
    _positionRing(ring, el);
  });

  if (!_active.card) _createCard();
  _updateCard(step, idx);
  // Place after a frame so the card has rendered and getBoundingClientRect is accurate
  requestAnimationFrame(() => {
    if (!_active || _gen !== _generation) return;
    _placeCard(targets[0]);
  });
  _trackResize(targets);
}

function _positionRing(ring, el) {
  const r = el.getBoundingClientRect();
  ring.style.top    = (r.top    + _INSET) + "px";
  ring.style.left   = (r.left   + _INSET) + "px";
  ring.style.width  = (r.width  - _INSET * 2) + "px";
  ring.style.height = (r.height - _INSET * 2) + "px";
}

// ── CARD ──────────────────────────────────────────────────────────────────

function _createCard() {
  const card = document.createElement("div");
  card.id = "ob-card";
  card.className = "persp-modal";
  card.innerHTML = `
    <div class="ob-header">
      <span class="label label--accent ob-counter"></span>
      <button class="btn-ghost ob-dismiss" title="Dismiss tutorial">${Lucide.iconHTML("x", 14)}</button>
    </div>
    <div class="ob-body">
      <strong class="ob-title"></strong>
      <p class="ob-desc"></p>
    </div>
    <div class="ob-actions">
      <button class="btn-ghost ob-prev">${Lucide.iconHTML("chevron-left", 14)}</button>
      <span class="ob-dots"></span>
      <button class="btn-ghost ob-next">${Lucide.iconHTML("chevron-right", 14)}</button>
    </div>
  `;
  card.querySelector(".ob-dismiss").addEventListener("click", _dismiss);
  card.querySelector(".ob-prev").addEventListener("click", _prev);
  card.querySelector(".ob-next").addEventListener("click", _nextOrSkip);
  document.body.appendChild(card);
  _active.card = card;
}

function _updateCard(step, idx) {
  const card  = _active.card;
  const total = _active.tutorial.steps.length;
  card.querySelector(".ob-title").textContent = step.title;
  card.querySelector(".ob-desc").textContent  = step.desc;

  // Counter: "2 / 6"
  card.querySelector(".ob-counter").textContent = `${idx + 1} / ${total}`;

  // Dot indicators
  const dots = card.querySelector(".ob-dots");
  dots.innerHTML = Array.from({ length: total }, (_, i) =>
    `<span class="ob-dot${i === idx ? " ob-dot--active" : ""}"></span>`
  ).join("");

  // Prev hidden on first step
  const prevBtn = card.querySelector(".ob-prev");
  prevBtn.classList.toggle("is-hidden", idx === 0);

  // Next hidden until the user has completed this step's action
  const nextBtn = card.querySelector(".ob-next");
  const isLast   = idx >= _active.tutorial.steps.length - 1;
  const unlocked = idx < _active.highWater || step.skippable;
  nextBtn.classList.toggle("is-hidden", isLast || !unlocked);
  nextBtn.innerHTML = step.skippable
    ? "Skip " + Lucide.iconHTML("chevron-right", 14)
    : Lucide.iconHTML("chevron-right", 14);
}

function _placeCard(primaryEl) {
  const card = _active.card;
  const cr   = card.getBoundingClientRect();
  const tr   = primaryEl.getBoundingClientRect();
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  const cw   = cr.width  || 220;
  const ch   = cr.height || 160;

  // Available space on each side
  const space = {
    right:  vw - (tr.right  + _INSET + _GAP),
    left:   tr.left - _INSET - _GAP,
    bottom: vh - (tr.bottom + _INSET + _GAP),
    top:    tr.top  - _INSET - _GAP,
  };

  // Pick side with most room, prefer right then bottom
  const side = ["right", "left", "bottom", "top"]
    .filter(s => space[s] >= (s === "right" || s === "left" ? cw : ch))
    .sort((a, b) => space[b] - space[a])[0] ?? "right";

  let top, left;
  if (side === "right") {
    left = tr.right + _INSET + _GAP;
    top  = Math.max(8, Math.min(vh - ch - 8, tr.top + (tr.height - ch) / 2));
  } else if (side === "left") {
    left = tr.left - _INSET - _GAP - cw;
    top  = Math.max(8, Math.min(vh - ch - 8, tr.top + (tr.height - ch) / 2));
  } else if (side === "bottom") {
    top  = tr.bottom + _INSET + _GAP;
    left = Math.max(8, Math.min(vw - cw - 8, tr.left + (tr.width - cw) / 2));
  } else {
    top  = tr.top - _INSET - _GAP - ch;
    left = Math.max(8, Math.min(vw - cw - 8, tr.left + (tr.width - cw) / 2));
  }

  card.style.top  = top  + "px";
  card.style.left = left + "px";
}

// ── RESIZE TRACKING ───────────────────────────────────────────────────────

function _trackResize(targets) {
  // Disconnect previous observer
  if (_active.ro) _active.ro.disconnect();
  if (_active.onResize) window.removeEventListener("resize", _active.onResize);
  if (_active.onScroll) _active.scrollEl?.removeEventListener("scroll", _active.onScroll);

  const refresh = () => {
    if (!_active) return;
    const step = _active.tutorial.steps[_active.stepIdx];
    const els  = step.targets().filter(Boolean);
    els.forEach((el, i) => {
      if (_active.rings[i]) _positionRing(_active.rings[i], el);
    });
    if (els[0] && _active.card) _placeCard(els[0]);
  };

  _active.ro = new ResizeObserver(refresh);
  targets.forEach(el => _active.ro.observe(el));
  _active.onResize = refresh;
  window.addEventListener("resize", _active.onResize);

  // Track scroll on the inspector panel so rings follow scrolled targets
  const scrollEl = document.getElementById("inspector");
  if (scrollEl) {
    _active.onScroll = refresh;
    _active.scrollEl = scrollEl;
    scrollEl.addEventListener("scroll", _active.onScroll);
  }
}

// ── CLEANUP ───────────────────────────────────────────────────────────────

function _clearRings() {
  _active.rings.forEach(r => r.remove());
  _active.rings = [];
}

function _teardown() {
  if (!_active) return;
  _clearRings();
  _active.card?.remove();
  _active.ro?.disconnect();
  if (_active.onResize) window.removeEventListener("resize", _active.onResize);
  if (_active.onScroll) _active.scrollEl?.removeEventListener("scroll", _active.onScroll);
  _active = null;
}

function _confetti() {
  const COLORS = [
    "#4ea2ef", "#7ec8f4", "#a0d8ff", "#c8eaff", "#ffffff",
    "#f4c842", "#f49e42", "#f46e6e", "#a0f4a0", "#c8a0f4",
  ];
  const COUNT = 120;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Spawn positions distributed all around the screen border
  function borderOrigin(i) {
    const t = i / COUNT;
    if (t < 0.25)      return { x: t * 4 * vw,  y: 0 };         // top
    else if (t < 0.5)  return { x: vw,           y: (t - 0.25) * 4 * vh }; // right
    else if (t < 0.75) return { x: (1 - (t - 0.5) * 4) * vw, y: vh };     // bottom
    else               return { x: 0,            y: (1 - (t - 0.75) * 4) * vh }; // left
  }

  // Inward angle toward center + randomness
  function inwardAngle(ox, oy) {
    const cx = vw / 2, cy = vh / 2;
    const base = Math.atan2(cy - oy, cx - ox);
    return base + (Math.random() - 0.5) * 1.2;
  }

  for (let i = 0; i < COUNT; i++) {
    const { x: ox, y: oy } = borderOrigin(i);
    const angle  = inwardAngle(ox, oy);
    const speed  = 80 + Math.random() * 260;
    const size   = 5 + Math.random() * 7;
    const tall   = Math.random() > 0.4;
    const dur    = 1600 + Math.random() * 1200;
    const delay  = Math.random() * 400;
    const color  = COLORS[Math.floor(Math.random() * COLORS.length)];
    const tx     = Math.cos(angle) * speed;
    const ty     = Math.sin(angle) * speed;
    const rot    = (Math.random() - 0.5) * 900;

    const el = document.createElement("div");
    el.style.cssText = `
      position:fixed;pointer-events:none;z-index:9999;
      left:${ox}px;top:${oy}px;
      width:${size}px;height:${tall ? size * 3 : size}px;
      border-radius:${Math.random() > 0.45 ? "50%" : "2px"};
      background:${color};
      opacity:0;
      transform:translate(-50%,-50%);
      animation:_ob_confetti ${dur}ms ${delay}ms cubic-bezier(.15,.8,.3,1) forwards;
      --tx:${tx}px;--ty:${ty}px;--rot:${rot}deg;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), dur + delay + 50);
  }
}

function _complete() {
  if (!_active) return;
  const id = _active.tutorial.id;
  localStorage.setItem(`snapatlas_ob_${id}`, "1");
  _teardown();
  analytics.track("onboarding_complete", { tutorial: id });
  _confetti();
  showToast("Tutorial complete!", "success");
  initAnalyticsBanner();
}

function _dismiss() {
  if (!_active) return;
  const id = _active.tutorial.id;
  const step = _active.stepIdx;
  localStorage.setItem(`snapatlas_ob_${id}`, "1");
  _teardown();
  analytics.track("onboarding_dismiss", { tutorial: id, step });
  initAnalyticsBanner();
}

function _prev() {
  if (!_active || _active.stepIdx === 0) return;
  const prev = _active.stepIdx - 1;
  _active.stepIdx = prev;
  _showStep(prev);
}

function _nextOrSkip() {
  if (!_active) return;
  const next = _active.stepIdx + 1;
  if (next >= _active.tutorial.steps.length) {
    _complete();
  } else {
    _active.highWater = Math.max(_active.highWater, next);
    _active.stepIdx = next;
    _showStep(next);
  }
}

// ── BUILT-IN: FIRST TEXTURE TUTORIAL ─────────────────────────────────────

_register({
  id: "first-texture",
  steps: [
    {
      id: "import",
      targets: () => {
        const overlay = document.getElementById("drop-overlay");
        // If overlay is hidden (photo already loaded somehow), fall back to load button
        if (overlay && !overlay.classList.contains("hidden")) return [overlay];
        return [document.getElementById("btn-load-photo")].filter(Boolean);
      },
      title: "Import a photo",
      desc:  "Drop an image onto the canvas, or click to browse your files.",
      skippable: false,
    },
    {
      id: "region",
      targets: () => [document.getElementById("tool-create")].filter(Boolean),
      title: "Draw a region",
      desc:  "Click the Create tool (already active), then click and drag on the photo to define a texture region.",
      skippable: false,
    },
    {
      id: "resize",
      targets: () => [
        document.getElementById("preview-canvas"),
        document.querySelector(".insp-dims"),
      ].filter(Boolean),
      title: "Set output size",
      desc:  "Drag the region handles in the atlas preview, or type a value in the inspector.",
      skippable: true,
    },
    {
      id: "corners",
      targets: () => [...document.querySelectorAll(".block-configure")].slice(0, 1),
      title: "Edit corners",
      desc:  "Click 'Edit Corners' on the Perspective block to correct any distortion.",
      skippable: false,
    },
    {
      id: "block",
      targets: () => [document.getElementById("insp-add-block")].filter(Boolean),
      title: "Add a processing block",
      desc:  "Blocks let you apply filters, AI tools, and more to your region. This step is optional.",
      skippable: true,
    },
    {
      id: "export",
      targets: () => [document.getElementById("btn-download-atlas")].filter(Boolean),
      title: "Export your atlas",
      desc:  "Click Export to package your regions into a game-ready texture atlas.",
      skippable: false,
    },
  ],
});

// ── PUBLIC API ────────────────────────────────────────────────────────────

window.onboarding = {
  register: _register,
  start:    _start,
  advance:  _advance,
  dismiss:  _dismiss,
};

// Auto-start the first-texture tutorial.
// Called here (not in _init) because onboarding.js loads after ui/main.js.
_start("first-texture");
