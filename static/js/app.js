const tabs = document.querySelectorAll(".tab");
const panels = {
  groceries: document.getElementById("panel-groceries"),
  meals: document.getElementById("panel-meals"),
  chores: document.getElementById("panel-chores"),
  reminders: document.getElementById("panel-reminders"),
  people: document.getElementById("panel-people"),
};

const TAB_HERO_IMAGES = {
  groceries:
    "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1600&h=480&q=80",
  meals:
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1600&h=480&q=80",
  chores:
    "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1600&h=480&q=80",
  reminders:
    "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=1600&h=480&q=80",
  people:
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&h=480&q=80",
};

function setTabHero(name) {
  const img = document.getElementById("app-hero-image");
  const next = TAB_HERO_IMAGES[name];
  if (!img || !next || img.dataset.tab === name) return;
  img.classList.add("is-fading");
  window.setTimeout(() => {
    img.src = next;
    img.dataset.tab = name;
    img.classList.remove("is-fading");
  }, 140);
}

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
  setTabHero(name);
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const CHORE_MOTIVATORS = [
  "Small jobs, big helpers.",
  "Done is a superpower.",
  "Teamwork makes the chores fly.",
  "Check it off — feel the win.",
  "Helping hands make a happy home.",
  "One chore at a time.",
  "Proud work starts with showing up.",
  "Little efforts add up fast.",
  "You make this house shine.",
  "Finish strong, fridge-chart champs.",
  "Kindness looks like a finished chore.",
  "Today’s helpers, tomorrow’s heroes.",
  "Put it back where it belongs.",
  "A tidy space is a calm place.",
  "We did it — together.",
  "Keep going. You’ve got this.",
];

