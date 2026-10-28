/* In-memory stand-in for the backend, used when VITE_DEMO=true.
   Data is stored in browser memory and resets on page refresh. */

const delay = (value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), 150));

const apiError = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const DEMO_USER = {
  id: 1,
  name: "Demo User",
  username: "demo",
  is_active: true,
  is_superuser: true,
  created_at: "2026-01-05T08:00:00+08:00",
  updated_at: "2026-01-05T08:00:00+08:00",
};

let currentUser = { ...DEMO_USER };
let currentPassword = "demo123";

const row = (
  id,
  project_title,
  date,
  cv_no,
  payee,
  amount,
  stamp
) => ({
  id,
  project_title,
  date,
  cv_no,
  payee,
  amount: Number(amount).toFixed(2),
  created_at: stamp,
  updated_at: stamp,
  created_by: "demo | Demo User",
  updated_by: "Demo User",
});

let store = [
  row(
    1,
    "Calamba Warehouse Expansion",
    "2026-08-03",
    "CV-0101",
    "Metro Steel Supply",
    185000,
    "2026-08-03T09:15:00+08:00"
  ),
  row(
    2,
    "Calamba Warehouse Expansion",
    "2026-08-12",
    "CV-0108",
    "R. Santos Electrical Works",
    64250.5,
    "2026-08-12T14:40:00+08:00"
  ),
  row(
    3,
    "Calamba Warehouse Expansion",
    "2026-09-01",
    "CV-0122",
    "Laguna Concrete Corp.",
    212400,
    "2026-09-01T10:05:00+08:00"
  ),
  row(
    4,
    "Batangas Pump Station",
    "2026-07-21",
    "CV-0087",
    "HydroTech Pumps Inc.",
    540000,
    "2026-07-21T11:20:00+08:00"
  ),
  row(
    5,
    "Batangas Pump Station",
    "2026-08-30",
    "CV-0119",
    "Southern Luzon Pipes",
    97800.75,
    "2026-08-30T16:00:00+08:00"
  ),
  row(
    6,
    "Plant 2 Roof Repair",
    "2026-09-14",
    "CV-0131",
    "Alpha Roofing Services",
    38500,
    "2026-09-14T09:45:00+08:00"
  ),
  row(
    7,
    "Plant 2 Roof Repair",
    "2026-09-22",
    "CV-0136",
    "Bright Paint & Coatings",
    12950,
    "2026-09-22T13:10:00+08:00"
  ),
  row(
    8,
    "Plant 2 Roof Repair",
    "2026-10-05",
    "CV-0142",
    "Kuya Mark Hauling",
    4200,
    "2026-10-05T15:30:00+08:00"
  ),
];

let nextId = 9;

function generateTestData(count) {
  const projectTitles = Array.from(
    { length: 100 },
    (_, i) => `Stress Test Project ${String(i + 1).padStart(3, "0")}`
  );

  const payees = [
    "Test Supplier A",
    "Test Supplier B",
    "Test Supplier C",
    "Test Contractor A",
    "Test Contractor B",
  ];

  const records = [];
  const startDate = new Date("2025-01-01T00:00:00");
  const endDate = new Date("2026-10-28T00:00:00");
  const dateRange = endDate.getTime() - startDate.getTime();

  for (let i = 0; i < count; i++) {
    const randomDate = new Date(
      startDate.getTime() + Math.random() * dateRange
    );

    const date = [
      randomDate.getFullYear(),
      String(randomDate.getMonth() + 1).padStart(2, "0"),
      String(randomDate.getDate()).padStart(2, "0"),
    ].join("-");

    const stamp = new Date().toISOString();

    records.push(
      row(
        i + 9,
        projectTitles[Math.floor(Math.random() * projectTitles.length)],
        date,
        `STRESS-CV-${String(i + 1).padStart(6, "0")}`,
        payees[Math.floor(Math.random() * payees.length)],
        Math.round(Math.random() * 49990000 + 10000) / 100,
        stamp
      )
    );
  }

  return records;
}

const now = () => new Date().toISOString();

const sameTitle = (a, b) =>
  String(a ?? "").trim().toLowerCase() ===
  String(b ?? "").trim().toLowerCase();

const normalizeTitle = (title) => String(title ?? "").trim();

const getProjectTitles = () => {
  const titles = new Map();

  store.forEach((entry) => {
    const key = entry.project_title.trim().toLowerCase();

    if (!titles.has(key)) {
      titles.set(key, entry.project_title);
    }
  });

  return [...titles.values()].sort((a, b) => a.localeCompare(b));
};

