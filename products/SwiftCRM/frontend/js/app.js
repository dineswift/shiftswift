const api = window.SwiftCRM;
const workspace = document.getElementById("workspace");
const pageTitle = document.getElementById("page-title");
const pageSub = document.getElementById("page-sub");

const COPY = {
  overview: ["Overview", "Lettings, arrears, tax flags and the latest updates."],
  lettings: ["Lettings", "ASTs the agency manages — tenant, landlord, rent and deposit."],
  properties: ["Properties", "Units on the books with council tax and who lives there."],
  tenants: ["Tenants", "People in occupation. The agency talks to them for the landlord."],
  landlords: ["Landlords", "Owners the agency acts for — tax status, portfolio, updates."],
  inbox: ["Updates", "Messages to tenants, landlords, or both. The agency is in the middle."],
  tax: ["Local tax", "Council tax liability per property, plus landlord NRL / UTR."],
  invoices: ["Invoices", "Rent and fees. Collect payment, then queue Xero."],
  payments: ["Payments", "Money in — Bacs, card, allocated to an invoice."],
  pipeline: ["Pipeline", "Applicants before they become a letting."],
  settings: ["Settings", "Agency profile, portals and accounting."],
};

const money = (n) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function chip(kind, label) {
  const text = label || String(kind || "").replaceAll("_", " ");
  return `<span class="chip chip--${kind}">${escapeHtml(text)}</span>`;
}

function parseRoute() {
  const raw = (location.hash || "#overview").replace(/^#/, "");
  const [section, id] = raw.split("/");
  return { section: section || "overview", id: id ? Number(id) : null };
}

function requireSession() {
  if (!api.token()) {
    window.location.replace("./login.html");
    return false;
  }
  return true;
}

function setNav(section) {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.section === section);
  });
  const [title, sub] = COPY[section] || COPY.overview;
  pageTitle.textContent = title;
  pageSub.textContent = sub;
}

function thread(items) {
  if (!items?.length) return `<p class="muted">No updates yet.</p>`;
  return `<div class="thread">${items
    .map(
      (m) => `<article class="msg msg--${m.author_role}">
        <header>
          <span>${escapeHtml(m.author_name)} · ${chip(m.audience)} ${chip(m.channel)}</span>
          <span>${escapeHtml((m.created_at || "").replace("T", " ").slice(0, 16))}</span>
        </header>
        <b>${escapeHtml(m.subject)}</b>
        <p>${escapeHtml(m.body)}</p>
        <p class="muted">${escapeHtml(m.property?.name || m.property_name || "")}</p>
      </article>`,
    )
    .join("")}</div>`;
}

