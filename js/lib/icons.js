// Icons from Lucide (https://lucide.dev) — MIT License
// SVG path data inlined at build time; no runtime dependency on the lucide package.
(function () {
  const ICONS = {
    x: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
    check: [["path", { d: "M20 6 9 17l-5-5" }]],
    heart: [
      [
        "path",
        {
          d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
        },
      ],
    ],
    play: [
      [
        "path",
        {
          d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
        },
      ],
    ],
    download: [
      ["path", { d: "M12 15V3" }],
      ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
      ["path", { d: "m7 10 5 5 5-5" }],
    ],
    upload: [
      ["path", { d: "M12 3v12" }],
      ["path", { d: "m17 8-5-5-5 5" }],
      ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ],
    search: [
      ["path", { d: "m21 21-4.34-4.34" }],
      ["circle", { cx: "11", cy: "11", r: "8" }],
    ],
    key: [
      [
        "path",
        { d: "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" },
      ],
      ["path", { d: "m21 2-9.6 9.6" }],
      ["circle", { cx: "7.5", cy: "15.5", r: "5.5" }],
    ],
    sun: [
      ["circle", { cx: "12", cy: "12", r: "4" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M12 20v2" }],
      ["path", { d: "m4.93 4.93 1.41 1.41" }],
      ["path", { d: "m17.66 17.66 1.41 1.41" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "m6.34 17.66-1.41 1.41" }],
      ["path", { d: "m19.07 4.93-1.41 1.41" }],
    ],
    palette: [
      [
        "path",
        {
          d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z",
        },
      ],
      ["circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" }],
      ["circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" }],
      ["circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" }],
      ["circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" }],
    ],
    leaf: [
      [
        "path",
        {
          d: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z",
        },
      ],
      ["path", { d: "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" }],
    ],
    cog: [
      ["path", { d: "M11 10.27 7 3.34" }],
      ["path", { d: "m11 13.73-4 6.93" }],
      ["path", { d: "M12 22v-2" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M14 12h8" }],
      ["path", { d: "m17 20.66-1-1.73" }],
      ["path", { d: "m17 3.34-1 1.73" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "m20.66 17-1.73-1" }],
      ["path", { d: "m20.66 7-1.73 1" }],
      ["path", { d: "m3.34 17 1.73-1" }],
      ["path", { d: "m3.34 7 1.73 1" }],
      ["circle", { cx: "12", cy: "12", r: "2" }],
      ["circle", { cx: "12", cy: "12", r: "8" }],
    ],
    diamond: [
      [
        "path",
        {
          d: "M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z",
        },
      ],
    ],
    square: [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }]],
    circle: [["circle", { cx: "12", cy: "12", r: "10" }]],
    "grip-vertical": [
      ["circle", { cx: "9", cy: "12", r: "1" }],
      ["circle", { cx: "9", cy: "5", r: "1" }],
      ["circle", { cx: "9", cy: "19", r: "1" }],
      ["circle", { cx: "15", cy: "12", r: "1" }],
      ["circle", { cx: "15", cy: "5", r: "1" }],
      ["circle", { cx: "15", cy: "19", r: "1" }],
    ],
    "rotate-ccw": [
      ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
      ["path", { d: "M3 3v5h5" }],
    ],
    plus: [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "M12 5v14" }],
    ],
    crosshair: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["line", { x1: "22", x2: "18", y1: "12", y2: "12" }],
      ["line", { x1: "6", x2: "2", y1: "12", y2: "12" }],
      ["line", { x1: "12", x2: "12", y1: "22", y2: "18" }],
      ["line", { x1: "12", x2: "12", y1: "6", y2: "2" }],
    ],
    "locate-fixed": [
      ["line", { x1: "2", x2: "5", y1: "12", y2: "12" }],
      ["line", { x1: "19", x2: "22", y1: "12", y2: "12" }],
      ["line", { x1: "12", x2: "12", y1: "2", y2: "5" }],
      ["line", { x1: "12", x2: "12", y1: "19", y2: "22" }],
      ["circle", { cx: "12", cy: "12", r: "7" }],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ],
    "square-plus": [
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["path", { d: "M8 12h8" }],
      ["path", { d: "M12 8v8" }],
    ],
    "grid-2x2-x": [
      [
        "path",
        {
          d: "M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3",
        },
      ],
      ["path", { d: "m16 16 5 5" }],
      ["path", { d: "m16 21 5-5" }],
    ],
    "image-plus": [
      ["path", { d: "M16 5h6" }],
      ["path", { d: "M19 2v6" }],
      [
        "path",
        { d: "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" },
      ],
      ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
      ["circle", { cx: "9", cy: "9", r: "2" }],
    ],
    "arrow-right": [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "m12 5 7 7-7 7" }],
    ],
    "arrow-up-down": [
      ["path", { d: "m21 16-4 4-4-4" }],
      ["path", { d: "M17 20V4" }],
      ["path", { d: "m3 8 4-4 4 4" }],
      ["path", { d: "M7 4v16" }],
    ],
    "arrow-left-right": [
      ["path", { d: "M8 3 4 7l4 4" }],
      ["path", { d: "M4 7h16" }],
      ["path", { d: "m16 21 4-4-4-4" }],
      ["path", { d: "M20 17H4" }],
    ],
    copy: [
      ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
      [
        "path",
        { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" },
      ],
    ],
    sparkles: [
      [
        "path",
        {
          d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
        },
      ],
      ["path", { d: "M20 2v4" }],
      ["path", { d: "M22 4h-4" }],
      ["circle", { cx: "4", cy: "20", r: "2" }],
    ],
    "grid-3x3": [
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["path", { d: "M3 9h18" }],
      ["path", { d: "M3 15h18" }],
      ["path", { d: "M9 3v18" }],
      ["path", { d: "M15 3v18" }],
    ],
    type: [
      ["path", { d: "M12 4v16" }],
      ["path", { d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" }],
      ["path", { d: "M9 20h6" }],
    ],
    building: [
      ["path", { d: "M12 10h.01" }],
      ["path", { d: "M12 14h.01" }],
      ["path", { d: "M12 6h.01" }],
      ["path", { d: "M16 10h.01" }],
      ["path", { d: "M16 14h.01" }],
      ["path", { d: "M16 6h.01" }],
      ["path", { d: "M8 10h.01" }],
      ["path", { d: "M8 14h.01" }],
      ["path", { d: "M8 6h.01" }],
      ["path", { d: "M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" }],
      ["rect", { x: "4", y: "2", width: "16", height: "20", rx: "2" }],
    ],
    landmark: [
      ["path", { d: "M10 18v-7" }],
      [
        "path",
        {
          d: "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z",
        },
      ],
      ["path", { d: "M14 18v-7" }],
      ["path", { d: "M18 18v-7" }],
      ["path", { d: "M3 22h18" }],
      ["path", { d: "M6 18v-7" }],
    ],
    road: [
      ["path", { d: "M12 17v4" }],
      ["path", { d: "M12 5V3" }],
      ["path", { d: "M12 9v3" }],
      [
        "path",
        {
          d: "M2.077 18.449A2 2 0 0 0 4 21h16a2 2 0 0 0 1.924-2.55l-4-14A2 2 0 0 0 16 3H8a2 2 0 0 0-1.924 1.45z",
        },
      ],
    ],
    "app-window": [
      ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }],
      ["path", { d: "M10 4v4" }],
      ["path", { d: "M2 8h20" }],
      ["path", { d: "M6 4v4" }],
    ],
    "door-closed": [
      ["path", { d: "M10 12h.01" }],
      ["path", { d: "M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" }],
      ["path", { d: "M2 20h20" }],
    ],
    "square-dot": [
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["circle", { cx: "12", cy: "12", r: "1" }],
    ],
    minus: [["path", { d: "M5 12h14" }]],
    "circle-dashed": [
      ["path", { d: "M10.1 2.182a10 10 0 0 1 3.8 0" }],
      ["path", { d: "M13.9 21.818a10 10 0 0 1-3.8 0" }],
      ["path", { d: "M17.609 3.721a10 10 0 0 1 2.69 2.7" }],
      ["path", { d: "M2.182 13.9a10 10 0 0 1 0-3.8" }],
      ["path", { d: "M20.279 17.609a10 10 0 0 1-2.7 2.69" }],
      ["path", { d: "M21.818 10.1a10 10 0 0 1 0 3.8" }],
      ["path", { d: "M3.721 6.391a10 10 0 0 1 2.7-2.69" }],
      ["path", { d: "M6.391 20.279a10 10 0 0 1-2.69-2.7" }],
    ],
    "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
    "corner-down-right": [
      ["path", { d: "m15 10 5 5-5 5" }],
      ["path", { d: "M4 4v7a4 4 0 0 0 4 4h12" }],
    ],
    "trash-2": [
      ["path", { d: "M10 11v6" }],
      ["path", { d: "M14 11v6" }],
      ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
    ],
    ruler: [
      [
        "path",
        {
          d: "M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",
        },
      ],
      ["path", { d: "m14.5 12.5 2-2" }],
      ["path", { d: "m11.5 9.5 2-2" }],
      ["path", { d: "m8.5 6.5 2-2" }],
      ["path", { d: "m17.5 15.5 2-2" }],
    ],
    pointer: [
      ["path", { d: "M22 14a8 8 0 0 1-8 8" }],
      ["path", { d: "M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" }],
      ["path", { d: "M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" }],
      ["path", { d: "M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" }],
      [
        "path",
        {
          d: "M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
        },
      ],
    ],
    maximize: [
      ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }],
      ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }],
      ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }],
      ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }],
    ],
    pencil: [
      [
        "path",
        {
          d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
        },
      ],
      ["path", { d: "m15 5 4 4" }],
    ],
    loader: [
      ["path", { d: "M12 2v4" }],
      ["path", { d: "m16.2 7.8 2.9-2.9" }],
      ["path", { d: "M18 12h4" }],
      ["path", { d: "m16.2 16.2 2.9 2.9" }],
      ["path", { d: "M12 18v4" }],
      ["path", { d: "m4.9 19.1 2.9-2.9" }],
      ["path", { d: "M2 12h4" }],
      ["path", { d: "m4.9 4.9 2.9 2.9" }],
    ],
    package: [
      [
        "path",
        {
          d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z",
        },
      ],
      ["path", { d: "M12 22V12" }],
      ["polyline", { points: "3.29 7 12 12 20.71 7" }],
      ["path", { d: "m7.5 4.27 9 5.15" }],
    ],
    "rectangle-horizontal": [
      ["rect", { width: "20", height: "12", x: "2", y: "6", rx: "2" }],
    ],
    "layout-grid": [
      ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1" }],
      ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1" }],
      ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1" }],
      ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1" }],
    ],
    "circle-dot": [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["circle", { cx: "12", cy: "12", r: "1" }],
    ],
    "flip-horizontal": [
      ["path", { d: "M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" }],
      ["path", { d: "M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" }],
      ["path", { d: "M12 20v2" }],
      ["path", { d: "M12 14v2" }],
      ["path", { d: "M12 8v2" }],
      ["path", { d: "M12 2v2" }],
    ],
    "tree-deciduous": [
      [
        "path",
        {
          d: "M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z",
        },
      ],
      ["path", { d: "M12 19v3" }],
    ],
    move: [
      ["path", { d: "M12 2v20" }],
      ["path", { d: "m15 19-3 3-3-3" }],
      ["path", { d: "m19 9 3 3-3 3" }],
      ["path", { d: "M2 12h20" }],
      ["path", { d: "m5 9-3 3 3 3" }],
      ["path", { d: "m9 5 3-3 3 3" }],
    ],
    triangle: [
      [
        "path",
        {
          d: "M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z",
        },
      ],
    ],
    eye: [
      [
        "path",
        {
          d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
        },
      ],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ],
    layers: [
      [
        "path",
        {
          d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
        },
      ],
      [
        "path",
        {
          d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
        },
      ],
      [
        "path",
        {
          d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
        },
      ],
    ],
    "chart-spline": [
      ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16" }],
      ["path", { d: "M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7" }],
    ],
    "sliders-horizontal": [
      ["path", { d: "M10 5H3" }],
      ["path", { d: "M12 19H3" }],
      ["path", { d: "M14 3v4" }],
      ["path", { d: "M16 17v4" }],
      ["path", { d: "M21 12h-9" }],
      ["path", { d: "M21 19h-5" }],
      ["path", { d: "M21 5h-7" }],
      ["path", { d: "M8 10v4" }],
      ["path", { d: "M8 12H3" }],
    ],
  };

  const SVG_ATTRS =
    'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  function _renderNodes(nodes) {
    return nodes
      .map(function (n) {
        var tag = n[0],
          attrs = n[1];
        var attrStr = Object.entries(attrs)
          .map(function (e) {
            return e[0] + '="' + e[1] + '"';
          })
          .join(" ");
        return "<" + tag + " " + attrStr + "/>";
      })
      .join("");
  }

  function iconHTML(name, size) {
    var nodes = ICONS[name];
    if (!nodes) return "";
    var s = size || 16;
    return (
      '<svg width="' +
      s +
      '" height="' +
      s +
      '" ' +
      SVG_ATTRS +
      ">" +
      _renderNodes(nodes) +
      "</svg>"
    );
  }

  function initIcons() {
    document.querySelectorAll("i[data-lucide]").forEach(function (el) {
      var html = iconHTML(el.dataset.lucide);
      if (!html) return;
      var wrap = document.createElement("span");
      wrap.innerHTML = html;
      var svg = wrap.firstElementChild;
      if (el.className) svg.setAttribute("class", el.className);
      el.replaceWith(svg);
    });
  }

  window.Lucide = { initIcons: initIcons, iconHTML: iconHTML };
})();
