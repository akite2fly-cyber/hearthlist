const tabs = document.querySelectorAll(".tab");
const panels = {
  groceries: document.getElementById("panel-groceries"),
  meals: document.getElementById("panel-meals"),
  chores: document.getElementById("panel-chores"),
  schedule: document.getElementById("panel-schedule"),
  reminders: document.getElementById("panel-reminders"),
  people: document.getElementById("panel-people"),
};

const TAB_HERO_IMAGES = {
  groceries:
    "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1500&h=500&q=80",
  meals:
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1500&h=500&q=80",
  chores:
    "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=1500&h=500&q=80",
  schedule:
    "https://images.unsplash.com/photo-1434626881859-194d67b2b86f?auto=format&fit=crop&w=1500&h=500&q=80",
  reminders:
    "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=1500&h=500&q=80",
  people:
    "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1500&h=500&q=80",
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
  window.__hearthlistGroceries = data.items || [];
  list.innerHTML = "";
  const openCount = (data.items || []).filter((i) => !i.done).length;
  const countEl = document.getElementById("grocery-open-count");
  if (countEl) {
    countEl.textContent = openCount === 1 ? "1 open" : `${openCount} open`;
  }
  if (!data.items.length) {
    list.appendChild(el("li", "item-meta grocery-empty", "No groceries yet — add your first item."));
    return;
  }
  for (const item of data.items) {
    const li = el("li", item.done ? "grocery-row is-done" : "grocery-row");
    const check = el("button", "item-check grocery-check", item.done ? "✓" : "");
    check.type = "button";
    check.setAttribute("aria-label", item.done ? "Mark not done" : "Mark done");
    check.addEventListener("click", async () => {
      await api(`/api/groceries/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
      loadGroceries();
    });
    const icon = el("span", "grocery-row-icon", groceryFoodIcon(item.title));
    icon.setAttribute("aria-hidden", "true");
    const body = el("div", "grocery-row-body");
    body.appendChild(el("span", "item-title", item.title));
    body.appendChild(el("span", "grocery-row-aisle", groceryAisle(item.title)));
    const remove = el("button", "item-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove item");
    remove.addEventListener("click", async () => {
      await api(`/api/groceries/${item.id}`, { method: "DELETE" });
      loadGroceries();
    });
    li.append(check, icon, body, remove);
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

const GROCERY_TAGLINES = [
  "Gather the good things.",
  "Fresh finds, happy cart.",
  "Shop once. Eat well.",
  "Bring home the flavor.",
  "A list worth tasting.",
];

function pickGroceryTagline() {
  return GROCERY_TAGLINES[Math.floor(Math.random() * GROCERY_TAGLINES.length)];
}

function groceryFoodIcon(title) {
  const t = (title || "").toLowerCase();
  if (/milk|cheese|yogurt|butter|cream|egg/.test(t)) return "🥛";
  if (/bread|bagel|bun|tortilla|bakery/.test(t)) return "🍞";
  if (/apple|berry|berries|banana|fruit|orange|grape|lemon|lime|peach|pear|mango|melon/.test(t)) return "🍓";
  if (/lettuce|salad|spinach|broccoli|carrot|veg|onion|tomato|potato|garlic|mushroom|pepper|cucumber|celery|zucchini|avocado|kale|cabbage|corn|asparagus|produce/.test(t)) return "🥬";
  if (/chicken|beef|pork|turkey|fish|salmon|meat|bacon/.test(t)) return "🍗";
  if (/coffee|tea|juice|soda|water|wine/.test(t)) return "☕";
  if (/rice|pasta|flour|oil|sauce|spice|cereal|oat|bean|can/.test(t)) return "🫙";
  if (/ice|frozen|pizza/.test(t)) return "🧊";
  if (/snack|chip|cookie|chocolate|candy/.test(t)) return "🍪";
  return "🛒";
}

function groceryAisle(title) {
  const t = (title || "").toLowerCase();
  if (/milk|cheese|yogurt|butter|cream|egg/.test(t)) return "Dairy & eggs";
  if (/bread|bagel|bun|tortilla/.test(t)) return "Bakery";
  if (/apple|berry|berries|banana|fruit|orange|grape|lemon|lime|peach|pear|mango|melon|lettuce|salad|spinach|broccoli|carrot|veg|onion|tomato|potato|garlic|herb|mushroom|pepper|cucumber|celery|zucchini|avocado|kale|cabbage|corn|asparagus|produce/.test(t))
    return "Produce";
  if (/chicken|beef|pork|turkey|fish|salmon|meat|bacon/.test(t)) return "Meat & fish";
  if (/ice|frozen|pizza/.test(t)) return "Frozen";
  if (/coffee|tea|juice|soda|water|wine/.test(t)) return "Drinks";
  if (/snack|chip|cookie|chocolate|candy/.test(t)) return "Snacks";
  return "Pantry & more";
}

const GROCERY_AISLE_ORDER = [
  "Produce",
  "Dairy & eggs",
  "Bakery",
  "Meat & fish",
  "Pantry & more",
  "Frozen",
  "Drinks",
  "Snacks",
];

function buildPrintGroceryList(items) {
  const root = document.getElementById("grocery-print-sheet");
  if (!root) return;
  const openItems = items.filter((i) => !i.done);
  const source = openItems.length ? openItems : items;
  const household = householdNameForPrint();
  const tagline = pickGroceryTagline();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  root.innerHTML = "";
  root.hidden = false;

  const sheet = el("div", "grocery-sheet");

  const layout = el("div", "grocery-sheet-layout");

  const aside = el("aside", "grocery-sheet-aside");
  aside.appendChild(el("p", "grocery-sheet-brand", "Hearthlist"));
  aside.appendChild(el("p", "grocery-sheet-kicker", household));
  aside.appendChild(el("h2", "grocery-sheet-title", "Market list"));
  aside.appendChild(el("p", "grocery-sheet-tagline", tagline));
  aside.appendChild(el("p", "grocery-sheet-date", today));
  const stats = el("div", "grocery-sheet-stats");
  stats.appendChild(el("span", "grocery-sheet-stat-num", String(source.length)));
  stats.appendChild(
    el("span", "grocery-sheet-stat-label", source.length === 1 ? "item to gather" : "items to gather")
  );
  aside.appendChild(stats);
  aside.appendChild(el("p", "grocery-sheet-aside-note", "Check things off as you go."));
  layout.appendChild(aside);

  const byAisle = {};
  for (const item of source) {
    const aisle = groceryAisle(item.title);
    byAisle[aisle] = byAisle[aisle] || [];
    byAisle[aisle].push(item);
  }
  const aisles = GROCERY_AISLE_ORDER.filter((name) => byAisle[name]?.length);
  for (const name of Object.keys(byAisle)) {
    if (!aisles.includes(name)) aisles.push(name);
  }

  const main = el("div", "grocery-sheet-main");
  main.appendChild(el("p", "grocery-sheet-main-label", "Your list"));
  const body = el("div", "grocery-sheet-body");
  for (const aisle of aisles) {
    const section = el("section", "grocery-sheet-aisle");
    const aisleHead = el("div", "grocery-sheet-aisle-head");
    aisleHead.appendChild(el("span", "grocery-sheet-aisle-mark", ""));
    aisleHead.appendChild(el("h3", "grocery-sheet-aisle-title", aisle));
    aisleHead.appendChild(
      el("span", "grocery-sheet-aisle-count", String(byAisle[aisle].length))
    );
    section.appendChild(aisleHead);
    const grid = el("div", "grocery-sheet-grid");
    for (const item of byAisle[aisle]) {
      const row = el("div", item.done ? "grocery-sheet-item is-done" : "grocery-sheet-item");
      row.appendChild(el("span", "grocery-sheet-check", ""));
      row.appendChild(el("span", "grocery-sheet-icon", groceryFoodIcon(item.title)));
      row.appendChild(el("span", "grocery-sheet-name", item.title));
      grid.appendChild(row);
    }
    section.appendChild(grid);
    body.appendChild(section);
  }
  main.appendChild(body);
  layout.appendChild(main);
  sheet.appendChild(layout);

  const footer = el("footer", "grocery-sheet-footer");
  footer.appendChild(el("span", "", "Happy shopping"));
  footer.appendChild(el("span", "grocery-sheet-footer-dot", "·"));
  footer.appendChild(el("span", "", household));
  footer.appendChild(el("span", "grocery-sheet-footer-dot", "·"));
  footer.appendChild(el("span", "", "Bring home the good stuff"));
  sheet.appendChild(footer);
  root.appendChild(sheet);
}

function printGroceryList() {
  const items = window.__hearthlistGroceries || [];
  if (!items.length) {
    alert("Add a few grocery items before printing.");
    return;
  }
  buildPrintGroceryList(items);
  document.body.classList.add("printing-groceries");
  const title = document.title;
  document.title = `${householdNameForPrint()} market list`;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("printing-groceries");
    document.title = title;
    const sheet = document.getElementById("grocery-print-sheet");
    if (sheet) {
      sheet.hidden = true;
      sheet.innerHTML = "";
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
      setTimeout(cleanup, 60000);
    });
  });
}

document.getElementById("print-groceries")?.addEventListener("click", printGroceryList);

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

function normalizeRecipeUrl(value) {
  const v = (value || "").trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

async function saveMealEditor() {
  if (!mealEditorState) return;
  const ui = mealEditorEls();
  const title = ui.title.value.trim();
  const recipe_url = normalizeRecipeUrl(ui.url.value);
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
        recipe_url: normalizeRecipeUrl(mealEditorEls().url.value),
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

function weekdayParts(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    short: date.toLocaleDateString(undefined, { weekday: "short" }),
    long: date.toLocaleDateString(undefined, { weekday: "long" }),
    dayNum: String(date.getDate()),
  };
}

async function loadMeals() {
  const grid = document.getElementById("meals-grid");
  if (!grid) return;
  const openDay =
    grid.querySelector(".meal-day-btn.is-open")?.dataset?.date ||
    grid.querySelector(".meal-day-panel.is-open")?.dataset?.date ||
    "";
  const data = await api("/api/meals");
  grid.className = "meals-week";
  grid.innerHTML = "";

  const byDate = {};
  for (const slot of data.slots) {
    byDate[slot.date] = byDate[slot.date] || {};
    byDate[slot.date][slot.meal_type] = slot;
  }

  const strip = el("div", "meals-week-strip");
  const journal = el("div", "meals-week-journal");
  grid.appendChild(strip);
  grid.appendChild(journal);

  const setOpenDay = (date) => {
    strip.querySelectorAll(".meal-day-btn").forEach((btn) => {
      const on = btn.dataset.date === date;
      btn.classList.toggle("is-open", on);
      btn.setAttribute("aria-expanded", on ? "true" : "false");
    });
    journal.querySelectorAll(".meal-day-panel").forEach((panel) => {
      const on = panel.dataset.date === date;
      panel.classList.toggle("is-open", on);
      panel.hidden = !on;
    });
    if (date) {
      requestAnimationFrame(() => {
        journal
          .querySelector(`.meal-day-panel[data-date="${date}"] .meal-cell-input`)
          ?.focus();
      });
    }
  };

  data.week.forEach((day, index) => {
    const tone = index % 7;
    const parts = weekdayParts(day);
    const planned = [];

    const btn = el("button", `meal-day-btn meal-day-tone-${tone}`, "");
    btn.type = "button";
    btn.dataset.date = day;
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", `Open ${parts.long} meals`);
    btn.appendChild(el("span", "meal-day-kicker", parts.short));
    btn.appendChild(el("span", "meal-day-num", parts.dayNum));
    btn.appendChild(el("span", "meal-day-name", parts.long));
    const preview = el("span", "meal-day-preview", "");
    btn.appendChild(preview);
    const count = el("span", "meal-day-count", "0");
    btn.appendChild(count);

    const panel = el("section", `meal-day-panel meal-day-tone-${tone}`);
    panel.dataset.date = day;
    panel.hidden = true;
    const panelHead = el("div", "meal-day-panel-head");
    panelHead.appendChild(el("h3", "meal-day-panel-title", parts.long));
    panelHead.appendChild(
      el("p", "meal-day-panel-note", "Breakfast, lunch, and dinner for this day")
    );
    panel.appendChild(panelHead);
    const slotsWrap = el("div", "meal-day-slots");

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
      if (slot.title) planned.push(slot.title);

      const cell = el("div", "meal-cell");
      const typeLabel = el("div", "meal-cell-type", MEAL_TYPE_LABELS[type] || type);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "meal-cell-input";
      input.maxLength = 200;
      input.placeholder = "Add meal…";
      input.value = slot.title || "";
      input.setAttribute("aria-label", `${parts.long} ${MEAL_TYPE_LABELS[type] || type}`);

      let lastSaved = slot.title || "";
      const refreshDayPreview = () => {
        const titles = ["breakfast", "lunch", "dinner"]
          .map((t) => (byDate[day]?.[t]?.title || "").trim())
          .filter(Boolean);
        preview.textContent = titles.length ? titles.join(" · ") : "Plan meals";
        preview.classList.toggle("is-empty", !titles.length);
        count.textContent = String(titles.length);
        count.hidden = titles.length === 0;
      };
      const persistTitle = async () => {
        const next = input.value.trim();
        if (next === lastSaved) {
          refreshDayPreview();
          return;
        }
        input.classList.add("is-saving");
        try {
          await saveMealSlot(slot, { title: next });
          lastSaved = next;
          input.value = next;
          refreshDayPreview();
          refreshMealCellCues(cell, slot);
        } catch (err) {
          input.value = lastSaved;
          slot.title = lastSaved;
          refreshDayPreview();
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
      input.addEventListener("input", () => {
        slot.title = input.value.trim();
        refreshDayPreview();
      });

      const actions = el("div", "meal-cell-actions");
      const details = el("button", "meal-cell-details", "Recipe links");
      details.type = "button";
      details.title = "Add a recipe webpage link and shopping ingredients";
      details.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMealEditor(slot);
      });
      actions.appendChild(details);

      const body = el("div", "meal-cell-body");
      body.appendChild(input);
      body.appendChild(actions);

      cell.appendChild(typeLabel);
      cell.appendChild(body);
      refreshMealCellCues(cell, slot);
      slotsWrap.appendChild(cell);
    }

    preview.textContent = planned.length ? planned.join(" · ") : "Plan meals";
    preview.classList.toggle("is-empty", !planned.length);
    count.textContent = String(planned.length);
    count.hidden = planned.length === 0;

    btn.addEventListener("click", () => {
      const already = btn.classList.contains("is-open");
      setOpenDay(already ? "" : day);
    });

    panel.appendChild(slotsWrap);
    strip.appendChild(btn);
    journal.appendChild(panel);
  });

  if (openDay) setOpenDay(openDay);
}

function refreshMealCellCues(cell, slot) {
  cell.querySelector(".meal-cell-cues")?.remove();
  const cues = el("div", "meal-cell-cues");
  if (slot.recipe_url) cues.appendChild(el("span", "meal-cue", "Link"));
  const ingCount = Array.isArray(slot.ingredients) ? slot.ingredients.length : 0;
  if (ingCount) cues.appendChild(el("span", "meal-cue", `${ingCount} items`));
  if (!cues.childNodes.length) return;
  const typeLabel = cell.querySelector(".meal-cell-type");
  if (typeLabel) typeLabel.appendChild(cues);
  else cell.appendChild(cues);
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
    section.classList.add(assigneeColorClass(name));

    const head = el("div", "chore-group-head");
    const titleWrap = el("div", "chore-group-title");
    titleWrap.appendChild(el("h3", "chore-group-name", name));
    if (name !== "Unassigned") {
      const current = getAssigneeColorId(name);
      const swatches = el("div", "chore-color-pick no-print");
      swatches.setAttribute("role", "group");
      swatches.setAttribute("aria-label", `Color for ${name}`);
      for (const color of CHORE_PERSON_COLORS) {
        const swatch = el(
          "button",
          current === color.id
            ? `chore-color-swatch chore-swatch-${color.id} is-active`
            : `chore-color-swatch chore-swatch-${color.id}`,
          ""
        );
        swatch.type = "button";
        swatch.title = color.label;
        swatch.setAttribute("aria-label", color.label);
        swatch.addEventListener("click", (e) => {
          e.preventDefault();
          setAssigneeColorId(name, color.id);
          loadChores();
        });
        swatches.appendChild(swatch);
      }
      titleWrap.appendChild(swatches);
    }
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

const CHORE_PERSON_COLORS = [
  { id: "blue", label: "Blue" },
  { id: "sky", label: "Sky" },
  { id: "pink", label: "Pink" },
  { id: "rose", label: "Rose" },
  { id: "green", label: "Green" },
  { id: "teal", label: "Teal" },
  { id: "gold", label: "Gold" },
  { id: "coral", label: "Coral" },
];

const ASSIGNEE_COLOR_KEY = "hearthlist-assignee-colors";

function loadAssigneeColors() {
  try {
    const raw = localStorage.getItem(ASSIGNEE_COLOR_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAssigneeColors(map) {
  try {
    localStorage.setItem(ASSIGNEE_COLOR_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

function nameStyleHash(name, mod) {
  let hash = 0;
  const key = (name || "").trim().toLowerCase();
  for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i) * (i + 1)) % mod;
  return hash;
}

function getAssigneeColorId(name) {
  const key = (name || "").trim();
  if (!key || key === "Unassigned") return "neutral";
  const saved = loadAssigneeColors()[key];
  if (CHORE_PERSON_COLORS.some((c) => c.id === saved)) return saved;
  return CHORE_PERSON_COLORS[nameStyleHash(key, CHORE_PERSON_COLORS.length)].id;
}

function setAssigneeColorId(name, colorId) {
  const key = (name || "").trim();
  if (!key || key === "Unassigned") return;
  if (!CHORE_PERSON_COLORS.some((c) => c.id === colorId)) return;
  const map = loadAssigneeColors();
  map[key] = colorId;
  saveAssigneeColors(map);
}

function assigneeColorClass(name) {
  const key = (name || "").trim() || "Unassigned";
  if (key === "Unassigned") return "chore-person-neutral";
  return `chore-person-${getAssigneeColorId(key)}`;
}

function chorePrintLabel(item) {
  const title = (item.title || "").trim() || "Chore";
  const who = (item.assignee || "").trim();
  if (!who || who === "Unassigned") return title;
  return `${title} · ${who}`;
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
  body.appendChild(el("div", "item-title", item.title));
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
  for (const listId of ["chore-assignee-suggestions", "schedule-assignee-suggestions"]) {
    const list = document.getElementById(listId);
    if (!list) continue;
    list.innerHTML = "";
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      list.appendChild(opt);
    }
  }
}

function householdNameForPrint() {
  return (
    document.getElementById("invite-card")?.dataset.householdName ||
    document.querySelector(".eyebrow")?.textContent?.trim() ||
    "Our home"
  );
}

function currentWeekDays() {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7; // Mon=0
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return d;
  });
}

function formatWeekRange(days) {
  if (!days.length) return "";
  const start = days[0];
  const end = days[6];
  const opts = { month: "short", day: "numeric" };
  const year = end.getFullYear();
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}, ${year}`;
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
  root.classList.add("chore-print-month");
  root.classList.remove("chore-print-week");

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
    const chip = el("span", `chore-cal-chip ${assigneeColorClass(name)}`);
    chip.textContent = name;
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
      const row = el("div", `chore-cal-entry ${assigneeColorClass(who)}`);
      row.appendChild(el("span", "chore-cal-check", ""));
      row.appendChild(el("span", "chore-cal-entry-text", chorePrintLabel(item)));
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

function buildPrintWeekChart(items) {
  const root = document.getElementById("chore-print-calendar");
  if (!root) return;
  const weekDays = currentWeekDays();
  const quote = pickChoreMotivator();
  const household = householdNameForPrint();

  root.innerHTML = "";
  root.hidden = false;
  root.classList.add("chore-print-week");
  root.classList.remove("chore-print-month");

  const header = el("header", "chore-cal-header");
  header.appendChild(el("p", "chore-cal-kicker", household));
  header.appendChild(el("h2", "chore-cal-title", "This week’s chore calendar"));
  header.appendChild(el("p", "chore-cal-sub", `${formatWeekRange(weekDays)} · check off each day · hang on the fridge`));
  header.appendChild(el("p", "chore-cal-quote", quote));
  root.appendChild(header);

  const people = [
    ...new Set(items.map((i) => (i.assignee || "").trim() || "Unassigned")),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const legend = el("div", "chore-cal-legend");
  for (const name of people) {
    const chip = el("span", `chore-cal-chip ${assigneeColorClass(name)}`);
    chip.textContent = name;
    legend.appendChild(chip);
  }
  root.appendChild(legend);

  const grid = el("div", "chore-week-cal-grid");
  const dowLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  weekDays.forEach((day, idx) => {
    const cell = el("div", "chore-week-cal-day");
    const top = el("div", "chore-week-cal-top");
    top.appendChild(el("div", "chore-week-cal-dow", dowLabels[idx]));
    top.appendChild(el("div", "chore-cal-daynum", String(day.getDate())));
    cell.appendChild(top);

    const dayItems = choresForCalendarDay(items, day);
    for (const item of dayItems) {
      const who = (item.assignee || "").trim() || "Unassigned";
      const row = el("div", `chore-cal-entry ${assigneeColorClass(who)}`);
      row.appendChild(el("span", "chore-cal-check", ""));
      row.appendChild(el("span", "chore-cal-entry-text", chorePrintLabel(item)));
      cell.appendChild(row);
    }
    if (!dayItems.length) {
      cell.appendChild(el("p", "chore-week-cal-empty", "No chores"));
    }
    grid.appendChild(cell);
  });
  root.appendChild(grid);

  const footer = el("footer", "chore-cal-footer");
  footer.appendChild(el("span", "chore-cal-footer-home", household));
  footer.appendChild(el("span", "chore-cal-footer-sep", " · "));
  footer.appendChild(el("span", "chore-cal-footer-quote", quote));
  root.appendChild(footer);
}

function runChorePrint({ buildFn, titleText, weekMode }) {
  const items = window.__hearthlistChores || [];
  if (!items.length) {
    alert("Add a few chores (with names in Who?) before printing.");
    return;
  }
  const root = document.getElementById("chore-print-calendar");
  if (root) {
    root.classList.toggle("chore-print-week", !!weekMode);
    root.classList.toggle("chore-print-month", !weekMode);
  }
  buildFn(items);
  document.body.classList.add("printing-chores");
  document.body.classList.toggle("printing-chores-week", !!weekMode);
  document.body.classList.toggle("printing-chores-month", !weekMode);
  const title = document.title;
  document.title = titleText;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove(
      "printing-chores",
      "printing-chores-week",
      "printing-chores-month"
    );
    document.title = title;
    const cal = document.getElementById("chore-print-calendar");
    if (cal) {
      cal.hidden = true;
      cal.innerHTML = "";
      cal.classList.remove("chore-print-week", "chore-print-month");
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Wait a frame so the print layout paints before the dialog opens.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
      // Long fallback only — short timeouts cleared the chart mid-dialog before.
      setTimeout(cleanup, 60000);
    });
  });
}

function printChoreChart() {
  runChorePrint({
    buildFn: buildPrintCalendar,
    titleText: `${householdNameForPrint()} chore calendar`,
    weekMode: false,
  });
}

function printChoreWeekChart() {
  runChorePrint({
    buildFn: buildPrintWeekChart,
    titleText: `${householdNameForPrint()} weekly chore calendar`,
    weekMode: true,
  });
}

document.getElementById("print-chores")?.addEventListener("click", printChoreChart);
document.getElementById("print-chores-week")?.addEventListener("click", printChoreWeekChart);

const SHIFT_PRESET_TIMES = {
  day: { start: "07:00", end: "15:00" },
  evening: { start: "15:00", end: "23:00" },
  night: { start: "23:00", end: "07:00" },
};

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatShiftTimeRange(start, end) {
  return `${start || "??"}–${end || "??"}`;
}

function shiftPresetLabel(preset) {
  const key = (preset || "").toLowerCase();
  if (key === "day") return "Day";
  if (key === "evening") return "Evening";
  if (key === "night") return "Night";
  return "Custom";
}

function workShiftPrintLabel(item) {
  const who = (item.assignee || "").trim() || "Unassigned";
  const title = (item.title || "").trim() || "Shift";
  const times = formatShiftTimeRange(item.start_time, item.end_time);
  const preset = shiftPresetLabel(item.shift_preset);
  return `${who} · ${title} · ${preset} ${times}`;
}

function workShiftsForWeekday(items, weekday) {
  return (items || []).filter((item) => (item.weekdays || []).includes(weekday));
}

function buildWorkShiftRow(item) {
  const li = el("li", "");
  const body = el("div", "item-body");
  body.appendChild(el("div", "item-title", item.title || "Shift"));
  const days = (item.weekdays || []).map((d) => WEEKDAY_SHORT[d] || d).join(", ");
  const meta = `${shiftPresetLabel(item.shift_preset)} · ${formatShiftTimeRange(
    item.start_time,
    item.end_time
  )}${days ? ` · ${days}` : ""}${item.notes ? ` · ${item.notes}` : ""}`;
  body.appendChild(el("div", "item-meta", meta));
  const remove = el("button", "item-remove no-print", "Delete");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm("Delete this shift?")) return;
    try {
      await api(`/api/work-shifts/${item.id}`, { method: "DELETE" });
      loadWorkShifts();
    } catch (err) {
      alert(err.message);
    }
  });
  li.append(body, remove);
  return li;
}