async function loadOverview() {
  const data = await api.request("/overview");
  workspace.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><span>Lettings</span><b>${data.portfolio.lettings || 0}</b></div>
      <div class="kpi"><span>Let / vacant</span><b>${data.portfolio.let} / ${data.portfolio.available}</b></div>
      <div class="kpi"><span>Arrears</span><b>${money(data.arrears_gbp)}</b></div>
      <div class="kpi"><span>Updates</span><b>${data.inbox || 0}</b></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Needs a chase</h2><a href="#invoices">Invoices</a></div>
      <table class="data">
        <thead><tr><th>Invoice</th><th>Property</th><th>Tenant</th><th>Due</th><th>Amount</th></tr></thead>
        <tbody>
          ${(data.attention || [])
            .map(
              (row) => `<tr>
                <td>${row.number} ${chip(row.status)}</td>
                <td>${escapeHtml(row.property_name)}</td>
                <td>${escapeHtml(row.contact_name)}</td>
                <td>${row.due_on}</td>
                <td class="money">${money(row.amount)}</td>
              </tr>`,
            )
            .join("") || `<tr><td colspan="5" class="muted">Nothing due.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Latest updates</h2><button type="button" class="btn btn--copper btn--sm" id="open-message">New update</button></div>
      ${thread(data.latest_updates || [])}
    </div>
  `;
  const btn = document.getElementById("open-message");
  if (btn) btn.onclick = openMessageDialog;
}

async function loadLettings() {
  const data = await api.request("/tenancies");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Live and recent lettings</h2>
        <button type="button" class="btn btn--copper btn--sm" id="add-letting">Record letting</button>
      </div>
      <table class="data">
        <thead><tr><th>Property</th><th>Tenant</th><th>Landlord</th><th>Term</th><th>Rent</th><th>Council tax</th></tr></thead>
        <tbody>
          ${data.tenancies
            .map(
              (t) => `<tr>
                <td><a href="#lettings/${t.id}">${escapeHtml(t.property_name)}</a><div class="muted">${escapeHtml(t.address_line)}, ${escapeHtml(t.city)}</div></td>
                <td><a href="#tenants/${t.occupier_id}">${escapeHtml(t.occupier_name)}</a></td>
                <td><a href="#landlords/${t.landlord_id}">${escapeHtml(t.landlord_name)}</a></td>
                <td>${t.start_date} → ${t.end_date || "rolling"} ${chip(t.status)}</td>
                <td class="money">${money(t.rent_pcm)}</td>
                <td>Band ${escapeHtml(t.council_tax_band || "—")} · ${escapeHtml(t.council_tax_liable === "occupier" ? "tenant" : t.council_tax_liable || "—")}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("add-letting").onclick = openLettingDialog;
}

async function loadLettingDetail(id) {
  const t = await api.request(`/tenancies/${id}`);
  workspace.innerHTML = `
    <p><a class="back" href="#lettings">← All lettings</a></p>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(t.property_name)}</h2>${chip(t.status)}</div>
        <dl class="kv">
          <dt>Tenant</dt><dd><a href="#tenants/${t.occupier_id}">${escapeHtml(t.occupier_name)}</a><div class="muted">${escapeHtml(t.occupier_email || "")} · ${escapeHtml(t.occupier_phone || "")}</div></dd>
          <dt>Landlord</dt><dd><a href="#landlords/${t.landlord_id}">${escapeHtml(t.landlord_name)}</a><div class="muted">${escapeHtml(t.landlord_email || "")}</div></dd>
          <dt>Term</dt><dd>${t.start_date} → ${t.end_date || "rolling"}</dd>
          <dt>Rent</dt><dd>${money(t.rent_pcm)} due day ${t.rent_due_day || 1}</dd>
          <dt>Deposit</dt><dd>${money(t.deposit)} · ${escapeHtml(t.deposit_scheme || "—")} ${escapeHtml(t.deposit_ref || "")}</dd>
          <dt>Council tax</dt><dd>Band ${escapeHtml(t.council_tax_band || "—")} · ${escapeHtml(t.council_tax_authority || "")}<div class="muted">Liable: ${escapeHtml(t.council_tax_liable === "occupier" ? "tenant" : t.council_tax_liable || "—")} · ${escapeHtml(t.council_tax_account || "")}</div></dd>
        </dl>
        <p><button type="button" class="btn btn--copper btn--sm" id="open-message">Update tenant &amp; landlord</button></p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Thread</h2></div>
        ${thread(t.communications)}
      </div>
    </div>
  `;
  document.getElementById("open-message").onclick = () =>
    openMessageDialog({
      audience: "both",
      property_id: t.property_id,
      tenancy_id: t.id,
      contact_id: t.occupier_id,
    });
}

async function loadProperties() {
  const data = await api.request("/properties");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Portfolio</h2>
        <button type="button" class="btn btn--copper btn--sm" id="add-property">Add property</button>
      </div>
      <table class="data">
        <thead><tr><th>Property</th><th>Status</th><th>Rent</th><th>Landlord</th><th>Tenant</th><th>Council tax</th></tr></thead>
        <tbody>
          ${data.properties
            .map(
              (p) => `<tr>
                <td><a href="#properties/${p.id}">${escapeHtml(p.name)}</a><div class="muted">${escapeHtml(p.address_line)}, ${escapeHtml(p.city)} ${escapeHtml(p.postcode)}</div></td>
                <td>${chip(p.status)}</td>
                <td class="money">${money(p.rent_pcm)}</td>
                <td>${p.landlord ? `<a href="#landlords/${p.landlord.id}">${escapeHtml(p.landlord.name)}</a>` : "—"}</td>
                <td>${p.current_tenancy ? `<a href="#tenants/${p.current_tenancy.occupier_id}">${escapeHtml(p.current_tenancy.occupier_name)}</a>` : "—"}</td>
                <td>Band ${escapeHtml(p.council_tax_band || "—")} · ${escapeHtml(p.council_tax_liable === "occupier" ? "tenant" : p.council_tax_liable || "—")}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("add-property").onclick = () =>
    document.getElementById("property-dialog").showModal();
}

async function loadPropertyDetail(id) {
  const p = await api.request(`/properties/${id}`);
  workspace.innerHTML = `
    <p><a class="back" href="#properties">← Portfolio</a></p>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(p.name)}</h2>${chip(p.status)}</div>
        <dl class="kv">
          <dt>Address</dt><dd>${escapeHtml(p.address_line)}, ${escapeHtml(p.city)} ${escapeHtml(p.postcode)}</dd>
          <dt>Type</dt><dd>${p.beds} bed ${escapeHtml(p.property_type)}</dd>
          <dt>Rent</dt><dd>${money(p.rent_pcm)}</dd>
          <dt>Landlord</dt><dd>${p.landlord ? `<a href="#landlords/${p.landlord.id}">${escapeHtml(p.landlord.name)}</a>` : "—"}</dd>
          <dt>Tenant</dt><dd>${p.current_tenancy ? `<a href="#tenants/${p.current_tenancy.occupier_id}">${escapeHtml(p.current_tenancy.occupier_name)}</a>` : "Vacant"}</dd>
          <dt>Council tax</dt><dd>Band ${escapeHtml(p.council_tax_band || "—")} · ${escapeHtml(p.council_tax_authority || "")}<div class="muted">${escapeHtml(p.council_tax_account || "")} · liable: ${escapeHtml(p.council_tax_liable === "occupier" ? "tenant" : p.council_tax_liable || "—")}</div></dd>
          <dt>EPC / gas / EICR</dt><dd>${escapeHtml(p.epc_rating || "—")} · ${escapeHtml(p.gas_due || "—")} · ${escapeHtml(p.eicr_due || "—")}</dd>
        </dl>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Property updates</h2>
          <button type="button" class="btn btn--copper btn--sm" id="open-message">New update</button></div>
        ${thread(p.communications)}
      </div>
    </div>
  `;
  document.getElementById("open-message").onclick = () =>
    openMessageDialog({ property_id: p.id, audience: "both" });
}

async function loadPeople(role, heading) {
  const data = await api.request(`/contacts?role=${role}`);
  const section = role === "landlord" ? "landlords" : "tenants";
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>${heading}</h2>
        <button type="button" class="btn btn--copper btn--sm" id="add-person" data-role="${role}">Add ${role === "landlord" ? "landlord" : "tenant"}</button>
      </div>
      <table class="data">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tax / notes</th></tr></thead>
        <tbody>
          ${data.contacts
            .map(
              (c) => `<tr>
                <td><a href="#${section}/${c.id}">${escapeHtml(c.name)}</a></td>
                <td>${escapeHtml(c.email || "—")}</td>
                <td>${escapeHtml(c.phone || "—")}</td>
                <td>${c.nrl_status ? chip(c.nrl_status) : ""} ${escapeHtml(c.utr || c.notes || "")}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("add-person").onclick = () => {
    const roleSelect = document.getElementById("contact-role");
    roleSelect.value = role;
    roleSelect.dispatchEvent(new Event("change"));
    document.getElementById("contact-dialog").showModal();
  };
}

async function loadPersonDetail(id, listHash) {
  const data = await api.request(`/contacts/${id}`);
  const c = data.contact;
  const isLandlord = c.role === "landlord";
  workspace.innerHTML = `
    <p><a class="back" href="#${listHash}">← Back</a></p>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(c.name)}</h2>${chip(c.role === "occupier" ? "occupier" : c.role, c.role === "occupier" ? "tenant" : c.role)}</div>
        <dl class="kv">
          <dt>Email</dt><dd>${escapeHtml(c.email || "—")}</dd>
          <dt>Phone</dt><dd>${escapeHtml(c.phone || "—")}</dd>
          <dt>Address</dt><dd>${escapeHtml([c.address_line, c.city, c.postcode].filter(Boolean).join(", ") || "—")}</dd>
          ${isLandlord ? `<dt>UTR</dt><dd>${escapeHtml(c.utr || "—")}</dd><dt>NRL</dt><dd>${c.nrl_status ? chip(c.nrl_status) : "UK / not recorded"} ${escapeHtml(c.nrl_ref || "")}</dd>` : ""}
          <dt>Prefers</dt><dd>${escapeHtml(c.preferred_channel || "email")}</dd>
          <dt>Notes</dt><dd>${escapeHtml(c.notes || "—")}</dd>
        </dl>
        ${
          data.lettings?.length
            ? `<h3>Lettings</h3><ul>${data.lettings
                .map(
                  (t) =>
                    `<li><a href="#lettings/${t.id}">${escapeHtml(t.property_name)}</a> · ${money(t.rent_pcm)}</li>`,
                )
                .join("")}</ul>`
            : ""
        }
        <p><button type="button" class="btn btn--copper btn--sm" id="open-message">Send update</button></p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Conversation</h2></div>
        ${thread(data.communications)}
      </div>
    </div>
  `;
  document.getElementById("open-message").onclick = () =>
    openMessageDialog({
      audience: isLandlord ? "landlord" : "occupier",
      contact_id: c.id,
    });
}

async function loadInbox() {
  const data = await api.request("/communications");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Every update the agency has logged</h2>
        <button type="button" class="btn btn--copper btn--sm" id="open-message">New update</button>
      </div>
      ${thread(data.communications)}
    </div>
  `;
  document.getElementById("open-message").onclick = () => openMessageDialog();
}

async function loadTax() {
  const data = await api.request("/tax");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Council tax</h2><span class="muted">Local billing authority</span></div>
      <table class="data">
        <thead><tr><th>Property</th><th>Authority</th><th>Band</th><th>Account</th><th>Liable</th><th>Tenant</th></tr></thead>
        <tbody>
          ${data.council_tax
            .map(
              (p) => `<tr>
                <td><a href="#properties/${p.id}">${escapeHtml(p.name)}</a><div class="muted">${escapeHtml(p.address_line)}, ${escapeHtml(p.city)}</div></td>
                <td>${escapeHtml(p.council_tax_authority || "—")}</td>
                <td>${escapeHtml(p.council_tax_band || "—")}</td>
                <td>${escapeHtml(p.council_tax_account || "—")}</td>
                <td>${chip(p.council_tax_liable || "void", p.council_tax_liable === "occupier" ? "tenant" : p.council_tax_liable || "—")}</td>
                <td>${escapeHtml(p.occupier_name || "Vacant")}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Landlord tax records</h2><span class="muted">UTR and non-resident landlord scheme</span></div>
      <table class="data">
        <thead><tr><th>Landlord</th><th>UTR</th><th>NRL</th><th>Ref</th></tr></thead>
        <tbody>
          ${data.landlords
            .map(
              (l) => `<tr>
                <td><a href="#landlords/${l.id}">${escapeHtml(l.name)}</a></td>
                <td>${escapeHtml(l.utr || "—")}</td>
                <td>${l.nrl_status ? chip(l.nrl_status) : "—"}</td>
                <td>${escapeHtml(l.nrl_ref || "—")}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
      <p class="muted">${(data.notes || []).map(escapeHtml).join(" ")}</p>
    </div>
  `;
}

async function loadInvoices() {
  const data = await api.request("/invoices");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Rent and fees</h2>
        <button type="button" class="btn btn--copper btn--sm" id="add-invoice">Raise invoice</button>
      </div>
      <table class="data">
        <thead><tr><th>Number</th><th>Bill to</th><th>Property</th><th>Due</th><th>Amount</th><th>Books</th><th></th></tr></thead>
        <tbody>
          ${data.invoices
            .map(
              (inv) => `<tr>
                <td>${inv.number} ${chip(inv.status)}</td>
                <td>${escapeHtml(inv.contact?.name || "—")}</td>
                <td>${escapeHtml(inv.property?.name || "—")}</td>
                <td>${inv.due_on}</td>
                <td class="money">${money(inv.amount)}</td>
                <td>${chip(inv.xero_status)}</td>
                <td>${
                  inv.status === "paid"
                    ? `<span class="muted">Paid</span>`
                    : `<button type="button" class="btn btn--navy btn--sm collect-btn" data-id="${inv.id}">Collect</button>`
                }</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("add-invoice").onclick = openInvoiceDialog;
  workspace.querySelectorAll(".collect-btn").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api.request(`/invoices/${btn.dataset.id}/collect`, {
          method: "POST",
          body: JSON.stringify({ method: "bacs" }),
        });
        await loadInvoices();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    };
  });
}

async function openInvoiceDialog() {
  const [props, people] = await Promise.all([api.request("/properties"), api.request("/contacts")]);
  document.getElementById("invoice-property").innerHTML = props.properties
    .map((p) => `<option value="${p.id}">${p.name} — ${money(p.rent_pcm)}</option>`)
    .join("");
  document.getElementById("invoice-contact").innerHTML = people.contacts
    .map((c) => `<option value="${c.id}">${c.name} (${c.role === "occupier" ? "tenant" : c.role})</option>`)
    .join("");
  const due = new Date();
  due.setDate(due.getDate() + 7);
  document.querySelector('#invoice-form [name="due_on"]').value = due.toISOString().slice(0, 10);
  document.getElementById("invoice-dialog").showModal();
}

async function openLettingDialog() {
  const [props, tenants, landlords] = await Promise.all([
    api.request("/properties"),
    api.request("/contacts?role=occupier"),
    api.request("/contacts?role=landlord"),
  ]);
  document.getElementById("letting-property").innerHTML = props.properties
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  document.getElementById("letting-tenant").innerHTML = tenants.contacts
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");
  document.getElementById("letting-landlord").innerHTML = landlords.contacts
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");
  document.querySelector('#letting-form [name="start_date"]').value = new Date().toISOString().slice(0, 10);
  document.getElementById("letting-dialog").showModal();
}

async function openMessageDialog(prefill = {}) {
  const [props, people] = await Promise.all([api.request("/properties"), api.request("/contacts")]);
  document.getElementById("message-property").innerHTML =
    `<option value="">—</option>` +
    props.properties.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  document.getElementById("message-contact").innerHTML =
    `<option value="">—</option>` +
    people.contacts
      .map((c) => `<option value="${c.id}">${c.name} (${c.role === "occupier" ? "tenant" : c.role})</option>`)
      .join("");
  const form = document.getElementById("message-form");
  if (prefill.audience) form.audience.value = prefill.audience;
  if (prefill.property_id) form.property_id.value = String(prefill.property_id);
  if (prefill.contact_id) form.contact_id.value = String(prefill.contact_id);
  form.dataset.tenancyId = prefill.tenancy_id || "";
  document.getElementById("message-dialog").showModal();
}

async function loadPayments() {
  const data = await api.request("/payments");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Money received</h2></div>
      <table class="data">
        <thead><tr><th>Date</th><th>Reference</th><th>Invoice</th><th>From</th><th>Property</th><th>Method</th><th>Amount</th></tr></thead>
        <tbody>
          ${data.payments
            .map(
              (p) => `<tr>
                <td>${p.paid_on}</td><td>${escapeHtml(p.reference)}</td><td>${p.invoice_number}</td>
                <td>${escapeHtml(p.contact_name)}</td><td>${escapeHtml(p.property_name)}</td>
                <td>${p.method}</td><td class="money">${money(p.amount)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadPipeline() {
  const data = await api.request("/pipeline");
  workspace.innerHTML = `
    <div class="pipeline">
      ${data.stages
        .map(
          (stage) => `<div class="stage">
            <h3>${stage.label} (${stage.deals.length})</h3>
            ${stage.deals
              .map(
                (d) => `<article class="deal">
                  <b>${escapeHtml(d.title)}</b>
                  <p>${escapeHtml(d.contact_name)}${d.property_name ? ` · ${escapeHtml(d.property_name)}` : ""}</p>
                  <select data-deal="${d.id}">
                    ${data.stages
                      .map((s) => `<option value="${s.key}" ${s.key === d.stage ? "selected" : ""}>${s.label}</option>`)
                      .join("")}
                  </select>
                </article>`,
              )
              .join("")}
          </div>`,
        )
        .join("")}
    </div>
  `;
  workspace.querySelectorAll("select[data-deal]").forEach((sel) => {
    sel.onchange = async () => {
      await api.request(`/pipeline/deals/${sel.dataset.deal}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: sel.value }),
      });
      await loadPipeline();
    };
  });
}

