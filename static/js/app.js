const tabs = document.querySelectorAll(".tab");
const panels = {
  groceries: document.getElementById("panel-groceries"),
  meals: document.getElementById("panel-meals"),
  chores: document.getElementById("panel-chores"),
  reminders: document.getElementById("panel-reminders"),
  people: document.getElementById("panel-people"),
};

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function showTab(name) {
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  Object.entries(panels).forEach(([key, panel]) => {
    if (!panel) return;
    const active = key === name;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function loadGroceries() {
  const list = document.getElementById("grocery-list");
  if (!list) return;
  const data = await api("/api/groceries");
  list.innerHTML = "";
  if (!data.items.length) {
    list.appendChild(el("li", "item-meta", "No groceries yet — add your first item."));
    return;
  }
  for (const item of data.items) {
    const li = el("li", item.done ? "is-done" : "");
    const check = el("button", "item-check", item.done ? "✓" : "○");
    check.type = "button";
    check.addEventListener("click", async () => {
      await api(`/api/groceries/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
      loadGroceries();
    });
    const title = el("span", "item-title", item.title);
    const remove = el("button", "item-remove", "×");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      await api(`/api/groceries/${item.id}`, { method: "DELETE" });
      loadGroceries();
    });
    li.append(check, title, remove);
    list.appendChild(li);
  }
}

const groceryForm = document.getElementById("grocery-form");
if (groceryForm) {
  groceryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("grocery-input");
    const title = input.value.trim();
    if (!title) return;
    input.value = "";
    try {
      await api("/api/groceries", { method: "POST", body: JSON.stringify({ title }) });
      loadGroceries();
    } catch (err) {
      alert(err.message);
    }
  });
}

function weekdayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}

async function loadMeals() {
  const grid = document.getElementById("meals-grid");
  if (!grid) return;
  const data = await api("/api/meals");
  grid.innerHTML = "";
  grid.appendChild(el("div", "meal-head", ""));
  ["Breakfast", "Lunch", "Dinner"].forEach((label) => {
    grid.appendChild(el("div", "meal-head", label));
  });

  const byDate = {};
  for (const slot of data.slots) {
    byDate[slot.date] = byDate[slot.date] || {};
    byDate[slot.date][slot.meal_type] = slot;
  }

  for (const day of data.week) {
    grid.appendChild(el("div", "meal-day", weekdayLabel(day)));
    for (const type of ["breakfast", "lunch", "dinner"]) {
      const slot = byDate[day][type];
      const btn = el("button", "meal-cell");
      btn.type = "button";
      const title = el("strong", "", slot.title || "Add…");
      btn.appendChild(title);
      if (slot.notes) btn.appendChild(el("span", "item-meta", slot.notes));
      btn.addEventListener("click", async () => {
        const nextTitle = prompt("Meal title", slot.title || "");
        if (nextTitle == null) return;
        const nextNotes = prompt("Notes (optional)", slot.notes || "") || "";
        try {
          await api("/api/meals", {
            method: "PUT",
            body: JSON.stringify({
              date: day,
              meal_type: type,
              title: nextTitle.trim(),
              notes: nextNotes.trim(),
            }),
          });
          loadMeals();
        } catch (err) {
          alert(err.message);
        }
      });
      grid.appendChild(btn);
    }
  }
}

async function loadChores() {
  const list = document.getElementById("chore-list");
  if (!list) return;
  const data = await api("/api/chores");
  list.innerHTML = "";
  if (!data.items.length) {
    list.appendChild(el("li", "item-meta", "No chores yet."));
    return;
  }
  for (const item of data.items) {
    const li = el("li", item.done ? "is-done" : "");
    const check = el("button", "item-check", item.done ? "✓" : "○");
    check.type = "button";
    check.addEventListener("click", async () => {
      await api(`/api/chores/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
      loadChores();
    });
    const body = el("div");
    body.appendChild(el("div", "item-title", item.title));
    const bits = [];
    if (item.assignee) bits.push(item.assignee);
    if (item.due_date) bits.push(`Due ${item.due_date}`);
    if (item.recurrence === "daily") bits.push("Repeats daily");
    if (item.recurrence === "weekly") {
      const day =
        item.recurrence_weekday != null ? WEEKDAY_NAMES[item.recurrence_weekday] : "weekly";
      bits.push(`Repeats every ${day}`);
    }
    if (bits.length) body.appendChild(el("div", "item-meta", bits.join(" · ")));
    const remove = el("button", "item-remove", "×");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      await api(`/api/chores/${item.id}`, { method: "DELETE" });
      loadChores();
    });
    li.append(check, body, remove);
    list.appendChild(li);
  }
}

const choreRecurrence = document.getElementById("chore-recurrence");
const choreWeekday = document.getElementById("chore-weekday");
if (choreRecurrence && choreWeekday) {
  choreRecurrence.addEventListener("change", () => {
    choreWeekday.hidden = choreRecurrence.value !== "weekly";
  });
}

const choreForm = document.getElementById("chore-form");
if (choreForm) {
  choreForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("chore-title").value.trim();
    const assignee = document.getElementById("chore-assignee").value.trim();
    const due_date = document.getElementById("chore-due").value;
    const recurrence = document.getElementById("chore-recurrence").value;
    const recurrence_weekday = Number(document.getElementById("chore-weekday").value);
    if (!title) return;
    try {
      await api("/api/chores", {
        method: "POST",
        body: JSON.stringify({
          title,
          assignee,
          due_date,
          recurrence,
          recurrence_weekday: recurrence === "weekly" ? recurrence_weekday : null,
        }),
      });
      choreForm.reset();
      document.getElementById("chore-recurrence").value = "none";
      document.getElementById("chore-weekday").hidden = true;
      loadChores();
    } catch (err) {
      alert(err.message);
    }
  });
}

