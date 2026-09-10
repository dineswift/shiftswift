const api = window.SwiftHelp;
const workspace = document.getElementById("workspace");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

if (!api.token()) window.location.replace("./login.html");

async function load() {
  try {
    const me = await api.request("/me");
    if (me.role !== "requester") {
      window.location.replace("./app.html");
      return;
    }
    document.getElementById("who").textContent = `${me.name} · ${me.org}`;
    const data = await api.request("/tickets");
    const id = Number((location.hash || "").replace("#", ""));
    if (id) {
      const t = await api.request(`/tickets/${id}`);
      workspace.innerHTML = `
        <p><a class="back" href="#">← My tickets</a></p>
        <div class="panel">
          <div class="panel-head"><h2>${escapeHtml(t.number)}</h2><span class="chip chip--${t.status}">${t.status}</span></div>
          <h3>${escapeHtml(t.title)}</h3>
          <p>${escapeHtml(t.detail || "")}</p>
        </div>
        <div class="panel">
          ${(t.updates || [])
            .map(
              (m) => `<article class="msg"><header>${escapeHtml(m.author_name)}</header><p>${escapeHtml(m.body)}</p></article>`,
            )
            .join("")}
          <form id="reply" class="toolbar" style="margin-top:12px">
            <input name="body" required placeholder="Reply to IT" style="flex:1" />
            <button class="btn btn--amber btn--sm">Send</button>
          </form>
        </div>
      `;
      document.getElementById("reply").onsubmit = async (event) => {
        event.preventDefault();
        await api.request(`/tickets/${id}/updates`, {
          method: "POST",
          body: JSON.stringify({ body: new FormData(event.target).get("body") }),
        });
        await load();
      };
      return;
    }
    workspace.innerHTML = `
      <div class="card-grid">
        ${data.tickets
          .map(
            (t) => `<a class="card" href="#${t.id}">
              <b>${escapeHtml(t.number)}</b>
              <p>${escapeHtml(t.title)}</p>
              <p class="muted">${escapeHtml(t.status)} · ${escapeHtml(t.priority)}</p>
            </a>`,
          )
          .join("")}
      </div>
    `;
  } catch (err) {
    workspace.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById("sign-out").onclick = () => {
  localStorage.removeItem("swifthelpToken");
  window.location.replace("./login.html");
};
document.getElementById("raise").onclick = () => document.getElementById("ticket-dialog").showModal();
document.getElementById("ticket-cancel").onclick = () => document.getElementById("ticket-dialog").close();
document.getElementById("ticket-form").onsubmit = async (event) => {
  event.preventDefault();
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    const created = await api.request("/tickets", {
      method: "POST",
      body: JSON.stringify({ title: raw.title, detail: raw.detail, priority: raw.priority, requester_id: 0 }),
    });
    document.getElementById("ticket-dialog").close();
    location.hash = `#${created.id}`;
    await load();
  } catch (ex) {
    document.getElementById("ticket-error").textContent = ex.message;
    document.getElementById("ticket-error").classList.remove("hidden");
  }
};
window.addEventListener("hashchange", load);
load();
