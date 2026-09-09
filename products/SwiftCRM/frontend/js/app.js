const api = window.SwiftCRM;
const workspace = document.getElementById("workspace");
const pageTitle = document.getElementById("page-title");
const pageSub = document.getElementById("page-sub");

const COPY = {
  today: ["Today", "Arrears, certificates due, open jobs, and the latest updates."],
  lettings: ["Lettings", "The house, the people, the tenancy, and the file — one record."],
  inbox: ["Inbox", "What the agency said to tenants, landlords, and suppliers."],
  money: ["Money", "Raise rent, collect Bacs, then queue Xero. Not a full accounts pack."],
  settings: ["Settings", "Who you are, the phone line, mail outbox, and the Xero queue."],
  people: ["Person", "Tenant or landlord on this letting."],
  house: ["House file", "Vacant or unmatched unit — suppliers, insurance, certificates."],
};

const NAV_FOR = {
  today: "today",
  overview: "today",
  jobs: "today",
  compliance: "today",
  pipeline: "today",
  lettings: "lettings",
  tenancies: "lettings",
  properties: "lettings",
  house: "lettings",
  tenants: "lettings",
  landlords: "lettings",
  people: "lettings",
  suppliers: "lettings",
  tax: "lettings",
  inbox: "inbox",
  money: "money",
  invoices: "money",
  payments: "money",
  settings: "settings",
};

let activePropertyId = null;
let activeTenancyId = null;

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

function docHref(id) {
  return `${api.apiBase}/documents/${id}/file?token=${encodeURIComponent(api.token())}`;
}

function kindLabel(kind) {
  return String(kind || "").replaceAll("_", " ");
}

function telLink(phone, contactId) {
  if (!phone) return "—";
  const extra = contactId ? ` data-contact="${contactId}" class="tel tel-call"` : ` class="tel"`;
  return `<a href="tel:${escapeHtml(phone)}"${extra}>${escapeHtml(phone)}</a>`;
}

function fileHref(row = {}) {
  if (row.tenancy_id) return `#lettings/${row.tenancy_id}`;
  if (row.property_id) return `#house/${row.property_id}`;
  return "#lettings";
}

function parseRoute() {
  const raw = (location.hash || "#today").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  const section = parts[0] || "today";
  const idPart = parts.find((part, index) => index > 0 && /^\d+$/.test(part));
  const tab = parts.find((part, index) => index > 0 && !/^\d+$/.test(part)) || "";
  return { section, id: idPart ? Number(idPart) : null, tab };
}

function requireSession() {
  if (!api.token()) {
    window.location.replace("./login.html");
    return false;
  }
  return true;
}

