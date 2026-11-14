# Moving Koti to Lehgo Technology: the drafts

Nothing here is live. These files wait for the move.

| File | What it's for | Before it goes live |
|---|---|---|
| `privacy.html` | The privacy policy with the company as the one responsible | Fill in the yellow parts; a lawyer checks every **[NEEDS LEGAL REVIEW]**; then it replaces `/privacy.html`, and `js/privacy.js` (the in-app text) is updated to match |
| `moved/index.html` | The page at the old address, `casanda00.github.io/koti/` | Set `NEW_URL` and `CONTACT` at the bottom; publish it as the root of a new `casanda00/koti` repository, after the transfer |
| `moved/sw.js` | Clears the old Koti copy kept on phones, so the "moved" page is what opens | Publish beside `moved/index.html` |

The "moved" page runs on the old address, so it can read what Koti kept on that phone. If any change never reached
the account, or the person never signed in, it says so and offers a backup file to restore at the new address
(You → Restore from a backup).

Facts checked for the policy: the Supabase project is in eu-west-3 (Paris); OpenAI is only reached when the AI is on;
there are no cookies or analytics in the code. The Supabase project belongs to an organisation created through
Vercel's integration, so moving it to the company goes through Vercel.
