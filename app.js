const feed = document.getElementById("feed");

let postsCache = new Map();
const voteLock = new Set();

// ------------------------------
function safeRequest(fn) {
  return fn().catch(err => {
    console.error(err);
    return null;
  });
}

// ------------------------------
function getSchool() {
  return document.getElementById("school").value.trim();
}

// ------------------------------
function getHotScore(p) {
  const age =
    (Date.now() - new Date(p.created_at || Date.now())) / 36e5;

  return (
    ((p.votes || 0) * 2 + (p.comments_count || 0) * 3) /
    Math.pow(age + 2, 1.5)
  );
}

// ------------------------------
async function loadPosts() {
  const school = getSchool();

  const { data } = await safeRequest(() =>
    supabaseClient
      .from("posts")
      .select("*")
      .eq("school", school)
  );

  if (!data) return;

  postsCache = new Map(data.map(x => [x.id, x]));
  render();
}

// ------------------------------
function render() {
  const list = [...postsCache.values()].sort(
    (a, b) => getHotScore(b) - getHotScore(a)
  );

  feed.innerHTML = "";

  list.forEach(item => {
    const el = document.createElement("div");
    el.className = "post";
    el.setAttribute("data-id", item.id);

    el.innerHTML = `
      <div>🏫 ${item.school}</div>
      <div>${item.text}</div>

      <div>
        ⭐ <span>${item.votes || 0}</span>
        💬 ${item.comments_count || 0}

        <button onclick="vote(${item.id}, 1)">▲</button>
        <button onclick="vote(${item.id}, -1)">▼</button>
      </div>
    `;

    feed.appendChild(el);
  });
}

// ------------------------------
document.getElementById("send").addEventListener("click", async () => {
  const text = document.getElementById("input").value;
  const school = getSchool();
  const type = document.getElementById("type").value;

  if (!text.trim()) return;

  const tempId = Date.now();

  const temp = {
    id: tempId,
    text,
    school,
    type,
    votes: 0,
    comments_count: 0,
    created_at: new Date().toISOString()
  };

  postsCache.set(tempId, temp);
  render();

  document.getElementById("input").value = "";

  const { data } = await supabaseClient
    .from("posts")
    .insert([
      {
        text,
        school,
        type,
        votes: 0,
        comments_count: 0,
        created_at: new Date().toISOString()
      }
    ])
    .select()
    .single();

  if (!data) return;

  postsCache.delete(tempId);
  postsCache.set(data.id, data);

  render();
});

// ------------------------------
async function vote(id, amount) {
  if (voteLock.has(id)) return;
  voteLock.add(id);

  const item = postsCache.get(id);
  if (!item) return;

  item.votes = (item.votes || 0) + amount;
  postsCache.set(id, item);

  render();

  await supabaseClient
    .from("posts")
    .update({ votes: item.votes })
    .eq("id", id);

  voteLock.delete(id);
}

// ------------------------------
function badWords(text) {
  return ["bomb", "kill", "shoot school"].some(w =>
    text.toLowerCase().includes(w)
  );
}

// ------------------------------
supabaseClient
  .channel("posts")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "posts" },
    () => loadPosts()
  )
  .subscribe();

// ------------------------------
loadPosts();

// ------------------------------
document.getElementById("school")
  .addEventListener("change", loadPosts);