async function loadWorkShifts() {
  const groupsEl = document.getElementById("schedule-groups");
  if (!groupsEl) return;
  const data = await api("/api/work-shifts");
  window.__hearthlistWorkShifts = data.items || [];
  groupsEl.innerHTML = "";

  const items = data.items || [];
  if (!items.length) {
    groupsEl.appendChild(el("p", "item-meta", "No work shifts yet."));
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

  const choreNames = (window.__hearthlistChores || [])
    .map((c) => (c.assignee || "").trim())
    .filter(Boolean);
  updateAssigneeSuggestions(
    [...new Set([...names.filter((n) => n !== "Unassigned"), ...choreNames])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    )
  );

  for (const name of names) {
    const groupItems = byName.get(name);
    const section = el("section", "chore-group");
    section.dataset.assignee = name;
    section.classList.add(assigneeColorClass(name));
    const head = el("div", "chore-group-head");
    head.appendChild(el("h3", "chore-group-name", name));
    head.appendChild(el("span", "chore-group-count", `${groupItems.length} shift${groupItems.length === 1 ? "" : "s"}`));
    section.appendChild(head);
    const list = el("ul", "item-list chore-group-list");
    for (const item of groupItems) list.appendChild(buildWorkShiftRow(item));
    section.appendChild(list);
    groupsEl.appendChild(section);
  }
}

function buildPrintWorkWeekChart(workItems) {
  const root = document.getElementById("schedule-print-calendar");
  if (!root) return;
  const weekDays = currentWeekDays();
  const household = householdNameForPrint();
  root.innerHTML = "";
  root.hidden = false;
  root.classList.add("chore-print-week");

  const header = el("header", "chore-cal-header");
  header.appendChild(el("p", "chore-cal-kicker", household));
  header.appendChild(el("h2", "chore-cal-title", "This week’s work schedule"));
  header.appendChild(el("p", "chore-cal-sub", `${formatWeekRange(weekDays)} · who works when`));
  root.appendChild(header);

  const people = [
    ...new Set(workItems.map((i) => (i.assignee || "").trim() || "Unassigned")),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const legend = el("div", "chore-cal-legend");
  for (const name of people) {
    const chip = el("span", `chore-cal-chip ${assigneeColorClass(name)}`);
    chip.textContent = name;
    legend.appendChild(chip);
  }
  root.appendChild(legend);

  const grid = el("div", "chore-week-cal-grid");
  const dowLabels = WEEKDAY_NAMES;
  weekDays.forEach((day, idx) => {
    const cell = el("div", "chore-week-cal-day");
    const top = el("div", "chore-week-cal-top");
    top.appendChild(el("div", "chore-week-cal-dow", dowLabels[idx]));
    top.appendChild(el("div", "chore-cal-daynum", String(day.getDate())));
    cell.appendChild(top);
    const dayItems = workShiftsForWeekday(workItems, idx);
    for (const item of dayItems) {
      const who = (item.assignee || "").trim() || "Unassigned";
      const row = el("div", `chore-cal-entry ${assigneeColorClass(who)}`);
      row.appendChild(el("span", "chore-cal-entry-text", workShiftPrintLabel(item)));
      cell.appendChild(row);
    }
    if (!dayItems.length) cell.appendChild(el("p", "chore-week-cal-empty", "No shifts"));
    grid.appendChild(cell);
  });
  root.appendChild(grid);
}

function buildPrintCombinedWeekChart(choreItems, workItems) {
  const root = document.getElementById("schedule-print-calendar");
  if (!root) return;
  const weekDays = currentWeekDays();
  const household = householdNameForPrint();
  root.innerHTML = "";
  root.hidden = false;
  root.classList.add("chore-print-week");

  const header = el("header", "chore-cal-header");
  header.appendChild(el("p", "chore-cal-kicker", household));
  header.appendChild(el("h2", "chore-cal-title", "This week — chores & work"));
  header.appendChild(el("p", "chore-cal-sub", `${formatWeekRange(weekDays)} · home + work on one sheet`));
  root.appendChild(header);

  const people = [
    ...new Set([
      ...choreItems.map((i) => (i.assignee || "").trim() || "Unassigned"),
      ...workItems.map((i) => (i.assignee || "").trim() || "Unassigned"),
    ]),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const legend = el("div", "chore-cal-legend");
  for (const name of people) {
    const chip = el("span", `chore-cal-chip ${assigneeColorClass(name)}`);
    chip.textContent = name;
    legend.appendChild(chip);
  }
  root.appendChild(legend);

  const grid = el("div", "chore-week-cal-grid");
  weekDays.forEach((day, idx) => {
    const cell = el("div", "chore-week-cal-day");
    const top = el("div", "chore-week-cal-top");
    top.appendChild(el("div", "chore-week-cal-dow", WEEKDAY_NAMES[idx]));
    top.appendChild(el("div", "chore-cal-daynum", String(day.getDate())));
    cell.appendChild(top);

    const chores = choresForCalendarDay(choreItems, day);
    const shifts = workShiftsForWeekday(workItems, idx);

    if (chores.length) {
      cell.appendChild(el("p", "schedule-print-section-label", "Chores"));
      for (const item of chores) {
        const who = (item.assignee || "").trim() || "Unassigned";
        const row = el("div", `chore-cal-entry ${assigneeColorClass(who)}`);
        row.appendChild(el("span", "chore-cal-check", ""));
        row.appendChild(el("span", "chore-cal-entry-text", chorePrintLabel(item)));
        cell.appendChild(row);
      }
    }
    if (shifts.length) {
      cell.appendChild(el("p", "schedule-print-section-label", "Work"));
      for (const item of shifts) {
        const who = (item.assignee || "").trim() || "Unassigned";
        const row = el("div", `chore-cal-entry ${assigneeColorClass(who)}`);
        row.appendChild(el("span", "chore-cal-entry-text", workShiftPrintLabel(item)));
        cell.appendChild(row);
      }
    }
    if (!chores.length && !shifts.length) {
      cell.appendChild(el("p", "chore-week-cal-empty", "Nothing scheduled"));
    }
    grid.appendChild(cell);
  });
  root.appendChild(grid);
}

function runSchedulePrint({ mode, titleText }) {
  const workItems = window.__hearthlistWorkShifts || [];
  const choreItems = window.__hearthlistChores || [];
  if (mode === "work" && !workItems.length) {
    alert("Add work shifts before printing.");
    return;
  }
  if (mode === "combined" && !workItems.length && !choreItems.length) {
    alert("Add chores or work shifts before printing.");
    return;
  }
  if (mode === "work") buildPrintWorkWeekChart(workItems);
  else buildPrintCombinedWeekChart(choreItems, workItems);

  document.body.classList.add(mode === "work" ? "printing-work" : "printing-combined");
  const title = document.title;
  document.title = titleText;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("printing-work", "printing-combined");
    document.title = title;
    const cal = document.getElementById("schedule-print-calendar");
    if (cal) {
      cal.hidden = true;
      cal.innerHTML = "";
      cal.classList.remove("chore-print-week");
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
      setTimeout(cleanup, 60000);
    });
  });
}

