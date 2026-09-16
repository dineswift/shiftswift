/** Modern SVG icons for admin (tabs, More, Modules, empty states). */
(function () {
  "use strict";

  /* Soft fill + stroke pairs; fill uses currentColor at low opacity via CSS .admin-icon__fill */
  const PATHS = {
    users:
      '<circle class="admin-icon__fill" cx="12" cy="8" r="3.5"/><circle cx="12" cy="8" r="3.5"/><path d="M5 19.5c.8-3.2 3.2-5 7-5s6.2 1.8 7 5"/>',
    home:
      '<path class="admin-icon__fill" d="M4.5 10.8L12 4.5l7.5 6.3V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-5.5h-4V20.5H6A1.5 1.5 0 0 1 4.5 19z"/><path d="M4.5 10.8L12 4.5l7.5 6.3V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-5.5h-4V20.5H6A1.5 1.5 0 0 1 4.5 19z"/>',
    clock:
      '<circle class="admin-icon__fill" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3.2 2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert:
      '<path class="admin-icon__fill" d="M10.3 4.2L2.1 18.2A1.8 1.8 0 0 0 3.7 21h16.6a1.8 1.8 0 0 0 1.6-2.8L13.7 4.2a1.8 1.8 0 0 0-3.4 0z"/><path d="M10.3 4.2L2.1 18.2A1.8 1.8 0 0 0 3.7 21h16.6a1.8 1.8 0 0 0 1.6-2.8L13.7 4.2a1.8 1.8 0 0 0-3.4 0z"/><path d="M12 9.5v4.2"/><path d="M12 16.8h.01"/>',
    card:
      '<rect class="admin-icon__fill" x="3" y="5" width="18" height="14" rx="2.5"/><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    clipboard:
      '<rect class="admin-icon__fill" x="7" y="5" width="10" height="15" rx="2"/><path d="M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5v13a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2V6A1.5 1.5 0 0 1 9 4.5z"/><path d="M9.5 3h5v3h-5z"/>',
    passport:
      '<rect class="admin-icon__fill" x="4.5" y="4" width="15" height="16" rx="2"/><rect x="4.5" y="4" width="15" height="16" rx="2"/><path d="M8 11h8"/><path d="M8 15h5"/><circle cx="12" cy="8" r="1.5"/>',
    medical:
      '<circle class="admin-icon__fill" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9"/><path d="M7.5 12h9"/>',
    "map-pin":
      '<path class="admin-icon__fill" d="M12 21s7-4.2 7-10.5a7 7 0 1 0-14 0C5 16.8 12 21 12 21z"/><path d="M12 21s7-4.2 7-10.5a7 7 0 1 0-14 0C5 16.8 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.25"/>',
    calendar:
      '<rect class="admin-icon__fill" x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3.5 9.5h17"/><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M8 13h3"/><path d="M13 13h3"/><path d="M8 16.5h5"/>',
    scale:
      '<path d="M12 3.5v17"/><path d="M5.5 7h13"/><path class="admin-icon__fill" d="M7.5 7.5l-3 6.5h6z"/><path d="M7.5 7.5l-3 6.5h6z"/><path class="admin-icon__fill" d="M16.5 7.5l-3 6.5h6z"/><path d="M16.5 7.5l-3 6.5h6z"/>',
    file:
      '<path class="admin-icon__fill" d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/>',
    document:
      '<path class="admin-icon__fill" d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    door:
      '<path class="admin-icon__fill" d="M13 4.5h3.5A2 2 0 0 1 18.5 6.5v13a2 2 0 0 1-2 2H13z"/><path d="M13 4.5h3.5A2 2 0 0 1 18.5 6.5v13a2 2 0 0 1-2 2H13"/><path d="M9.5 12h.01"/><path d="M9.5 20.5V3.5"/>',
    beach:
      '<path d="M3.5 18h17"/><path class="admin-icon__fill" d="M6.5 18c2.2-4.5 4.3-6.8 5.5-6.8S15.3 13.5 17.5 18"/><path d="M6.5 18c2.2-4.5 4.3-6.8 5.5-6.8S15.3 13.5 17.5 18"/><path d="M12 5.5v5.7"/><path d="M9.2 8.2L12 5.5l2.8 2.7"/>',
    folder:
      '<path class="admin-icon__fill" d="M3.5 8.5A2 2 0 0 1 5.5 6.5h3.2l1.8 2H18.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/><path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h3.2l1.8 2H18.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/>',
    bell:
      '<path class="admin-icon__fill" d="M10.2 5.2a2 2 0 0 1 3.6 0A6.5 6.5 0 0 1 16.5 11v2.8l1.8 1.8H5.7l1.8-1.8V11a6.5 6.5 0 0 1 2.7-5.8z"/><path d="M10.2 5.2a2 2 0 0 1 3.6 0A6.5 6.5 0 0 1 16.5 11v2.8l1.8 1.8H5.7l1.8-1.8V11a6.5 6.5 0 0 1 2.7-5.8z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>',
    menu: '<path d="M4.5 7.5h15"/><path d="M4.5 12h15"/><path d="M4.5 16.5h15"/>',
    more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
    plug:
      '<path d="M12 21.5v-4.5"/><path d="M9.5 8V3"/><path d="M14.5 8V3"/><path class="admin-icon__fill" d="M6.5 8.5h11a2 2 0 0 1 2 2v3.2a5.8 5.8 0 0 1-5.8 5.8h-3.4A5.8 5.8 0 0 1 4.5 13.7V10.5a2 2 0 0 1 2-2z"/><path d="M6.5 8.5h11a2 2 0 0 1 2 2v3.2a5.8 5.8 0 0 1-5.8 5.8h-3.4A5.8 5.8 0 0 1 4.5 13.7V10.5a2 2 0 0 1 2-2z"/>',
    building:
      '<path class="admin-icon__fill" d="M6.5 21.5V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16.5"/><path d="M6.5 21.5V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16.5"/><path d="M6.5 12.5h11"/><path d="M10 12.5v4"/><path d="M14 12.5v4"/><path d="M10 7h4"/>',
    lock:
      '<rect class="admin-icon__fill" x="5" y="11" width="14" height="10" rx="2"/><path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11"/><rect x="5" y="11" width="14" height="10" rx="2"/>',
    layout:
      '<rect class="admin-icon__fill" x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect class="admin-icon__fill" x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect class="admin-icon__fill" x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect class="admin-icon__fill" x="13" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/>',
    settings:
      '<circle class="admin-icon__fill" cx="12" cy="12" r="3.25"/><circle cx="12" cy="12" r="3.25"/><path d="M12 3.2v2.1"/><path d="M12 18.7v2.1"/><path d="M5.1 5.1l1.5 1.5"/><path d="M17.4 17.4l1.5 1.5"/><path d="M3.2 12h2.1"/><path d="M18.7 12h2.1"/><path d="M5.1 18.9l1.5-1.5"/><path d="M17.4 6.6l1.5-1.5"/>',
    chevron: '<path d="M9 6.5l6 5.5l-6 5.5"/>',
    "trending-up": '<path d="M3.5 16.5l6-6l4 4l7-7"/><path d="M14.5 7.5h6v6"/>',
    "user-plus":
      '<circle class="admin-icon__fill" cx="11" cy="8" r="3.25"/><circle cx="11" cy="8" r="3.25"/><path d="M4 19.5c.7-2.8 2.8-4.5 6.2-4.5"/><path d="M16.5 18.5h5"/><path d="M19 16v5"/>',
    "user-minus":
      '<circle class="admin-icon__fill" cx="11" cy="8" r="3.25"/><circle cx="11" cy="8" r="3.25"/><path d="M4 19.5c.7-2.8 2.8-4.5 6.2-4.5H17"/><path d="M16.5 18.5h5"/>',
    "file-text":
      '<path class="admin-icon__fill" d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/><path d="M9.5 12.5h5"/><path d="M9.5 16h5"/><path d="M9.5 19.5h3"/>',
    "file-certificate":
      '<path class="admin-icon__fill" d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/><circle cx="12" cy="14.5" r="2.2"/><path d="M9.5 10.5h5"/>',
    sparkles:
      '<path class="admin-icon__fill" d="M12 3.2l1.2 3.8L17 8.2l-3.8 1.2L12 13.2l-1.2-3.8L7 8.2l3.8-1.2z"/><path d="M12 3.2l1.2 3.8L17 8.2l-3.8 1.2L12 13.2l-1.2-3.8L7 8.2l3.8-1.2z"/><path d="M19 14.2l.7 2.1L21.8 17l-2.1.7L19 19.8l-.7-2.1L16.2 17l2.1-.7z"/><path d="M5.2 16l.8 2.3L8.3 19l-2.3.8L5.2 22.1l-.8-2.3L2.1 19l2.3-.7z"/>',
    star:
      '<path class="admin-icon__fill" d="M12 3.8l2.4 4.9l5.4.8l-3.9 3.8l.9 5.4L12 16.2l-4.8 2.5l.9-5.4L4.2 9.5l5.4-.8z"/><path d="M12 3.8l2.4 4.9l5.4.8l-3.9 3.8l.9 5.4L12 16.2l-4.8 2.5l.9-5.4L4.2 9.5l5.4-.8z"/>',
    "calendar-off":
      '<path d="M8 3v4"/><path d="M16 3v4"/><path d="M3.5 9.5h17"/><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M15.5 15.5l-7-7"/><path d="M8.5 15.5l7-7"/>',
    "external-link":
      '<path d="M12 6.5h5.5V12"/><path d="M10.5 13.5L17.5 6.5"/><path d="M15 11.5h3v8.5H5.5V8.5H14"/>',
    download: '<path d="M12 3.5v11"/><path d="M8.2 11.2L12 15l3.8-3.8"/><path d="M4.5 20.5h15"/>',
    plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
    trash:
      '<path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path class="admin-icon__fill" d="M6.5 7.5h11V19a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z"/><path d="M6.5 7.5h11V19a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z"/><path d="M10.5 11.5v6"/><path d="M13.5 11.5v6"/>',
    mail:
      '<rect class="admin-icon__fill" x="3.5" y="5.5" width="17" height="13" rx="2.5"/><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.2 7.2L12 13.2l7.8-6"/>',
    phone:
      '<path class="admin-icon__fill" d="M21.5 16.7v2.7a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3.5 4.5a1.8 1.8 0 0 1 1.8-2h2.7a1.8 1.8 0 0 1 1.8 1.55c.12.86.33 1.7.65 2.5a1.8 1.8 0 0 1-.4 1.9L8.5 10a14.4 14.4 0 0 0 5.4 5.4l1.15-1.15a1.8 1.8 0 0 1 1.9-.4c.8.32 1.64.53 2.5.65a1.8 1.8 0 0 1 1.55 1.8z"/><path d="M21.5 16.7v2.7a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3.5 4.5a1.8 1.8 0 0 1 1.8-2h2.7a1.8 1.8 0 0 1 1.8 1.55c.12.86.33 1.7.65 2.5a1.8 1.8 0 0 1-.4 1.9L8.5 10a14.4 14.4 0 0 0 5.4 5.4l1.15-1.15a1.8 1.8 0 0 1 1.9-.4c.8.32 1.64.53 2.5.65a1.8 1.8 0 0 1 1.55 1.8z"/>',
    cake:
      '<path d="M19.5 20.5v-7a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2v7"/><path d="M4.5 16h15"/><path d="M12 7.5v4"/><path d="M12 4a1.4 1.4 0 0 1 0 2.8"/>',
    heart:
      '<path class="admin-icon__fill" d="M19.2 12.4L12 19.5l-7.2-7.1A4.6 4.6 0 0 1 12 5.5a4.6 4.6 0 0 1 7.2 6.9z"/><path d="M19.2 12.4L12 19.5l-7.2-7.1A4.6 4.6 0 0 1 12 5.5a4.6 4.6 0 0 1 7.2 6.9z"/>',
    briefcase:
      '<path d="M9.5 6.5V5a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1.5"/><rect class="admin-icon__fill" x="3.5" y="6.5" width="17" height="14" rx="2.5"/><rect x="3.5" y="6.5" width="17" height="14" rx="2.5"/><path d="M3.5 12h17"/>',
    shield:
      '<path class="admin-icon__fill" d="M12 3.5l7.5 2.8v5.4c0 4.7-3.2 8-7.5 8.5-4.3-.5-7.5-3.8-7.5-8.5V6.3z"/><path d="M12 3.5l7.5 2.8v5.4c0 4.7-3.2 8-7.5 8.5-4.3-.5-7.5-3.8-7.5-8.5V6.3z"/><path d="M9.2 12.2l2 2l3.6-3.6"/>',
    user:
      '<circle class="admin-icon__fill" cx="12" cy="8" r="3.5"/><circle cx="12" cy="8" r="3.5"/><path d="M5 19.5c.8-3.2 3.2-5 7-5s6.2 1.8 7 5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4.2 4.2"/>',
  };

  function svg(name, className) {
    const body = PATHS[name];
    if (!body) return "";
    const cls = className ? ` admin-icon ${className}` : " admin-icon";
    return `<svg class="${cls.trim()}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  window.AdminIcons = { svg, paths: PATHS };
})();
