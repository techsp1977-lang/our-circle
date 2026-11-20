# Our Circle — setup guide

Your family app: household chats, a shared photo and video album (kept at original quality), birthdays and big days with nudges, weekly check-in reminders, and a private voice journal you can print as a book.

It runs on its own, outside Claude. It uses two free services:
- **GitHub Pages** hosts the app (the web address your family opens).
- **Firebase** (by Google) handles logins, messages, photos and journals.

Plan on about 45 minutes the first time. Do the parts in order.

---

## Part 1 — Put the app online and try the demo (10 min)

1. Unzip `our-circle.zip`. All the app files sit together in one folder (no subfolders), so uploading from a phone or any browser works.
2. Go to **github.com** and sign in.
3. Click **+** (top right) → **New repository**.
   - Repository name: `our-circle`
   - Choose **Public** (free GitHub Pages needs a public repository; your family's data is never stored here, only the app's code).
   - Click **Create repository**.
4. On the new repository page, click **uploading an existing file**.
5. Open the unzipped folder, select **all the files inside it**, and drag them into the browser window (or tap **choose your files** and select them all). Wait until every file is listed, then click **Commit changes**.
6. Click **Settings** (top of the repository) → **Pages** (left side).
   - Under **Branch**, choose `main` and `/ (root)`, then click **Save**.
7. Wait about a minute and refresh. The page shows your address, like `https://YOUR-GITHUB-NAME.github.io/our-circle/`.
8. Open that address. You'll see the app in **demo mode** with sample Proctor family data. Use the **View as** menu at the top to see it as Jamison, Leah and others. Demo data stays only in that browser.

---

## Part 2 — Create the Firebase project (15 min)

1. Go to **console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
   - Name: `our-circle`
   - Turn **off** Google Analytics (not needed).
   - Click **Create project**, then **Continue**.

### Logins
3. Left menu → **Build** → **Authentication** → **Get started**.
4. On **Sign-in method**, click **Email/Password**, turn on the first switch, **Save**.
5. Click **Add new provider** → **Google** → turn on → pick your email as the support email → **Save**.
6. Still in Authentication, open the **Settings** tab → **Authorized domains** → **Add domain** → type `YOUR-GITHUB-NAME.github.io` → **Add**.

### Database (messages, dates, journals)
7. Left menu → **Build** → **Firestore Database** → **Create database**.
   - Location: `nam5 (United States)` → **Next**
   - Choose **Start in production mode** → **Create**.
8. Open the **Rules** tab. Delete everything in the box. Open the file `firestore.rules` from your unzipped folder in a text editor (TextEdit or Notepad), copy all of it, paste it into the box, then click **Publish**.

### Photo and video storage
9. Firebase needs the pay-as-you-go **Blaze** plan before it turns on file storage. Click **Upgrade** (bottom of the left menu) → **Blaze** and add a card.
   - Set a **budget alert** of $5 when it asks. A family your size should stay at or near $0 for the first year; you'll get an email if that ever changes.
10. Left menu → **Build** → **Storage** → **Get started** → **production mode** → choose the same US location → **Done**.
11. Open Storage's **Rules** tab. Replace everything with the contents of `storage.rules`, then **Publish**. If Firebase asks to let Storage rules read Firestore, click **Grant** (this is how it checks that someone is in your family before showing a photo).

### Connect the app to Firebase
12. Click the gear (top left) → **Project settings**. Scroll to **Your apps** → click the **</>** (web) button.
    - Nickname: `Our Circle` → **Register app**. (Skip Firebase Hosting.)
