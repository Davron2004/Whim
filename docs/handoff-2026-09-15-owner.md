# Owner checklist, 2026-09-15: mail switch and Apple console

Two jobs only you can do. Neither needs an agent; both need logins the agents don't hold. Tick them off in this file as you go so the next session knows.

## 1. Move mail from Google Workspace to Zoho Mail

Why now: `support@anycognition.ca` is printed on the live privacy and support pages, and the Google Workspace subscription is cancelled, so that address stops receiving mail when Google shuts the account.

What the zone looks like today (checked 2026-09-15): five Google MX records, an SPF record that goes through a GoDaddy-managed include which resolves to Google, a `google-site-verification` TXT, a DMARC record reporting to `jamila@anycognition.com`, and no DKIM at all.

### In Zoho Mail admin

1. Domains: add `anycognition.ca` if it's not listed. Verify it the way Zoho asks (a TXT record; the value comes from Zoho's page).
2. Open the domain's DNS-mapping page. It shows the MX hosts and the SPF value for your data centre. Copy those, not the ones below, if they differ.
3. Generate DKIM with selector `zmail`. Copy the TXT value.
4. Create `support@anycognition.ca`, as a mailbox or as an alias of one you read.

### At GoDaddy, DNS for anycognition.ca

Saving needs the SMS 2FA. Do them in this order.

| Action | Record |
|---|---|
| Delete | all five MX records ending in `aspmx.l.google.com` |
| Add | MX `@` → `mx.zoho.com` priority 10, `mx2.zoho.com` 20, `mx3.zoho.com` 50 |
| Edit | the TXT at `@` that starts `v=spf1` → `v=spf1 include:zohomail.com ~all` |
| Add | TXT `zmail._domainkey` → the DKIM value from Zoho |
| Add | TXT `@` → the `zoho-verification=...` value (delete after Zoho says verified) |
| Delete | the TXT starting `google-site-verification=` |
| Leave | `whim` and `api.whim` (the app), the apex A records, `www`, and `_dmarc` |

Notes:
- Editing the SPF TXT directly is what removes Google. The current value looks neutral but the include it points at resolves to `_spf.google.com`.
- The moment the MX records change, mail stops reaching the Google mailboxes. Export anything you need from them first.
- The DMARC record reports to an address on the `.com` domain. Fine if that's yours; otherwise point `rua=` at a `.ca` mailbox.

### Check it worked

From any machine: `dig +short MX anycognition.ca` should list only Zoho hosts. Send a mail from outside to `support@anycognition.ca` and confirm it arrives. Zoho's admin page shows SPF and DKIM as verified once DNS has propagated (TTL is 600 s, so about ten minutes).

- [ ] Zoho domain verified
- [ ] MX, SPF, DKIM switched at GoDaddy
- [ ] `support@anycognition.ca` receives a test mail
- [ ] Google records removed

## 2. Apple: agreement and console

Everything under team `2B7K4YLS34` (AnyCognition Inc.). The agents can't accept agreements or create keys, and the browser task spaces you've used before are yours, so an agent can't take them over.

### 2a. Program License Agreement (blocks everything else)

App Store Connect shows a banner when an updated agreement is pending. The Account Holder accepts it. Until then no new app can be created.

- [ ] Agreement accepted

### 2b. developer.apple.com, Certificates, Identifiers & Profiles

- [ ] Identifiers → App IDs → new App ID, bundle id `com.anycognition.whim`, capability **Associated Domains** on. Description "Whim".

### 2c. App Store Connect, Users and Access, Integrations

- [ ] Team API key with the **App Manager** role. Download the `.p8` once (it can't be downloaded again). Save it as `~/.config/whim/AuthKey_<KEYID>.p8`, then write `~/.config/whim/asc-api-key.json`:

```json
{ "key_id": "<KEYID>", "issuer_id": "<ISSUER ID from the same page>", "key_filepath": "/Users/davrondjabborov/.config/whim/AuthKey_<KEYID>.p8" }
```

Both files mode 600 (`chmod 600 ~/.config/whim/AuthKey_*.p8 ~/.config/whim/asc-api-key.json`). The release preflight refuses looser modes.

### 2d. App Store Connect, My Apps

- [ ] New App: platform iOS, name `Whim: Small Apps You Describe`, primary language English (U.S.), bundle id the one above, SKU `whim-ios`.
- [ ] App Information: primary category Productivity, secondary Utilities. Content rights: does not contain third-party content.
- [ ] Pricing: Free. Availability: all territories except China mainland.
- [ ] TestFlight: create an external group named `Public beta` (public link on).

The rest of the Apple work (age rating, App Privacy answers from `release/store/app-store/app-privacy.json`, review notes from `release/store/app-store/review_information/notes.txt`, screenshots, the first TestFlight upload) is driven by the release CLI and fastlane once the key exists; an agent can run those with you present. The review contact is already written to `~/.config/whim/review-contact.json` (Davron Djabborov).

## 3. Google Play (for completeness; the agent handoff has the detail)

The app already exists in the personal developer account, package `com.anycognition.whim`. What's left there is the service-account grant, the upload key, the store listing forms and a closed-testing track. These are platform-release-readiness tasks 14.1 to 14.6 and an agent can walk you through them.