function notifiedKey(id) {
  const today = new Date().toISOString().slice(0, 10);
  return `hearthlist-notified-${id}-${today}`;
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (_) {
    return null;
  }
}

function updateNotifyStatus() {
  const status = document.getElementById("notify-permission-status");
  if (!status || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    status.textContent = "Popup notifications are on.";
  } else if (Notification.permission === "denied") {
    status.textContent = "Notifications are blocked in browser settings.";
  } else {
    status.textContent = "Your browser will ask for permission once.";
  }
}

async function showBrowserNotification(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await ensureServiceWorker();
  if (reg && reg.active) {
    reg.active.postMessage({ type: "SHOW_REMINDER", title, body, tag });
    return;
  }
  new Notification(title, { body, tag });
}

function showReminderPopup(items) {
  const popup = document.getElementById("reminder-popup");
  const list = document.getElementById("reminder-popup-list");
  const title = document.getElementById("reminder-popup-title");
  if (!popup || !list) return;
  list.innerHTML = "";
  title.textContent = items.length === 1 ? items[0].title : "Today’s reminders";
  for (const item of items) {
    const li = el("li");
    li.textContent = `${item.title} · ${item.notify_time}`;
    list.appendChild(li);
  }
  popup.hidden = false;
}

document.getElementById("reminder-popup-close")?.addEventListener("click", () => {
  const popup = document.getElementById("reminder-popup");
  if (popup) popup.hidden = true;
});

document.getElementById("enable-notifications")?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    alert("This browser doesn’t support notifications.");
    return;
  }
  await ensureServiceWorker();
  const result = await Notification.requestPermission();
  updateNotifyStatus();
  if (result === "granted") {
    await showBrowserNotification(
      "Hearthlist reminders on",
      "We’ll pop up for garbage day and other reminders.",
      "hearthlist-enabled"
    );
    checkDueReminders();
  }
});

