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

  // Reddit-style ranking formula (simplified)
  const score =
    (votes * 2 + comments * 3) / Math.pow(ageHours + 2, 1.5);

  return score;
}

// ------------------------------
// LOAD POSTS
// ------------------------------
async function loadPosts() {
  const { data, error } = await supabaseClient
    .from("posts")
    .select("*");

  if (error) return console.error(error);

  postsCache.clear();
  data.forEach(p => postsCache.set(p.id, p));

  render();
}

// ------------------------------
// RENDER (SORTED BY HOT SCORE)
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
  const school = document.getElementById("school").value;
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
// VOTING (INSTANT)
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
// COMMENTS (SIMPLE VERSION)
// ------------------------------
async function openComments(postId) {
  const comment = prompt("Write comment:");

  if (!comment) return;

  const post = postsCache.get(postId);
  post.comments_count = (post.comments_count || 0) + 1;

  postsCache.set(postId, post);
  render();

  const post = postsCache.get(postId);

await supabaseClient.from("comments").insert([
  {
    post_id: postId,
    text: comment,
    school: post.school
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
// REALTIME SYNC
// ------------------------------
supabaseClient
  .channel("posts-channel")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "posts" },
    () => loadPosts()
  )
  .subscribe();

// ------------------------------
loadPosts();
