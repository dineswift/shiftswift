/** Stroke SVG icons for admin overview (consistent cross-platform). */
(function () {
  "use strict";

  const PATHS = {
    users:
      '<path d="M9 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0"/><path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/>',
    clock: '<path d="M12 7v5l3 3"/><path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18"/>',
    check: '<path d="M5 12l5 5l10-10"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0"/>',
    card: '<path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/>',
    clipboard:
      '<path d="M9 5h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2"/><path d="M9 3h6v4H9z"/>',
    passport:
      '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 11h8"/><path d="M8 15h5"/>',
    medical: '<path d="M12 6v12"/><path d="M6 12h12"/><path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18"/>',
    "map-pin":
      '<path d="M12 11a2 2 0 1 0 0-4a2 2 0 0 0 0 4"/><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11"/>',
    calendar:
      '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 8h18"/><path d="M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2"/>',
    scale:
      '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M7 7l-3 6h6z"/><path d="M17 7l-3 6h6z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    door: '<path d="M13 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M9 12h.01"/><path d="M9 21V3"/>',
    beach:
      '<path d="M3 17h18"/><path d="M6 17c2-4 4-6 6-6s4 2 6 6"/><path d="M12 5v6"/><path d="M9 8l3-3l3 3"/>',
    folder:
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    bell:
      '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 3 6v3l2 2H5l2-2v-3a7 7 0 0 1 3-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    plug:
      '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M6 8h12a2 2 0 0 1 2 2v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-4a2 2 0 0 1 2-2"/>',
    building:
      '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 12h12"/><path d="M10 12v4"/><path d="M14 12v4"/><path d="M10 6h4"/>',
    lock:
      '<path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2"/>',
    layout:
      '<path d="M3 3h8v8H3z"/><path d="M13 3h8v8h-8z"/><path d="M3 13h8v8H3z"/><path d="M13 13h8v8h-8z"/>',
    settings:
      '<path d="M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.93 19.07l1.41-1.41"/><path d="M17.66 6.34l1.41-1.41"/>',
    chevron: '<path d="M9 6l6 6l-6 6"/>',
    "trending-up": '<path d="M3 17l6-6l4 4l8-8"/><path d="M14 7h7v7"/>',
    "user-plus":
      '<path d="M9 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0"/><path d="M3 21v-2a4 4 0 0 1 4-4h4"/><path d="M16 19h6"/><path d="M19 16v6"/>',
    "user-minus":
      '<path d="M9 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0"/><path d="M3 21v-2a4 4 0 0 1 4-4h10"/><path d="M16 19h6"/>',
    "file-text":
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 9h6"/><path d="M10 13h6"/><path d="M10 17h4"/>',
    "file-certificate":
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 14l-2 1l2 1l2-1l-2-1"/><path d="M10 10h4"/>',
    sparkles:
      '<path d="M12 3l1.1 3.6L17 8l-3.9 1.4L12 13l-1.1-3.6L7 8l3.9-1.4z"/><path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z"/><path d="M5 16l.8 2.4L8.2 19l-2.4.8L5 22.2l-.8-2.4L1.8 19l2.4-.8z"/>',
    "calendar-off":
      '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 8h18"/><path d="M5 6h14a2 2 0 0 1 2 2v2"/><path d="M16 16l-8-8"/><path d="M8 16l8-8"/>',
    "external-link":
      '<path d="M12 6h6v6"/><path d="M10 14L18 6"/><path d="M15 10h3v9H6v-12h9"/>',
    download: '<path d="M12 3v12"/><path d="M8 11l4 4l4-4"/><path d="M4 21h16"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    trash:
      '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    mail:
      '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/><path d="M22 6l-10 7L2 6"/>',
    search: '<path d="M10 10a6 6 0 1 1 0-12a6 6 0 0 1 0 12"/><path d="M14.5 14.5L20 20"/>',
  };

  function svg(name, className) {
    const body = PATHS[name];
    if (!body) return "";
    const cls = className ? ` admin-icon ${className}` : " admin-icon";
    return `<svg class="${cls.trim()}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  window.AdminIcons = { svg };
})();
