const api = window.SwiftHelp;
const workspace = document.getElementById("workspace");

const COPY = {
  today: ["Today", "P1s, SLA due, waiting on the user."],
  tickets: ["Tickets", "Requester, device, priority, thread — one record."],
  assets: ["Assets", "Laptops, phones, printers. Who has what."],
  inbox: ["Inbox", "What IT said back to the requester."],
  settings: ["Settings", "This desk is IT. Not lettings, not HR."],
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const chip = (kind, label) =>
  `<span class="chip chip--${kind}">${escapeHtml(label || String(kind || "").replaceAll("_", " "))}</span>`;

function parseRoute() {
  const raw = (location.hash || "#today").replace(/^#/, "");
  const [section, id] = raw.split("/");
  return { section: section || "today", id: id ? Number(id) : null };
}

function setNav(section) {
  const key = COPY[section] ? section : "today";
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.section === key);
  });
  pageTitle.textContent = COPY[key][0];
  pageSub.textContent = COPY[key][1];
}

const pageTitle = document.getElementById("page-title");
const pageSub = document.getElementById("page-sub");

function thread(items) {
  if (!items?.length) return `<p class="muted">Nothing logged.</p>`;
  return `<div class="thread">${items
    .map(
      (m) => `<article class="msg msg--${m.author_role}">
        <header><span>${escapeHtml(m.author_name)} · ${chip(m.author_role)}</span>
        <span>${escapeHtml((m.created_at || "").replace("T", " ").slice(0, 16))}</span></header>
        <p>${escapeHtml(m.body)}</p>
      </article>`,
    )
    .join("")}</div>`;
}

function ticketLink(t) {
  return `#tickets/${t.id}`;
}

async function loadToday() {
  const data = await api.request("/overview");
  workspace.innerHTML = `
    <div class="kpi-grid">
      <a class="kpi" href="#tickets"><span>Open</span><b>${data.open}</b></a>
      <a class="kpi" href="#today"><span>P1</span><b>${data.p1}</b></a>
      <a class="kpi" href="#today"><span>SLA due</span><b>${data.sla_due}</b></a>
      <a class="kpi" href="#today"><span>Waiting</span><b>${data.waiting}</b></a>
    </div>
    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><h2>Needs you</h2></div>
        <table class="data">
          <thead><tr><th>Ticket</th><th>Who</th><th></th></tr></thead>
          <tbody>
            ${[...(data.p1_list || []), ...(data.sla_list || [])]
              .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
              .map(
                (t) => `<tr>
                  <td><a href="${ticketLink(t)}">${escapeHtml(t.number)}</a> ${chip(t.priority)} ${chip(t.sla)}</td>
                  <td>${escapeHtml(t.requester?.name || "")}<div class="muted">${escapeHtml(t.title)}</div></td>
                  <td>${chip(t.status)}</td>
                </tr>`,
              )
              .join("") || `<tr><td colspan="3" class="muted">Clear.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Latest</h2><button type="button" class="btn btn--amber btn--sm" id="add-ticket">Raise ticket</button></div>
        ${thread(data.latest || [])}
      </div>
    </div>
  `;
  document.getElementById("add-ticket").onclick = openTicketDialog;
}

async function loadTickets() {
  const data = await api.request("/tickets");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Open and recent</h2>
        <div class="toolbar">
          <button type="button" class="btn btn--ghost btn--sm" id="add-person">Add person</button>
          <button type="button" class="btn btn--amber btn--sm" id="add-ticket">Raise ticket</button>
        </div>
      </div>
      <div class="card-grid">
        ${data.tickets
          .map(
            (t) => `<a class="card" href="${ticketLink(t)}">
              <b>${escapeHtml(t.number)} ${chip(t.priority)} ${chip(t.status)}</b>
              <p>${escapeHtml(t.title)}</p>
              <p class="muted">${escapeHtml(t.requester?.name || "")} · ${escapeHtml(t.asset?.name || "no asset")}</p>
            </a>`,
          )
          .join("")}
      </div>
    </div>
  `;
  document.getElementById("add-ticket").onclick = openTicketDialog;
  document.getElementById("add-person").onclick = () => document.getElementById("person-dialog").showModal();
}

async function loadTicket(id) {
  const t = await api.request(`/tickets/${id}`);
  workspace.innerHTML = `
    <p><a class="back" href="#tickets">← All tickets</a></p>
    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(t.number)}</h2>${chip(t.priority)} ${chip(t.status)} ${chip(t.sla)}</div>
        <h3>${escapeHtml(t.title)}</h3>
        <p>${escapeHtml(t.detail || "")}</p>
        <dl class="kv">
          <dt>Requester</dt><dd>${escapeHtml(t.requester?.name || "")}<div class="muted">${escapeHtml(t.requester?.department || "")}</div></dd>
          <dt>Asset</dt><dd>${t.asset ? `<a href="#assets/${t.asset.id}">${escapeHtml(t.asset.name)}</a>` : "—"}</dd>
          <dt>Due</dt><dd>${escapeHtml((t.due_at || "").replace("T", " ").slice(0, 16))}</dd>
        </dl>
        <p class="toolbar">
          <label>Status
            <select id="ticket-status">
              ${["open", "waiting", "in_progress", "resolved", "closed"]
                .map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${s.replace("_", " ")}</option>`)
                .join("")}
            </select>
          </label>
        </p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Thread</h2></div>
        ${thread(t.updates)}
        <form id="reply-form" class="toolbar" style="margin-top:12px">
          <input name="body" required placeholder="Update the requester" style="flex:1" />
          <button class="btn btn--amber btn--sm" type="submit">Send</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById("ticket-status").onchange = async (event) => {
    await api.request(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: event.target.value }) });
    await loadTicket(id);
  };
  document.getElementById("reply-form").onsubmit = async (event) => {
    event.preventDefault();
    const body = new FormData(event.target).get("body");
    await api.request(`/tickets/${id}/updates`, { method: "POST", body: JSON.stringify({ body, audience: "requester" }) });
    await loadTicket(id);
  };
}