async function loadSettings() {
  const me = await api.request("/me");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Agency</h2></div>
      <p><strong>${escapeHtml(me.agency || "Charlbury Lettings")}</strong><br>${escapeHtml(me.name)} · ${escapeHtml(me.email)}</p>
      <p class="muted">The agency sits between landlords and tenants. Each side has its own app.</p>
      <p>
        <a class="btn btn--ghost btn--sm" href="./tenant.html">Tenant app</a>
        <a class="btn btn--ghost btn--sm" href="./landlord.html">Landlord app</a>
      </p>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Accounting</h2></div>
      <p>Xero: ${chip("not_synced", "not connected")} · FreeAgent: ${chip("not_synced", "not connected")}</p>
    </div>
  `;
}

async function render() {
  if (!requireSession()) return;
  const { section, id } = parseRoute();
  setNav(section);
  workspace.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (section === "overview") await loadOverview();
    else if (section === "lettings" && id) await loadLettingDetail(id);
    else if (section === "lettings" || section === "tenancies") await loadLettings();
    else if (section === "properties" && id) await loadPropertyDetail(id);
    else if (section === "properties") await loadProperties();
    else if (section === "tenants" && id) await loadPersonDetail(id, "tenants");
    else if (section === "tenants") await loadPeople("occupier", "Tenants in occupation");
    else if (section === "landlords" && id) await loadPersonDetail(id, "landlords");
    else if (section === "landlords") await loadPeople("landlord", "Landlords");
    else if (section === "inbox") await loadInbox();
    else if (section === "tax") await loadTax();
    else if (section === "invoices") await loadInvoices();
    else if (section === "payments") await loadPayments();
    else if (section === "pipeline") await loadPipeline();
    else if (section === "settings") await loadSettings();
    else await loadOverview();
  } catch (err) {
    if (String(err.message).toLowerCase().includes("sign in")) {
      localStorage.removeItem("swiftcrmToken");
      window.location.replace("./login.html");
      return;
    }
    workspace.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById("sign-out").onclick = () => {
  localStorage.removeItem("swiftcrmToken");
  window.location.replace("./login.html");
};

document.getElementById("contact-role")?.addEventListener("change", (event) => {
  document.querySelectorAll(".landlord-only").forEach((el) => {
    el.classList.toggle("hidden", event.target.value !== "landlord");
  });
});

["property-cancel", "contact-cancel", "invoice-cancel", "letting-cancel", "message-cancel"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", () => {
    document.getElementById(id.replace("-cancel", "-dialog")).close();
  });
});

document.getElementById("property-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("property-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/properties", {
      method: "POST",
      body: JSON.stringify({ ...raw, beds: Number(raw.beds), rent_pcm: Number(raw.rent_pcm) }),
    });
    document.getElementById("property-dialog").close();
    event.target.reset();
    await loadProperties();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("contact-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/contacts", { method: "POST", body: JSON.stringify(raw) });
    document.getElementById("contact-dialog").close();
    event.target.reset();
    location.hash = raw.role === "landlord" ? "#landlords" : "#tenants";
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("invoice-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("invoice-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/invoices", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(raw.property_id),
        contact_id: Number(raw.contact_id),
        amount: Number(raw.amount),
        due_on: raw.due_on,
        description: raw.description,
      }),
    });
    document.getElementById("invoice-dialog").close();
    await loadInvoices();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("letting-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("letting-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/tenancies", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(raw.property_id),
        occupier_id: Number(raw.occupier_id),
        landlord_id: Number(raw.landlord_id),
        start_date: raw.start_date,
        end_date: raw.end_date || null,
        rent_pcm: Number(raw.rent_pcm),
        deposit: Number(raw.deposit),
        rent_due_day: Number(raw.rent_due_day || 1),
        deposit_scheme: raw.deposit_scheme,
        deposit_ref: raw.deposit_ref,
      }),
    });
    document.getElementById("letting-dialog").close();
    event.target.reset();
    location.hash = "#lettings";
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("message-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/communications", {
      method: "POST",
      body: JSON.stringify({
        audience: raw.audience,
        channel: raw.channel,
        property_id: raw.property_id ? Number(raw.property_id) : null,
        contact_id: raw.contact_id ? Number(raw.contact_id) : null,
        tenancy_id: event.target.dataset.tenancyId ? Number(event.target.dataset.tenancyId) : null,
        subject: raw.subject,
        body: raw.body,
      }),
    });
    document.getElementById("message-dialog").close();
    event.target.reset();
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", render);