function printWorkWeekChart() {
  runSchedulePrint({
    mode: "work",
    titleText: `${householdNameForPrint()} work schedule`,
  });
}

function printCombinedWeekChart() {
  runSchedulePrint({
    mode: "combined",
    titleText: `${householdNameForPrint()} chores & work`,
  });
}

document.getElementById("print-work-week")?.addEventListener("click", printWorkWeekChart);
document.getElementById("print-combined-week")?.addEventListener("click", printCombinedWeekChart);

const schedulePreset = document.getElementById("schedule-preset");
const scheduleStart = document.getElementById("schedule-start");
const scheduleEnd = document.getElementById("schedule-end");
if (schedulePreset && scheduleStart && scheduleEnd) {
  schedulePreset.addEventListener("change", () => {
    const preset = SHIFT_PRESET_TIMES[schedulePreset.value];
    if (!preset) return;
    scheduleStart.value = preset.start;
    scheduleEnd.value = preset.end;
  });
}

const scheduleForm = document.getElementById("schedule-form");
if (scheduleForm) {
  scheduleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("schedule-title").value.trim();
    const assignee = document.getElementById("schedule-assignee").value.trim();
    const shift_preset = document.getElementById("schedule-preset").value;
    const start_time = document.getElementById("schedule-start").value;
    const end_time = document.getElementById("schedule-end").value;
    const notes = document.getElementById("schedule-notes").value.trim();
    const weekdays = [...document.querySelectorAll('input[name="schedule-weekday"]:checked')].map(
      (el) => Number(el.value)
    );
    if (!title || !assignee) return;
    if (!weekdays.length) {
      alert("Pick at least one weekday.");
      return;
    }
    try {
      await api("/api/work-shifts", {
        method: "POST",
        body: JSON.stringify({
          title,
          assignee,
          shift_preset,
          start_time,
          end_time,
          weekdays,
          notes,
        }),
      });
      scheduleForm.reset();
      document.getElementById("schedule-preset").value = "day";
      document.getElementById("schedule-start").value = "07:00";
      document.getElementById("schedule-end").value = "15:00";
      loadWorkShifts();
    } catch (err) {
      alert(err.message);
    }
  });
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