async function loadAssets() {
  const data = await api.request("/assets");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Inventory</h2>
        <button type="button" class="btn btn--amber btn--sm" id="add-asset">Add asset</button></div>
      <div class="card-grid">
        ${data.assets
          .map(
            (a) => `<a class="card" href="#assets/${a.id}">
              <b>${escapeHtml(a.name)}</b>
              <p>${chip(a.kind)} ${chip(a.status)}</p>
              <p class="muted">${escapeHtml(a.owner?.name || "Unassigned")} · ${escapeHtml(a.serial || "")}</p>
            </a>`,
          )
          .join("")}
      </div>
    </div>
  `;
  document.getElementById("add-asset").onclick = openAssetDialog;
}

async function loadAsset(id) {
  const a = await api.request(`/assets/${id}`);
  workspace.innerHTML = `
    <p><a class="back" href="#assets">← Inventory</a></p>
    <div class="panel">
      <div class="panel-head"><h2>${escapeHtml(a.name)}</h2>${chip(a.kind)} ${chip(a.status)}</div>
      <dl class="kv">
        <dt>Serial</dt><dd>${escapeHtml(a.serial || "—")}</dd>
        <dt>Owner</dt><dd>${escapeHtml(a.owner?.name || "Unassigned")}</dd>
        <dt>Notes</dt><dd>${escapeHtml(a.notes || "—")}</dd>
      </dl>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Tickets on this device</h2></div>
      <table class="data">
        <thead><tr><th>Ticket</th><th>Status</th></tr></thead>
        <tbody>
          ${(a.tickets || [])
            .map((t) => `<tr><td><a href="#tickets/${t.id}">${escapeHtml(t.number)}</a> ${escapeHtml(t.title)}</td><td>${chip(t.status)}</td></tr>`)
            .join("") || `<tr><td colspan="2" class="muted">None.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function loadInbox() {
  const data = await api.request("/updates");
  workspace.innerHTML = `<div class="panel"><div class="panel-head"><h2>Every update</h2></div>${thread(data.updates)}</div>`;
}

async function loadSettings() {
  const me = await api.request("/me");
  workspace.innerHTML = `
    <div class="panel">
      <h2>${escapeHtml(me.org)}</h2>
      <p>${escapeHtml(me.name)} · ${escapeHtml(me.email)}</p>
      <p class="muted">Five jobs: today, tickets, assets, inbox, settings. Staff have their own portal. This is not SwiftCRM and not ShiftSwift HR.</p>
      <p><a class="btn btn--ghost btn--sm" href="./request.html">Staff portal</a></p>
    </div>
  `;
}

async function openTicketDialog() {
  const [people, assets] = await Promise.all([api.request("/people"), api.request("/assets")]);
  document.getElementById("ticket-requester").innerHTML = people.people
    .filter((p) => p.role === "requester")
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  document.getElementById("ticket-asset").innerHTML =
    `<option value="">—</option>` + assets.assets.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  document.getElementById("ticket-dialog").showModal();
}

async function openAssetDialog() {
  const people = await api.request("/people");
  document.getElementById("asset-owner").innerHTML =
    `<option value="">Unassigned</option>` +
    people.people.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  document.getElementById("asset-dialog").showModal();
}

async function render() {
  if (!api.token()) {
    window.location.replace("./login.html");
    return;
  }
  if (!location.hash) history.replaceState(null, "", "#today");
  const { section, id } = parseRoute();
  setNav(section);
  workspace.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (section === "tickets" && id) await loadTicket(id);
    else if (section === "tickets") await loadTickets();
    else if (section === "assets" && id) await loadAsset(id);
    else if (section === "assets") await loadAssets();
    else if (section === "inbox") await loadInbox();
    else if (section === "settings") await loadSettings();
    else await loadToday();
  } catch (err) {
    if (String(err.message).toLowerCase().includes("sign in")) {
      localStorage.removeItem("swifthelpToken");
      window.location.replace("./login.html");
      return;
    }
    workspace.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById("sign-out").onclick = () => {
  localStorage.removeItem("swifthelpToken");
  window.location.replace("./login.html");
};

["ticket-cancel", "asset-cancel", "person-cancel"].forEach((id) => {
  document.getElementById(id).onclick = () => document.getElementById(id.replace("-cancel", "-dialog")).close();
});

document.getElementById("ticket-form").onsubmit = async (event) => {
  event.preventDefault();
  const err = document.getElementById("ticket-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/tickets", {
      method: "POST",
      body: JSON.stringify({
        title: raw.title,
        detail: raw.detail,
        priority: raw.priority,
        requester_id: Number(raw.requester_id),
        asset_id: raw.asset_id ? Number(raw.asset_id) : null,
      }),
    });
    document.getElementById("ticket-dialog").close();
    event.target.reset();
    location.hash = "#tickets";
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
};

document.getElementById("asset-form").onsubmit = async (event) => {
  event.preventDefault();
  const err = document.getElementById("asset-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/assets", {
      method: "POST",
      body: JSON.stringify({
        ...raw,
        owner_id: raw.owner_id ? Number(raw.owner_id) : null,
      }),
    });
    document.getElementById("asset-dialog").close();
    event.target.reset();
    location.hash = "#assets";
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
};

document.getElementById("person-form").onsubmit = async (event) => {
  event.preventDefault();
  const err = document.getElementById("person-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/people", { method: "POST", body: JSON.stringify(raw) });
    document.getElementById("person-dialog").close();
    event.target.reset();
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
};

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", render);