function setNav(section) {
  const nav = NAV_FOR[section] || "today";
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.section === nav);
  });
  const [title, sub] = COPY[section] || COPY[nav] || COPY.today;
  pageTitle.textContent = title;
  pageSub.textContent = sub;
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="muted">${escapeHtml(text)}</td></tr>`;
}

function thread(items) {
  if (!items?.length) return `<p class="muted">Nothing logged yet.</p>`;
  return `<div class="thread">${items
    .map(
      (m) => `<article class="msg msg--${m.author_role}">
        <header>
          <span>${escapeHtml(m.author_name)} · ${chip(m.audience)} ${chip(m.channel)}</span>
          <span>${escapeHtml((m.created_at || "").replace("T", " ").slice(0, 16))}</span>
        </header>
        <b>${escapeHtml(m.subject)}</b>
        <p>${escapeHtml(m.body)}</p>
        <p class="muted">${escapeHtml(m.property?.name || m.property_name || "")}${m.supplier?.name ? ` · ${escapeHtml(m.supplier.name)}` : ""}</p>
      </article>`,
    )
    .join("")}</div>`;
}

function invoiceRows(invoices, { collect = true } = {}) {
  if (!invoices?.length) return emptyRow(7, "No invoices.");
  return invoices
    .map(
      (inv) => `<tr>
        <td>${escapeHtml(inv.number)} ${chip(inv.status)}</td>
        <td>${escapeHtml(inv.contact?.name || inv.contact_name || "—")}</td>
        <td>${escapeHtml(inv.property?.name || inv.property_name || "—")}</td>
        <td>${escapeHtml(inv.due_on || "—")}</td>
        <td class="money">${money(inv.amount)}</td>
        <td>${chip(inv.xero_status)}</td>
        <td>${
          !collect || inv.status === "paid"
            ? `<span class="muted">Paid</span>`
            : `<button type="button" class="btn btn--navy btn--sm collect-btn" data-id="${inv.id}">Collect</button>`
        }</td>
      </tr>`,
    )
    .join("");
}

function bindCollectButtons() {
  workspace.querySelectorAll(".collect-btn").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api.request(`/invoices/${btn.dataset.id}/collect`, {
          method: "POST",
          body: JSON.stringify({ method: "bacs" }),
        });
        await render();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    };
  });
}

function jobRows(jobs, { statusSelect = true } = {}) {
  if (!jobs?.length) return emptyRow(5, "No open jobs.");
  return jobs
    .map((j) => {
      const href = fileHref(j);
      return `<tr>
        <td>${escapeHtml(j.title)}<div class="muted">${escapeHtml(j.detail || j.reported_via || "")}</div></td>
        <td>${j.property_id || j.property_name ? `<a href="${href}">${escapeHtml(j.property_name || "Letting")}</a>` : "—"}</td>
        <td>${escapeHtml(j.contact_name || "—")}</td>
        <td>${chip(j.priority)}</td>
        <td>${
          statusSelect
            ? `<select data-job="${j.id}">
                ${["open", "booked", "in_progress", "done", "cancelled"]
                  .map((s) => `<option value="${s}" ${s === j.status ? "selected" : ""}>${s.replace("_", " ")}</option>`)
                  .join("")}
              </select>`
            : chip(j.status)
        }</td>
      </tr>`;
    })
    .join("");
}

function bindJobSelects() {
  workspace.querySelectorAll("select[data-job]").forEach((sel) => {
    sel.onchange = async () => {
      await api.request(`/jobs/${sel.dataset.job}`, {
        method: "PATCH",
        body: JSON.stringify({ status: sel.value }),
      });
      await render();
    };
  });
}

function houseFileHtml(p) {
  const suppliers = p.suppliers || [];
  const policies = p.policies || [];
  const compliance = p.compliance || [];
  const documents = p.documents || [];
  return `
    <div class="panel">
      <div class="panel-head"><h2>Suppliers</h2>
        <button type="button" class="btn btn--ghost btn--sm" id="add-supplier">Add supplier</button></div>
      <table class="data">
        <thead><tr><th>Role</th><th>Supplier</th><th>Account</th><th>Phone</th><th></th></tr></thead>
        <tbody>
          ${
            suppliers
              .map(
                (s) => `<tr>
                  <td>${chip(s.role || s.kind)}</td>
                  <td><a href="#suppliers/${s.id}">${escapeHtml(s.name)}</a><div class="muted">${escapeHtml(s.contact_name || "")}</div></td>
                  <td>${escapeHtml(s.property_account || s.account_ref || "—")}</td>
                  <td>${escapeHtml(s.phone || "—")}</td>
                  <td><button type="button" class="btn btn--ghost btn--sm supplier-msg" data-id="${s.id}">Message</button></td>
                </tr>`,
              )
              .join("") || emptyRow(5, "No suppliers on this house yet.")
          }
        </tbody>
      </table>
    </div>
    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><h2>Insurance</h2>
          <button type="button" class="btn btn--ghost btn--sm" id="add-policy">Add policy</button></div>
        <table class="data">
          <thead><tr><th>Cover</th><th>Insurer</th><th>Ends</th></tr></thead>
          <tbody>
            ${
              policies
                .map(
                  (pol) => `<tr>
                    <td>${chip(pol.kind)} ${chip(pol.status)}</td>
                    <td>${escapeHtml(pol.insurer)}<div class="muted">${escapeHtml(pol.policy_number || "")}</div></td>
                    <td>${escapeHtml(pol.end_on || "—")}</td>
                  </tr>`,
                )
                .join("") || emptyRow(3, "No policies on file.")
            }
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Certificates</h2>
          <button type="button" class="btn btn--ghost btn--sm" id="add-compliance">Add date</button></div>
        <table class="data">
          <thead><tr><th>Item</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            ${
              compliance
                .map(
                  (c) => `<tr>
                    <td>${escapeHtml(c.title)}<div class="muted">${escapeHtml(kindLabel(c.kind))}</div></td>
                    <td>${escapeHtml(c.due_on || "—")}</td>
                    <td>${chip(c.status)}</td>
                  </tr>`,
                )
                .join("") || emptyRow(3, "No diary items.")
            }
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Documents</h2></div>
      <form id="upload-form" class="toolbar" style="margin-bottom:12px">
        <input type="file" name="file" required />
        <select name="kind">
          <option value="other">Other</option>
          <option value="gas">Gas certificate</option>
          <option value="eicr">EICR</option>
          <option value="epc">EPC</option>
          <option value="insurance">Insurance</option>
          <option value="ast">AST</option>
          <option value="inventory">Inventory</option>
          <option value="licence">Licence</option>
        </select>
        <input name="title" placeholder="Title" />
        <select name="signed_status">
          <option value="n/a">No signature</option>
          <option value="unsigned">Unsigned</option>
          <option value="sent">Sent for signature</option>
          <option value="signed">Signed</option>
        </select>
        <button type="submit" class="btn btn--copper btn--sm">Upload</button>
      </form>
      <table class="data">
        <thead><tr><th>Document</th><th>Type</th><th>Signature</th><th></th></tr></thead>
        <tbody>
          ${
            documents
              .map(
                (d) => `<tr>
                  <td>${escapeHtml(d.title)}<div class="muted">${escapeHtml(d.filename)}</div></td>
                  <td>${chip(d.kind)}</td>
                  <td>${chip(d.signed_status || "n/a")}${
                    d.kind === "ast" || d.kind === "inventory"
                      ? ` <button type="button" class="btn btn--ghost btn--sm sign-doc" data-id="${d.id}" data-status="${d.signed_status === "signed" ? "sent" : "signed"}">${d.signed_status === "signed" ? "Mark sent" : "Mark signed"}</button>`
                      : ""
                  }</td>
                  <td><a class="btn btn--ghost btn--sm" href="${docHref(d.id)}" target="_blank" rel="noopener">Open</a></td>
                </tr>`,
              )
              .join("") || emptyRow(4, "No files yet.")
          }
        </tbody>
      </table>
    </div>
  `;
}

function bindHouseFile(p) {
  activePropertyId = p.id;
  document.getElementById("add-supplier").onclick = () =>
    document.getElementById("supplier-dialog").showModal();
  document.getElementById("add-policy").onclick = () => openPolicyDialog(p.id);
  document.getElementById("add-compliance").onclick = () => openComplianceDialog(p.id);
  workspace.querySelectorAll(".supplier-msg").forEach((btn) => {
    btn.onclick = () =>
      openMessageDialog({
        audience: "supplier",
        property_id: p.id,
        supplier_id: Number(btn.dataset.id),
        tenancy_id: activeTenancyId,
      });
  });
  workspace.querySelectorAll(".sign-doc").forEach((btn) => {
    btn.onclick = async () => {
      await api.request(`/documents/${btn.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ signed_status: btn.dataset.status }),
      });
      await render();
    };
  });
  document.getElementById("upload-form").onsubmit = async (event) => {
    event.preventDefault();
    const payload = new FormData(event.target);
    payload.set("property_id", String(p.id));
    if (p.current_tenancy) payload.set("tenancy_id", String(p.current_tenancy.id));
    else if (activeTenancyId) payload.set("tenancy_id", String(activeTenancyId));
    await api.request("/documents", { method: "POST", body: payload });
    await render();
  };
}

