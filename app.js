const feed = document.getElementById("feed");

let postsCache = new Map();

// ------------------------------
// HOT SCORE ALGORITHM
// ------------------------------
function getHotScore(post) {
  const ageHours =
    (Date.now() - new Date(post.created_at || Date.now()).getTime()) /
    36e5;

  const votes = post.votes || 0;
  const comments = post.comments_count || 0;

  return (votes * 2 + comments * 3) / Math.pow(ageHours + 2, 1.5);
}

// ------------------------------
// GET CURRENT SCHOOL
// ------------------------------
function getSchool() {
  return document.getElementById("school").value;
}

// ------------------------------
// LOAD POSTS (FILTERED BY SCHOOL)
// ------------------------------
async function loadPosts() {
  const school = getSchool();

  const { data, error } = await supabaseClient
    .from("posts")
    .select("*")
    .eq("school", school);   // 🔥 THIS FIXES CROSS-SCHOOL LEAK

  if (error) return console.error(error);

  postsCache.clear();
  data.forEach(p => postsCache.set(p.id, p));

  render();
}

// ------------------------------
// RENDER
// ------------------------------
function render() {
  const posts = [...postsCache.values()];

  posts.sort((a, b) => getHotScore(b) - getHotScore(a));

  feed.innerHTML = "";

  posts.forEach(post => {
    const div = document.createElement("div");
    div.className = "post";
    div.setAttribute("data-id", post.id);

    div.innerHTML = `
      <div class="meta">
        🏫 ${post.school} • 🔥 ${getHotScore(post).toFixed(2)}
      </div>

      <div>${post.text}</div>

      <div class="actions">
        ⭐ <span class="vote-count">${post.votes}</span>
        💬 ${post.comments_count || 0}

        <button onclick="vote(${post.id}, 1)">▲</button>
        <button onclick="vote(${post.id}, -1)">▼</button>
        <button onclick="openComments(${post.id})">💬</button>
      </div>
    `;

    feed.appendChild(div);
  });
}

// ------------------------------
// POST (INSTANT UI)
// ------------------------------
document.getElementById("send").addEventListener("click", async () => {
  const text = document.getElementById("input").value;
  const school = getSchool();
  const type = document.getElementById("type").value;

  if (!text.trim()) return;
  if (badWords(text)) return alert("Blocked");

  const tempId = Date.now();

  const newPost = {
    id: tempId,
    text,
    school,
    type,
    votes: 0,
    comments_count: 0,
    created_at: new Date().toISOString()
  };

  postsCache.set(tempId, newPost);
  render();

  document.getElementById("input").value = "";

  const { data, error } = await supabaseClient
    .from("posts")
    .insert([newPost])
    .select()
    .single();

  if (error) return console.error(error);

  postsCache.delete(tempId);
  postsCache.set(data.id, data);

  render();
});

// ------------------------------
// VOTING (INSTANT UI)
// ------------------------------
async function vote(id, amount) {
  const post = postsCache.get(id);
  if (!post) return;

  post.votes += amount;
  postsCache.set(id, post);

  render();

  await supabaseClient
    .from("posts")
    .update({ votes: post.votes })
    .eq("id", id);
}

// ------------------------------
// COMMENTS
// ------------------------------
async function openComments(postId) {
  const comment = prompt("Write comment:");
  if (!comment) return;

  const post = postsCache.get(postId);
  if (!post) return;

  post.comments_count = (post.comments_count || 0) + 1;
  postsCache.set(postId, post);

  render();

  await supabaseClient.from("comments").insert([
    {
      post_id: postId,
      text: comment,
      school: post.school   // 🔥 KEEP SCHOOL ISOLATION
    }
  ]);

  await supabaseClient
    .from("posts")
    .update({ comments_count: post.comments_count })
    .eq("id", postId);
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
// REALTIME SYNC (SCHOOL-LOCKED)
// ------------------------------
supabaseClient
  .channel("posts-channel")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "posts" },
    (payload) => {
      // reload only current school data
      loadPosts();
    }
  )
  .subscribe();

// ------------------------------
loadPosts();

// ------------------------------
// UPDATE FEED WHEN SCHOOL CHANGES
// ------------------------------
document.getElementById("school").addEventListener("change", () => {
  loadPosts();
});