13. Firebase shows a block of code with `firebaseConfig = { apiKey: "...", ... }`. Keep that page open.
14. On GitHub, open your `our-circle` repository → file `config.js` → click the **pencil** (Edit).
15. Replace each `PASTE_...` value with the matching value from Firebase:
    `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
    Keep the quotes. Click **Commit changes**.
16. Wait a minute, then open your app address again (refresh twice). The demo banner is gone and you'll see a sign-in screen.

> These Firebase values are safe to be public. What protects your family is the rules you pasted in steps 8 and 11.

---

## Part 3 — Set up your family (10 min)

1. On your app, tap **Create account** with your email and a password (or **Continue with Google**).
2. Fill in **Start your family circle**:
   - Family name: `The Proctors`
   - Your first name: `Spencer`
   - Your household: `Spencer & Jeana`
3. You land on **Family settings**. For each household tap **Add household**, then **Add a person** in it:
   - `Spencer & Jeana` → add Jeana
   - `Jamison, Sophi & Jack` → Jamison, Sophi, and Jack (check **Young child without a phone**)
   - `Braelyn & Romney` → Braelyn, Romney
   - `Colsen`, `McKay`, `Leah` → one person each
   Add birthdays as you go if you know them.
4. Tap **Invite** next to each person (not Jack). Tap **Share link** and text it to them. Each link works once and signs them in as that person.
5. When someone opens their link, they create a login and land in the family, already set up with their name and birthday.

---

## Part 4 — Put it on everyone's phone

Use the app's own address, **https://our-circle-3da6a.web.app**.

- **iPhone:** open the app address in **Safari** → tap **Share** → **Add to Home Screen** → **Add**.
- **Android:** open it in **Chrome** → menu (⋮) → **Install app** (or **Add to Home screen**).

It then opens full-screen like a regular app.

---

## How things work

- **Family tab:** your household on the left, every other household on the right. **Message** talks to the whole household; tapping one photo messages just that person. **Message everyone** goes to the whole family; **New group** makes things like a siblings-only chat.
- **Coming up:** trips and family events anyone can add or edit (the pencil).
- **Birthdays & big days:** everyone adds their own on **My page** (birthday, anniversary, graduation, mission, baptism, and so on). On the day, a card appears for the whole family with a one-tap message.
- **Weekly check-in:** if you haven't messaged a household in 7 days, you get a card on the Family tab. Change it to 3 days, 2 weeks or monthly on **My page**.
- **Album:** share photos and videos with everyone. Originals are uploaded untouched; anyone can **Download original**.
- **Journal:** private to each person. Pick Daily Journal, Gratitude, Spiritual Impressions or Leaving a Legacy, or **Edit layout** to make your own (add `[3]` after a section name for a numbered list). Tap the mic, or the microphone on your phone keyboard, to speak.
- **Daily journal reminder:** **My page** → **Daily journal reminder** → pick a time → **Add**, then open the downloaded file to put a repeating reminder in your phone's calendar.
- **Printed book:** Journal → **Make a printed book** → pick dates and page size → **Preview** → **Print / Save as PDF**. Upload that PDF to Blurb using the same page size (check Blurb's current size and margin guide first).
- **Kids:** parents add a child on **My page** → **Add a child's profile**. When the child gets a phone, tap **Invite** next to their name and the profile becomes theirs.

## Privacy, plainly

- Only people with an invite can see anything in your family.
- Journals are stored under each person's own account. The app's rules block everyone else, including other family members and organizers.
- One honest caveat: as the owner of the Firebase project, you could technically open the database in the Firebase console. Before offering this to other families, the next step is encrypting journals on the phone so not even the app owner can read them.

## What's next (not built yet)

1. **Push notifications** for nudges and new messages, so reminders arrive even when the app is closed. This needs a small Firebase server function; for now nudges show when you open the app.
2. **Journal encryption** (see above).
3. **Billing and a sign-up flow** for other families. The app already keeps each family completely separate, so other families can start their own circle with the same setup today.

## Hosting on Firebase (the app's own address)

The app's home is **https://our-circle-3da6a.web.app**. It has its own address so no other website can read its saved sign-in, and it sends strict security settings to the browser.

The old GitHub Pages address (`…github.io/our-circle`) still works. Once the new address is live, it clears its saved data and sends people (and old invite links) to the new one.

**One-time setup, so GitHub publishes to Firebase automatically** (10 minutes):
1. Go to **console.cloud.google.com**, pick project `our-circle-3da6a`, then **IAM & Admin → Service Accounts → Create service account**.
   - Name it `github-deploy`, then **Create and continue**.
   - Role: **Firebase Hosting Admin**, then **Continue**, then **Done**.
2. Click the new account, open the **Keys** tab, then **Add key → Create new key → JSON → Create**. A file downloads.
3. On GitHub, open the `our-circle` repository → **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: open the downloaded file in TextEdit or Notepad, copy all of it, and paste it in. Click **Add secret**.
4. Delete the downloaded file and empty the trash. GitHub keeps the only copy it needs.
5. Every change to `main` now publishes itself. To watch it, open the **Actions** tab and look for **Deploy to Firebase Hosting**. A green check means it's live.

**If the deploy fails** with a permission message, add the role **Service Usage Consumer** to the same service account (IAM & Admin → IAM → pencil next to `github-deploy` → Add another role), then click **Re-run jobs**.

## Face ID sign-in (one-time server setup)

**Sign in with Face ID** uses a small Firebase server function (`functions/`). It checks the Face ID proof from the phone and signs you in. Set it up once, from Google's browser terminal. Nothing gets installed on your computer.

1. Open **https://console.cloud.google.com/?project=our-circle-3da6a&cloudshell=true**. A terminal opens at the bottom of the page. Click **Authorize** if asked.
2. Paste this whole block and press Enter. It takes about 5 minutes.

```bash
gcloud config set project our-circle-3da6a
gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com iamcredentials.googleapis.com
gcloud iam service-accounts create passkey-fn --display-name="Our Circle Face ID sign-in" || true
echo "Waiting a minute for Google to finish creating the account..."; sleep 60
gcloud projects add-iam-policy-binding our-circle-3da6a --member="serviceAccount:passkey-fn@our-circle-3da6a.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None
gcloud iam service-accounts add-iam-policy-binding passkey-fn@our-circle-3da6a.iam.gserviceaccount.com --member="serviceAccount:passkey-fn@our-circle-3da6a.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator"
rm -rf ~/our-circle && git clone https://github.com/techsp1977-lang/our-circle.git ~/our-circle && cd ~/our-circle/functions && npm ci && cd ..
npx --yes firebase-tools@15.34.2 deploy --only functions --project our-circle-3da6a
```

3. It's done when the last lines say **Deploy complete!** If it asks how many days to keep container images, press Enter (1 day).
4. Check that both roles are in place. These two lines should print `roles/datastore.user` and `roles/iam.serviceAccountTokenCreator`. If either is missing, run its line from step 2 again.

```bash
gcloud projects get-iam-policy our-circle-3da6a --flatten="bindings[].members" --filter="bindings.members:passkey-fn@" --format="value(bindings.role)"
gcloud iam service-accounts get-iam-policy passkey-fn@our-circle-3da6a.iam.gserviceaccount.com --format="value(bindings.role)"
```

**If it says you're not logged in**, run `npx --yes firebase-tools@15.34.2 login --no-localhost`, follow the link, paste the code back in, then run the last line again.

**If it says the build failed because of a missing permission**, run these two lines, then the last line again:

```bash
PN=$(gcloud projects describe our-circle-3da6a --format='value(projectNumber)')
gcloud projects add-iam-policy-binding our-circle-3da6a --member="serviceAccount:${PN}-compute@developer.gserviceaccount.com" --role="roles/cloudbuild.builds.builder" --condition=None
```

The function runs as its own account, `passkey-fn`. That account can only use Face ID records and sign people in; it can't publish the site or change settings.

After a change to `functions/`, run the last two lines of step 2 again. Changes to the app itself still publish automatically.

## Message notifications (one-time server setup)

Phone notifications for new messages use a second server function, `notify`, which runs as its own account, `notify-fn`. That account can only use the database. In Cloud Shell (**https://console.cloud.google.com/?project=our-circle-3da6a&cloudshell=true**), paste:

```bash
gcloud config set project our-circle-3da6a
gcloud iam service-accounts create notify-fn --display-name="Our Circle message notifications" || true
echo "Waiting a minute for Google to finish creating the account..."; sleep 60
gcloud projects add-iam-policy-binding our-circle-3da6a --member="serviceAccount:notify-fn@our-circle-3da6a.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None --format=none
gcloud projects get-iam-policy our-circle-3da6a --flatten="bindings[].members" --filter="bindings.members:notify-fn@" --format="value(bindings.role)"
rm -rf ~/our-circle && git clone https://github.com/techsp1977-lang/our-circle.git ~/our-circle && cd ~/our-circle/functions && npm ci && cd ..
npx --yes firebase-tools@15.34.2 deploy --only functions --project our-circle-3da6a
```

The fifth line should print `roles/datastore.user`. It's done when it says **Deploy complete!**

Then each person turns notifications on for each phone: **My page → Notifications → New messages on this phone → Turn on**. On iPhone this only works in the Home Screen app (iOS 16.4 or later). Signing out of a phone stops its notifications. **Alerts inside the app** turns the in-app banner on or off.

## Updating the app later

Edit or replace files in the GitHub repository. Changes are published to the app's address automatically (Actions tab) and appear within a minute or two; on phones, closing and reopening the app picks them up.

**If `firestore.rules` or `storage.rules` change**, GitHub alone doesn't apply them. Open each one, copy all of it, and paste it into Firebase (**Firestore Database → Rules**, and **Storage → Rules**), then click **Publish**.

The `tests` folder checks those rules on a computer before you publish them. With Node and Java installed, open that folder in a terminal and run `npm install`, then `npm test`. Every line should be a ✔. The tests run a copy of Firebase on the computer and never touch your real family data.
