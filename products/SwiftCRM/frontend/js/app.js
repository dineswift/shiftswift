const api = window.SwiftCRM;
const workspace = document.getElementById("workspace");
const pageTitle = document.getElementById("page-title");
const pageSub = document.getElementById("page-sub");

const COPY = {
  overview: ["Overview", "Portfolio, arrears and what needs a chase today."],
  properties: ["Properties", "Units on the books — let, vacant, rent and landlord."],
  people: ["People", "Landlords, occupiers, applicants and guarantors."],
  tenancies: ["Tenancies", "ASTs with rent, deposit and dates."],
  invoices: ["Invoices", "Rent and fees. Collect payment, then queue Xero."],
  payments: ["Payments", "Money in — Bacs, card, allocated to an invoice."],
  pipeline: ["Lettings pipeline", "Enquiry through to move-in. Drag-free: pick the next stage."],
  settings: ["Settings", "Agency profile and accounting connections."],
};

const money = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

function chip(kind, label = kind) {
  return `<span class="chip chip--${kind}">${label.replace("_", " ")}</span>`;
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

function section() {
  return (location.hash || "#overview").replace("#", "") || "overview";
}

async function loadOverview() {
  const data = await api.request("/overview");
  const inv = data.invoices || {};
  workspace.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><span>Properties</span><b>${data.portfolio.properties}</b></div>
      <div class="kpi"><span>Let / vacant</span><b>${data.portfolio.let} / ${data.portfolio.available}</b></div>
      <div class="kpi"><span>Arrears</span><b>${money(data.arrears_gbp)}</b></div>
      <div class="kpi"><span>Open pipeline</span><b>${data.open_pipeline}</b></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Needs a chase</h2><span class="muted">Due and overdue rent</span></div>
      <table class="data">
        <thead><tr><th>Invoice</th><th>Property</th><th>Occupier</th><th>Due</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          ${data.attention
            .map(
              (row) => `<tr>
                <td>${row.number} ${chip(row.status)}</td>
                <td>${row.property_name}</td>
                <td>${row.contact_name}</td>
                <td>${row.due_on}</td>
                <td class="money">${money(row.amount)}</td>
                <td><a href="#invoices">Open invoices</a></td>
              </tr>`,
            )
            .join("") || `<tr><td colspan="6" class="muted">Nothing overdue.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Invoice book</h2></div>
      <p class="muted">Paid ${inv.paid?.count || 0} · due ${inv.due?.count || 0} · overdue ${inv.overdue?.count || 0}</p>
    </div>
  `;
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
        <thead><tr><th>Property</th><th>Type</th><th>Status</th><th>Rent</th><th>Landlord</th><th>Occupier</th></tr></thead>
        <tbody>
          ${data.properties
            .map(
              (p) => `<tr>
                <td><div class="addr">${p.name}</div><div class="muted">${p.address_line}, ${p.city} ${p.postcode}</div></td>
                <td>${p.beds} bed ${p.property_type}</td>
                <td>${chip(p.status)}</td>
                <td class="money">${money(p.rent_pcm)}</td>
                <td>${p.landlord?.name || "—"}</td>
                <td>${p.current_tenancy?.occupier_name || "—"}</td>
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

async function loadPeople() {
  const data = await api.request("/contacts");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Everyone on the books</h2>
        <button type="button" class="btn btn--copper btn--sm" id="add-person">Add person</button>
      </div>
      <table class="data">
        <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Notes</th></tr></thead>
        <tbody>
          ${data.contacts
            .map(
              (c) => `<tr>
                <td class="addr">${c.name}</td>
                <td>${chip(c.role)}</td>
                <td>${c.email || "—"}</td>
                <td>${c.phone || "—"}</td>
                <td class="muted">${c.notes || ""}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("add-person").onclick = () =>
    document.getElementById("contact-dialog").showModal();
}

async function loadTenancies() {
  const data = await api.request("/tenancies");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Active and recent ASTs</h2></div>
      <table class="data">
        <thead><tr><th>Property</th><th>Occupier</th><th>Landlord</th><th>Term</th><th>Rent</th><th>Deposit</th></tr></thead>
        <tbody>
          ${data.tenancies
            .map(
              (t) => `<tr>
                <td><div class="addr">${t.property_name}</div><div class="muted">${t.address_line}, ${t.city}</div></td>
                <td>${t.occupier_name}</td>
                <td>${t.landlord_name}</td>
                <td>${t.start_date} → ${t.end_date || "rolling"} ${chip(t.status, t.status)}</td>
                <td class="money">${money(t.rent_pcm)}</td>
                <td class="money">${money(t.deposit)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
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
                <td>${inv.contact?.name || "—"}</td>
                <td>${inv.property?.name || "—"}</td>
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
  const pSel = document.getElementById("invoice-property");
  const cSel = document.getElementById("invoice-contact");
  pSel.innerHTML = props.properties
    .map((p) => `<option value="${p.id}">${p.name} — ${money(p.rent_pcm)}</option>`)
    .join("");
  cSel.innerHTML = people.contacts
    .map((c) => `<option value="${c.id}">${c.name} (${c.role})</option>`)
    .join("");
  const due = new Date();
  due.setDate(due.getDate() + 7);
  document.querySelector('#invoice-form [name="due_on"]').value = due.toISOString().slice(0, 10);
  document.getElementById("invoice-dialog").showModal();
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
                <td>${p.paid_on}</td>
                <td>${p.reference}</td>
                <td>${p.invoice_number}</td>
                <td>${p.contact_name}</td>
                <td>${p.property_name}</td>
                <td>${p.method}</td>
                <td class="money">${money(p.amount)}</td>
              </tr>`,
            )
            .join("") || `<tr><td colspan="7" class="muted">No payments yet.</td></tr>`}
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
                  <b>${d.title}</b>
                  <p>${d.contact_name}${d.property_name ? ` · ${d.property_name}` : ""}</p>
                  <p>${d.value_pcm ? money(d.value_pcm) + " pcm" : "—"}</p>
                  <select data-deal="${d.id}">
                    ${data.stages
                      .map(
                        (s) =>
                          `<option value="${s.key}" ${s.key === d.stage ? "selected" : ""}>${s.label}</option>`,
                      )
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
      <p><strong>${me.agency}</strong><br>${me.name} · ${me.email}</p>
      <p class="muted">SwiftCRM keeps occupiers separate from the SaaS agency account. Client money reporting is not in this slice.</p>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Accounting</h2></div>
      <p>Xero: ${chip(me.accounting.xero, "not connected")}</p>
      <p>FreeAgent: ${chip(me.accounting.freeagent, "not connected")}</p>
      <p class="muted">Connect comes next. This desk already stamps invoices <em>not synced / queued / synced</em> so the join is obvious.</p>
      <p><button type="button" class="btn btn--ghost" disabled>Connect Xero</button>
         <button type="button" class="btn btn--ghost" disabled>Connect FreeAgent</button></p>
    </div>
  `;
}

const loaders = {
  overview: loadOverview,
  properties: loadProperties,
  people: loadPeople,
  tenancies: loadTenancies,
  invoices: loadInvoices,
  payments: loadPayments,
  pipeline: loadPipeline,
  settings: loadSettings,
};

async function render() {
  if (!requireSession()) return;
  const key = loaders[section()] ? section() : "overview";
  setNav(key);
  workspace.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    await loaders[key]();
  } catch (err) {
    if (String(err.message).toLowerCase().includes("sign in")) {
      localStorage.removeItem("swiftcrmToken");
      window.location.replace("./login.html");
      return;
    }
    workspace.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

document.getElementById("sign-out").onclick = () => {
  localStorage.removeItem("swiftcrmToken");
  window.location.replace("./login.html");
};

document.getElementById("property-cancel").onclick = () =>
  document.getElementById("property-dialog").close();
document.getElementById("contact-cancel").onclick = () =>
  document.getElementById("contact-dialog").close();
document.getElementById("invoice-cancel").onclick = () =>
  document.getElementById("invoice-dialog").close();

document.getElementById("property-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("property-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/properties", {
      method: "POST",
      body: JSON.stringify({
        ...raw,
        beds: Number(raw.beds),
        rent_pcm: Number(raw.rent_pcm),
      }),
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
    await loadPeople();
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

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", render);
