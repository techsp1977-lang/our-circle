// Personal greeting from the invite: welcome.html?to=Jeana&c=The%20Proctors (plain text only).
(function () {
  var q = new URLSearchParams(location.search), to = (q.get('to') || '').slice(0, 40), c = (q.get('c') || '').slice(0, 60);
  if (to) document.getElementById('title').textContent = 'Welcome, ' + to + '!';
  if (c) document.getElementById('lead').textContent = 'You’re invited to ' + c + ' on Our Circle: a private place for family chats, birthdays, photos and a personal journal. Setup takes about 3 minutes.';
})();