async function loadToday() {
  const data = await api.request("/overview");
  workspace.innerHTML = `
    <div class="kpi-grid">
      <a class="kpi" href="#lettings"><span>Lettings</span><b>${data.portfolio.lettings || 0}</b></a>
      <a class="kpi" href="#money"><span>Arrears</span><b>${money(data.arrears_gbp)}</b></a>
      <a class="kpi" href="#today"><span>Certificates due</span><b>${data.compliance_due || 0}</b></a>
      <a class="kpi" href="#today"><span>Open jobs</span><b>${data.open_jobs || 0}</b></a>
    </div>
    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><h2>Rent to chase</h2><a href="#money">Money</a></div>
        <table class="data">
          <thead><tr><th>Invoice</th><th>Who</th><th>Due</th><th></th></tr></thead>
          <tbody>
            ${(data.attention || [])
              .map(
                (row) => `<tr>
                  <td>${escapeHtml(row.number)} ${chip(row.status)}</td>
                  <td><a href="${fileHref(row)}">${escapeHtml(row.property_name)}</a><div class="muted">${escapeHtml(row.contact_name)}</div></td>
                  <td>${escapeHtml(row.due_on)}</td>
                  <td class="money">${money(row.amount)}</td>
                </tr>`,
              )
              .join("") || emptyRow(4, "Nothing due.")}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Certificates</h2></div>
        <table class="data">
          <thead><tr><th>Item</th><th>House</th><th>Due</th></tr></thead>
          <tbody>
            ${(data.compliance_attention || [])
              .map(
                (row) => `<tr>
                  <td>${escapeHtml(row.title)} ${chip(row.status)}</td>
                  <td><a href="${fileHref(row)}">${escapeHtml(row.property_name)}</a></td>
                  <td>${escapeHtml(row.due_on || "—")}</td>
                </tr>`,
              )
              .join("") || emptyRow(3, "Nothing due.")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><h2>Open jobs</h2>
          <button type="button" class="btn btn--ghost btn--sm" id="add-job">Raise job</button></div>
        <table class="data">
          <thead><tr><th>Job</th><th>House</th><th>Status</th></tr></thead>
          <tbody>
            ${(data.open_job_list || [])
              .map(
                (j) => `<tr>
                  <td>${escapeHtml(j.title)} ${chip(j.priority)}</td>
                  <td><a href="${fileHref(j)}">${escapeHtml(j.property_name || "—")}</a></td>
                  <td>${chip(j.status)}</td>
                </tr>`,
              )
              .join("") || emptyRow(3, "No open jobs.")}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Latest</h2>
          <button type="button" class="btn btn--copper btn--sm" id="open-message">Log update</button></div>
        ${thread(data.latest_updates || [])}
      </div>
    </div>
  `;
  document.getElementById("open-message").onclick = openMessageDialog;
  document.getElementById("add-job").onclick = () => openJobDialog();
}

