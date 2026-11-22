(() => {
  "use strict";

  /* ---------- config ---------- */
  const KEYS = {
    users: "vault.users",
    admin: "vault.admin",
    theme: "vault.theme",
    locks: "vault.locks",
    session: "vault.session",
    adminSession: "vault.adminSession",
  };
  const ITERATIONS = 150000;
  const MAX_FAILS = 5;
  const LOCK_MS = 30000;
  const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

  /* ---------- tiny helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        toast("Could not save: browser storage is unavailable.", "error");
        return false;
      }
    },
  };

  const session = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const getUsers = () => store.get(KEYS.users, []);
  const setUsers = (list) => store.set(KEYS.users, list);
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

  const fmtDate = (iso) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  function toast(text, type = "info") {
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = text;
    $("#toasts").append(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  function say(statusEl, text, type = "") {
    statusEl.textContent = text;
    statusEl.className = "status " + type;
  }

  function busy(form, on) {
    const btn = $("button[type='submit']", form);
    if (btn) btn.disabled = on;
  }

  /* ---------- password hashing (PBKDF2 + random salt) ---------- */
  const encoder = new TextEncoder();
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function hashPassword(password, saltB64) {
    const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      key,
      256
    );
    return { salt: toB64(salt), hash: toB64(bits) };
  }

  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ---------- brute-force slowdown ---------- */
  function lockRemaining(scope) {
    const entry = store.get(KEYS.locks, {})[scope];
    return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
  }
  function registerFail(scope) {
    const locks = store.get(KEYS.locks, {});
    const entry = locks[scope] || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILS) {
      entry.count = 0;
      entry.until = Date.now() + LOCK_MS;
    }
    locks[scope] = entry;
    store.set(KEYS.locks, locks);
  }
  function clearFails(scope) {
    const locks = store.get(KEYS.locks, {});
    delete locks[scope];
    store.set(KEYS.locks, locks);
  }

  /* ---------- confirm / prompt dialog ---------- */
  function ask({ title, text, input = false, placeholder = "", confirmText = "Confirm" }) {
    return new Promise((resolve) => {
      const dlg = $("#dialog");
      $("#dlg-title").textContent = title;
      $("#dlg-text").textContent = text;
      $("#dlg-field").hidden = !input;
      const field = $("#dlg-input");
      field.value = "";
      field.placeholder = placeholder;
      $("#dlg-ok").textContent = confirmText;
      dlg.addEventListener(
        "close",
        () => resolve(dlg.returnValue === "ok" ? (input ? field.value : true) : null),
        { once: true }
      );
      dlg.returnValue = "cancel";
      dlg.showModal();
      if (input) field.focus();
    });
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = $("meta[name='theme-color']");
    if (meta) meta.content = theme === "dark" ? "#0b1020" : "#4f46e5";
  }
  const savedTheme = store.get(KEYS.theme, null);
  applyTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    store.set(KEYS.theme, next);
  });

  /* ---------- tabs ---------- */
  function showTab(name) {
    $$(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (name === "login") renderAccount();
    if (name === "admin") renderAdmin();
    history.replaceState(null, "", "#" + name);
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  /* ---------- show/hide password + strength meter ---------- */
  $$(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $("input", btn.parentElement);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      input.classList.toggle("revealed", show);
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  function strength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    return pw.length === 0 ? 0 : Math.max(1, Math.min(s, 4));
  }
  const LABELS = ["Strength", "Weak", "Okay", "Good", "Strong"];
  function updateMeter(form) {
    const meter = $(".meter", form);
    const input = $("[data-meter]", form);
    if (!meter || !input) return;
    const lvl = strength(input.value);
    meter.dataset.level = lvl;
    $("span", meter).textContent = LABELS[lvl];
  }
  $$("[data-meter]").forEach((input) =>
    input.addEventListener("input", () => updateMeter(input.form))
  );

  /* ---------- sign up ---------- */
  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const status = $(".status", form);
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    const confirmPw = form.elements.confirm.value;

    if (!USERNAME_RE.test(username)) return say(status, "Username: 3–24 characters, letters, numbers, . _ - only.", "error");
    if (password.length < 8) return say(status, "Password must be at least 8 characters.", "error");
    if (password !== confirmPw) return say(status, "Passwords don't match.", "error");

    const users = getUsers();
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      return say(status, "That username is already taken.", "error");
    }

    busy(form, true);
    try {
      const { salt, hash } = await hashPassword(password);
      users.push({ id: uid(), username, salt, hash, created: new Date().toISOString(), lastLogin: null });
      if (!setUsers(users)) return;
      form.reset();
      updateMeter(form);
      say(status, "");
      toast("Account created. You can log in now.", "ok");
      showTab("login");
      $("#li-user").value = username;
      $("#li-pass").focus();
    } catch {
      say(status, "Something went wrong while saving. Please try again.", "error");
    } finally {
      busy(form, false);
    }
  });

  /* ---------- user login ---------- */
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const status = $(".status", form);
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) return say(status, "Enter your username and password.", "error");

    const scope = "user:" + username.toLowerCase();
    const wait = lockRemaining(scope);
    if (wait) return say(status, `Too many attempts. Try again in ${wait}s.`, "error");

    busy(form, true);
    try {
      const users = getUsers();
      const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      // always hash, so the response time doesn't reveal whether the username exists
      const probe = await hashPassword(password, user ? user.salt : undefined);

      if (user && safeEqual(probe.hash, user.hash)) {
        clearFails(scope);
        user.lastLogin = new Date().toISOString();
        setUsers(users);
        session.set(KEYS.session, user.id);
        form.reset();
        say(status, "");
        renderAccount();
        toast(`Welcome back, ${user.username}!`, "ok");
      } else {
        registerFail(scope);
        say(status, "Wrong username or password.", "error");
      }
    } finally {
      busy(form, false);
    }
  });

  /* ---------- account card ---------- */
  function currentUser() {
    const id = session.get(KEYS.session);
    return id ? getUsers().find((u) => u.id === id) || null : null;
  }

  function renderAccount() {
    const user = currentUser();
    $("#login-form").hidden = !!user;
    $("#account").hidden = !user;
    if (!user) return;
    $("#acc-avatar").textContent = user.username[0].toUpperCase();
    $("#acc-name").textContent = "Hi, " + user.username;
    $("#acc-meta").textContent = `Member since ${fmtDate(user.created)}`;
  }

  $("#acc-logout").addEventListener("click", () => {
    session.del(KEYS.session);
    renderAccount();
    toast("Logged out.");
  });

  $("#acc-delete").addEventListener("click", async () => {
    const user = currentUser();
    if (!user) return;
    const ok = await ask({
      title: "Delete your account?",
      text: "This permanently removes your saved credentials from this browser.",
      confirmText: "Delete",
    });
    if (!ok) return;
    setUsers(getUsers().filter((u) => u.id !== user.id));
    session.del(KEYS.session);
    renderAccount();
    toast("Account deleted.");
  });

  /* ---------- admin: setup, login, dashboard ---------- */
  function renderAdmin() {
    const admin = store.get(KEYS.admin, null);
    const authed = !!admin && session.get(KEYS.adminSession) === "1";
    $("#admin-setup").hidden = !!admin;
    $("#admin-login").hidden = !admin || authed;
    $("#admin-dash").hidden = !authed;
    if (authed) renderTable();
  }

  $("#admin-setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const status = $(".status", form);
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;

    if (!USERNAME_RE.test(username)) return say(status, "Username: 3–24 characters, letters, numbers, . _ - only.", "error");
    if (password.length < 8) return say(status, "Password must be at least 8 characters.", "error");
    if (password !== form.elements.confirm.value) return say(status, "Passwords don't match.", "error");

    busy(form, true);
    try {
      const { salt, hash } = await hashPassword(password);
      if (!store.set(KEYS.admin, { username, salt, hash, created: new Date().toISOString() })) return;
      session.set(KEYS.adminSession, "1");
      form.reset();
      updateMeter(form);
      say(status, "");
      toast("Admin created.", "ok");
      renderAdmin();
    } finally {
      busy(form, false);
    }
  });

  $("#admin-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const status = $(".status", form);
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    const admin = store.get(KEYS.admin, null);
    if (!admin) return renderAdmin();

    const wait = lockRemaining("admin");
    if (wait) return say(status, `Too many attempts. Try again in ${wait}s.`, "error");

    busy(form, true);
    try {
      const probe = await hashPassword(password, admin.salt);
      if (username.toLowerCase() === admin.username.toLowerCase() && safeEqual(probe.hash, admin.hash)) {
        clearFails("admin");
        session.set(KEYS.adminSession, "1");
        form.reset();
        say(status, "");
        renderAdmin();
      } else {
        registerFail("admin");
        say(status, "Invalid admin login.", "error");
      }
    } finally {
      busy(form, false);
    }
  });

  $("#admin-logout").addEventListener("click", () => {
    session.del(KEYS.adminSession);
    renderAdmin();
    toast("Admin logged out.");
  });

  function renderTable() {
    const all = getUsers();
    const q = $("#search").value.trim().toLowerCase();
    const list = all.filter((u) => u.username.toLowerCase().includes(q));
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;

    $("#stat-total").textContent = all.length;
    $("#stat-recent").textContent = all.filter((u) => new Date(u.created).getTime() > weekAgo).length;
    $("#stat-active").textContent = all.filter((u) => u.lastLogin).length;
    $("#empty").hidden = list.length > 0;

    const tbody = $("#rows");
    tbody.replaceChildren();

    list.forEach((user, i) => {
      const tr = document.createElement("tr");
      const cell = (text) => {
        const td = document.createElement("td");
        td.textContent = text;
        return td;
      };
      const actions = document.createElement("td");
      actions.className = "right";

      const reset = document.createElement("button");
      reset.className = "link";
      reset.type = "button";
      reset.textContent = "Reset password";
      reset.addEventListener("click", () => resetPassword(user.id));

      const del = document.createElement("button");
      del.className = "link del";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteUser(user.id));

      actions.append(reset, del);
      tr.append(cell(i + 1), cell(user.username), cell(fmtDate(user.created)), cell(fmtDate(user.lastLogin)), actions);
      tbody.append(tr);
    });
  }

  async function resetPassword(id) {
    const user = getUsers().find((u) => u.id === id);
    if (!user) return;
    const value = await ask({
      title: "Reset password",
      text: `Set a new password for ${user.username} (min. 8 characters).`,
      input: true,
      placeholder: "New password",
      confirmText: "Save",
    });
    if (value === null) return;
    if (value.length < 8) return toast("Password must be at least 8 characters.", "error");
    const { salt, hash } = await hashPassword(value);
    const users = getUsers().map((u) => (u.id === id ? { ...u, salt, hash } : u));
    setUsers(users);
    clearFails("user:" + user.username.toLowerCase());
    toast(`Password updated for ${user.username}.`, "ok");
  }

  async function deleteUser(id) {
    const user = getUsers().find((u) => u.id === id);
    if (!user) return;
    const ok = await ask({ title: "Delete user?", text: `Remove ${user.username} permanently?`, confirmText: "Delete" });
    if (!ok) return;
    setUsers(getUsers().filter((u) => u.id !== id));
    if (session.get(KEYS.session) === id) session.del(KEYS.session);
    renderTable();
    toast("User deleted.");
  }

  $("#search").addEventListener("input", renderTable);

  $("#clear").addEventListener("click", async () => {
    if (!getUsers().length) return toast("Nothing to delete.");
    const ok = await ask({ title: "Delete all users?", text: "This removes every saved account from this browser.", confirmText: "Delete all" });
    if (!ok) return;
    setUsers([]);
    session.del(KEYS.session);
    renderTable();
    toast("All users deleted.");
  });

  $("#export").addEventListener("click", () => {
    const rows = getUsers().map(({ username, created, lastLogin }) => ({ username, created, lastLogin }));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "users.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Exported users (no passwords).", "ok");
  });

  /* ---------- start ---------- */
  if (!(window.crypto && crypto.subtle)) $("#crypto-warning").hidden = false;
  const start = location.hash.replace("#", "");
  showTab(["signup", "login", "admin"].includes(start) ? start : "signup");
})();
