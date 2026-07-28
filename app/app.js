const appState = {
  activeView: "dashboard",
  activeModule: "customers",
  titles: {
    dashboard: "Dashboard",
    operations: "Operations",
    documents: "Documents",
    analytics: "Analytics",
    profile: "Profile"
  }
};

const moduleData = {
  customers: {
    title: "Customers",
    subtitle: "Customer list, details, ledger, outstanding payments",
    rows: [
      ["Acme Auto Parts", "Ledger ₹28.4L · Outstanding ₹6.2L", "AA"],
      ["Prime Axles Ltd", "Ledger ₹42.8L · Outstanding ₹10.7L", "PA"],
      ["Nexon Heavy Tools", "Ledger ₹18.9L · Outstanding ₹2.1L", "NH"]
    ],
    amountLabel: "Customers"
  },
  vendors: {
    title: "Vendors",
    subtitle: "Vendor details, purchase history, outstanding bills",
    rows: [
      ["Bharat Steel Traders", "EN-8 rounds · Bills due ₹14.6L", "BS"],
      ["Indo Furnace Services", "Maintenance · Bills due ₹2.8L", "IF"],
      ["Shakti Logistics", "Freight · Bills due ₹1.3L", "SL"]
    ],
    amountLabel: "Vendors"
  },
  invoices: {
    title: "Invoices",
    subtitle: "Invoice list, details, create flow, PDF preview",
    rows: [
      ["INV-2051", "Prime Axles Ltd · Due in 6 days", "₹8.9L"],
      ["INV-2050", "Acme Auto Parts · Awaiting approval", "₹4.2L"],
      ["INV-2049", "Nexon Heavy Tools · Paid", "₹2.7L"]
    ],
    amountLabel: "Invoices"
  },
  purchase: {
    title: "Purchase Management",
    subtitle: "Purchase orders, vendor bills, live tracking",
    rows: [
      ["PO-4109", "EN-8 steel bars · Delivery tomorrow", "₹8.4L"],
      ["VB-8821", "Vendor bill review · GST matched", "₹3.1L"],
      ["PO-4108", "Consumables · In transit", "₹74K"]
    ],
    amountLabel: "Open"
  },
  inventory: {
    title: "Inventory",
    subtitle: "Raw materials, finished goods, stock movement, warehouses",
    rows: [
      ["EN-8 Steel", "Raw material · Low stock alert", "4.2T"],
      ["Forged Shafts 48mm", "Finished goods · Warehouse 1", "1,240"],
      ["Die Lubricant", "Stock movement · Issued to Line B", "82L"]
    ],
    amountLabel: "Items"
  },
  production: {
    title: "Production",
    subtitle: "Production orders, job status, machines, work orders",
    rows: [
      ["JOB-7782", "Crankshaft forging · 74% complete", "Line A"],
      ["Machine H-12", "Hydraulic press · Running", "OEE 86%"],
      ["WO-3321", "Heat treatment · Delayed 42 min", "Alert"]
    ],
    amountLabel: "Jobs"
  },
  payments: {
    title: "Payments",
    subtitle: "Incoming, outgoing, bank reconciliation",
    rows: [
      ["Incoming", "Acme Auto Parts · UTR matched", "₹6.2L"],
      ["Outgoing", "Bharat Steel Traders · Scheduled", "₹14.6L"],
      ["Bank Reconciliation", "3 entries need review", "3"]
    ],
    amountLabel: "Pending"
  },
  expenses: {
    title: "Expenses",
    subtitle: "Expense list, categories, add expense",
    rows: [
      ["Power & Fuel", "Furnace usage · July", "₹12.4L"],
      ["Maintenance", "Press H-12 service", "₹86K"],
      ["Factory Admin", "Safety equipment", "₹38K"]
    ],
    amountLabel: "Categories"
  }
};

const screenTitle = document.getElementById("screenTitle");
const moduleStack = document.getElementById("moduleStack");
const toast = document.getElementById("toast");
const fab = document.getElementById("fab");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function showAuth(screen) {
  document.querySelectorAll(".screen").forEach(item => {
    item.classList.toggle("is-active", item.dataset.screen === screen);
  });
  if (screen === "login") {
    document.querySelector('[data-screen="login"]').classList.add("is-active");
  }
}

function enterApp() {
  document.querySelectorAll(".screen").forEach(item => item.classList.remove("is-active"));
  document.querySelector('[data-screen="app"]').classList.add("is-active");
  routeTo("dashboard");
}

function routeTo(view) {
  appState.activeView = view;
  document.querySelectorAll(".content-view").forEach(item => {
    item.classList.toggle("is-active", item.dataset.view === view);
  });
  document.querySelectorAll(".bottom-nav button").forEach(item => {
    item.classList.toggle("is-active", item.dataset.route === view);
  });
  screenTitle.textContent = appState.titles[view];
  fab.style.display = view === "profile" ? "none" : "grid";
}

function renderModule(name) {
  const module = moduleData[name];
  appState.activeModule = name;
  moduleStack.innerHTML = `
    <article class="module-card">
      <header>
        <div>
          <strong>${module.title}</strong>
          <small>${module.subtitle}</small>
        </div>
        <span class="status-pill good">${module.amountLabel}</span>
      </header>
      ${module.rows.map(row => `
        <div class="row">
          <div>
            <strong>${row[0]}</strong>
            <small>${row[1]}</small>
          </div>
          <span class="amount">${row[2]}</span>
        </div>
      `).join("")}
    </article>
    <div class="state-row">
      <article class="state-card skeleton"><span></span><b></b><small></small></article>
      <article class="state-card empty">
        <strong>No errors</strong>
        <small>Error states and empty results use quiet, actionable cards.</small>
      </article>
    </div>
  `;
}

document.querySelectorAll("[data-action='enter-app']").forEach(button => {
  button.addEventListener("click", enterApp);
});

document.querySelectorAll("[data-auth]").forEach(button => {
  button.addEventListener("click", () => showAuth(button.dataset.auth));
});

document.querySelectorAll("[data-route]").forEach(button => {
  button.addEventListener("click", () => routeTo(button.dataset.route));
});

document.querySelectorAll("[data-module]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-module]").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    renderModule(button.dataset.module);
  });
});

document.querySelectorAll("[data-toast]").forEach(button => {
  button.addEventListener("click", () => showToast(button.dataset.toast));
});

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => showToast("Filters opened: status, date, plant, role"));
});

fab.addEventListener("click", () => {
  const labels = {
    dashboard: "Quick create menu opened",
    operations: `Add ${moduleData[appState.activeModule].title} record`,
    documents: "Upload PDF or scan document",
    analytics: "Create scheduled KPI report"
  };
  showToast(labels[appState.activeView] || "Add record");
});

renderModule("customers");