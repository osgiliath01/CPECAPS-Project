// The User Guides page (components/HelpCenter.jsx).
//
// Each guide: who it's for ("all", "staff" or "admin"), a category, a one-line summary, the
// steps (**bold** = a button or label exactly as it appears in the app), optional tips, and
// where "Take me there" goes ({ page: "home" | "user", section?: tab key of the User Panel }).
// When a screen changes, update its guide here.

export const CATEGORIES = [
  { key: "start", label: "Getting started" },
  { key: "entries", label: "Projects & entries" },
  { key: "requests", label: "Requests & approvals" },
  { key: "account", label: "Your account" },
  { key: "admin", label: "Admin tools" },
  { key: "more", label: "Assistant & phone" },
];

export const GUIDES = [
  // ---------- Getting started ----------
  {
    id: "tour", cat: "start", roles: "all",
    title: "Find your way around",
    summary: "The search bar, the menu, the chat button and the live dot.",
    steps: [
      "The **search bar** at the top finds projects. The **Filter by** chips under it choose what it searches: **Project Title**, **Payee / Particulars**, or both.",
      "Your **picture at the top right** opens the menu: **Voucher Control** (the project list), **User Panel** (your account, requests and, for admins, the admin tools), **User Guides** (this page) and **Sign out**.",
      "A **red number** on your picture means something is waiting for you: requests to review (admins) or answers to your requests (staff).",
      "The **yellow chat button** at the bottom right opens the assistant, which answers questions about the records.",
      "The **dot** next to your picture is green when the screen updates by itself: changes made by others appear without reloading.",
    ],
    go: { page: "home" },
  },
  {
    id: "signin", cat: "start", roles: "all",
    title: "Sign in, and when you're signed out",
    summary: "One device at a time; signed out after 30 minutes without activity.",
    steps: [
      "Open the app's link, type your **username** and **password**, and click **Sign in**.",
      "An account can be signed in on **one device at a time**. If it's open somewhere else, that device is asked to let you in; wait on the sign-in page until it does.",
      "If you don't use the app for **30 minutes**, you're signed out. Two minutes before, a bar at the bottom says so: click **Stay signed in** to continue.",
      "To sign out yourself, click your picture at the top right, then **Sign out**. Signing out properly lets you sign in on another device straight away.",
    ],
    tips: ["Five wrong passwords in a row lock the account for 15 minutes. Use **Forgot password?** if you're unsure."],
  },
  {
    id: "register", cat: "start", roles: "all",
    title: "Create an account",
    summary: "New accounts can sign in once an admin approves them.",
    steps: [
      "On the sign-in page, click **Create one** (under the Sign in button).",
      "Fill in **Full name**, **Username**, **Password** (at least 8 characters) and **Confirm password**, then click **Create account**.",
      "The page says *Account created. An admin has to approve it before you can sign in.* Let an admin know you've signed up.",
      "Once approved, sign in with the username and password you chose.",
    ],
  },
  {
    id: "forgot", cat: "start", roles: "all",
    title: "Forgot your password",
    summary: "Ask an admin for a temporary password from the sign-in page.",
    steps: [
      "On the sign-in page, click **Forgot password?**",
      "Type your **username** (and a short message if you like), then **Send request**.",
      "An admin approves it and gives you a **temporary password**, privately.",
      "Sign in with it. You'll be asked to **set a new password** straight away.",
    ],
  },

  // ---------- Projects & entries ----------
  {
    id: "find", cat: "entries", roles: "all",
    title: "Find a project, payee or voucher",
    summary: "Search, filter, sort and open a project.",
    steps: [
      "Type in the **search bar** at the top: part of a project title, a payee, or a CV number.",
      "Use the **Filter by** chips to choose where to look: **Project Title**, **Payee / Particulars**, or both.",
      "Click a column title such as **PROJECT TITLE** or **TOTAL DISBURSEMENT AMOUNT** to sort. Click again to reverse.",
      "Click **View** on a project to see its entries (the *Summary of Expenses*). **← Back** returns to the list.",
    ],
    go: { page: "home" },
  },
  {
    id: "add-entry", cat: "entries", roles: "all",
    title: "Add an entry",
    summary: "Record a voucher in a project.",
    steps: [
      "In **Voucher Control**, click **View** on the project.",
      "Click **+ Add new record**.",
      "Fill in **Date**, **CV no.**, **Payee / Particulars** and **Amount (PHP)**.",
      "Click **Add record**. The entry is saved with your name as the encoder, and appears for everyone right away.",
    ],
    go: { page: "home" },
  },
  {
    id: "new-project", cat: "entries", roles: "all",
    title: "Create a project",
    summary: "Start a new project to record entries in.",
    steps: [
      "In **Voucher Control**, click **+ Create new project**.",
      "Type the **Project title** and click **Create project**.",
      "Open it with **View** and add its first entry with **+ Add new record**.",
    ],
    tips: ["Projects are also created automatically by an import, if the file has a new project title."],
    go: { page: "home" },
  },
  {
    id: "edit-entry", cat: "entries", roles: "admin",
    title: "Edit an entry",
    summary: "Change an entry directly (admins).",
    steps: [
      "Open the project with **View**.",
      "Click **Edit** on the entry's row.",
      "Change what's needed and click **Save changes**. Your name is recorded as the editor, and the change is logged.",
      "If someone else changed the entry after you opened it, you're told so: close it and open it again to see the latest version.",
    ],
    go: { page: "home" },
  },
  {
    id: "request-edit", cat: "entries", roles: "staff",
    title: "Ask for an entry to be changed",
    summary: "Staff send an edit request; an admin approves it.",
    steps: [
      "Open the project with **View**.",
      "Click **Request edit** on the entry's row.",
      "Change the values that are wrong. Add a **Reason (optional)**, e.g. *Wrong amount encoded*.",
      "Click **Send request**. The entry changes once an admin approves. See **Track your requests**.",
    ],
    go: { page: "home" },
  },
  {
    id: "archive-entry", cat: "entries", roles: "admin",
    title: "Archive an entry",
    summary: "Remove an entry from its project (restorable for 30 days).",
    steps: [
      "Open the project with **View** and click **Archive** on the entry's row.",
      "Confirm with **Archive**. The entry disappears from the project and its totals.",
      "It can be restored for 30 days: **User Panel → Activity Log → Archived**. After that it's deleted permanently.",
    ],
    go: { page: "home" },
  },
  {
    id: "request-archive", cat: "entries", roles: "staff",
    title: "Ask for an entry to be removed",
    summary: "Staff send an archive request with a reason.",
    steps: [
      "Open the project with **View** and click **Request archive** on the entry's row.",
      "Write the **Reason**, e.g. *Duplicate entry*.",
      "Click **Send request**. An admin decides; you'll see the answer in **My Requests**.",
    ],
    go: { page: "home" },
  },
  {
    id: "several", cat: "entries", roles: "all",
    title: "Work on several entries at once",
    summary: "Tick entries and archive them (admins) or request it (staff) together.",
    steps: [
      "Open the project with **View**. Each row has a **checkbox**; the one in the header ticks the whole page. Ticks are kept when you change pages.",
      "A dark bar shows how many are selected, e.g. *3 entries selected*.",
      "Admins: **Archive selected**, add an optional reason, and confirm. Staff: **Request archive**, write the reason, and **Send requests**.",
      "The message says how many went through, and why any were skipped (for example, already archived). **Clear** unticks everything.",
    ],
    go: { page: "home" },
  },
  {
    id: "export", cat: "entries", roles: "all",
    title: "Export a project to Excel",
    summary: "Download all of a project's entries as an .xlsx file.",
    steps: [
      "Open the project with **View**.",
      "Click **Export Excel**. A file like *Project-Name_2026-11-02.xlsx* downloads.",
      "Sheet **Entries** has every entry (not only what the search shows). Sheet **Summary** has the total, the number of entries and the date range.",
    ],
    tips: ["To import it again later: open the Entries sheet and use **Save As → CSV UTF-8** in Excel."],
    go: { page: "home" },
  },
  {
    id: "import", cat: "entries", roles: "admin",
    title: "Import entries from a file",
    summary: "Add many entries at once from a CSV (admins).",
    steps: [
      "In **Voucher Control**, click **Import File**.",
      "If you need the format, click **Download a template**: the columns are project_title, date, cv_no, payee, amount.",
      "Choose your **CSV file**. The app checks every row first and lists any problems (with the line number).",
      "Click **Import … rows**. Rows with problems are skipped; fix them in the file and import those again if needed.",
    ],
    go: { page: "home" },
  },
  {
    id: "archive-projects", cat: "entries", roles: "admin",
    title: "Archive projects",
    summary: "Archive one or several projects with all their entries (admins).",
    steps: [
      "In **Voucher Control**, click **Archive** on a project's row, or tick several projects and click **Archive selected**.",
      "The confirmation shows the projects and how many entries go with them. Confirm with **Archive**.",
      "They can be restored for 30 days: **User Panel → Activity Log → Archived → Projects**.",
    ],
    go: { page: "home" },
  },

  // ---------- Requests & approvals ----------
  {
    id: "my-requests", cat: "requests", roles: "staff",
    title: "Track your requests",
    summary: "See whether your edit and archive requests were approved.",
    steps: [
      "Click your picture at the top right, then **User Panel**. **My Requests** opens first.",
      "Use the chips to show **All**, **Pending**, **Approved** or **Rejected**.",
      "Each request shows the admin's response and note. New answers are highlighted with **New**.",
      "A **red number** on your picture means an admin has answered; it clears when you open My Requests.",
    ],
    go: { page: "user", section: "requests" },
  },
  {
    id: "review-requests", cat: "requests", roles: "admin",
    title: "Review edit and archive requests",
    summary: "Approve or reject what staff asked for (admins).",
    steps: [
      "A **red number** on your picture means requests are waiting. Open **User Panel → Activity Log → Requests**.",
      "Each request shows the entry, what's being asked and why.",
      "Optionally type a **Note to requester**, then **Approve** or **Reject**. The requester sees your answer and note.",
      "You can't review your own requests: another admin has to.",
    ],
    go: { page: "user", section: "activity" },
  },
  {
    id: "resets", cat: "requests", roles: "admin",
    title: "Handle forgotten passwords",
    summary: "Give someone a temporary password (admins).",
    steps: [
      "Open **User Panel → Activity Log → Password resets**.",
      "Check who's asking, then click **Approve**.",
      "Copy the **temporary password** shown (it's shown only once) and give it to the person privately.",
      "They sign in with it and must choose a new password straight away.",
    ],
    tips: ["Manage Users → Manage → **Reset password** does the same without a request."],
    go: { page: "user", section: "activity" },
  },
  {
    id: "approve-accounts", cat: "requests", roles: "admin",
    title: "Approve new accounts and name changes",
    summary: "Let new people in, and approve staff name changes (admins).",
    steps: [
      "Open **User Panel → Manage Users**. A red number on that tab means someone is waiting.",
      "**Name change requests** are listed first: optionally add a note, then **Approve** or **Reject**.",
      "In the user list, new accounts are shown first as **Waiting for approval**. Click **Review**.",
      "**Approve** lets them sign in. **Reject** removes the account so the username can be used again.",
    ],
    go: { page: "user", section: "users" },
  },
  {
    id: "other-device", cat: "requests", roles: "all",
    title: "Someone signs in to your account elsewhere",
    summary: "Allow or block a sign-in from another device.",
    steps: [
      "A pop-up says **Sign-in from another device** and which browser and device it is.",
      "If it's you (e.g. moving to another computer), click **Allow and sign me out**. Save your work first.",
      "If it isn't you, click **Block**, then change your password (**User Panel → Change password**) and use **Sign out on all devices**.",
    ],
  },

  // ---------- Your account ----------
  {
    id: "profile", cat: "account", roles: "all",
    title: "Change your photo or name",
    summary: "Your profile picture and full name.",
    steps: [
      "Open **User Panel**. Your profile card is on the left (at the top on a phone).",
      "Photo: **Add photo** or **Change photo**, then pick a picture. It's cropped to a square automatically. **Remove** goes back to the default.",
      "Name: click **Edit** next to your name and type the new one.",
      "Admins click **Save**. Staff click **Request change**: the card shows *Waiting for approval* until an admin approves it.",
    ],
    go: { page: "user" },
  },
  {
    id: "password", cat: "account", roles: "all",
    title: "Change your password",
    summary: "Set a new password while signed in.",
    steps: [
      "Open **User Panel** and click **Change password**.",
      "Type your current password and the new one (at least 8 characters), then save.",
    ],
    go: { page: "user" },
  },
  {
    id: "security", cat: "account", roles: "all",
    title: "Check your sign-in security",
    summary: "Previous sign-in, wrong passwords, and signing out everywhere.",
    steps: [
      "Open **User Panel**. Under **Sign-in security** you see your previous sign-in, wrong passwords since then, and when your password last changed.",
      "Wrong passwords you didn't type are shown in red with a hint: someone may be guessing.",
      "**Sign out on all devices** ends every session of your account, including this one. Use it if you think someone else has your password, after changing it.",
    ],
    go: { page: "user" },
  },
  {
    id: "my-activity", cat: "account", roles: "all",
    title: "See your activity and numbers",
    summary: "Your work this month, and everything you've done.",
    steps: [
      "Open **User Panel**. The cards at the top show your entries this month, all your entries and totals, your edits and your requests.",
      "The **My Activity** tab lists what you did, grouped by day, plus what admins did to your account.",
      "Sign-ins are hidden; tick **Show sign-ins** to include them. **Show more** loads older items.",
    ],
    go: { page: "user", section: "mine" },
  },

  // ---------- Admin tools ----------
  {
    id: "activity-log", cat: "admin", roles: "admin",
    title: "Read the Activity Log",
    summary: "Who did what, and when.",
    steps: [
      "Open **User Panel → Activity Log → Activity**.",
      "Narrow it with the filters: record type (entries, projects, accounts, backups), action, user, or words in the details.",
      "Edits show what changed (old → new). Permanently deleted items keep a full copy here.",
    ],
    go: { page: "user", section: "activity" },
  },
  {
    id: "archived", cat: "admin", roles: "admin",
    title: "Restore or permanently delete archived items",
    summary: "Bring items back, or erase them before the 30 days are up.",
    steps: [
      "Open **User Panel → Activity Log → Archived**, then choose **Projects** or **Entries**.",
      "**Restore** brings an item back (a project with the entries archived with it). **Deletes in** shows how long until it's deleted automatically.",
      "**Delete** erases it now. Type **DELETE** to confirm. This can't be undone; the Activity Log keeps a copy.",
      "Tick several items to **Restore selected** or **Delete permanently** at once.",
    ],
    go: { page: "user", section: "activity" },
  },
  {
    id: "manage-users", cat: "admin", roles: "admin",
    title: "Manage user accounts",
    summary: "Roles, deactivating, password resets and deleting accounts.",
    steps: [
      "Open **User Panel → Manage Users** and click **Manage** on the person.",
      "**Make admin** / **Remove admin** changes their role. **Deactivate** stops them signing in but keeps their history.",
      "**Reset password** gives a temporary password (shown once); they choose a new one at sign-in.",
      "**Delete account** is permanent: type their username to confirm. Deactivating is usually better.",
    ],
    tips: ["You can't remove the last admin, or deactivate or delete yourself."],
    go: { page: "user", section: "users" },
  },
  {
    id: "who-is-online", cat: "account", roles: "staff",
    title: "See who is active",
    summary: "Who has the app open right now, and who is idle.",
    steps: [
      "Open **User Panel → Active Status**. The line above the list counts who is **active**, **idle** and **offline**.",
      "A **green dot** on someone's picture means they're using the app now. **Yellow** means it's open but they haven't clicked or typed for a few minutes.",
      "The **Online** column says **Active now**, **Idle**, or when they were **last seen** (hover for the exact time).",
      "Tick **Online now only** to list just the people who have the app open.",
    ],
    tips: [
      "It updates by itself every 30 seconds.",
      "Someone shows as offline about a minute after they close the app, lose their connection or sign out.",
    ],
    go: { page: "user", section: "online" },
  },
  {
    id: "who-is-online-admin", cat: "admin", roles: "admin",
    title: "See who is active",
    summary: "Who has the app open right now, who is idle, and when others were last seen.",
    steps: [
      "Open **User Panel → Manage Users**. The line above the list counts who is **active**, **idle** and **offline**.",
      "A **green dot** on someone's picture means they're using the app now. **Yellow** means it's open but they haven't clicked or typed for a few minutes.",
      "The **Online** column says **Active now**, **Idle** (and when they last used the app), or when they were **last seen**, with their last sign-in below.",
      "Tick **Online now only** to list just the people who have the app open.",
    ],
    tips: [
      "It updates by itself every 30 seconds.",
      "Staff see the same online status (without sign-in times) in their **Active Status** tab.",
    ],
    go: { page: "user", section: "users" },
  },
  {
    id: "backups", cat: "admin", roles: "admin",
    title: "Check that backups are running",
    summary: "The nightly encrypted backup and what its colours mean.",
    steps: [
      "Open **User Panel**. Under **Backups** on your profile card: **green** means the last backup was within a day.",
      "**Yellow** means the last backup is over a day old: check that the server is on and running.",
      "**Red** means the last backup failed; it tries again within an hour. If it stays red, tell whoever runs the server.",
      "Restoring from a backup is done on the server by the person who runs it (README, Backups).",
    ],
    go: { page: "user" },
  },

  // ---------- Assistant & phone ----------
  {
    id: "assistant", cat: "more", roles: "all",
    title: "Ask the assistant",
    summary: "Questions about projects, payees and totals, in plain words.",
    steps: [
      "Click the **yellow chat button** at the bottom right.",
      "Ask, for example: *Which projects spent the most this year?*, *Show the latest payments to Laguna Steel*, *Who created CV-12234?*",
      "Follow-up questions work (*who edited it?*). **New chat** starts over; **Expand** makes the window bigger.",
      "It only reads the records: it can't add, change or archive anything. Double-check important figures.",
    ],
  },
  {
    id: "phone", cat: "more", roles: "all",
    title: "Use the app on a phone",
    summary: "Same link, phone-sized layout.",
    steps: [
      "Open the same link in your phone's browser and sign in.",
      "Tables become cards: each value has its label, and buttons are at the bottom of the card.",
      "The checkbox to select an entry is at the **top right of its card**.",
      "The menu is still your picture at the top right; the chat button is at the bottom right.",
    ],
  },
];