const getEntry = (id) => {
  const entry = store.find((item) => item.id === Number(id));

  if (!entry) {
    throw apiError("Disbursement not found.", 404);
  }

  return entry;
};

const validateDisbursement = (body, isUpdate = false) => {
  if (!body || typeof body !== "object") {
    throw apiError("Invalid request body.");
  }

  const requiredFields = [
    "project_title",
    "date",
    "cv_no",
    "payee",
    "amount",
  ];

  if (!isUpdate) {
    for (const field of requiredFields) {
      if (
        body[field] === undefined ||
        body[field] === null ||
        String(body[field]).trim() === ""
      ) {
        throw apiError(`${field} is required.`);
      }
    }
  }

  if (
    body.project_title !== undefined &&
    !normalizeTitle(body.project_title)
  ) {
    throw apiError("Project title cannot be empty.");
  }

  if (body.amount !== undefined) {
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount < 0) {
      throw apiError("Amount must be a non-negative number.");
    }

    // Prevent amounts with more than two decimal places.
    if (Math.round(amount * 100) !== amount * 100) {
      throw apiError("Amount must have at most two decimal places.");
    }
  }

  if (body.date !== undefined && !String(body.date).trim()) {
    throw apiError("Date cannot be empty.");
  }

  if (body.cv_no !== undefined && !String(body.cv_no).trim()) {
    throw apiError("CV number cannot be empty.");
  }

  if (body.payee !== undefined && !String(body.payee).trim()) {
    throw apiError("Payee cannot be empty.");
  }
};

const makeDisbursement = (body, id, stamp) => ({
  id,
  project_title: normalizeTitle(body.project_title),
  date: String(body.date),
  cv_no: String(body.cv_no).trim(),
  payee: String(body.payee).trim(),
  amount: Number(body.amount).toFixed(2),
  created_at: stamp,
  updated_at: stamp,
  created_by: `${currentUser.username} | ${currentUser.name}`,
  updated_by: currentUser.name,
});

