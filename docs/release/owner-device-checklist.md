# Owner device checklist (TestFlight / Play closed track)

What the owner checks by hand on a real phone before beta-1 merges. Written 2026-10-03 for 392403; sections
1–7 apply to every candidate, section 8 from the D20 candidate on. Report anything off with a screenshot.

1. **First launch** (delete any older Whim first): age check → Terms → AI consent, each shown once, no blank
   screen. Home shows three example tiles in distinct colours, each captioned "Example".
2. **Keyboard**
   - Compose: opens with no keyboard and suggestions visible. With the keyboard up, Continue sits just above
     the Done bar. Done, an empty-space tap and a header tap each dismiss without continuing. Drag the
     keyboard down with a finger, slowly, ending inside the keyboard: no freeze, no half-parked keyboard.
   - Plan: tap the last row ("What it remembers"). The editor and Cancel/Save scroll above the keyboard.
     Done keeps the text; Save and Cancel work with the keyboard up.
   - Clarify: "Other" on the last question stays visible while typing; Return dismisses. Single-choice
     replaces the earlier pick; "Decide for me" works.
   - Report sheet: rises above the keyboard; Send/Cancel stay visible; a tap outside closes it.
3. **A real build** (e.g. a water tracker): questions → plan → Building → "… is ready" → Open, about a
   minute. In the app the last element clears the orb, the orb dim covers the status bar, all four orb
   items work.
4. **Limit**: ask for something Whim can't do ("an app that reads my text messages") → the limit screen.
   "Build … instead" asks new questions; "Change my idea" returns to Compose.
5. **The line** (optional): with 3 builds already running server-wide, a 4th shows "You're in line…" and
   starts when one finishes.
6. **History, Settings, failure**: History lists versions and "Change it from here" opens Compose. Settings
   margins and Back look right; "Turn on AI features" shows each legal screen once; the phone ID is
   selectable. A failed build shows "Try again" filled edge to edge.
7. **General**: crashes, blank frames, text touching edges, wrong colours.
8. **Your own server** (D20 candidate)
   - Settings → Advanced is present. "Use your own server" opens a confirm sheet that says the server sees
     everything Whim sends and Whim's privacy policy doesn't cover it. Cancel leaves no field.
   - Confirm, enter a reachable server (`https://…`, or `http://<LAN IP>:<port>`); a build goes there.
     A caption under the field restates the responsibility.
   - `http://example.com` is refused inline and not saved.
   - "Use Whim's server" empties the field; the next build goes to Whim's server; the field stays available.
   - The privacy policy link shows the new "If you point Whim at your own server" section.
