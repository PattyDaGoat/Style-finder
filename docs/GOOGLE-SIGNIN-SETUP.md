# Turning on real Google Sign-In

Plain-English walkthrough. About 10 minutes, free, no credit card.

Right now the app shows local profiles instead of real Google sign-in. Everything works — you just get "profile saved in this browser" rather than a genuine Google account. This guide switches on the real thing.

---

## First, the part that trips everyone up

**Google will not let its sign-in button run on a file opened off your Desktop.**

When you double-click `style-finder.html`, your browser's address bar reads something like:

```
file:///Users/patricksg/Desktop/Claude Cowork/Outputs/menswear-style-profiler/style-finder.html
```

That `file://` prefix means "a document sitting on this disk." Google requires the page to live at a real **web address** — something starting with `http://` or `https://` — that you have registered with them in advance. This is a deliberate security rule, not a bug and not something a setting can override: it's how Google stops a random downloaded file from harvesting Google logins.

So there are two jobs, and **both** are required:

| Job | What it does | Skippable? |
|---|---|---|
| **1. Serve the page at a web address** | Gives the file an `http://localhost:8000` address instead of `file://` | No |
| **2. Get a Client ID from Google** | Your app's public name badge, so Google knows who's asking | No |

Do job 1 first — it's the easier one, and job 2 asks you for the address you set up in job 1.

---

## Job 1 — Give the app a real web address (2 minutes)

Your Mac already has everything needed. No installing.

1. Open **Terminal** (press `Cmd` + `Space`, type `Terminal`, hit Return).

2. Paste this line and press Return:

   ```
   cd "/Users/patricksg/Desktop/Claude Cowork/Outputs/menswear-style-profiler"
   ```

   `cd` means "change directory" — you've just pointed Terminal at the folder holding the app.

3. Paste this and press Return:

   ```
   python3 -m http.server 8000
   ```

   You should see `Serving HTTP on :: port 8000`. You've started a tiny web server on your own machine. It's only reachable from your Mac — nothing is published to the internet.

4. In Chrome, go to:

   ```
   http://localhost:8000/style-finder.html
   ```

The app loads exactly as before, but the address bar now reads `http://localhost:8000/...`. That's the address Google will accept.

**Notes on this step**

- Leave that Terminal window open while you use the app. Closing it stops the server. To stop it deliberately, click the Terminal window and press `Control` + `C`.
- Next time, you only need steps 1–3 again.
- If it says `Address already in use`, something else is on port 8000. Use `8001` instead — in the command *and* in the browser address.

> **Worth knowing:** your saved swipes live in browser storage, which is keyed to the address. `file://...` and `http://localhost:8000` count as two different places, so the profile you built by double-clicking the file won't appear at the localhost address. It isn't deleted — it's just filed under the other address. Once you switch to localhost, stay there.

---

## Job 2 — Get your Client ID from Google (about 8 minutes)

A **Client ID** is a long public string like `849201...-a1b2c3.apps.googleusercontent.com`. It's your app's name badge. It is not a password and not a secret — it's designed to sit in plain sight in your page, which is why it's safe to paste into the HTML file. What actually protects you is the list of approved addresses you register alongside it: Google only honours the badge when the request comes from an address on your list.

1. Go to **https://console.cloud.google.com/** and sign in with your Google account.

2. **Create a project.** Click the project dropdown in the top bar → **New Project**. Name it `Maison Edit`. Click **Create**, then make sure it's the selected project in that dropdown.

3. **Fill in the consent screen.** In the search bar at the top type `OAuth consent screen` and open it.
   - User type: **External**. (This just means "not restricted to a company Google Workspace." Yours is a personal Gmail, so External is correct.)
   - App name: `Maison Edit`. Support email: your own. Developer contact: your own.
   - Save through the remaining steps. You do **not** need to add scopes, and you do **not** need to submit anything for Google's review — that's only required if you publish the app to strangers.
   - Leave it in **Testing** mode. While in Testing, only accounts you list can sign in, so find the **Test users** section and add `psuttongerstein@gmail.com` (plus anyone else you want to let in). **If you skip this, your own sign-in will be refused.**

4. **Create the credential.** Search for `Credentials` → **+ Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `Maison Edit web`
   - Under **Authorized JavaScript origins**, click *Add URI* and enter exactly:

     ```
     http://localhost:8000
     ```

     Type it precisely: no trailing slash, no filename, `http` not `https`. If you used a different port in Job 1, use that number here.
   - **Authorized redirect URIs**: leave empty. The button style this app uses doesn't redirect anywhere, so it needs none.
   - Click **Create**.

5. Google shows your **Client ID**. Copy it. (You can always find it again under Credentials.) Ignore the "Client secret" — this app doesn't use one, and a secret must never go in a web page anyway.

---

## Job 3 — Paste it into the app (30 seconds)

1. Open `style-finder.html` in a text editor (TextEdit works — right-click the file → *Open With* → *TextEdit*).
2. Press `Cmd` + `F` and search for:

   ```
   GOOGLE_CLIENT_ID
   ```

3. You'll land on one line, near the top of the app's code:

   ```js
   const GOOGLE_CLIENT_ID = "";
   ```

4. Paste your ID between the quote marks:

   ```js
   const GOOGLE_CLIENT_ID = "849201735562-a1b2c3d4e5f6g7h8.apps.googleusercontent.com";
   ```

   Keep the quotes and the semicolon. Change nothing else on the line.

5. Save the file. Reload `http://localhost:8000/style-finder.html`.

The real Google button — white, with the four-colour G — now appears, along with "Create a new account with Google". Click it and you'll get Google's genuine account chooser.

---

## If something goes wrong

The app is built not to break. Whatever happens with Google, "Continue as guest" always works and the swiping engine is untouched.

**"Error 400: redirect_uri_mismatch" or "origin_mismatch"**
The address in your browser doesn't exactly match what you registered. Compare character by character: `http` vs `https`, the port number, a stray trailing slash, `127.0.0.1` vs `localhost` (Google treats those as different). Fix the origin in the Credentials page. Changes can take a few minutes to take effect.

**"Access blocked: this app has not completed the Google verification process"**
Your Gmail isn't on the Test users list. Go back to the OAuth consent screen → Test users → add it.

**The button never appears, and you see "Couldn't load Google sign-in"**
Google's script didn't download. Usually no internet, or an ad-blocker / privacy extension blocking `accounts.google.com`. Try a window with extensions off. The app falls back to local profiles automatically so you're never stuck.

**Still says "Real Google sign-in isn't switched on"**
The Client ID didn't save. Re-open the file, search `GOOGLE_CLIENT_ID`, and confirm your ID is inside the quotes.

**You opened the file by double-clicking again**
Then you're back on `file://` and Google will refuse. Use the `http://localhost:8000/style-finder.html` address.

---

## One honest limitation

When you sign in, Google hands the page a signed token containing your name, email and photo. This app reads that token directly in the browser to fill in your profile. What it does **not** do is verify the signature — checking that Google really issued the token, and that nobody forged it, requires a server that holds a secret key.

For an app on your own machine that only stores your own clothing preferences, that's a reasonable trade-off: there's nothing to steal and nobody to impersonate. It stops being reasonable the moment you host this publicly and let strangers sign in — at that point a forged token could impersonate any user. If you get to that stage, the fix is to send the token to a backend (your `backend/server.py`, or a Supabase Edge Function) and verify it there before trusting it. Worth knowing now so it isn't a surprise later.
