const tabs = document.querySelectorAll(".tab");
const panels = {
  groceries: document.getElementById("panel-groceries"),
  meals: document.getElementById("panel-meals"),
  chores: document.getElementById("panel-chores"),
  people: document.getElementById("panel-people"),
};

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
    const meta = [item.assignee, item.due_date].filter(Boolean).join(" · ");
    if (meta) body.appendChild(el("div", "item-meta", meta));
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

const choreForm = document.getElementById("chore-form");
if (choreForm) {
  choreForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("chore-title").value.trim();
    const assignee = document.getElementById("chore-assignee").value.trim();
    const due_date = document.getElementById("chore-due").value;
    if (!title) return;
    try {
      await api("/api/chores", {
        method: "POST",
        body: JSON.stringify({ title, assignee, due_date }),
      });
      choreForm.reset();
      loadChores();
    } catch (err) {
      alert(err.message);
    }
  });
}

Promise.all([loadGroceries(), loadMeals(), loadChores()]).catch(() => {
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
