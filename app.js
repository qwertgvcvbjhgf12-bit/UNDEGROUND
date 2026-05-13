const feed = document.getElementById("feed");

// local cache (prevents full reload every time)
let postsCache = new Map();

/* -----------------------------
   LOAD POSTS (initial + sync)
------------------------------*/
async function loadPosts() {
  const { data, error } = await supabaseClient
    .from("posts")
    .select("*")
    .order("votes", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  postsCache.clear();
  data.forEach(p => postsCache.set(p.id, p));

  render([...postsCache.values()]);
}

/* -----------------------------
   RENDER UI
------------------------------*/
function render(posts) {
  feed.innerHTML = "";

  posts.forEach(post => {
    const div = document.createElement("div");
    div.className = "post";
    div.setAttribute("data-id", post.id);

    div.innerHTML = `
      <div class="meta">
        #${post.type} • ${post.school}
      </div>

      <div>${post.text}</div>

      <div class="actions">
        ⭐ <span class="vote-count">${post.votes}</span>
        <button onclick="vote(${post.id}, 1)">▲</button>
        <button onclick="vote(${post.id}, -1)">▼</button>
      </div>
    `;

    feed.appendChild(div);
  });
}

/* -----------------------------
   POST (OPTIMISTIC UI)
------------------------------*/
document.getElementById("send")
  .addEventListener("click", async () => {

    const text = document.getElementById("input").value;
    const school = document.getElementById("school").value;
    const type = document.getElementById("type").value;

    if (!text.trim()) return;

    if (badWords(text)) {
      alert("Blocked by moderation");
      return;
    }

    // 🔥 1. create optimistic post instantly
    const tempId = Date.now();

    const newPost = {
      id: tempId,
      text,
      school,
      type,
      votes: 0
    };

    postsCache.set(tempId, newPost);
    render([...postsCache.values()]);

    document.getElementById("input").value = "";

    // 🔥 2. send to Supabase
    const { data, error } = await supabaseClient
      .from("posts")
      .insert([{
        text,
        school,
        type,
        votes: 0
      }])
      .select()
      .single();

    if (error) {
      console.error(error);
      return;
    }

    // 🔥 3. replace temp post with real one
    postsCache.delete(tempId);
    postsCache.set(data.id, data);

    render([...postsCache.values()]);
  });

/* -----------------------------
   VOTING (INSTANT UI UPDATE)
------------------------------*/
async function vote(id, amount) {

  const post = postsCache.get(id);
  if (!post) return;

  // 🔥 INSTANT UI UPDATE (NO LAG)
  post.votes += amount;
  postsCache.set(id, post);
  render([...postsCache.values()]);

  // 🔥 BACKGROUND SYNC
  const { error } = await supabaseClient
    .from("posts")
    .update({ votes: post.votes })
    .eq("id", id);

  if (error) console.error(error);
}

/* -----------------------------
   BAD WORD FILTER
------------------------------*/
function badWords(text) {
  const blocked = ["bomb", "kill", "shoot school"];

  return blocked.some(word =>
    text.toLowerCase().includes(word)
  );
}

/* -----------------------------
   REALTIME SYNC (OTHERS ONLY)
------------------------------*/
supabaseClient
  .channel("posts-channel")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "posts"
    },
    (payload) => {
      console.log("SYNC:", payload);

      // only refresh cache from DB changes
      loadPosts();
    }
  )
  .subscribe();

/* -----------------------------
   INIT
------------------------------*/
loadPosts();
