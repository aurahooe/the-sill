const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const $ = (id) => document.getElementById(id);

const HOUR_COPY = [
  ["The light has shifted.", "Whatever you leave on the sill will catch a different colour than it did an hour ago."],
  ["A quieter hour.", "Not every note needs an audience. The public ones sit together anyway."],
  ["The window is open.", "Passers-by only see what you marked public. The rest stays on your desk."],
  ["Paper still warm.", "This room turns on the hour. Featured notes are chosen from the public pile."],
  ["Hold still a moment.", "A title, a few lines, a switch. That is the whole machine."],
  ["Evening finds the grain.", "The site keeps time even if nobody is watching the countdown."],
];

function hourSlot(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x;
}
function nextHour(d = new Date()) {
  return new Date(hourSlot(d).getTime() + 36e5);
}
function copyForHour(d = new Date()) {
  return HOUR_COPY[d.getHours() % HOUR_COPY.length];
}

function tick() {
  const now = new Date();
  const end = nextHour(now);
  const start = hourSlot(now);
  const left = Math.max(0, end - now);
  const h = String(Math.floor(left / 36e5)).padStart(2, "0");
  const m = String(Math.floor((left % 36e5) / 6e4)).padStart(2, "0");
  const s = String(Math.floor((left % 6e4) / 1000)).padStart(2, "0");
  $("countdown").textContent = `${h}:${m}:${s}`;
  const pct = ((now - start) / 36e5) * 100;
  $("hour-bar").style.width = `${pct}%`;
}

async function ensureHour() {
  const slot = hourSlot().toISOString();
  const [headline, editorial] = copyForHour();
  const { data: existing } = await sb.from("hours").select("*").eq("slot", slot).maybeSingle();
  if (existing) return existing;

  const { data: publics } = await sb
    .from("notes")
    .select("id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(24);

  const pick = publics?.length ? publics[Math.floor(Math.random() * publics.length)].id : null;
  const { data } = await sb
    .from("hours")
    .insert({ slot, headline, editorial, featured_note_id: pick })
    .select()
    .maybeSingle();
  return data || { slot, headline, editorial, featured_note_id: pick };
}

async function renderHour() {
  const hour = await ensureHour();
  const [fallbackH, fallbackE] = copyForHour();
  $("hour-kicker").textContent = new Date().toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  $("hour-headline").textContent = hour?.headline || fallbackH;
  $("hour-editorial").textContent = hour?.editorial || fallbackE;

  const card = $("feature-body");
  const empty = $("feature-empty");
  if (!hour?.featured_note_id) {
    card.hidden = true;
    empty.hidden = false;
    return;
  }
  const { data: note } = await sb
    .from("notes")
    .select("title, body, created_at, user_id, profiles(display_name, handle)")
    .eq("id", hour.featured_note_id)
    .maybeSingle();
  if (!note) {
    card.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  card.hidden = false;
  const who = note.profiles?.display_name || note.profiles?.handle || "someone passing through";
  card.innerHTML = `<h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.body)}</p><p class="byline">on the sill · ${escapeHtml(who)}</p>`;
}

async function renderPublic() {
  const { data } = await sb
    .from("notes")
    .select("id, title, body, created_at, profiles(display_name, handle)")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(24);
  const grid = $("public-grid");
  if (!data?.length) {
    grid.innerHTML = `<article class="note"><h3>Empty wood</h3><p>No public notes yet. Sign in, write, and mark one public.</p></article>`;
    return;
  }
  grid.innerHTML = data
    .map((n, i) => {
      const who = n.profiles?.display_name || n.profiles?.handle || "anonymous";
      return `<article class="note" style="animation-delay:${i * 60}ms"><h3>${escapeHtml(n.title)}</h3><p>${escapeHtml(n.body)}</p><div class="note-meta"><span>${escapeHtml(who)}</span><span>${new Date(n.created_at).toLocaleDateString()}</span></div></article>`;
    })
    .join("");
}

let session = null;

async function renderDesk() {
  const locked = $("desk-locked");
  const composer = $("composer");
  const mine = $("mine");
  $("auth-btn").textContent = session ? "Sign out" : "Sign in";
  if (!session) {
    locked.hidden = false;
    composer.hidden = true;
    mine.hidden = true;
    return;
  }
  locked.hidden = true;
  composer.hidden = false;
  mine.hidden = false;
  const { data } = await sb
    .from("notes")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  mine.innerHTML = (data || [])
    .map(
      (n) => `<article class="note">
        <h3>${escapeHtml(n.title)}</h3>
        <p>${escapeHtml(n.body)}</p>
        <div class="note-meta">
          <span>${n.is_public ? "On the sill" : "Private desk"}</span>
          <button class="linkish" data-toggle="${n.id}" data-public="${n.is_public}">${n.is_public ? "Make private" : "Make public"}</button>
        </div>
      </article>`
    )
    .join("") || `<p class="muted">Nothing on the desk yet.</p>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function ensureProfile(user) {
  if (!user) return;
  await sb.from("profiles").upsert({
    id: user.id,
    handle: (user.email || "reader").split("@")[0].slice(0, 24),
    display_name: (user.email || "Reader").split("@")[0],
  });
}

$("auth-btn").addEventListener("click", async () => {
  if (session) {
    await sb.auth.signOut();
    return;
  }
  $("auth-dialog").showModal();
});
$("desk-signin").addEventListener("click", () => $("auth-dialog").showModal());

$("signin-btn").addEventListener("click", async () => {
  const form = $("auth-form");
  const email = form.email.value.trim();
  const password = form.password.value;
  $("auth-msg").textContent = "Working…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("auth-msg").textContent = error ? error.message : "Welcome back.";
  if (!error) $("auth-dialog").close();
});

$("signup-btn").addEventListener("click", async () => {
  const form = $("auth-form");
  const email = form.email.value.trim();
  const password = form.password.value;
  $("auth-msg").textContent = "Creating desk…";
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    $("auth-msg").textContent = error.message;
    return;
  }
  if (data.user) await ensureProfile(data.user);
  $("auth-msg").textContent = data.session
    ? "Desk ready."
    : "Check your email if confirmation is on. Then sign in.";
  if (data.session) $("auth-dialog").close();
});

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!session) return;
  const fd = new FormData(e.target);
  $("compose-msg").textContent = "Saving…";
  const payload = {
    user_id: session.user.id,
    title: String(fd.get("title") || "").trim(),
    body: String(fd.get("body") || "").trim(),
    is_public: fd.get("is_public") === "on",
  };
  const { error } = await sb.from("notes").insert(payload);
  $("compose-msg").textContent = error ? error.message : "Saved.";
  if (!error) {
    e.target.reset();
    await renderDesk();
    await renderPublic();
    await renderHour();
  }
});

$("mine").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-toggle]");
  if (!btn) return;
  const id = btn.getAttribute("data-toggle");
  const was = btn.getAttribute("data-public") === "true";
  await sb.from("notes").update({ is_public: !was }).eq("id", id);
  await renderDesk();
  await renderPublic();
});

sb.auth.onAuthStateChange(async (_event, next) => {
  session = next;
  if (next?.user) await ensureProfile(next.user);
  await renderDesk();
});

tick();
setInterval(tick, 1000);
renderHour();
renderPublic();
renderDesk();

setInterval(() => {
  renderHour();
  renderPublic();
}, 60 * 1000);