function pickChoreMotivator() {
  return CHORE_MOTIVATORS[Math.floor(Math.random() * CHORE_MOTIVATORS.length)];
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

const MEAL_TYPE_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

let mealEditorState = null;

function mealEditorEls() {
  return {
    root: document.getElementById("meal-editor"),
    form: document.getElementById("meal-editor-form"),
    meta: document.getElementById("meal-editor-meta"),
    title: document.getElementById("meal-editor-title"),
    url: document.getElementById("meal-editor-url"),
    openLink: document.getElementById("meal-editor-open-link"),
    list: document.getElementById("meal-ingredient-list"),
    status: document.getElementById("meal-editor-status"),
  };
}

function setMealEditorStatus(message) {
  const { status } = mealEditorEls();
  if (status) status.textContent = message || "";
}

function syncMealOpenLink() {
  const { url, openLink } = mealEditorEls();
  if (!url || !openLink) return;
  const value = url.value.trim();
  if (value) {
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    openLink.href = href;
    openLink.hidden = false;
  } else {
    openLink.hidden = true;
    openLink.removeAttribute("href");
  }
}

function collectMealIngredients() {
  const { list } = mealEditorEls();
  if (!list) return [];
  const items = [];
  for (const row of list.querySelectorAll(".meal-ingredient-row")) {
    const name = row.querySelector(".ing-name")?.value.trim() || "";
    const qty = row.querySelector(".ing-qty")?.value.trim() || "";
    if (name) items.push({ name, qty });
  }
  return items;
}

function addMealIngredientRow(item = { name: "", qty: "" }, checked = true) {
  const { list } = mealEditorEls();
  if (!list) return;
  const li = el("li", "meal-ingredient-row");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = checked;
  check.className = "ing-check";
  check.title = "Add to groceries";
  const name = document.createElement("input");
  name.type = "text";
  name.className = "ing-name";
  name.placeholder = "Ingredient";
  name.maxLength = 120;
  name.value = item.name || "";
  const qty = document.createElement("input");
  qty.type = "text";
  qty.className = "ing-qty qty";
  qty.placeholder = "Qty";
  qty.maxLength = 40;
  qty.value = item.qty || "";
  const remove = el("button", "item-remove", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", "Remove ingredient");
  remove.addEventListener("click", () => li.remove());
  li.append(check, name, qty, remove);
  list.appendChild(li);
  if (!item.name) name.focus();
}

function closeMealEditor() {
  const { root, form } = mealEditorEls();
  if (root) root.hidden = true;
  mealEditorState = null;
  setMealEditorStatus("");
  if (form) form.reset();
}

function openMealEditor(slot) {
  const ui = mealEditorEls();
  if (!ui.root) return;
  mealEditorState = {
    date: slot.date,
    meal_type: slot.meal_type,
  };
  const dayLabel = weekdayLabel(slot.date);
  ui.meta.textContent = `${dayLabel} · ${MEAL_TYPE_LABELS[slot.meal_type] || slot.meal_type}`;
  ui.title.value = slot.title || "";
  ui.url.value = slot.recipe_url || "";
  ui.list.innerHTML = "";
  const ingredients = Array.isArray(slot.ingredients) ? slot.ingredients : [];
  if (ingredients.length) {
    for (const item of ingredients) addMealIngredientRow(item, true);
  } else {
    addMealIngredientRow({ name: "", qty: "" }, true);
  }
  syncMealOpenLink();
  setMealEditorStatus("");
  ui.root.hidden = false;
  ui.title.focus();
}

async function saveMealEditor() {
  if (!mealEditorState) return;
  const ui = mealEditorEls();
  const title = ui.title.value.trim();
  const recipe_url = ui.url.value.trim();
  const ingredients = collectMealIngredients();
  await saveMealSlot(
    {
      date: mealEditorState.date,
      meal_type: mealEditorState.meal_type,
      title,
      recipe_url,
      ingredients,
    },
    { title, recipe_url, ingredients }
  );
  closeMealEditor();
  loadMeals();
}

async function addCheckedIngredientsToGroceries() {
  const { list } = mealEditorEls();
  if (!list) return;
  const names = [];
  for (const row of list.querySelectorAll(".meal-ingredient-row")) {
    const checked = row.querySelector(".ing-check")?.checked;
    const name = row.querySelector(".ing-name")?.value.trim() || "";
    const qty = row.querySelector(".ing-qty")?.value.trim() || "";
    if (checked && name) {
      names.push(qty ? `${name} (${qty})` : name);
    }
  }
  if (!names.length) {
    setMealEditorStatus("Check at least one ingredient first.");
    return;
  }
  // Save current meal so ingredients aren’t lost, then push to groceries.
  if (mealEditorState) {
    await api("/api/meals", {
      method: "PUT",
      body: JSON.stringify({
        date: mealEditorState.date,
        meal_type: mealEditorState.meal_type,
        title: mealEditorEls().title.value.trim(),
        recipe_url: mealEditorEls().url.value.trim(),
        ingredients: collectMealIngredients(),
        notes: "",
      }),
    });
  }
  const result = await api("/api/meals/to-groceries", {
    method: "POST",
    body: JSON.stringify({ names }),
  });
  const added = (result.added || []).length;
  const skipped = (result.skipped || []).length;
  setMealEditorStatus(
    added
      ? `Added ${added} to groceries${skipped ? ` · ${skipped} already on the list` : ""}.`
      : skipped
        ? "Those items are already on your grocery list."
        : "Nothing added."
  );
  if (typeof loadGroceries === "function") loadGroceries();
  loadMeals();
}

async function saveMealSlot(slot, patch = {}) {
  const title = patch.title !== undefined ? patch.title : slot.title || "";
  const recipe_url = patch.recipe_url !== undefined ? patch.recipe_url : slot.recipe_url || "";
  const ingredients =
    patch.ingredients !== undefined ? patch.ingredients : slot.ingredients || [];
  await api("/api/meals", {
    method: "PUT",
    body: JSON.stringify({
      date: slot.date,
      meal_type: slot.meal_type,
      title: (title || "").trim(),
      recipe_url: (recipe_url || "").trim(),
      ingredients: Array.isArray(ingredients) ? ingredients : [],
      notes: "",
    }),
  });
  slot.title = (title || "").trim();
  slot.recipe_url = (recipe_url || "").trim();
  slot.ingredients = Array.isArray(ingredients) ? ingredients : [];
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
      const slot = byDate[day]?.[type] || {
        date: day,
        meal_type: type,
        title: "",
        recipe_url: "",
        ingredients: [],
      };
      byDate[day] = byDate[day] || {};
      byDate[day][type] = slot;

      const cell = el("div", "meal-cell");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "meal-cell-input";
      input.maxLength = 200;
      input.placeholder = "Add meal…";
      input.value = slot.title || "";
      input.setAttribute(
        "aria-label",
        `${weekdayLabel(day)} ${MEAL_TYPE_LABELS[type] || type}`
      );

      let lastSaved = slot.title || "";
      const persistTitle = async () => {
        const next = input.value.trim();
        if (next === lastSaved) return;
        input.classList.add("is-saving");
        try {
          await saveMealSlot(slot, { title: next });
          lastSaved = next;
          input.value = next;
          refreshMealCellCues(cell, slot);
        } catch (err) {
          input.value = lastSaved;
          alert(err.message || "Could not save meal.");
        } finally {
          input.classList.remove("is-saving");
        }
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
        if (e.key === "Escape") {
          input.value = lastSaved;
          input.blur();
        }
      });
      input.addEventListener("blur", () => {
        persistTitle();
      });

      const actions = el("div", "meal-cell-actions");
      const details = el("button", "meal-cell-details", "Recipe");
      details.type = "button";
      details.title = "Edit recipe link and ingredients";
      details.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMealEditor(slot);
      });
      actions.appendChild(details);

      cell.appendChild(input);
      cell.appendChild(actions);
      refreshMealCellCues(cell, slot);
      grid.appendChild(cell);
    }
  }
}