async function loadLettings() {
  const [lets, props] = await Promise.all([api.request("/tenancies"), api.request("/properties")]);
  const vacant = (props.properties || []).filter((p) => p.status !== "let");
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Live lettings</h2>
        <div class="toolbar">
          <button type="button" class="btn btn--ghost btn--sm" id="add-property">Add property</button>
          <button type="button" class="btn btn--ghost btn--sm" id="add-tenant">Add tenant</button>
          <button type="button" class="btn btn--ghost btn--sm" id="add-landlord">Add landlord</button>
          <button type="button" class="btn btn--copper btn--sm" id="add-letting">Record letting</button>
        </div>
      </div>
      <div class="card-grid">
        ${
          lets.tenancies
            .map(
              (t) => `<a class="letting-card" href="#lettings/${t.id}">
                <div class="letting-card__top">
                  <b>${escapeHtml(t.property_name)}</b>
                  ${chip(t.status)}
                </div>
                <p class="muted">${escapeHtml(t.address_line)}, ${escapeHtml(t.city)}</p>
                <p>${escapeHtml(t.occupier_name)} · ${escapeHtml(t.landlord_name)}</p>
                <p class="money">${money(t.rent_pcm)} <span class="muted">band ${escapeHtml(t.council_tax_band || "—")}</span></p>
              </a>`,
            )
            .join("") || `<p class="muted">No lettings recorded.</p>`
        }
      </div>
    </div>
    ${
      vacant.length
        ? `<div class="panel">
            <div class="panel-head"><h2>Vacant units</h2><span class="muted">House file only — no live tenancy</span></div>
            <div class="card-grid">
              ${vacant
                .map(
                  (p) => `<a class="letting-card letting-card--vacant" href="#house/${p.id}">
                    <div class="letting-card__top"><b>${escapeHtml(p.name)}</b>${chip(p.status)}</div>
                    <p class="muted">${escapeHtml(p.address_line)}, ${escapeHtml(p.city)}</p>
                    <p>${p.landlord ? escapeHtml(p.landlord.name) : "No landlord"}</p>
                  </a>`,
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
  `;
  document.getElementById("add-letting").onclick = openLettingDialog;
  document.getElementById("add-property").onclick = () =>
    document.getElementById("property-dialog").showModal();
  document.getElementById("add-tenant").onclick = () => openPersonDialog("occupier");
  document.getElementById("add-landlord").onclick = () => openPersonDialog("landlord");
}

function openPersonDialog(role) {
  const roleSelect = document.getElementById("contact-role");
  roleSelect.value = role;
  roleSelect.dispatchEvent(new Event("change"));
  document.getElementById("contact-dialog").showModal();
}

async function loadLettingDetail(id) {
  const t = await api.request(`/tenancies/${id}`);
  activePropertyId = t.property_id;
  activeTenancyId = t.id;
  const occupiers = t.occupiers?.length
    ? t.occupiers
        .map(
          (o) =>
            `<a href="#people/${o.id}">${escapeHtml(o.name)}</a>${o.is_primary ? " · lead" : ""} · ${telLink(o.phone, o.id)}`,
        )
        .join("<br>")
    : `<a href="#people/${t.occupier_id}">${escapeHtml(t.occupier_name)}</a>`;
  workspace.innerHTML = `
    <p><a class="back" href="#lettings">← All lettings</a></p>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(t.property_name)}</h2>${chip(t.status)}</div>
        <dl class="kv">
          <dt>Address</dt><dd>${escapeHtml(t.address_line)}, ${escapeHtml(t.city)} ${escapeHtml(t.postcode || "")}</dd>
          <dt>Tenant</dt><dd>${occupiers}<div class="muted">${escapeHtml(t.occupier_email || "")}</div></dd>
          <dt>Landlord</dt><dd><a href="#people/${t.landlord_id}">${escapeHtml(t.landlord_name)}</a><div class="muted">${escapeHtml(t.landlord_email || "")}${t.nrl_status ? ` · ${escapeHtml(t.nrl_status)}` : ""}</div></dd>
          <dt>Term</dt><dd>${t.start_date} → ${t.end_date || "rolling"}</dd>
          <dt>Rent</dt><dd>${money(t.rent_pcm)} due day ${t.rent_due_day || 1}</dd>
          <dt>Deposit</dt><dd>${money(t.deposit)} · ${escapeHtml(t.deposit_scheme || "—")} ${escapeHtml(t.deposit_ref || "")}</dd>
          <dt>Council tax</dt><dd>Band ${escapeHtml(t.council_tax_band || "—")} · ${escapeHtml(t.council_tax_authority || "")}<div class="muted">Liable: ${escapeHtml(t.council_tax_liable === "occupier" ? "tenant" : t.council_tax_liable || "—")} · ${escapeHtml(t.council_tax_account || "")}</div></dd>
        </dl>
        <p class="toolbar">
          <button type="button" class="btn btn--copper btn--sm" id="open-message">Update both sides</button>
          <button type="button" class="btn btn--navy btn--sm" id="raise-job">Raise job</button>
          ${t.status === "active" ? `<button type="button" class="btn btn--ghost btn--sm" id="end-letting">End letting</button>` : ""}
        </p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Thread</h2></div>
        ${thread(t.communications)}
      </div>
    </div>
    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><h2>Jobs</h2></div>
        <table class="data">
          <thead><tr><th>Job</th><th></th><th></th><th></th><th>Status</th></tr></thead>
          <tbody>${jobRows((t.jobs || []).map((j) => ({ ...j, property_name: t.property_name, tenancy_id: t.id })))}</tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Rent on this letting</h2></div>
        <table class="data">
          <thead><tr><th>Number</th><th>Bill to</th><th>House</th><th>Due</th><th>Amount</th><th>Books</th><th></th></tr></thead>
          <tbody>${invoiceRows(t.invoices)}</tbody>
        </table>
      </div>
    </div>
    ${houseFileHtml({ ...t, id: t.property_id, current_tenancy: { id: t.id } })}
  `;
  document.getElementById("open-message").onclick = () =>
    openMessageDialog({
      audience: "both",
      property_id: t.property_id,
      tenancy_id: t.id,
      contact_id: t.occupier_id,
    });
  const endBtn = document.getElementById("end-letting");
  if (endBtn) {
    endBtn.onclick = async () => {
      if (!confirm("End this letting and mark the property available?")) return;
      await api.request(`/tenancies/${t.id}/end`, { method: "POST" });
      await loadLettingDetail(id);
    };
  }
  document.getElementById("raise-job").onclick = () =>
    openJobDialog({
      property_id: t.property_id,
      tenancy_id: t.id,
      contact_id: t.occupier_id,
    });
  bindHouseFile({ ...t, id: t.property_id, current_tenancy: { id: t.id } });
  bindCollectButtons();
  bindJobSelects();
}

async function loadHouse(id) {
  const p = await api.request(`/properties/${id}`);
  activePropertyId = p.id;
  activeTenancyId = p.current_tenancy?.id || null;
  if (p.current_tenancy?.id) {
    history.replaceState(null, "", `#lettings/${p.current_tenancy.id}`);
    setNav("lettings");
    await loadLettingDetail(p.current_tenancy.id);
    return;
  }
  workspace.innerHTML = `
    <p><a class="back" href="#lettings">← All lettings</a></p>
    <div class="panel">
      <div class="panel-head"><h2>${escapeHtml(p.name)}</h2>${chip(p.status)}</div>
      <dl class="kv">
        <dt>Address</dt><dd>${escapeHtml(p.address_line)}, ${escapeHtml(p.city)} ${escapeHtml(p.postcode)}</dd>
        <dt>Type</dt><dd>${p.beds} bed ${escapeHtml(p.property_type)}</dd>
        <dt>Rent</dt><dd>${money(p.rent_pcm)}</dd>
        <dt>Landlord</dt><dd>${p.landlord ? `<a href="#people/${p.landlord.id}">${escapeHtml(p.landlord.name)}</a>` : "—"}</dd>
        <dt>Council tax</dt><dd>Band ${escapeHtml(p.council_tax_band || "—")} · ${escapeHtml(p.council_tax_authority || "")}</dd>
      </dl>
    </div>
    ${houseFileHtml(p)}
  `;
  bindHouseFile(p);
}

async function loadPerson(id) {
  const data = await api.request(`/contacts/${id}`);
  const c = data.contact;
  const isLandlord = c.role === "landlord";
  const back = data.lettings?.[0]?.id ? `#lettings/${data.lettings[0].id}` : "#lettings";
  workspace.innerHTML = `
    <p><a class="back" href="${back}">← Letting</a></p>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(c.name)}</h2>${chip(c.role === "occupier" ? "occupier" : c.role, c.role === "occupier" ? "tenant" : c.role)}</div>
        <dl class="kv">
          <dt>Email</dt><dd>${escapeHtml(c.email || "—")}</dd>
          <dt>Phone</dt><dd>${telLink(c.phone, c.id)}</dd>
          <dt>Address</dt><dd>${escapeHtml([c.address_line, c.city, c.postcode].filter(Boolean).join(", ") || "—")}</dd>
          ${isLandlord ? `<dt>UTR</dt><dd>${escapeHtml(c.utr || "—")}</dd><dt>NRL</dt><dd>${c.nrl_status ? chip(c.nrl_status) : "UK / not recorded"} ${escapeHtml(c.nrl_ref || "")}</dd>` : ""}
          <dt>Prefers</dt><dd>${escapeHtml(c.preferred_channel || "email")}</dd>
          <dt>Notes</dt><dd>${escapeHtml(c.notes || "—")}</dd>
        </dl>
        <p>
          <label class="muted">Phone <input id="person-phone" value="${escapeHtml(c.phone || "")}" /></label>
          <button type="button" class="btn btn--ghost btn--sm" id="save-person">Save phone</button>
        </p>
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
  document.getElementById("save-person").onclick = async () => {
    await api.request(`/contacts/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ phone: document.getElementById("person-phone").value }),
    });
    await loadPerson(id);
  };
}

