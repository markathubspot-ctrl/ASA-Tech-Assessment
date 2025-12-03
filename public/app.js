const API_BASE = "http://localhost:3001/api";

let contacts = [];
let selectedContactIdForDeals = null;

const pageSize = 15; // 15 contacts per page
let currentContactsPage = 1;

// -------- DOM REFERENCES --------
const statusEl = document.getElementById("status");

// Contacts
const contactsLoadingEl = document.getElementById("contactsLoading");
const contactsErrorEl = document.getElementById("contactsError");
const contactsTableBodyEl = document.getElementById("contactsTableBody");

// Pagination
const contactsPaginationEl = document.getElementById("contactsPagination");
const contactsPrevBtn = document.getElementById("contactsPrevBtn");
const contactsNextBtn = document.getElementById("contactsNextBtn");
const contactsPageInfoEl = document.getElementById("contactsPageInfo");

// Deals
const dealsHeaderEl = document.getElementById("dealsHeader");
const dealsLoadingEl = document.getElementById("dealsLoading");
const dealsErrorEl = document.getElementById("dealsError");
const dealsTableEl = document.getElementById("dealsTable");
const dealsTableBodyEl = document.getElementById("dealsTableBody");

// Forms & selects
const createContactForm = document.getElementById("createContactForm");
const createDealForm = document.getElementById("createDealForm");
const refreshContactsBtn = document.getElementById("refreshContactsBtn");
const dealContactSelect = document.getElementById("dealContactSelect");

// AI Overview
const generateAiOverviewBtn = document.getElementById("generateAiOverviewBtn");
const aiOverviewLoadingEl = document.getElementById("aiOverviewLoading");
const aiOverviewErrorEl = document.getElementById("aiOverviewError");
const aiOverviewResultEl = document.getElementById("aiOverviewResult");


// -------- HELPERS --------
function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type === "success") statusEl.classList.add("success");
  if (type === "error") statusEl.classList.add("error");
}


// -------- CONTACTS --------
async function fetchContacts() {
  contactsLoadingEl.classList.remove("hidden");
  contactsErrorEl.classList.add("hidden");
  contactsTableBodyEl.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/contacts`);
    if (!res.ok) throw new Error(`Error fetching contacts: HTTP ${res.status}`);

    contacts = await res.json();
    currentContactsPage = 1;

    populateContactSelect();
    renderContactsTable();
    setStatus("Contacts loaded.", "success");
  } catch (err) {
    contactsErrorEl.textContent = err.message;
    contactsErrorEl.classList.remove("hidden");
    setStatus("Failed to load contacts.", "error");
  } finally {
    contactsLoadingEl.classList.add("hidden");
  }
}

function renderContactsTable() {
  contactsTableBodyEl.innerHTML = "";

  if (!contacts.length) {
    contactsTableBodyEl.innerHTML =
      `<tr><td colspan="6">No contacts found.</td></tr>`;
    contactsPaginationEl.style.display = "none";
    return;
  }

  const totalPages = Math.ceil(contacts.length / pageSize);
  currentContactsPage = Math.max(1, Math.min(currentContactsPage, totalPages));

  const startIndex = (currentContactsPage - 1) * pageSize;
  const pageContacts = contacts.slice(startIndex, startIndex + pageSize);

  pageContacts.forEach((contact) => {
    const props = contact.properties || contact;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${props.firstname || ""}</td>
      <td>${props.lastname || ""}</td>
      <td>${props.email || ""}</td>
      <td>${props.phone || ""}</td>
      <td>${props.address || ""}</td>
      <td><button class="view-deals-btn" data-contact-id="${contact.id}">View</button></td>
    `;
    contactsTableBodyEl.appendChild(row);
  });

  document.querySelectorAll(".view-deals-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const contactId = btn.dataset.contactId;
      selectedContactIdForDeals = contactId;

      const c = contacts.find(x => x.id === contactId);
      const props = c?.properties || {};
      dealsHeaderEl.textContent = `${props.firstname || ""} ${props.lastname || ""}`.trim() || "Deals";

      fetchDealsForContact(contactId);
    });
  });

  updatePagination(totalPages);
}

function updatePagination(totalPages) {
  if (totalPages <= 1) {
    contactsPaginationEl.style.display = "none";
    return;
  }

  contactsPaginationEl.style.display = "flex";
  contactsPageInfoEl.textContent = `Page ${currentContactsPage} of ${totalPages}`;

  contactsPrevBtn.disabled = currentContactsPage === 1;
  contactsNextBtn.disabled = currentContactsPage === totalPages;
}