export function createMockApi() {
  return {
    // --------------------------------------------------
    // Authentication
    // --------------------------------------------------

    async login(username, password) {
      await delay(null);

      if (
        username !== currentUser.username ||
        password !== currentPassword
      ) {
        throw apiError("Incorrect username or password.", 401);
      }

      /*
       * The real backend returns a token response.
       * This mock token is only a placeholder because the
       * demo API does not authenticate requests through HTTP.
       */
      return {
        access_token: "demo-access-token",
        token_type: "bearer",
      };
    },

    async register(body) {
      await delay(null);

      if (!body || typeof body !== "object") {
        throw apiError("Invalid registration data.");
      }

      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");

      if (!username || !password) {
        throw apiError("Username and password are required.");
      }

      if (username === currentUser.username) {
        throw apiError("Username already exists.", 400);
      }

      /*
       * The mock uses a single in-memory user.
       * Registering a different username replaces that user.
       * This is only suitable for demo use.
       */
      const stamp = now();

      currentUser = {
        id: currentUser.id + 1,
        name: String(body.name ?? username).trim(),
        username,
        is_active: true,
        is_superuser: false,
        created_at: stamp,
        updated_at: stamp,
      };

      currentPassword = password;

      return {
        id: currentUser.id,
        username: currentUser.username,
        name: currentUser.name,
        is_active: currentUser.is_active,
        is_superuser: currentUser.is_superuser,
        created_at: currentUser.created_at,
        updated_at: currentUser.updated_at,
      };
    },

    async me() {
      await delay(null);

      if (!currentUser || !currentUser.is_active) {
        throw apiError("Your session has expired.", 401);
      }

      return {
        username: currentUser.username,
        name: currentUser.name || currentUser.username,
        is_superuser: !!currentUser.is_superuser,
      };
    },

    // --------------------------------------------------
    // Projects
    // --------------------------------------------------

    async loadStressTestData(count = 10000) {
      const start = performance.now();

      store = [
        ...store,
        ...generateTestData(count),
      ];

      nextId = Math.max(...store.map((entry) => entry.id)) + 1;

      const elapsed = performance.now() - start;

      console.log(`Stress test dataset loaded.`);
      console.log(`New records: ${count}`);
      console.log(`Total records: ${store.length}`);
      console.log(`Generation time: ${elapsed.toFixed(2)} ms`);

      return {
        inserted: count,
        total: store.length,
        generationTimeMs: Number(elapsed.toFixed(2)),
      };
  },

    async listProjects() {
      await delay(null);

      return getAllProjectTitles().map((title) => ({ title }));
    },

    async createProject(title) {
      await delay(null);

      const normalizedTitle = normalizeTitle(title);

      if (!normalizedTitle) {
        throw apiError("Project title is required.");
      }

      const existing = getProjectTitles().find((projectTitle) =>
        sameTitle(projectTitle, normalizedTitle)
      );

      if (existing) {
        throw apiError("Project already exists.", 400);
      }

      /*
       * Projects are derived from disbursement records.
       * Add a project without an entry by tracking it separately.
       */
      extraProjects.add(normalizedTitle);

      return { title: normalizedTitle };
    },

    async getSummary(title) {
      await delay(null);

      const normalizedTitle = normalizeTitle(title);

      const entries = store
        .filter((entry) => sameTitle(entry.project_title, normalizedTitle))
        .map((entry) => ({ ...entry }));

      const projectExists =
        entries.length > 0 ||
        [...extraProjects].some((projectTitle) =>
          sameTitle(projectTitle, normalizedTitle)
        );

      if (!projectExists) {
        throw apiError("Project not found.", 404);
      }

      return {
        project_title: normalizedTitle,
        entries,
        total_amount: entries
          .reduce((sum, entry) => sum + Number(entry.amount), 0)
          .toFixed(2),
      };
    },

    // --------------------------------------------------
    // Disbursements
    // --------------------------------------------------

    async listDisbursements() {
      await delay(null);

      return store.map((entry) => ({ ...entry }));
    },

    async createDisbursement(body) {
      await delay(null);

      validateDisbursement(body);

      const projectTitle = normalizeTitle(body.project_title);

      // Keep the project name consistent with existing projects.
      const existingTitle = getProjectTitles().find((title) =>
        sameTitle(title, projectTitle)
      );

      const finalBody = {
        ...body,
        project_title: existingTitle || projectTitle,
      };

      extraProjects.add(finalBody.project_title);

      const stamp = now();

      const entry = makeDisbursement(finalBody, nextId++, stamp);

      store.push(entry);

      return { ...entry };
    },

    async updateDisbursement(id, body) {
      await delay(null);

      const existing = getEntry(id);

      validateDisbursement(body, true);

      const updatedBody = {
        ...existing,
        ...body,
      };

      updatedBody.project_title = normalizeTitle(
        updatedBody.project_title
      );

      const updated = {
        ...existing,
        ...updatedBody,
        id: existing.id,
        amount: Number(updatedBody.amount).toFixed(2),
        updated_at: now(),
        updated_by: currentUser.name,
      };

      const index = store.findIndex(
        (entry) => entry.id === Number(id)
      );

      extraProjects.add(updated.project_title);

      store[index] = updated;

      return { ...updated };
    },

    async deleteDisbursement(id) {
      await delay(null);

      getEntry(id);

      store = store.filter((entry) => entry.id !== Number(id));

      return null;
    },

    // --------------------------------------------------
    // Password management
    // --------------------------------------------------

    async changePassword(body) {
      await delay(null);

      if (!body || typeof body !== "object") {
        throw apiError("Invalid request body.");
      }

      /*
       * Expected fields:
       * current_password
       * new_password
       *
       * Change these field names if your backend uses
       * different names in its password-change schema.
       */
      if (body.current_password !== currentPassword) {
        throw apiError("Current password is incorrect.", 400);
      }

      const newPassword = String(body.new_password ?? "");

      if (!newPassword) {
        throw apiError("New password is required.");
      }

      currentPassword = newPassword;
      currentUser.updated_at = now();

      return { message: "Password changed successfully." };
    },
  };
}

/*
 * Projects created without disbursement records must still
 * appear in the project list and have a valid summary.
 */
const extraProjects = new Set();

// Include standalone projects when listing all projects.
const originalGetProjectTitles = getProjectTitles;

const getAllProjectTitles = () => {
  const titles = new Map();

  originalGetProjectTitles().forEach((title) => {
    titles.set(title.toLowerCase(), title);
  });

  extraProjects.forEach((title) => {
    if (!titles.has(title.toLowerCase())) {
      titles.set(title.toLowerCase(), title);
    }
  });

  return [...titles.values()].sort((a, b) => a.localeCompare(b));
};