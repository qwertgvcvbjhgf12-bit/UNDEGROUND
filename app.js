const feed = document.getElementById("feed");

async function loadPosts() {

  const { data } = await supabaseClient
    .from("posts")
    .select("*")
    .order("votes", { ascending: false });

  render(data);
}

function render(posts) {

  feed.innerHTML = "";

  posts.forEach(post => {

    const div = document.createElement("div");
    div.className = "post";

    div.innerHTML = `
      <div class="meta">
        #${post.type} • ${post.school}
      </div>

      <div>${post.text}</div>

      <div class="actions">
        ⭐ ${post.votes}

        <button onclick="vote(${post.id}, 1)">▲</button>
        <button onclick="vote(${post.id}, -1)">▼</button>
      </div>
    `;

    feed.appendChild(div);
  });
}

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

    await supabaseClient
      .from("posts")
      .insert([{
        text,
        school,
        type
      }]);

    document.getElementById("input").value = "";
  });

async function vote(id, amount) {

  const { data } = await supabaseClient
    .from("posts")
    .select("votes")
    .eq("id", id)
    .single();

  await supabaseClient
    .from("posts")
    .update({
      votes: data.votes + amount
    })
    .eq("id", id);
}

function badWords(text) {

  const blocked = [
    "bomb",
    "kill",
    "shoot school"
  ];

  return blocked.some(word =>
    text.toLowerCase().includes(word)
  );
}

supabaseClient
  .channel("posts-live")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "posts"
    },
    () => {
      loadPosts();
    }
  )
  .subscribe();

loadPosts();