function refreshMealCellCues(cell, slot) {
  cell.querySelector(".meal-cell-cues")?.remove();
  const cues = el("div", "meal-cell-cues");
  if (slot.recipe_url) cues.appendChild(el("span", "meal-cue", "Link"));
  const ingCount = Array.isArray(slot.ingredients) ? slot.ingredients.length : 0;
  if (ingCount) cues.appendChild(el("span", "meal-cue", `${ingCount} items`));
  if (cues.childNodes.length) {
    const actions = cell.querySelector(".meal-cell-actions");
    if (actions) cell.insertBefore(cues, actions);
    else cell.appendChild(cues);
  }
}

document.getElementById("meal-editor-cancel")?.addEventListener("click", closeMealEditor);
document.getElementById("meal-add-ingredient")?.addEventListener("click", () => {
  addMealIngredientRow({ name: "", qty: "" }, true);
});
document.getElementById("meal-editor-url")?.addEventListener("input", syncMealOpenLink);
document.getElementById("meal-to-groceries")?.addEventListener("click", async () => {
  try {
    await addCheckedIngredientsToGroceries();
  } catch (err) {
    setMealEditorStatus(err.message || "Could not update groceries.");
  }
});
document.getElementById("meal-editor-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await saveMealEditor();
  } catch (err) {
    setMealEditorStatus(err.message || "Could not save meal.");
  }
});
document.getElementById("meal-editor")?.addEventListener("click", (e) => {
  if (e.target.id === "meal-editor") closeMealEditor();
});

async function loadChores() {
  const groupsEl = document.getElementById("chore-groups");
  if (!groupsEl) return;
  const data = await api("/api/chores");
  window.__hearthlistChores = data.items || [];
  groupsEl.innerHTML = "";

  const items = data.items || [];
  if (!items.length) {
    groupsEl.appendChild(el("p", "item-meta", "No chores yet."));
    updateAssigneeSuggestions([]);
    return;
  }

  const byName = new Map();
  for (const item of items) {
    const name = (item.assignee || "").trim() || "Unassigned";
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(item);
  }

  const names = [...byName.keys()].sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  updateAssigneeSuggestions(names.filter((n) => n !== "Unassigned"));

  for (const name of names) {
    const groupItems = byName.get(name);
    const openCount = groupItems.filter((i) => !i.done).length;
    const section = el("section", "chore-group");
    section.dataset.assignee = name;
    const colorIdx = assigneeColorIndex(name);
    section.classList.add(`chore-color-${colorIdx}`);

    const head = el("div", "chore-group-head");
    const titleWrap = el("div", "chore-group-title");
    titleWrap.appendChild(el("span", "chore-group-icon", chorePersonIcon(name)));
    titleWrap.appendChild(el("h3", "chore-group-name", name));
    head.appendChild(titleWrap);
    head.appendChild(
      el("span", "chore-group-count", openCount ? `${openCount} open` : "All done")
    );
    section.appendChild(head);

    const list = el("ul", "item-list chore-group-list");
    for (const item of groupItems) {
      list.appendChild(buildChoreRow(item));
    }
    section.appendChild(list);
    groupsEl.appendChild(section);
  }
}

function assigneeColorIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i) * (i + 1)) % 6;
  return hash;
}

function chorePersonIcon(name) {
  const icons = ["⭐", "🌈", "🍀", "🌞", "🎈", "🧩"];
  return icons[assigneeColorIndex(name)];
}

function choreTaskIcon(title) {
  const t = (title || "").toLowerCase();
  if (/trash|garbage|recycle|bin/.test(t)) return "🗑️";
  if (/dish|sink|kitchen/.test(t)) return "🍽️";
  if (/vacuum|sweep|mop|floor|dust/.test(t)) return "🧹";
  if (/bed|room/.test(t)) return "🛏️";
  if (/laundry|wash|clothes/.test(t)) return "👕";
  if (/dog|cat|pet|feed/.test(t)) return "🐾";
  if (/lawn|yard|plant|garden/.test(t)) return "🌿";
  if (/homework|study|read/.test(t)) return "📚";
  return "✓";
}

