(() => {
  "use strict";

  const config = window.CANTEEN_SUPABASE_CONFIG || { offlineMode: true, url: "", publishableKey: "" };
  const supabaseLibrary = window.supabase;
  const offlineMode = Boolean(config.offlineMode || !config.url || !config.publishableKey || !supabaseLibrary || !supabaseLibrary.createClient);
  const $ = (selector) => document.querySelector(selector);
  const menuGrid = $("#menu-grid");
  const offlineMenu = [
    { id: 1, name: "Masala Dosa", description: "Golden crisp dosa with potato masala and coconut chutney.", price: 75, category: "veg", available: true, sort_order: 1 },
    { id: 2, name: "Paneer Sizzler Bowl", description: "Fire-roasted paneer cubes, rice, veggies, and house sauce.", price: 180, category: "veg", available: true, sort_order: 2 },
    { id: 3, name: "Veg Biryani", description: "Fragrant basmati rice layered with vegetables and spices.", price: 160, category: "veg", available: true, sort_order: 3 },
    { id: 4, name: "Chicken Wrap", description: "Juicy chicken, lettuce, crunch, and smoky mayo in a soft wrap.", price: 155, category: "non-veg", available: true, sort_order: 4 },
    { id: 5, name: "Butter Naan Combo", description: "Fresh naan with dal makhani and seasonal veg curry.", price: 140, category: "veg", available: false, sort_order: 5 },
    { id: 6, name: "Grilled Chicken Rice Bowl", description: "Lean protein with herbed rice and salad on the side.", price: 210, category: "non-veg", available: true, sort_order: 6 }
  ];
  const offlineSpecial = { special_date: localDateISO(), name: "Paneer Tikka Roll", description: "Char-grilled paneer, mint chutney, and crunchy slaw wrapped for a campus-perfect bite.", price: 130 };
  const offlineCrowd = { average_score: 2.1, vote_count: 3 };
  const offlineVoteKey = "common-room-offline-vote";
  const offlineMenuKey = "common-room-offline-menu";
  const offlineSpecialKey = "common-room-offline-special";
  const offlineAdminKey = "common-room-offline-admin";
  const state = { menu: [], special: null, crowd: { average_score: 2, vote_count: 0 }, myVote: null };
  let supabaseClient;
  let role = "student";
  let loginIntent = "guest";
  let activeFilter = "all";
  let editingId = null;
  let toastTimer;
  let crowdRefreshTimer;
  let liveChannel;
  let sessionUser;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function formatPrice(price) {
    return price == null ? "—" : `₹${Number(price).toLocaleString("en-IN")}`;
  }

  function localDateISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function isAnonymousUser(user) {
    return user.is_anonymous === true || user.app_metadata?.provider === "anonymous";
  }

  function reportError(message) {
    const errorBox = $("#app-error");
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    showToast("Something went wrong. See the message at the top of the page.");
  }

  function clearError() {
    $("#app-error").textContent = "";
    $("#app-error").classList.add("hidden");
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function readStoredJson(key, description) {
    const stored = localStorage.getItem(key);
    if (stored === null) return null;
    try {
      return JSON.parse(stored);
    } catch {
      throw new Error(`Saved ${description} data is unreadable. Clear this app’s local storage to restore the demo defaults.`);
    }
  }

  function getOfflineAdminRecord() {
    const record = readStoredJson(offlineAdminKey, "admin account");
    if (record === null) return null;
    if (typeof record.salt !== "string" || typeof record.hash !== "string") {
      throw new Error("Saved admin account data is invalid. Clear this app’s local storage to set up the admin again.");
    }
    return record;
  }

  function encodeBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  async function hashAdminPassword(password, salt) {
    if (!crypto.subtle) throw new Error("Password setup requires a secure browser context such as localhost or HTTPS.");
    const saltBytes = salt ? Uint8Array.from(atob(salt), (character) => character.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
    const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: 150000, hash: "SHA-256" },
      passwordKey,
      256
    );
    return { salt: encodeBase64(saltBytes), hash: encodeBase64(new Uint8Array(derivedBits)) };
  }

  function renderMenu() {
    const dishes = state.menu.filter((dish) => activeFilter === "all" || dish.category === activeFilter);
    $("#menu-count").textContent = state.menu.length;
    menuGrid.innerHTML = dishes.map((dish, index) => `
      <article class="menu-item">
        <div class="dish-art art-${index % 3 + 1}">
          <span class="veg-indicator ${dish.category === "non-veg" ? "non-veg" : ""}" title="${dish.category === "veg" ? "Vegetarian" : "Non-vegetarian"}"></span>
          <span class="availability-chip ${dish.available ? "" : "unavailable"}">${dish.available ? "● Available" : "● Sold out"}</span>
        </div>
        <div class="dish-details">
          <div class="dish-title-row"><h3>${escapeHtml(dish.name)}</h3><span class="dish-price">${formatPrice(dish.price)}</span></div>
          <p class="dish-description">${escapeHtml(dish.description)}</p>
          <div class="dish-footer"><span class="category-label">${dish.category === "veg" ? "● Veg" : "● Non-veg"}</span>
            ${role === "admin" ? `<span class="admin-actions"><button class="admin-action" data-action="edit" data-id="${escapeHtml(dish.id)}">Edit</button><button class="admin-action" data-action="availability" data-id="${escapeHtml(dish.id)}">${dish.available ? "Mark sold out" : "Mark available"}</button><button class="admin-action delete" data-action="delete" data-id="${escapeHtml(dish.id)}" aria-label="Delete ${escapeHtml(dish.name)}">Delete</button></span>` : ""}
          </div>
        </div>
      </article>`).join("");
    $("#menu-empty").classList.toggle("hidden", dishes.length > 0);
  }

  function renderSpecial() {
    const special = state.special;
    $("#special-name").textContent = special ? special.name : "Not announced yet";
    $("#special-description").textContent = special
      ? special.description
      : "The canteen hasn’t posted today’s special yet.";
    $("#special-price").textContent = formatPrice(special && special.price);
    $("#special-available").classList.toggle("hidden", !special);
  }

  function renderCrowd() {
    const { average_score: average = 2, vote_count: count = 0 } = state.crowd;
    const score = Number(average);
    const position = Math.min(100, Math.max(0, (score - 1) * 50));
    $("#meter-fill").style.width = `${position}%`;
    $("#meter-indicator").style.left = `${position}%`;
    const status = score < 1.67
      ? { text: "Looking quiet", color: "#a8d475" }
      : score < 2.34
        ? { text: "A little busy", color: "#e5cb6c" }
        : { text: "Pretty packed", color: "#e59674" };
    $("#rush-status").textContent = status.text;
    $("#status-dot").style.background = status.color;
    $("#vote-total").textContent = `${count} ${count === 1 ? "vote" : "votes"}`;
    document.querySelectorAll(".vote-button").forEach((button) => {
      button.classList.toggle("selected", Number(button.dataset.vote) === state.myVote);
      button.disabled = role === "admin" || (!sessionUser && !offlineMode);
      button.title = role === "admin"
        ? "Crowd voting is available to guests"
        : !sessionUser && !offlineMode
          ? "Enable anonymous sign-ins in Supabase to vote"
          : "";
    });
    $("#vote-message").textContent = role === "admin"
      ? "Admin view — voting is available to campus members."
      : !sessionUser && !offlineMode
        ? "Enable anonymous sign-ins in Supabase to submit a guest vote."
      : state.myVote
        ? "Your local vote is included in this browser’s crowd check."
        : offlineMode ? "Demo mode — votes are saved only in this browser." : "";
  }

  async function fetchMenu() {
    if (!supabaseClient || config.offlineMode) {
      const storedMenu = readStoredJson(offlineMenuKey, "menu");
      if (storedMenu !== null && !Array.isArray(storedMenu)) throw new Error("Saved menu data is invalid.");
      state.menu = storedMenu || offlineMenu.map((dish) => ({ ...dish }));
      renderMenu();
      return;
    }
    const { data, error } = await supabaseClient
      .from("menu_items")
      .select("id,name,description,price,category,available,sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(`Could not load the menu: ${error.message}`);
    state.menu = data;
    renderMenu();
  }

  async function fetchSpecial() {
    if (!supabaseClient || config.offlineMode) {
      const storedSpecial = readStoredJson(offlineSpecialKey, "special");
      state.special = storedSpecial === null ? { ...offlineSpecial } : storedSpecial;
      renderSpecial();
      return;
    }
    const { data, error } = await supabaseClient
      .from("canteen_specials")
      .select("special_date,name,description,price")
      .eq("special_date", localDateISO())
      .maybeSingle();
    if (error) throw new Error(`Could not load today’s special: ${error.message}`);
    state.special = data;
    renderSpecial();
  }

  async function fetchCrowd() {
    if (!supabaseClient || offlineMode) {
      state.crowd = offlineCrowd;
      const savedVote = Number(localStorage.getItem(offlineVoteKey));
      state.myVote = [1, 2, 3].includes(savedVote) ? savedVote : null;
      if (state.myVote !== null) {
        state.crowd = {
          average_score: (offlineCrowd.average_score * offlineCrowd.vote_count + state.myVote) / (offlineCrowd.vote_count + 1),
          vote_count: offlineCrowd.vote_count + 1
        };
      }
      renderCrowd();
      return;
    }
    const ownVoteRequest = sessionUser
      ? supabaseClient.from("crowd_votes").select("score,voted_at").eq("user_id", sessionUser.id).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [{ data: summary, error: summaryError }, { data: ownVote, error: voteError }] = await Promise.all([
      supabaseClient.rpc("get_crowd_summary"),
      ownVoteRequest
    ]);
    if (summaryError) throw new Error(`Could not load the crowd check: ${summaryError.message}`);
    if (voteError) throw new Error(`Could not load your crowd vote: ${voteError.message}`);
    state.crowd = Array.isArray(summary) ? summary[0] : summary;
    state.myVote = ownVote && Date.now() - new Date(ownVote.voted_at).getTime() < 60 * 60 * 1000
      ? ownVote.score
      : null;
    renderCrowd();
  }

  async function refreshDashboard() {
    clearError();
    try {
      await Promise.all([fetchMenu(), fetchSpecial(), fetchCrowd()]);
    } catch (error) {
      console.error(error);
      reportError(error.message);
    }
  }

  async function checkAdmin(userId) {
    const { data, error } = await supabaseClient
      .from("canteen_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Could not verify admin access: ${error.message}`);
    return Boolean(data);
  }

  function stopLiveUpdates() {
    if (supabaseClient && liveChannel) {
      supabaseClient.removeChannel(liveChannel);
      liveChannel = null;
    }
    clearInterval(crowdRefreshTimer);
    crowdRefreshTimer = null;
  }

  function startLiveUpdates() {
    if (!supabaseClient || config.offlineMode) {
      clearInterval(crowdRefreshTimer);
      crowdRefreshTimer = null;
      return;
    }
    stopLiveUpdates();
    liveChannel = supabaseClient
      .channel("canteen-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, () => {
        fetchMenu().catch((error) => reportError(error.message));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "canteen_specials" }, () => {
        fetchSpecial().catch((error) => reportError(error.message));
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reportError("Live menu updates are unavailable. You can still refresh the page to see changes.");
        }
      });
    crowdRefreshTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchCrowd().catch((error) => reportError(error.message));
      }
    }, 30000);
  }

  async function renderPublicGuest() {
    stopLiveUpdates();
    sessionUser = null;
    role = "student";
    loginIntent = "guest";
    clearError();
    $("#login-modal").classList.add("hidden");
    $("#profile-name").textContent = "Guest";
    $("#profile-role").textContent = "Browsing as guest";
    $("#user-avatar").textContent = "G";
    $("#welcome-name").textContent = "friend";
    $("#logout-button").setAttribute("aria-label", "Admin sign in");
    $("#logout-button").title = "Admin sign in";
    $("#logout-button").textContent = "→";
    $("#add-item-button").classList.add("hidden");
    $("#edit-special-button").classList.add("hidden");
    state.myVote = null;
    renderMenu();
    renderCrowd();
    await refreshDashboard();
    startLiveUpdates();
  }

  async function renderApp(session) {
    stopLiveUpdates();
    if (offlineMode || !supabaseClient) {
      await renderOfflineApp("student");
      return;
    }
    sessionUser = session ? session.user : null;
    if (!sessionUser) {
      role = "student";
      state.menu = [];
      state.special = null;
      state.crowd = { average_score: 2, vote_count: 0 };
      state.myVote = null;
      $("#login-modal").classList.remove("hidden");
      $("#add-item-button").classList.add("hidden");
      $("#edit-special-button").classList.add("hidden");
      renderMenu();
      renderSpecial();
      renderCrowd();
      return;
    }

    clearError();
    $("#login-modal").classList.add("hidden");
    try {
      const isAnonymous = isAnonymousUser(sessionUser);
      role = !isAnonymous && await checkAdmin(sessionUser.id) ? "admin" : "student";
      if (loginIntent === "admin" && role !== "admin") {
        await supabaseClient.auth.signOut();
        $("#login-modal").classList.remove("hidden");
        $("#login-error").textContent = "This account isn’t designated as a canteen admin.";
        return;
      }
      $("#profile-name").textContent = role === "admin"
        ? sessionUser.email
          ? sessionUser.email.split("@")[0]
          : "Canteen admin"
        : "Guest";
      $("#profile-role").textContent = role === "admin" ? "Administrator" : "Browsing as guest";
      $("#user-avatar").textContent = role === "admin" ? "A" : "G";
      $("#welcome-name").textContent = role === "admin" ? "admin" : "friend";
      $("#logout-button").setAttribute("aria-label", role === "admin" ? "Sign out" : "Admin sign in");
      $("#logout-button").title = role === "admin" ? "Sign out" : "Admin sign in";
      $("#logout-button").textContent = role === "admin" ? "↗" : "→";
      $("#add-item-button").classList.toggle("hidden", role !== "admin");
      $("#edit-special-button").classList.toggle("hidden", role !== "admin");
      loginIntent = role === "admin" ? "admin" : "guest";
      renderMenu();
      renderCrowd();
      await refreshDashboard();
      startLiveUpdates();
    } catch (error) {
      console.error(error);
      reportError(error.message);
    }
  }

  async function renderOfflineApp(nextRole) {
    sessionUser = null;
    role = nextRole;
    loginIntent = nextRole === "admin" ? "admin" : "guest";
    clearError();
    $("#login-modal").classList.add("hidden");
    $("#profile-name").textContent = role === "admin" ? "Local admin" : "Guest";
    $("#profile-role").textContent = role === "admin" ? "Browser-only admin" : "Browsing as guest";
    $("#user-avatar").textContent = role === "admin" ? "A" : "G";
    $("#welcome-name").textContent = role === "admin" ? "admin" : "friend";
    $("#logout-button").setAttribute("aria-label", role === "admin" ? "Sign out" : "Admin sign in");
    $("#logout-button").title = role === "admin" ? "Sign out" : "Admin sign in";
    $("#logout-button").textContent = role === "admin" ? "↗" : "→";
    $("#add-item-button").classList.toggle("hidden", role !== "admin");
    $("#edit-special-button").classList.toggle("hidden", role !== "admin");
    await Promise.all([fetchMenu(), fetchSpecial(), fetchCrowd()]);
  }

  function setLoginRole(nextRole) {
    loginIntent = nextRole;
    document.querySelectorAll(".login-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.role === loginIntent));
    $("#login-user-id").value = "";
    $("#login-password").value = "";
    $("#login-error").textContent = "";
    document.querySelectorAll(".admin-credentials").forEach((field) => field.classList.toggle("hidden", loginIntent !== "admin"));
    const adminRecord = offlineMode ? getOfflineAdminRecord() : null;
    const isPasswordSetup = offlineMode && !adminRecord;
    $("#login-user-id-field").classList.toggle("hidden", loginIntent !== "admin" || offlineMode);
    $("#login-password-field").classList.toggle("hidden", loginIntent !== "admin");
    $("#login-confirm-field").classList.toggle("hidden", loginIntent !== "admin" || !isPasswordSetup);
    $("#login-user-id").disabled = loginIntent !== "admin" || offlineMode;
    $("#login-password").disabled = loginIntent !== "admin";
    $("#login-confirm-password").disabled = loginIntent !== "admin" || !isPasswordSetup;
    $("#login-user-id").required = loginIntent === "admin" && !offlineMode;
    $("#login-password").required = loginIntent === "admin";
    $("#login-confirm-password").required = loginIntent === "admin" && isPasswordSetup;
    $("#login-password").autocomplete = isPasswordSetup ? "new-password" : "current-password";
    $("#login-password").minLength = isPasswordSetup ? 8 : 0;
    $("#login-submit").querySelector("span").textContent = loginIntent === "admin"
      ? isPasswordSetup ? "Set admin password" : "Admin sign in"
      : "Continue as guest";
    $("#demo-hint").textContent = loginIntent === "admin"
      ? offlineMode
        ? isPasswordSetup
          ? "Set a password of at least 8 characters. This local password is not secure authentication."
          : "This password unlocks editing only in this browser."
        : "Enter the admin account UUID from Supabase Authentication → Users and its password."
      : "No student account or password needed.";
  }

  async function signIn(event) {
    event.preventDefault();
    $("#login-error").textContent = "";
    if (offlineMode) {
      if (loginIntent !== "admin") {
        await renderOfflineApp("student");
        return;
      }
      const password = $("#login-password").value;
      const record = getOfflineAdminRecord();
      if (!record) {
        if (password.length < 8) {
          $("#login-error").textContent = "Choose a password with at least 8 characters.";
          return;
        }
        if (password !== $("#login-confirm-password").value) {
          $("#login-error").textContent = "The passwords do not match.";
          return;
        }
        const newRecord = await hashAdminPassword(password);
        localStorage.setItem(offlineAdminKey, JSON.stringify(newRecord));
        await renderOfflineApp("admin");
        showToast("Local admin password set.");
        return;
      }
      const candidate = await hashAdminPassword(password, record.salt);
      if (candidate.hash !== record.hash) {
        $("#login-error").textContent = "Incorrect admin password.";
        return;
      }
      await renderOfflineApp("admin");
      showToast("Signed in as local admin.");
      return;
    }
    if (loginIntent === "guest") {
      await startGuestSession();
      return;
    }
    const userId = $("#login-user-id").value.trim();
    const password = $("#login-password").value;
    const { data, error } = await supabaseClient.functions.invoke("admin-login-by-user-id", {
      body: { userId, password }
    });
    if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
      $("#login-error").textContent = error?.message || data?.error || "Admin sign-in failed. Check the user ID and password.";
      return;
    }
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (sessionError || !sessionData?.session || !sessionData.user) {
      $("#login-error").textContent = sessionError?.message || "Admin sign-in failed. Please try again.";
      return;
    }
    if (loginIntent === "admin") {
      try {
        if (!(await checkAdmin(sessionData.user.id))) {
          await supabaseClient.auth.signOut();
          $("#login-error").textContent = "This account isn’t designated as a canteen admin.";
          return;
        }
      } catch (checkError) {
        await supabaseClient.auth.signOut();
        $("#login-error").textContent = checkError.message;
        return;
      }
    }
    await renderApp(sessionData);
  }

  async function startGuestSession() {
    loginIntent = "guest";
    $("#login-error").textContent = "";
    const { data: currentSession, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw new Error(`Could not check guest access: ${sessionError.message}`);
    if (currentSession.session) {
      await renderApp(currentSession.session);
      return;
    }
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) {
      if (error.code === "anonymous_provider_disabled" || error.message.toLowerCase().includes("anonymous sign-ins are disabled")) {
        await renderPublicGuest();
        return;
      }
      throw new Error(`Guest access is unavailable. Enable anonymous sign-ins in Supabase Authentication settings. ${error.message}`);
    }
    if (!data.session) {
      throw new Error("Supabase did not create a guest session. Please try again.");
    }
    await renderApp(data.session);
  }

  async function handleProfileAction() {
    if (offlineMode) {
      if (role === "admin") {
        await renderOfflineApp("student");
        showToast("Signed out of the local admin account.");
        return;
      }
      setLoginRole("admin");
      $("#login-modal").classList.remove("hidden");
      $("#login-password").focus();
      return;
    }
    if (role === "admin") {
      setLoginRole("guest");
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        setLoginRole("admin");
        reportError(`Could not sign out: ${error.message}`);
      }
      return;
    }
    setLoginRole("admin");
    $("#login-modal").classList.remove("hidden");
    $("#login-user-id").focus();
  }

  function closeItemModal() {
    $("#item-modal").classList.add("hidden");
    $("#item-form").reset();
    editingId = null;
  }

  function openItemModal(dish = null) {
    if (role !== "admin") return;
    editingId = dish ? dish.id : null;
    $("#modal-title").textContent = dish ? "Edit menu item" : "Add a menu item";
    $("#item-submit-label").textContent = dish ? "Save changes" : "Add to menu";
    const form = $("#item-form");
    if (dish) {
      form.elements.name.value = dish.name;
      form.elements.description.value = dish.description;
      form.elements.price.value = dish.price;
      form.elements.category.value = dish.category;
      form.elements.available.checked = dish.available;
    } else {
      form.reset();
      form.elements.available.checked = true;
    }
    $("#item-modal").classList.remove("hidden");
    form.elements.name.focus();
  }

  async function saveMenuItem(event) {
    event.preventDefault();
    if (role !== "admin") return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const item = {
      name: values.get("name").trim(),
      description: values.get("description").trim(),
      price: Number(values.get("price")),
      category: values.get("category"),
      available: form.elements.available.checked
    };
    const wasEditing = Boolean(editingId);
    if (offlineMode || !supabaseClient) {
      if (wasEditing) {
        state.menu = state.menu.map((dish) => String(dish.id) === String(editingId) ? { ...dish, ...item } : dish);
      } else {
        state.menu.push({ ...item, id: Date.now(), sort_order: state.menu.length + 1 });
      }
      localStorage.setItem(offlineMenuKey, JSON.stringify(state.menu));
      closeItemModal();
      await fetchMenu();
      showToast(wasEditing ? "Menu item updated in this browser." : "Menu item added in this browser.");
      return;
    }
    const request = wasEditing
      ? supabaseClient.from("menu_items").update(item).eq("id", editingId)
      : supabaseClient.from("menu_items").insert(item);
    const { error } = await request;
    if (error) {
      reportError(`Could not save the menu item: ${error.message}`);
      return;
    }
    closeItemModal();
    await fetchMenu();
    showToast(wasEditing ? "Menu item updated." : "New dish added to the menu.");
  }

  async function handleMenuAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button || role !== "admin") return;
    const dish = state.menu.find((item) => String(item.id) === button.dataset.id);
    if (!dish) return;
    if (button.dataset.action === "edit") {
      openItemModal(dish);
      return;
    }
    let request;
    let message;
    if (button.dataset.action === "availability") {
      if (offlineMode || !supabaseClient) {
        state.menu = state.menu.map((item) => String(item.id) === String(dish.id) ? { ...item, available: !item.available } : item);
        localStorage.setItem(offlineMenuKey, JSON.stringify(state.menu));
        await fetchMenu();
        showToast(dish.available ? `${dish.name} is marked sold out.` : `${dish.name} is marked available.`);
        return;
      }
      request = supabaseClient.from("menu_items").update({ available: !dish.available }).eq("id", dish.id);
      message = dish.available ? `${dish.name} is marked sold out.` : `${dish.name} is marked available.`;
    } else if (button.dataset.action === "delete") {
      if (offlineMode || !supabaseClient) {
        if (!window.confirm(`Remove ${dish.name} from the menu?`)) return;
        state.menu = state.menu.filter((item) => String(item.id) !== String(dish.id));
        localStorage.setItem(offlineMenuKey, JSON.stringify(state.menu));
        await fetchMenu();
        showToast(`${dish.name} removed from the menu.`);
        return;
      }
      request = supabaseClient.from("menu_items").delete().eq("id", dish.id);
      message = `${dish.name} removed from the menu.`;
    } else {
      return;
    }
    const { error } = await request;
    if (error) {
      reportError(`Could not update the menu: ${error.message}`);
      return;
    }
    await fetchMenu();
    showToast(message);
  }

  async function submitVote(event) {
    const button = event.target.closest("[data-vote]");
    if (!button || role !== "student") return;
    if (offlineMode || !supabaseClient) {
      const nextVote = Number(button.dataset.vote);
      localStorage.setItem(offlineVoteKey, String(nextVote));
      state.myVote = nextVote;
      const voteCount = offlineCrowd.vote_count + 1;
      const previousTotal = offlineCrowd.average_score * offlineCrowd.vote_count;
      state.crowd = {
        average_score: (previousTotal + nextVote) / voteCount,
        vote_count: voteCount
      };
      renderCrowd();
      showToast("Your vote was saved in this browser.");
      return;
    }
    if (!sessionUser) return;
    const { error } = await supabaseClient.from("crowd_votes").upsert({
      user_id: sessionUser.id,
      score: Number(button.dataset.vote)
    }, { onConflict: "user_id" });
    if (error) {
      reportError(`Could not save your crowd vote: ${error.message}`);
      return;
    }
    try {
      await fetchCrowd();
      showToast("Thanks for checking in!");
    } catch (refreshError) {
      reportError(refreshError.message);
    }
  }

  function closeSpecialModal() {
    $("#special-modal").classList.add("hidden");
  }

  function openSpecialModal() {
    if (role !== "admin") return;
    const form = $("#special-form");
    form.elements.name.value = state.special ? state.special.name : "";
    form.elements.description.value = state.special ? state.special.description : "";
    form.elements.price.value = state.special ? state.special.price : "";
    $("#special-modal").classList.remove("hidden");
    form.elements.name.focus();
  }

  async function saveSpecial(event) {
    event.preventDefault();
    if (role !== "admin") return;
    const values = new FormData(event.currentTarget);
    const special = {
      special_date: localDateISO(),
      name: values.get("name").trim(),
      description: values.get("description").trim(),
      price: Number(values.get("price"))
    };
    if (offlineMode || !supabaseClient) {
      state.special = special;
      localStorage.setItem(offlineSpecialKey, JSON.stringify(special));
      closeSpecialModal();
      renderSpecial();
      showToast("Today’s special updated in this browser.");
      return;
    }
    const { error } = await supabaseClient
      .from("canteen_specials")
      .upsert(special, { onConflict: "special_date" });
    if (error) {
      reportError(`Could not update today’s special: ${error.message}`);
      return;
    }
    closeSpecialModal();
    await fetchSpecial();
    showToast("Today’s special has been updated.");
  }

  function setDate() {
    $("#today-label").textContent = new Intl.DateTimeFormat("en", {
      weekday: "short", month: "short", day: "numeric"
    }).format(new Date()).toUpperCase();
  }

  function initialize() {
    if (offlineMode) {
      supabaseClient = null;
      $(".live-pill").innerHTML = "<span></span> DEMO MODE";
      $(".crowd-live").innerHTML = "<span></span> DEMO";
      $(".crowd-footnote").textContent = "Votes are saved in this browser only";
    } else {
      supabaseClient = supabaseLibrary.createClient(config.url, config.publishableKey);
    }
    $("#login-form").addEventListener("submit", (event) => {
      signIn(event).catch((error) => {
        console.error(error);
        $("#login-error").textContent = error.message;
      });
    });
    document.querySelectorAll(".login-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        try {
          setLoginRole(tab.dataset.role);
        } catch (error) {
          $("#login-error").textContent = error.message;
        }
      });
    });
    $("#logout-button").addEventListener("click", () => {
      handleProfileAction().catch((error) => reportError(error.message));
    });
    document.querySelectorAll(".menu-tab").forEach((tab) => tab.addEventListener("click", () => {
      activeFilter = tab.dataset.filter;
      document.querySelectorAll(".menu-tab").forEach((item) => item.classList.toggle("active", item === tab));
      renderMenu();
    }));
    $("#vote-options").addEventListener("click", (event) => {
      submitVote(event).catch((error) => reportError(error.message));
    });
    $("#add-item-button").addEventListener("click", () => openItemModal());
    $("#modal-close").addEventListener("click", closeItemModal);
    $("#item-modal").addEventListener("click", (event) => {
      if (event.target === $("#item-modal")) closeItemModal();
    });
    $("#item-form").addEventListener("submit", (event) => {
      saveMenuItem(event).catch((error) => reportError(error.message));
    });
    menuGrid.addEventListener("click", (event) => {
      handleMenuAction(event).catch((error) => reportError(error.message));
    });
    $("#edit-special-button").addEventListener("click", openSpecialModal);
    $("#special-modal-close").addEventListener("click", closeSpecialModal);
    $("#special-modal").addEventListener("click", (event) => {
      if (event.target === $("#special-modal")) closeSpecialModal();
    });
    $("#special-form").addEventListener("submit", (event) => {
      saveSpecial(event).catch((error) => reportError(error.message));
    });
    setDate();
    if (offlineMode) {
      renderApp(null).catch((error) => reportError(error.message));
      return;
    }
    supabaseClient.auth.getSession()
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (data.session) {
          await renderApp(data.session);
        } else {
          await startGuestSession();
        }
      })
      .catch((error) => {
        console.error(error);
        loginIntent = "guest";
        setLoginRole("guest");
        $("#login-modal").classList.remove("hidden");
        $("#login-error").textContent = error.message.includes("Guest access")
          ? error.message
          : `Could not start guest access: ${error.message}`;
      });
    supabaseClient.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT" || loginIntent !== "guest") return;
      window.setTimeout(() => {
        startGuestSession().catch((error) => {
          console.error(error);
          setLoginRole("guest");
          $("#login-modal").classList.remove("hidden");
          $("#login-error").textContent = error.message;
        });
      }, 0);
    });
  }

  initialize();
})();
