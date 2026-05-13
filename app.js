// ============================================================
// UNDERGROUND — Anonymous Teen Social Network
// Fixed: per-school realtime subscriptions, channel cleanup,
//        optimistic UI, bad-word guard, and hot-score ranking.
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
// Replace these with your actual Supabase project values.
// const supabaseClient = supabase.createClient(
//   "https://YOUR_PROJECT.supabase.co",
//   "YOUR_ANON_KEY"
// );

// ── STATE ────────────────────────────────────────────────────
const feed      = document.getElementById("feed");
let postsCache  = new Map();          // id → post object
const voteLock  = new Set();          // ids currently being voted on
let activeChannel = null;             // current Realtime channel

// ── HELPERS ──────────────────────────────────────────────────

/** Wraps a Supabase call and swallows errors, returning null on failure. */
function safeRequest(fn) {
  return fn().catch(err => {
    console.error("[Underground]", err);
    return null;
  });
}

/** Returns the currently selected school string. */
function getSchool() {
  return document.getElementById("school").value.trim();
}

/**
 * Reddit-style "hot" score.
 * Higher votes + comments = higher score, decays with age.
 */
function getHotScore(p) {
  const ageHours = (Date.now() - new Date(p.created_at || Date.now())) / 36e5;
  return (
    ((p.votes || 0) * 2 + (p.comments_count || 0) * 3) /
    Math.pow(ageHours + 2, 1.5)
  );
}

/**
 * Basic profanity / danger-word check.
 * Extend the list as needed.
 */
function containsBadWords(text) {
  const banned = ["bomb", "kill", "shoot school", "shoot up"];
  return banned.some(w => text.toLowerCase().includes(w));
}

// ── RENDER ────────────────────────────────────────────────────

/** Re-renders the feed from postsCache, sorted by hot score. */
function render() {
  const sorted = [...postsCache.values()].sort(
    (a, b) => getHotScore(b) - getHotScore(a)
  );

  feed.innerHTML = "";

  if (sorted.length === 0) {
    feed.innerHTML = `<p class="empty">No posts yet for this school. Be the first! 👀</p>`;
    return;
  }

  sorted.forEach(item => {
    const el = document.createElement("div");
    el.className = "post";
    el.setAttribute("data-id", item.id);

    // Badge colour per post type
    const typeBadge = item.type
      ? `<span class="badge badge--${item.type}">${item.type}</span>`
      : "";

    el.innerHTML = `
      <div class="post__header">
        <span class="post__school">🏫 ${item.school}</span>
        ${typeBadge}
      </div>
      <p class="post__text">${escapeHTML(item.text)}</p>
      <div class="post__footer">
        <span class="post__votes">⭐ <span class="vote-count">${item.votes || 0}</span></span>
        <span class="post__comments">💬 ${item.comments_count || 0}</span>
        <button class="btn btn--up"   onclick="vote(${item.id},  1)">▲</button>
        <button class="btn btn--down" onclick="vote(${item.id}, -1)">▼</button>
      </div>
    `;

    feed.appendChild(el);
  });
}

/** Minimal XSS protection — escapes HTML special chars. */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── DATA LOADING ──────────────────────────────────────────────

/** Fetches all posts for the selected school and re-renders. */
async function loadPosts() {
  const school = getSchool();
  if (!school) return;

  const result = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .select("*")
      .eq("school", school)
      .order("created_at", { ascending: false })
  );

  if (!result?.data) return;

  postsCache = new Map(result.data.map(x => [x.id, x]));
  render();

  // Re-subscribe scoped to this school
  subscribeToSchool(school);
}

// ── REALTIME (THE BIG FIX) ────────────────────────────────────

/**
 * Creates a Supabase Realtime channel filtered to ONE school.
 * Removes the previous channel first so we never listen to
 * multiple schools simultaneously.
 *
 * IMPORTANT: For the server-side filter to work you must enable
 * "Filter pushdown" for the posts table in your Supabase dashboard:
 *   Database → Replication → posts → enable realtime + row filter support
 */
function subscribeToSchool(school) {
  // ── tear down the old channel ──
  if (activeChannel) {
    supabaseClient.removeChannel(activeChannel);
    activeChannel = null;
  }

  // ── create a new channel scoped to this school ──
  activeChannel = supabaseClient
    .channel(`posts:school=eq.${school}`)          // unique name per school
    .on(
      "postgres_changes",
      {
        event:  "*",
        schema: "public",
        table:  "posts",
        filter: `school=eq.${school}`              // ← server-side filter (KEY FIX)
      },
      payload => {
        // Handle each CDC event individually — no full reload needed
        switch (payload.eventType) {
          case "INSERT":
            // Don't overwrite an optimistic post that already exists
            if (!postsCache.has(payload.new.id)) {
              postsCache.set(payload.new.id, payload.new);
            }
            break;

          case "UPDATE":
            postsCache.set(payload.new.id, payload.new);
            break;

          case "DELETE":
            postsCache.delete(payload.old.id);
            break;
        }
        render();
      }
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        console.log(`[Underground] Subscribed to school: ${school}`);
      }
    });
}

// ── POSTING ───────────────────────────────────────────────────

document.getElementById("send").addEventListener("click", async () => {
  const input  = document.getElementById("input");
  const text   = input.value.trim();
  const school = getSchool();
  const type   = document.getElementById("type").value;

  if (!text)   return;
  if (!school) { alert("Please select a school first."); return; }

  // Content moderation check
  if (containsBadWords(text)) {
    alert("⚠️ Your post was flagged and cannot be submitted.");
    return;
  }

  // ── Optimistic insert ──
  const tempId = `temp_${Date.now()}`;
  const tempPost = {
    id:             tempId,
    text,
    school,
    type,
    votes:          0,
    comments_count: 0,
    created_at:     new Date().toISOString(),
    _optimistic:    true
  };
  postsCache.set(tempId, tempPost);
  render();
  input.value = "";

  // ── Persist to Supabase ──
  const result = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .insert([{ text, school, type, votes: 0, comments_count: 0 }])
      .select()
      .single()
  );

  // Replace temp entry with real one (or remove on failure)
  postsCache.delete(tempId);
  if (result?.data) {
    postsCache.set(result.data.id, result.data);
  } else {
    alert("Failed to post. Please try again.");
  }
  render();
});

// ── VOTING ────────────────────────────────────────────────────

/**
 * Optimistic vote: updates locally immediately, then persists.
 * voteLock prevents double-clicking from sending duplicate requests.
 */
async function vote(id, amount) {
  if (voteLock.has(id)) return;
  voteLock.add(id);

  const item = postsCache.get(id);
  if (!item) { voteLock.delete(id); return; }

  // Optimistic update
  const previousVotes = item.votes || 0;
  item.votes = previousVotes + amount;
  postsCache.set(id, item);
  render();

  const result = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .update({ votes: item.votes })
      .eq("id", id)
  );

  // Roll back on failure
  if (!result) {
    item.votes = previousVotes;
    postsCache.set(id, item);
    render();
  }

  voteLock.delete(id);
}

// ── SCHOOL CHANGE ─────────────────────────────────────────────

document.getElementById("school").addEventListener("change", () => {
  postsCache.clear();   // clear previous school's posts immediately
  render();
  loadPosts();          // loadPosts → subscribeToSchool handles channel swap
});

// ── BOOT ──────────────────────────────────────────────────────
loadPosts();