async function loadSupplier(id) {
  const s = await api.request(`/suppliers/${id}`);
  const house = s.properties?.[0];
  workspace.innerHTML = `
    <p><a class="back" href="${house ? `#house/${house.property_id}` : "#lettings"}">← House file</a></p>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>${escapeHtml(s.name)}</h2>${chip(s.kind)}</div>
        <dl class="kv">
          <dt>Contact</dt><dd>${escapeHtml(s.contact_name || "—")}</dd>
          <dt>Email</dt><dd>${escapeHtml(s.email || "—")}</dd>
          <dt>Phone</dt><dd>${escapeHtml(s.phone || "—")}</dd>
          <dt>Account</dt><dd>${escapeHtml(s.account_ref || "—")}</dd>
        </dl>
        <h3>Houses</h3>
        <ul>${
          (s.properties || [])
            .map(
              (p) =>
                `<li><a href="#house/${p.property_id}">${escapeHtml(p.property_name)}</a> · ${escapeHtml(kindLabel(p.role))}</li>`,
            )
            .join("") || "<li class='muted'>Not assigned.</li>"
        }</ul>
        <p><button type="button" class="btn btn--copper btn--sm" id="open-message">Log a message</button></p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Communication</h2></div>
        ${thread(s.communications || [])}
      </div>
    </div>
  `;
  document.getElementById("open-message").onclick = () =>
    openMessageDialog({
      audience: "supplier",
      supplier_id: s.id,
      property_id: house?.property_id,
    });
}

async function loadInbox() {
  const { tab } = parseRoute();
  const filter = ["occupier", "landlord", "supplier"].includes(tab) ? tab : "all";
  const data = await api.request("/communications");
  const items = (data.communications || []).filter((m) => {
    if (filter === "all") return true;
    if (filter === "occupier") return m.audience === "occupier" || m.audience === "both";
    if (filter === "landlord") return m.audience === "landlord" || m.audience === "both";
    return m.audience === "supplier";
  });
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div class="seg" role="tablist">
          <a class="${filter === "all" ? "is-on" : ""}" href="#inbox">All</a>
          <a class="${filter === "occupier" ? "is-on" : ""}" href="#inbox/occupier">Tenants</a>
          <a class="${filter === "landlord" ? "is-on" : ""}" href="#inbox/landlord">Landlords</a>
          <a class="${filter === "supplier" ? "is-on" : ""}" href="#inbox/supplier">Suppliers</a>
        </div>
        <button type="button" class="btn btn--copper btn--sm" id="open-message">Log update</button>
      </div>
      ${thread(items)}
    </div>
  `;
  document.getElementById("open-message").onclick = () =>
    openMessageDialog({
      audience: filter === "all" ? "occupier" : filter,
    });
}