contactsPrevBtn.addEventListener("click", () => {
  if (currentContactsPage > 1) {
    currentContactsPage--;
    renderContactsTable();
  }
});

contactsNextBtn.addEventListener("click", () => {
  const totalPages = Math.ceil(contacts.length / pageSize);
  if (currentContactsPage < totalPages) {
    currentContactsPage++;
    renderContactsTable();
  }
});

// Populate select for creating deals
function populateContactSelect() {
  const first = dealContactSelect.querySelector("option");
  dealContactSelect.innerHTML = "";
  if (first) dealContactSelect.appendChild(first);

  contacts.forEach((contact) => {
    const props = contact.properties || {};
    const id = contact.id;
    const name =
      `${props.firstname || ""} ${props.lastname || ""}`.trim() ||
      props.email ||
      id;

    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name;
    dealContactSelect.appendChild(opt);
  });
}


// -------- DEALS --------
async function fetchDealsForContact(contactId) {
  dealsLoadingEl.classList.remove("hidden");
  dealsErrorEl.classList.add("hidden");
  dealsTableEl.classList.add("hidden");
  dealsTableBodyEl.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/contacts/${contactId}/deals`);
    if (!res.ok) throw new Error(`Error fetching deals: HTTP ${res.status}`);

    const data = await res.json();
    const deals = data.results || [];

    if (!deals.length) {
      dealsTableBodyEl.innerHTML = `<tr><td colspan="3">No deals.</td></tr>`;
    } else {
      deals.forEach((deal) => {
        const props = deal.properties || {};
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${props.dealname || ""}</td>
          <td>${props.amount || ""}</td>
          <td>${props.dealstage || ""}</td>
        `;
        dealsTableBodyEl.appendChild(row);
      });
    }

    dealsTableEl.classList.remove("hidden");
  } catch (err) {
    dealsErrorEl.textContent = err.message;
    dealsErrorEl.classList.remove("hidden");
  } finally {
    dealsLoadingEl.classList.add("hidden");
  }
}


// -------- CREATE CONTACT --------
createContactForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const formData = new FormData(createContactForm);
  const properties = Object.fromEntries(formData.entries());

  try {
    setStatus("Creating contact...");
    const res = await fetch(`${API_BASE}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties }),
    });

    if (!res.ok) throw new Error(`Error creating contact: HTTP ${res.status}`);

    setStatus("Contact created successfully.", "success");
    createContactForm.reset();
    await fetchContacts();
  } catch (err) {
    setStatus(err.message, "error");
  }
});


// -------- CREATE DEAL --------
createDealForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const formData = new FormData(createDealForm);
  const contactId = dealContactSelect.value;

  if (!contactId) {
    setStatus("Please select a contact.", "error");
    return;
  }

  const payload = {
    contactId,
    dealProperties: {
      dealname: formData.get("dealname"),
      amount: String(formData.get("amount")),
      dealstage: formData.get("dealstage"),
    }
  };

  try {
    setStatus("Creating deal...");
    const res = await fetch(`${API_BASE}/deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Error creating deal: HTTP ${res.status}`);

    setStatus("Deal created.", "success");
    createDealForm.reset();

    if (selectedContactIdForDeals === contactId) {
      await fetchDealsForContact(contactId);
    }
  } catch (err) {
    setStatus(err.message, "error");
  }
});


// -------- AI OVERVIEW --------
async function generateAiOverview() {
  aiOverviewResultEl.textContent = "";
  aiOverviewErrorEl.classList.add("hidden");
  aiOverviewLoadingEl.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/ai/overview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5 })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI overview error: HTTP ${res.status} ${text}`);
    }

    const data = await res.json();
   // Convert simple Markdown (**bold**, *italic*, inline code) into HTML
function formatMarkdownToHtml(text) {
  if (!text) return "";

  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")     // **bold**
    .replace(/\*(.*?)\*/g, "<em>$1</em>")                 // *italic*
    .replace(/`([^`]*)`/g, "<code>$1</code>")             // `inline code`
    .replace(/^#+\s*(.*)$/gm, "<strong>$1</strong>")      // headings -> bold
    .trim();
}


aiOverviewResultEl.innerHTML = formatMarkdownToHtml(data.insights);


  } catch (err) {
    aiOverviewErrorEl.textContent = err.message;
    aiOverviewErrorEl.classList.remove("hidden");
  } finally {
    aiOverviewLoadingEl.classList.add("hidden");
  }
}

generateAiOverviewBtn.addEventListener("click", generateAiOverview);


// -------- INIT --------
refreshContactsBtn.addEventListener("click", fetchContacts);
fetchContacts();
