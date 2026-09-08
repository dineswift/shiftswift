const portal = document.getElementById("portal-root")?.dataset.portal || "tenant";
const tokenKey = portal === "landlord" ? "swiftcrmLandlordToken" : "swiftcrmTenantToken";
const api = window.SwiftCRM;
const money = (n) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

function setToken(value) {
  if (value) localStorage.setItem(tokenKey, value);
  else localStorage.removeItem(tokenKey);
  localStorage.setItem("swiftcrmToken", value || "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function showHome() {
  const data = await api.request("/portal/home");
  document.getElementById("login-card").classList.add("hidden");
  document.body.classList.remove("login-page");
  document.getElementById("portal-app").classList.remove("hidden");
  document.getElementById("portal-title").textContent = data.user.name;
  const lettings = data.lettings
    .map(
      (t) => `<article class="panel">
        <div class="panel-head"><h2>${escapeHtml(t.property_name)}</h2></div>
        <p>${escapeHtml(t.address_line || "")}, ${escapeHtml(t.city || "")} ${escapeHtml(t.postcode || "")}</p>
        <p>Rent ${money(t.rent_pcm)} · ${portal === "landlord" ? "Tenant " + escapeHtml(t.occupier_name || "") : "Landlord " + escapeHtml(t.landlord_name || "")}</p>
        <p class="muted">Council tax band ${escapeHtml(t.council_tax_band || "—")} · liable: ${escapeHtml(t.council_tax_liable === "occupier" ? "tenant" : t.council_tax_liable || "—")} · ${escapeHtml(t.council_tax_authority || "")}</p>
      </article>`,
    )
    .join("");
  const invoices = (data.invoices || [])
    .map((i) => `<li>${i.number} · ${money(i.amount)} · ${i.status} · due ${i.due_on}</li>`)
    .join("");
  const thread = (data.communications || [])
    .map(
      (m) => `<article class="msg msg--${m.author_role}">
        <header><span>${escapeHtml(m.author_name)}</span><span>${escapeHtml((m.created_at || "").slice(0, 10))}</span></header>
        <b>${escapeHtml(m.subject)}</b>
        <p>${escapeHtml(m.body)}</p>
      </article>`,
    )
    .join("");
  document.getElementById("portal-workspace").innerHTML = `
    ${lettings || `<p class="muted">No lettings on file.</p>`}
    <div class="panel">
      <div class="panel-head"><h2>Invoices</h2></div>
      <ul>${invoices || "<li class='muted'>None</li>"}</ul>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Updates from the agency</h2></div>
      <div class="thread">${thread || "<p class='muted'>No messages yet.</p>"}</div>
      <form id="reply-form" class="sheet-body" style="padding:0">
        <label>Write to the agency
          <input name="subject" required placeholder="Subject" />
        </label>
        <label>
          <textarea name="body" rows="3" required placeholder="Message"></textarea>
        </label>
        <button class="btn btn--copper" type="submit">Send</button>
      </form>
    </div>
  `;
  document.getElementById("reply-form").onsubmit = async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.target).entries());
    const letting = data.lettings[0];
    await api.request("/portal/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: raw.subject,
        body: raw.body,
        property_id: letting?.property_id || null,
        tenancy_id: letting?.id || null,
      }),
    });
    await showHome();
  };
}

document.getElementById("portal-login")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("login-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    const data = await api.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ ...raw, portal }),
    });
    setToken(data.token);
    await showHome();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("portal-out")?.addEventListener("click", () => {
  setToken("");
  window.location.reload();
});

if (localStorage.getItem(tokenKey)) {
  localStorage.setItem("swiftcrmToken", localStorage.getItem(tokenKey));
  showHome().catch(() => setToken(""));
}