async function loadMoney() {
  const [invoices, payments] = await Promise.all([api.request("/invoices"), api.request("/payments")]);
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Invoices</h2>
        <div class="toolbar">
          <button type="button" class="btn btn--ghost btn--sm" id="gen-rent">This month's rent</button>
          <button type="button" class="btn btn--ghost btn--sm" id="sync-xero">Queue to Xero</button>
          <button type="button" class="btn btn--copper btn--sm" id="add-invoice">Raise invoice</button>
        </div>
      </div>
      <table class="data">
        <thead><tr><th>Number</th><th>Bill to</th><th>House</th><th>Due</th><th>Amount</th><th>Books</th><th></th></tr></thead>
        <tbody>${invoiceRows(invoices.invoices)}</tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Money in</h2><span class="muted">Demo Bacs — not live collection</span></div>
      <table class="data">
        <thead><tr><th>Date</th><th>Reference</th><th>Invoice</th><th>From</th><th>House</th><th>Method</th><th>Amount</th></tr></thead>
        <tbody>
          ${(payments.payments || [])
            .map(
              (p) => `<tr>
                <td>${escapeHtml(p.paid_on)}</td><td>${escapeHtml(p.reference)}</td><td>${escapeHtml(p.invoice_number)}</td>
                <td>${escapeHtml(p.contact_name)}</td><td>${escapeHtml(p.property_name)}</td>
                <td>${escapeHtml(p.method)}</td><td class="money">${money(p.amount)}</td>
              </tr>`,
            )
            .join("") || emptyRow(7, "No payments yet.")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("add-invoice").onclick = openInvoiceDialog;
  document.getElementById("gen-rent").onclick = async () => {
    const result = await api.request("/invoices/generate-rent", { method: "POST" });
    alert(`Raised ${result.created} rent invoice(s) for ${result.period}. ${result.skipped} already existed.`);
    await loadMoney();
  };
  document.getElementById("sync-xero").onclick = async () => {
    const result = await api.request("/xero/sync", { method: "POST" });
    alert(`Queued ${result.exported} invoice(s) for Xero. ${result.note}`);
    await loadMoney();
  };
  bindCollectButtons();
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
  const [props, people, suppliers] = await Promise.all([
    api.request("/properties"),
    api.request("/contacts"),
    api.request("/suppliers"),
  ]);
  document.getElementById("message-property").innerHTML =
    `<option value="">—</option>` +
    props.properties.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  document.getElementById("message-contact").innerHTML =
    `<option value="">—</option>` +
    people.contacts
      .map((c) => `<option value="${c.id}">${c.name} (${c.role === "occupier" ? "tenant" : c.role})</option>`)
      .join("");
  document.getElementById("message-supplier").innerHTML =
    `<option value="">—</option>` +
    (suppliers.suppliers || []).map((s) => `<option value="${s.id}">${s.name} (${s.kind})</option>`).join("");
  const form = document.getElementById("message-form");
  if (prefill.audience) form.audience.value = prefill.audience;
  if (prefill.property_id) form.property_id.value = String(prefill.property_id);
  if (prefill.contact_id) form.contact_id.value = String(prefill.contact_id);
  if (prefill.supplier_id) form.supplier_id.value = String(prefill.supplier_id);
  form.dataset.tenancyId = prefill.tenancy_id || "";
  document.getElementById("message-dialog").showModal();
}

async function openPolicyDialog(propertyId) {
  const suppliers = await api.request("/suppliers?kind=insurance");
  document.querySelector('#policy-form [name="property_id"]').value = String(propertyId);
  document.getElementById("policy-broker").innerHTML =
    `<option value="">—</option>` +
    (suppliers.suppliers || []).map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  document.getElementById("policy-dialog").showModal();
}

async function openComplianceDialog(propertyId) {
  const suppliers = await api.request("/suppliers");
  document.querySelector('#compliance-form [name="property_id"]').value = String(propertyId);
  document.getElementById("compliance-supplier").innerHTML =
    `<option value="">—</option>` +
    (suppliers.suppliers || []).map((s) => `<option value="${s.id}">${s.name} (${s.kind})</option>`).join("");
  const kind = document.querySelector('#compliance-form [name="kind"]');
  document.querySelector('#compliance-form [name="title"]').value = kind.options[kind.selectedIndex].text;
  document.getElementById("compliance-dialog").showModal();
}

async function loadSettings() {
  const [me, outbox, calls, xero] = await Promise.all([
    api.request("/me"),
    api.request("/mail/outbox"),
    api.request("/telephony/calls"),
    api.request("/xero/export"),
  ]);
  workspace.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Agency</h2></div>
      <p><strong>${escapeHtml(me.agency || "Charlbury Lettings")}</strong><br>${escapeHtml(me.name)} · ${escapeHtml(me.email)} · ${escapeHtml(me.phone || "")}</p>
      <p class="muted">Five jobs on this desk: today, the letting, the inbox, the money, and this page. Tenant and landlord each have their own app.</p>
      <p>
        <a class="btn btn--ghost btn--sm" href="./tenant.html">Tenant app</a>
        <a class="btn btn--ghost btn--sm" href="./landlord.html">Landlord app</a>
      </p>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Telephone</h2></div>
      <p class="muted">Inbound webhook: <code>POST /telephony/inbound</code> with Twilio-style <code>From</code> / <code>To</code> / <code>CallSid</code>. Caller ID pops the letting. Live audio is not connected.</p>
      <label>Simulate a ring
        <select id="sim-from">
          <option value="07700 900111">Hannah Reid — 07700 900111</option>
          <option value="07700 900113">Luca Bianchi — 07700 900113 (arrears)</option>
          <option value="07700 900117">Elise Ward — 07700 900117 (joint tenant)</option>
          <option value="07700 900999">Unknown number</option>
        </select>
      </label>
      <p><button type="button" class="btn btn--copper btn--sm" id="sim-call">Ring the desk</button></p>
      <table class="data">
        <thead><tr><th>When</th><th>From</th><th>Direction</th><th>Status</th></tr></thead>
        <tbody>
          ${(calls.calls || [])
            .slice(0, 8)
            .map(
              (c) => `<tr>
                <td>${escapeHtml((c.created_at || "").replace("T", " ").slice(0, 16))}</td>
                <td>${escapeHtml(c.from_raw || c.from_e164 || "—")}</td>
                <td>${escapeHtml(c.direction)}</td>
                <td>${chip(c.status)}</td>
              </tr>`,
            )
            .join("") || emptyRow(4, "No calls yet.")}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Mail outbox</h2>
        <button type="button" class="btn btn--ghost btn--sm" id="flush-mail">Flush</button></div>
      <p class="muted">${me.mail_queued || 0} queued. Emails sit here until SMTP is configured.</p>
      <table class="data">
        <thead><tr><th>To</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>
          ${(outbox.messages || [])
            .slice(0, 8)
            .map(
              (m) => `<tr><td>${escapeHtml(m.to_email)}</td><td>${escapeHtml(m.subject)}</td><td>${chip(m.status)}</td></tr>`,
            )
            .join("") || emptyRow(3, "Empty.")}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Accounting</h2>
        <button type="button" class="btn btn--ghost btn--sm" id="settings-xero">Queue invoices to Xero</button></div>
      <p>Xero: ${chip(me.accounting?.xero || "not_connected")} · FreeAgent: ${chip("not_synced", "not connected")}</p>
      <p class="muted">${(xero.items || []).length} export row(s). Live OAuth is not connected — this is the queue a connector would send.</p>
    </div>
  `;
  document.getElementById("sim-call").onclick = () =>
    simulateIncoming(document.getElementById("sim-from").value);
  document.getElementById("flush-mail").onclick = async () => {
    const result = await api.request("/mail/flush", { method: "POST" });
    alert(result.note);
  };
  document.getElementById("settings-xero").onclick = async () => {
    const result = await api.request("/xero/sync", { method: "POST" });
    alert(`Queued ${result.exported}. ${result.note}`);
    await loadSettings();
  };
}

async function render() {
  if (!requireSession()) return;
  if (!location.hash) history.replaceState(null, "", "#today");
  const { section, id, tab } = parseRoute();
  setNav(section);
  activePropertyId = null;
  activeTenancyId = null;
  workspace.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (section === "today" || section === "overview" || section === "jobs" || section === "compliance" || section === "pipeline") {
      await loadToday();
    } else if ((section === "lettings" || section === "tenancies") && id) {
      await loadLettingDetail(id);
    } else if (section === "lettings" || section === "tenancies") {
      await loadLettings();
    } else if ((section === "house" || section === "properties") && id) {
      await loadHouse(id);
    } else if (section === "properties") {
      await loadLettings();
    } else if (section === "people" && tab === "supplier" && id) {
      await loadSupplier(id);
    } else if ((section === "people" || section === "tenants" || section === "landlords") && id) {
      await loadPerson(id);
    } else if (section === "suppliers" && id) {
      await loadSupplier(id);
    } else if (section === "inbox") {
      await loadInbox();
    } else if (section === "money" || section === "invoices" || section === "payments") {
      await loadMoney();
    } else if (section === "settings") {
      await loadSettings();
    } else if (section === "tax" || section === "suppliers" || section === "tenants" || section === "landlords") {
      await loadLettings();
    } else {
      await loadToday();
    }
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

["property-cancel", "contact-cancel", "invoice-cancel", "letting-cancel", "message-cancel", "job-cancel", "supplier-cancel", "policy-cancel", "compliance-cancel"].forEach((id) => {
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
    location.hash = "#lettings";
    await render();
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
    location.hash = "#lettings";
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
    await render();
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
        supplier_id: raw.supplier_id ? Number(raw.supplier_id) : null,
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

document.getElementById("supplier-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("supplier-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    const created = await api.request("/suppliers", { method: "POST", body: JSON.stringify(raw) });
    if (activePropertyId) {
      await api.request(`/properties/${activePropertyId}/suppliers`, {
        method: "POST",
        body: JSON.stringify({ supplier_id: created.id, role: created.kind, account_ref: raw.account_ref }),
      });
    }
    document.getElementById("supplier-dialog").close();
    event.target.reset();
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("policy-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("policy-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/policies", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(raw.property_id),
        kind: raw.kind,
        insurer: raw.insurer,
        policy_number: raw.policy_number,
        broker_id: raw.broker_id ? Number(raw.broker_id) : null,
        start_on: raw.start_on || null,
        end_on: raw.end_on || null,
        excess: raw.excess ? Number(raw.excess) : 0,
        notes: raw.notes,
      }),
    });
    document.getElementById("policy-dialog").close();
    event.target.reset();
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("compliance-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("compliance-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/compliance", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(raw.property_id),
        kind: raw.kind,
        title: raw.title,
        reference: raw.reference || null,
        issued_on: raw.issued_on || null,
        due_on: raw.end_on || raw.due_on || null,
        supplier_id: raw.supplier_id ? Number(raw.supplier_id) : null,
        notes: raw.notes,
      }),
    });
    document.getElementById("compliance-dialog").close();
    event.target.reset();
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", () => {
  render();
  startCallWatch();
});

let watchedCallId = null;

function ringBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    /* ignore autoplay limits */
  }
}

function openJobDialog(prefill = {}) {
  const form = document.getElementById("job-form");
  form.call_id.value = prefill.call_id || "";
  form.property_id.value = prefill.property_id || "";
  form.tenancy_id.value = prefill.tenancy_id || "";
  form.contact_id.value = prefill.contact_id || "";
  form.title.value = prefill.title || "";
  form.detail.value = prefill.detail || "";
  document.getElementById("job-dialog").showModal();
}

async function simulateIncoming(fromNumber) {
  await api.request("/telephony/simulate", {
    method: "POST",
    body: JSON.stringify({ from_number: fromNumber || "07700 900111" }),
  });
  await refreshCallPop();
}

function bindCallPop(pop) {
  const overlay = document.getElementById("call-pop");
  if (!pop?.call) {
    overlay.classList.add("hidden");
    return;
  }
  const call = pop.call;
  const person = pop.contact;
  document.getElementById("call-pop-status").textContent =
    call.status === "answered" ? "On the line" : "Incoming call";
  document.getElementById("call-pop-name").textContent = person?.name || "Unknown caller";
  document.getElementById("call-pop-number").textContent = call.from_raw || call.from_e164 || "";
  const letting = pop.letting;
  document.getElementById("call-pop-context").textContent = letting
    ? `${letting.property_name} · ${letting.address_line}, ${letting.city}`
    : person
      ? `${person.role === "occupier" ? "Tenant" : person.role} on file`
      : "No matching record for this caller ID.";
  document.getElementById("call-pop-arrears").textContent = pop.arrears_gbp
    ? `Arrears ${money(pop.arrears_gbp)}`
    : "";
  const record = document.getElementById("call-record");
  if (letting?.id) {
    record.href = `#lettings/${letting.id}`;
    record.textContent = "Open letting";
    record.classList.remove("hidden");
  } else if (person) {
    record.href = `#people/${person.id}`;
    record.textContent = "Open record";
    record.classList.remove("hidden");
  } else {
    record.classList.add("hidden");
  }
  overlay.classList.remove("hidden");
  overlay.dataset.callId = String(call.id);
}