async function loadReminders() {
  const list = document.getElementById("reminder-list");
  if (!list) return;
  const data = await api("/api/reminders");
  list.innerHTML = "";
  if (!data.items.length) {
    list.appendChild(el("li", "item-meta", "No reminders yet — try “Garbage day”."));
    return;
  }
  for (const item of data.items) {
    const li = el("li");
    const body = el("div");
    body.appendChild(el("div", "item-title", item.title));
    body.appendChild(
      el(
        "div",
        "item-meta",
        `${WEEKDAY_NAMES[item.weekday]} at ${item.notify_time}${item.is_today ? " · today" : ""}`
      )
    );
    const toggle = el("button", "item-check", item.enabled ? "On" : "Off");
    toggle.type = "button";
    toggle.addEventListener("click", async () => {
      await api(`/api/reminders/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      loadReminders();
    });
    const remove = el("button", "item-remove", "×");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      await api(`/api/reminders/${item.id}`, { method: "DELETE" });
      loadReminders();
    });
    li.append(toggle, body, remove);
    list.appendChild(li);
  }
}

async function checkDueReminders() {
  try {
    const data = await api("/api/reminders");
    const now = new Date();
    const due = [];
    for (const item of data.items || []) {
      if (!item.enabled || !item.is_today) continue;
      const [h, m] = (item.notify_time || "07:00").split(":").map(Number);
      const ready = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
      if (!ready) continue;
      if (localStorage.getItem(notifiedKey(item.id))) continue;
      due.push(item);
      localStorage.setItem(notifiedKey(item.id), "1");
      await showBrowserNotification(
        item.title,
        `Hearthlist reminder · ${WEEKDAY_NAMES[item.weekday]} ${item.notify_time}`,
        `reminder-${item.id}`
      );
    }
    if (due.length) showReminderPopup(due);
  } catch (_) {
    /* ignore when logged out */
  }
}

const reminderForm = document.getElementById("reminder-form");
if (reminderForm) {
  reminderForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("reminder-title").value.trim();
    const weekday = Number(document.getElementById("reminder-weekday").value);
    const notify_time = document.getElementById("reminder-time").value || "07:00";
    if (!title) return;
    try {
      await api("/api/reminders", {
        method: "POST",
        body: JSON.stringify({ title, weekday, notify_time }),
      });
      reminderForm.reset();
      document.getElementById("reminder-time").value = "07:00";
      loadReminders();
      checkDueReminders();
    } catch (err) {
      alert(err.message);
    }
  });
}

Promise.all([loadGroceries(), loadMeals(), loadChores(), loadReminders()])
  .then(() => {
    updateNotifyStatus();
    ensureServiceWorker();
    checkDueReminders();
    setInterval(checkDueReminders, 60 * 1000);
  })
  .catch(() => {
    /* panels may not exist on other pages */
  });

const inviteCard = document.getElementById("invite-card");
const inviteStatus = document.getElementById("invite-status");
const inviteMessage = document.getElementById("invite-message");

function invitePayload() {
  if (!inviteCard) return null;
  return {
    code: inviteCard.dataset.inviteCode || "",
    url: inviteCard.dataset.inviteUrl || "",
    name: inviteCard.dataset.householdName || "our household",
  };
}

function buildInviteMessage() {
  const data = invitePayload();
  if (!data) return "";
  return [
    `Want to share groceries, meals, and chores with me on Hearthlist?`,
    ``,
    `Join “${data.name}” here:`,
    data.url,
    ``,
    `Or use invite code: ${data.code}`,
  ].join("\n");
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function setInviteStatus(text) {
  if (inviteStatus) inviteStatus.textContent = text;
}

if (inviteMessage) {
  inviteMessage.value = buildInviteMessage();
}

document.getElementById("copy-invite-link")?.addEventListener("click", async () => {
  const data = invitePayload();
  if (!data) return;
  await copyText(data.url);
  setInviteStatus("Invite link copied.");
});

document.getElementById("copy-invite-code")?.addEventListener("click", async () => {
  const data = invitePayload();
  if (!data) return;
  await copyText(data.code);
  setInviteStatus("Invite code copied.");
});

document.getElementById("copy-invite-message")?.addEventListener("click", async () => {
  const text = buildInviteMessage();
  await copyText(text);
  setInviteStatus("Message copied — paste it into a text or email.");
});

document.getElementById("share-invite")?.addEventListener("click", async () => {
  const data = invitePayload();
  if (!data) return;
  const text = buildInviteMessage();
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Join my Hearthlist household",
        text,
        url: data.url,
      });
      setInviteStatus("Shared.");
      return;
    } catch (_) {
      /* user canceled or share failed — fall through */
    }
  }
  await copyText(text);
  setInviteStatus("Share isn’t available here — message copied instead.");
});

function openInviteTab() {
  showTab("people");
  inviteCard?.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("invite-open")?.addEventListener("click", openInviteTab);
document.getElementById("invite-open-banner")?.addEventListener("click", openInviteTab);

if (new URLSearchParams(window.location.search).get("invite") === "1") {
  openInviteTab();
}