const NOTIFY_PREF_KEY = "hearthlist-system-notifications";

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

function systemNotificationsWanted() {
  const saved = localStorage.getItem(NOTIFY_PREF_KEY);
  if (saved === "1" || saved === "0") return saved === "1";
  // Migrate older preference key if present.
  if (localStorage.getItem("hearthlist-reminders-enabled") === "1") return true;
  return false;
}

function setSystemNotificationsWanted(on) {
  localStorage.setItem(NOTIFY_PREF_KEY, on ? "1" : "0");
}

function updateNotifyStatus() {
  const status = document.getElementById("notify-permission-status");
  const toggle = document.getElementById("notify-toggle");
  if (!status) return;

  const wanted = systemNotificationsWanted();
  if (toggle) {
    if (!supportsSystemNotifications()) {
      toggle.checked = false;
      toggle.disabled = true;
    } else if (Notification.permission === "denied") {
      toggle.checked = false;
      toggle.disabled = false;
    } else {
      toggle.disabled = false;
      toggle.checked = wanted && Notification.permission === "granted";
    }
  }

  if (!supportsSystemNotifications()) {
    status.textContent = isIosDevice()
      ? "This browser tab can’t do lock-screen alerts. In-app popups still work while Hearthlist is open. On iPhone: Add to Home Screen, then open from that icon (iOS 16.4+)."
      : "This browser can’t show lock-screen notifications. In-app popups still work while Hearthlist is open.";
    return;
  }

  if (Notification.permission === "denied") {
    status.textContent = "Blocked in browser settings. In-app popups still work while Hearthlist is open.";
    return;
  }

  if (wanted && Notification.permission === "granted") {
    status.textContent = "On — lock-screen alerts when Hearthlist can reach you. In-app popups still work while open.";
    return;
  }

  status.textContent = "Off — turn on for lock-screen alerts. In-app popups still work while Hearthlist is open.";
}

