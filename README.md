# Vault Demo

A modern login, sign-up and admin dashboard built with plain HTML, CSS and JavaScript. No build step, no dependencies.

## Features

- Sign up, log in, log out and delete your own account
- Passwords are stored as salted **PBKDF2 (SHA-256, 150k iterations)** hashes, never plain text
- Password strength meter and show/hide toggle
- Admin dashboard: stats, search, reset password, delete user, export (no passwords), delete all
- Admin account is created on first visit, so no password is hardcoded in the code
- Slows down guessing after 5 wrong attempts (30 second pause)
- Dark mode, responsive layout, accessible (keyboard and screen-reader friendly)

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Host on GitHub Pages

1. Create a new repository on GitHub (for example `vault-demo`).
2. Upload `index.html`, `style.css`, `script.js`, `README.md` and `.nojekyll`.
   Or from a terminal:
   ```bash
   git init
   git add .
   git commit -m "Add login demo"
   git branch -M main
   git remote add origin https://github.com/<your-username>/vault-demo.git
   git push -u origin main
   ```
3. In the repository go to **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, select **main** and **/ (root)**, then **Save**.
5. After a minute your site is live at `https://<your-username>.github.io/vault-demo/`.

## Important limits

This is a front-end demo. Data lives in each visitor's own browser (localStorage), so:

- Every visitor sees only their own accounts. There is no shared user list across devices.
- The admin check runs in the browser, so it is not real security. Anyone can open dev tools and read their own browser's storage.
- Don't use real passwords you care about.

For real accounts you need a backend (for example Firebase Auth, Supabase, or a Node.js server with a database), which can reuse this interface.

# facebook