function buildChoreRow(item) {
  const li = el("li", item.done ? "is-done" : "");
  const check = el("button", "item-check no-print", item.done ? "✓" : "○");
  check.type = "button";
  check.addEventListener("click", async () => {
    await api(`/api/chores/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: !item.done }),
    });
    loadChores();
  });

  const printBox = el("span", "chore-print-box print-only", "");
  printBox.setAttribute("aria-hidden", "true");

  const body = el("div");
  const titleLine = el("div", "item-title");
  titleLine.appendChild(el("span", "chore-task-icon", choreTaskIcon(item.title)));
  titleLine.appendChild(document.createTextNode(` ${item.title}`));
  body.appendChild(titleLine);
  const bits = [];
  if (item.due_date) bits.push(`Due ${item.due_date}`);
  if (item.recurrence === "daily") bits.push("Every day");
  if (item.recurrence === "weekly") {
    const day =
      item.recurrence_weekday != null ? WEEKDAY_NAMES[item.recurrence_weekday] : "week";
    bits.push(`Every ${day}`);
  }
  if (item.recurrence === "monthly") bits.push("Every month");
  if (bits.length) body.appendChild(el("div", "item-meta", bits.join(" · ")));

  const remove = el("button", "item-remove no-print", "×");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    await api(`/api/chores/${item.id}`, { method: "DELETE" });
    loadChores();
  });

  li.append(check, printBox, body, remove);
  return li;
}

function updateAssigneeSuggestions(names) {
  const list = document.getElementById("chore-assignee-suggestions");
  if (!list) return;
  list.innerHTML = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    list.appendChild(opt);
  }
}

function householdNameForPrint() {
  return (
    document.getElementById("invite-card")?.dataset.householdName ||
    document.querySelector(".eyebrow")?.textContent?.trim() ||
    "Our home"
  );
}

function monthMatrix(year, monthIndex) {
  // Monday-first calendar grid
  const first = new Date(year, monthIndex, 1);
  const startOffset = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function localISODate(dayDate) {
  const y = dayDate.getFullYear();
  const m = String(dayDate.getMonth() + 1).padStart(2, "0");
  const d = String(dayDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function choresForCalendarDay(items, dayDate) {
  const iso = localISODate(dayDate);
  const weekday = (dayDate.getDay() + 6) % 7; // Mon=0
  const dayNum = dayDate.getDate();
  const matches = [];
  for (const item of items) {
    const rec = item.recurrence || "none";
    if (rec === "daily") {
      matches.push(item);
      continue;
    }
    if (rec === "weekly") {
      const target =
        item.recurrence_weekday != null ? Number(item.recurrence_weekday) : weekday;
      if (target === weekday) matches.push(item);
      continue;
    }
    if (rec === "monthly") {
      let dueDay = dayNum;
      if (item.due_date) {
        const parts = String(item.due_date).split("-");
        dueDay = Number(parts[2]) || dayNum;
      }
      if (dueDay === dayNum) matches.push(item);
      continue;
    }
    if (item.due_date === iso) matches.push(item);
  }
  return matches;
}

function buildPrintCalendar(items) {
  const root = document.getElementById("chore-print-calendar");
  if (!root) return;
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const monthName = now.toLocaleString(undefined, { month: "long", year: "numeric" });
  const cells = monthMatrix(year, monthIndex);

  root.innerHTML = "";
  root.hidden = false;

  const quote = pickChoreMotivator();
  const household = householdNameForPrint();

  const header = el("header", "chore-cal-header");
  header.appendChild(el("p", "chore-cal-kicker", household));
  header.appendChild(el("h2", "chore-cal-title", `${monthName} chore calendar`));
  header.appendChild(el("p", "chore-cal-sub", "Check off each day · hang on the fridge"));
  header.appendChild(el("p", "chore-cal-quote", quote));
  root.appendChild(header);

  // Legend by person
  const people = [
    ...new Set(items.map((i) => (i.assignee || "").trim() || "Unassigned")),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const legend = el("div", "chore-cal-legend");
  for (const name of people) {
    const chip = el("span", `chore-cal-chip chore-color-${assigneeColorIndex(name)}`);
    chip.appendChild(el("span", "chore-group-icon", chorePersonIcon(name)));
    chip.appendChild(document.createTextNode(` ${name}`));
    legend.appendChild(chip);
  }
  root.appendChild(legend);

  const grid = el("div", "chore-cal-grid");
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((d) => {
    grid.appendChild(el("div", "chore-cal-dow", d));
  });

  for (const day of cells) {
    const cell = el("div", day ? "chore-cal-day" : "chore-cal-day is-empty");
    if (!day) {
      grid.appendChild(cell);
      continue;
    }
    const num = el("div", "chore-cal-daynum", String(day.getDate()));
    cell.appendChild(num);
    const allDayItems = choresForCalendarDay(items, day);
    const dayItems = allDayItems.slice(0, 3);
    for (const item of dayItems) {
      const who = (item.assignee || "").trim() || "Unassigned";
      const row = el(
        "div",
        `chore-cal-entry chore-color-${assigneeColorIndex(who)}`
      );
      row.appendChild(el("span", "chore-cal-check", ""));
      row.appendChild(
        el("span", "chore-cal-entry-text", `${choreTaskIcon(item.title)} ${item.title}`)
      );
      cell.appendChild(row);
    }
    if (allDayItems.length > 3) {
      cell.appendChild(el("div", "chore-cal-more", "+ more"));
    }
    grid.appendChild(cell);
  }
  const weekRows = Math.max(4, Math.ceil(cells.length / 7));
  grid.style.setProperty("--week-rows", String(weekRows));
  root.appendChild(grid);

  const footer = el("footer", "chore-cal-footer");
  footer.appendChild(el("span", "chore-cal-footer-home", household));
  footer.appendChild(el("span", "chore-cal-footer-sep", " · "));
  footer.appendChild(el("span", "chore-cal-footer-quote", quote));
  root.appendChild(footer);
}

function printChoreChart() {
  const items = window.__hearthlistChores || [];
  if (!items.length) {
    alert("Add a few chores (with names in Who?) before printing.");
    return;
  }
  buildPrintCalendar(items);
  document.body.classList.add("printing-chores");
  const title = document.title;
  document.title = `${householdNameForPrint()} chore calendar`;
  const cleanup = () => {
    document.body.classList.remove("printing-chores");
    document.title = title;
    const cal = document.getElementById("chore-print-calendar");
    if (cal) {
      cal.hidden = true;
      cal.innerHTML = "";
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 1500);
}

document.getElementById("print-chores")?.addEventListener("click", printChoreChart);

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

function supportsSystemNotifications() {
  return "Notification" in window;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function updateNotifyStatus() {
  const status = document.getElementById("notify-permission-status");
  const button = document.getElementById("enable-notifications");
  if (!status) return;

  if (!supportsSystemNotifications()) {
    status.textContent = isIosDevice()
      ? "On iPhone, Safari can’t do lock-screen alerts from a normal tab. Reminder popups still work inside Hearthlist while the app is open. For system alerts: Share → Add to Home Screen, then open Hearthlist from that icon (iOS 16.4+)."
      : "This browser can’t show lock-screen notifications. Reminder popups still work inside Hearthlist while the page is open.";
    if (button) button.textContent = "Show a test popup";
    return;
  }

  if (Notification.permission === "granted") {
    status.textContent = "System notifications are on. You’ll also get an in-app popup.";
    if (button) button.textContent = "Send test notification";
  } else if (Notification.permission === "denied") {
    status.textContent = "Notifications are blocked in browser settings. In-app popups still work while Hearthlist is open.";
    if (button) button.textContent = "Show a test popup";
  } else {
    status.textContent = "Allow notifications for lock-screen alerts, or rely on in-app popups while Hearthlist is open.";
    if (button) button.textContent = "Turn on reminder popups";
  }
}

async function showBrowserNotification(title, body, tag) {
  if (!supportsSystemNotifications() || Notification.permission !== "granted") return;
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
  localStorage.setItem("hearthlist-reminders-enabled", "1");

  // Always prove in-app popup works (especially on iPhone Safari).
  showReminderPopup([
    { title: "Reminder popups are ready", notify_time: "now" },
  ]);

  if (!supportsSystemNotifications()) {
    updateNotifyStatus();
    return;
  }

  await ensureServiceWorker();
  if (Notification.permission !== "granted") {
    await Notification.requestPermission();
  }
  updateNotifyStatus();
  if (Notification.permission === "granted") {
    await showBrowserNotification(
      "Hearthlist reminders on",
      "We’ll also pop up inside the app for garbage day and other reminders.",
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
