const feed = document.getElementById("feed");

let postsCache = new Map();
const voteLock = new Set();
let renderPending = false;
let realtimeCooldown = false;

// ------------------------------
// SAFE WRAPPER
// ------------------------------
async function safeRequest(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error("Supabase error:", err);
    return { data: null, error: err };
  }
}

// ------------------------------
// HOT SCORE
// ------------------------------
function getHotScore(p) {
  const ageHours =
    (Date.now() - new Date(p.created_at || Date.now()).getTime()) /
    36e5;

  const votes = p.votes || 0;
  const comments = p.comments_count || 0;

  return (votes * 2 + comments * 3) / Math.pow(ageHours + 2, 1.5);
}

// ------------------------------
// SCHOOL
// ------------------------------
function getSchool() {
  return document.getElementById("school").value.trim();
}

// ------------------------------
// LOAD POSTS
// ------------------------------
async function loadPosts() {
  const school = getSchool();

  const { data, error } = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .select("*")
      .eq("school", school)
  );

  if (error || !data) return;

  postsCache.clear();
  data.forEach(p => postsCache.set(p.id, p));

  render();
}

// ------------------------------
// RENDER
// ------------------------------
function render() {
  if (renderPending) return;

  renderPending = true;

  requestAnimationFrame(() => {
    const posts = [...postsCache.values()]
      .sort((a, b) => getHotScore(b) - getHotScore(a));

    feed.innerHTML = "";

    posts.forEach(p => {
      const div = document.createElement("div");
      div.className = "post";
      div.setAttribute("data-id", p.id);

      div.innerHTML = `
        <div class="meta">
          🏫 ${p.school} • 🔥 ${getHotScore(p).toFixed(2)}
        </div>

        <div>${p.text}</div>

        <div class="actions">
          ⭐ <span class="vote-count">${p.votes || 0}</span>
          💬 ${p.comments_count || 0}

          <button onclick="vote(${p.id}, 1)">▲</button>
          <button onclick="vote(${p.id}, -1)">▼</button>
          <button onclick="openComments(${p.id})">💬</button>
        </div>
      `;

      feed.appendChild(div);
    });

    renderPending = false;
  });
}

// ------------------------------
// POST (INSTANT)
// ------------------------------
document.getElementById("send").addEventListener("click", async () => {
  const text = document.getElementById("input").value;
  const school = getSchool();
  const type = document.getElementById("type").value;

  if (!text.trim()) return;
  if (badWords(text)) return alert("Blocked");

  const tempId = Date.now();

  const tempPost = {
    id: tempId,
    text,
    school,
    type,
    votes: 0,
    comments_count: 0,
    created_at: new Date().toISOString()
  };

  postsCache.set(tempId, tempPost);
  render();

  document.getElementById("input").value = "";

  const { data, error } = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .insert([{
        text,
        school,
        type,
        votes: 0,
        comments_count: 0,
        created_at: new Date().toISOString()
      }])
      .select()
      .single()
  );

  if (error || !data) return;

  postsCache.delete(tempId);
  postsCache.set(data.id, data);

  render();
});

// ------------------------------
// VOTE (SAFE)
// ------------------------------
async function vote(id, amount) {
  if (voteLock.has(id)) return;
  voteLock.add(id);

  const p = postsCache.get(id);
  if (!p) return;

  p.votes = (p.votes || 0) + amount;
  postsCache.set(id, p);

  render();

  await safeRequest(() =>
    supabaseClient
      .from("posts")
      .update({ votes: p.votes })
      .eq("id", id)
  );

  voteLock.delete(id);
}

// ------------------------------
// COMMENTS (FIXED - NO DUPLICATE DECLARE BUG)
// ------------------------------
async function openComments(postId) {
  const text = prompt("Write comment:");
  if (!text) return;

  const p = postsCache.get(postId);
  if (!p) return;

  p.comments_count = (p.comments_count || 0) + 1;
  postsCache.set(postId, p);

  render();

  await safeRequest(() =>
    supabaseClient.from("comments").insert([
      {
        post_id: postId,
        text: text,
        school: p.school
      }
    ])
  );

  await safeRequest(() =>
    supabaseClient
      .from("posts")
      .update({ comments_count: p.comments_count })
      .eq("id", postId)
  );
}

// ------------------------------
// BAD WORD FILTER
// ------------------------------
function badWords(text) {
  return ["bomb", "kill", "shoot school"].some(w =>
    text.toLowerCase().includes(w)
  );
}

// ------------------------------
// REALTIME (SAFE)
// ------------------------------
supabaseClient
  .channel("posts-channel")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "posts" },
    () => {
      if (realtimeCooldown) return;

      realtimeCooldown = true;
      loadPosts();

      setTimeout(() => {
        realtimeCooldown = false;
      }, 1000);
    }
  )
  .subscribe();

// ------------------------------
// INIT
// ------------------------------
loadPosts();

// ------------------------------
// SCHOOL CHANGE
// ------------------------------
document.getElementById("school")
  .addEventListener("change", loadPosts);