async function refreshCallPop() {
  if (!api.token()) return;
  try {
    const pop = await api.request("/telephony/active");
    const id = pop.call?.id || null;
    if (id && id !== watchedCallId && pop.call?.status === "ringing") {
      ringBeep();
    }
    watchedCallId = id;
    bindCallPop(pop);
  } catch {
    /* session may not be agency */
  }
}

function startCallWatch() {
  refreshCallPop();
  setInterval(refreshCallPop, 1500);
  document.getElementById("simulate-ring")?.addEventListener("click", () => {
    simulateIncoming("07700 900111").catch((err) => alert(err.message || "Could not ring the desk"));
  });
  document.getElementById("call-answer")?.addEventListener("click", async () => {
    const id = document.getElementById("call-pop").dataset.callId;
    if (!id) return;
    await api.request(`/telephony/calls/${id}/answer`, { method: "POST", body: "{}" });
    await refreshCallPop();
  });
  document.getElementById("call-hangup")?.addEventListener("click", async () => {
    const id = document.getElementById("call-pop").dataset.callId;
    if (!id) return;
    await api.request(`/telephony/calls/${id}/hangup`, { method: "POST", body: "{}" });
    await refreshCallPop();
  });
  document.getElementById("call-job")?.addEventListener("click", async () => {
    const pop = await api.request("/telephony/active");
    if (!pop.call) return;
    openJobDialog({
      call_id: pop.call.id,
      property_id: pop.call.property_id,
      tenancy_id: pop.call.tenancy_id,
      contact_id: pop.call.contact_id,
      title: pop.contact ? `Call from ${pop.contact.name}` : "Inbound call job",
    });
  });
}

document.getElementById("job-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = document.getElementById("job-error");
  err.classList.add("hidden");
  const raw = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api.request("/jobs", {
      method: "POST",
      body: JSON.stringify({
        title: raw.title,
        detail: raw.detail,
        priority: raw.priority,
        call_id: raw.call_id ? Number(raw.call_id) : null,
        property_id: raw.property_id ? Number(raw.property_id) : null,
        tenancy_id: raw.tenancy_id ? Number(raw.tenancy_id) : null,
        contact_id: raw.contact_id ? Number(raw.contact_id) : null,
      }),
    });
    document.getElementById("job-dialog").close();
    event.target.reset();
    await render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

document.body.addEventListener("click", async (event) => {
  const link = event.target.closest("a.tel-call");
  if (!link || !link.dataset.contact) return;
  try {
    await api.request("/telephony/outbound", {
      method: "POST",
      body: JSON.stringify({ contact_id: Number(link.dataset.contact) }),
    });
  } catch {
    /* still allow tel: */
  }
});