async function showBrowserNotification(title, body, tag) {
  if (!systemNotificationsWanted()) return;
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

document.getElementById("test-reminder-popup")?.addEventListener("click", async () => {
  showReminderPopup([{ title: "Test reminder", notify_time: "now" }]);
  if (systemNotificationsWanted() && supportsSystemNotifications() && Notification.permission === "granted") {
    await showBrowserNotification(
      "Test reminder",
      "Hearthlist system notifications are working.",
      "hearthlist-test"
    );
  }
});

document.getElementById("notify-toggle")?.addEventListener("change", async (e) => {
  const toggle = e.target;
  const turnOn = !!toggle.checked;

  if (!turnOn) {
    setSystemNotificationsWanted(false);
    updateNotifyStatus();
    return;
  }

  if (!supportsSystemNotifications()) {
    setSystemNotificationsWanted(false);
    toggle.checked = false;
    updateNotifyStatus();
    return;
  }

  await ensureServiceWorker();
  if (Notification.permission === "denied") {
    setSystemNotificationsWanted(false);
    toggle.checked = false;
    updateNotifyStatus();
    alert("Notifications are blocked in your browser settings. You can still use in-app popups while Hearthlist is open.");
    return;
  }

  if (Notification.permission !== "granted") {
    await Notification.requestPermission();
  }

  if (Notification.permission === "granted") {
    setSystemNotificationsWanted(true);
    updateNotifyStatus();
    await showBrowserNotification(
      "Hearthlist notifications on",
      "You’ll get lock-screen alerts when a reminder is due (while this browser can deliver them).",
      "hearthlist-enabled"
    );
    checkDueReminders();
  } else {
    setSystemNotificationsWanted(false);
    toggle.checked = false;
    updateNotifyStatus();
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

Promise.all([loadGroceries(), loadMeals(), loadChores(), loadWorkShifts(), loadReminders()])
  .then(() => {
    updateNotifyStatus();
    ensureServiceWorker();
    checkDueReminders();
    setInterval(checkDueReminders, 60 * 1000);
  })
  .catch((err) => {
    if (!document.getElementById("panel-groceries")) return;
    console.error(err);
    alert(err?.message || "Could not load your household data. Refresh and try again.");
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
