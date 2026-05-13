let posts = JSON.parse(localStorage.getItem("posts")) || [];

const feed = document.getElementById("feed");

function save() {
  localStorage.setItem("posts", JSON.stringify(posts));
}

function createPost() {
  const text = document.getElementById("postInput").value;
  const type = document.getElementById("postType").value;
  const school = document.getElementById("schoolSelect").value;

  if (!text.trim()) return;

  const post = {
    id: Date.now(),
    text,
    type,
    school,
    votes: 0,
    time: new Date().toLocaleTimeString()
  };

  posts.unshift(post);
  save();
  render();

  document.getElementById("postInput").value = "";
}

function vote(id, value) {
  posts = posts.map(p => {
    if (p.id === id) p.votes += value;
    return p;
  });

  save();
  render();
}

function render() {
  const school = document.getElementById("schoolSelect").value;
  feed.innerHTML = "";

  posts
    .filter(p => p.school === school)
    .sort((a, b) => b.votes - a.votes)
    .forEach(post => {
      const div = document.createElement("div");
      div.className = "post";

      div.innerHTML = `
        <div class="type">#${post.type} • ${post.time}</div>
        <div>${post.text}</div>
        <div class="vote">
          ⭐ ${post.votes}
          <button onclick="vote(${post.id}, 1)">▲</button>
          <button onclick="vote(${post.id}, -1)">▼</button>
        </div>
      `;

      feed.appendChild(div);
    });
}

function clearFeed() {
  posts = [];
  save();
  render();
}

document.getElementById("schoolSelect").addEventListener("change", render);

render();
