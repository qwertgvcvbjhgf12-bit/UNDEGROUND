// ============================================================
// UNDERGROUND — Anonymous Teen Social Network
// Fixed: hard reset on school change, channel killed before
//        cache clear, no cross-school bleed possible.
// ============================================================

// ── CONFIG ───────────────────────────────────────────────────
// Uncomment and fill in your Supabase project values:
// const supabaseClient = supabase.createClient(
//   "https://YOUR_PROJECT.supabase.co",
//   "YOUR_ANON_KEY"
// );

// ── STATE ─────────────────────────────────────────────────────
const feed        = document.getElementById("feed");
let postsCache    = new Map();   // id → post object
const voteLock    = new Set();   // ids currently being voted on
let activeChannel = null;        // current Realtime channel
let currentSchool = "";          // tracks which school is loaded

// ── HELPERS ───────────────────────────────────────────────────

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
 * Basic danger-word check.
 * Extend the list as needed.
 */
function containsBadWords(text) {
  const banned = ["bomb", "kill", "shoot school", "shoot up"];
  return banned.some(w => text.toLowerCase().includes(w));
}

/** Minimal XSS protection — escapes HTML special chars. */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

    const typeBadge = item.type
      ? `<span class="badge badge--${item.type}">${item.type}</span>`
      : "";

    el.innerHTML = `
      <div class="post__header">
        <span class="post__school">🏫 ${escapeHTML(item.school)}</span>
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

// ── HARD RESET ────────────────────────────────────────────────

/**
 * Completely tears down the current school session:
 *  1. Awaits channel removal so no stale events can fire
 *  2. Clears the cache
 *  3. Wipes the DOM immediately
 * Must be called and awaited before loading a new school.
 */
async function hardReset() {
  // Step 1 — kill the channel FIRST, await it so no in-flight
  // realtime event can sneak through during the switch
  if (activeChannel) {
    await supabaseClient.removeChannel(activeChannel);
    activeChannel = null;
  }

  // Step 2 — nuke the cache so no old data can bleed into render
  postsCache.clear();
  currentSchool = "";

  // Step 3 — wipe the DOM immediately, user sees nothing from old school
  feed.innerHTML = `<p class="empty">Switching schools... 🔄</p>`;
}

// ── REALTIME ──────────────────────────────────────────────────

/**
 * Subscribes to realtime changes for ONE specific school.
 * Server-side filter means only posts for this school are pushed.
 *
 * Requires in Supabase dashboard:
 *   Database → Replication → posts → enable Realtime + filter pushdown
 */
function subscribeToSchool(school) {
  activeChannel = supabaseClient
    .channel(`posts:school=eq.${school}`)
    .on(
      "postgres_changes",
      {
        event:  "*",
        schema: "public",
        table:  "posts",
        filter: `school=eq.${school}`
      },
      payload => {
        // Guard: if school changed while an event was in-flight, discard it
        if (currentSchool !== school) return;

        switch (payload.eventType) {
          case "INSERT":
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
      console.log(`[Underground] Realtime status for "${school}": ${status}`);
    });
}

// ── DATA LOADING ──────────────────────────────────────────────

/** Loads posts for the selected school then subscribes to realtime. */
async function loadPosts() {
  const school = getSchool();

  if (!school) {
    feed.innerHTML = `<p class="empty">Select a school to see posts. 🏫</p>`;
    return;
  }

  feed.innerHTML = `<p class="empty">Loading posts... ⏳</p>`;

  const result = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .select("*")
      .eq("school", school)
      .order("created_at", { ascending: false })
  );

  // If the school changed while we were fetching, abort —
  // don't render data for a school the user already left
  if (getSchool() !== school) return;

  if (!result?.data) {
    feed.innerHTML = `<p class="empty">Failed to load posts. Try again. 😔</p>`;
    return;
  }

  currentSchool = school;
  postsCache    = new Map(result.data.map(x => [x.id, x]));
  render();

  // Subscribe only after fresh data is confirmed in place
  subscribeToSchool(school);
}

// ── SCHOOL CHANGE ─────────────────────────────────────────────

document.getElementById("school").addEventListener("change", async () => {
  await hardReset();  // channel killed + cache nuked + DOM wiped
  await loadPosts();  // fresh fetch + new scoped subscription
});

// ── POSTING ───────────────────────────────────────────────────

document.getElementById("send").addEventListener("click", async () => {
  const input  = document.getElementById("input");
  const text   = input.value.trim();
  const school = getSchool();
  const type   = document.getElementById("type").value;

  if (!text)   return;
  if (!school) { alert("Please select a school first."); return; }

  if (containsBadWords(text)) {
    alert("⚠️ Your post was flagged and cannot be submitted.");
    return;
  }

  // Optimistic insert — show post immediately before DB confirms
  const tempId   = `temp_${Date.now()}`;
  const tempPost = {
    id:             tempId,
    text,
    school,
    type,
    votes:          0,
    comments_count: 0,
    created_at:     new Date().toISOString(),
  };
  postsCache.set(tempId, tempPost);
  render();
  input.value = "";

  // Persist to Supabase
  const result = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .insert([{ text, school, type, votes: 0, comments_count: 0 }])
      .select()
      .single()
  );

  // Swap temp entry for real one, or remove it on failure
  postsCache.delete(tempId);
  if (result?.data) {
    postsCache.set(result.data.id, result.data);
  } else {
    alert("Failed to post. Please try again.");
  }
  render();
});

// ── VOTING ────────────────────────────────────────────────────

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

// ── BOOT ──────────────────────────────────────────────────────
loadPosts();
