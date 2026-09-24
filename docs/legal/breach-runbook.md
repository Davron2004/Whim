# Breach runbook

A working document for AnyCognition's Privacy Officer (the owner, by title). It is not legal advice. It follows PIPEDA s.10.1 (report and notify when a breach creates a real risk of significant harm) and s.10.3 (record every breach), with the Quebec, EU and UK duties that stack on top. Sources: `docs/research/legal-surface-2026-09/canada.md` (Appendix, s.10.1 and Quebec s.3.5–3.8), `practice-and-terms.md` (record keeping), and `docs/deploy.md` (commands). Where a rule comes from general knowledge rather than those files, the line says so.

Every step below is done by the owner. There is no one else.

## Before launch: fill in once

These are the only open items. Don't leave them for the day of a breach.

- TODO(owner): add the OPC's breach report form link to Contacts. The research files don't cite one.
- TODO(owner): add the Commission d'accès à l'information (CAI) link for reporting a confidentiality incident to Contacts.
- TODO(owner): add the ICO's breach report link to Contacts, and decide with the EU Article 27 representative which EU authority or authorities to notify. Whim can't tell where a user is, so it can't tell which EU country is affected.
- TODO(owner): add OpenRouter's security contact to Contacts, and check whether OpenRouter's terms or DPA promise to tell Whim about an incident (this belongs in the B3 written agreement).
- TODO(owner): pick a private place for incident notes and evidence copies, encrypted and outside this repository. The repository is public (`openspec/changes/developer-observability/design.md`, the note on publishing the commit SHA).
- TODO(owner): confirm the daily snapshot schedule for the `whim-data` disk exists (`docs/deploy.md` §"Persistent-disk snapshots" says no script creates it).
- TODO(owner): optionally name a backup person who can stop the server if you can't be reached, and give them IAP SSH access.

## Contacts

| Who | When | How |
|---|---|---|
| Office of the Privacy Commissioner of Canada (OPC) | Real risk of significant harm, any Canadian affected | Breach report form: see "Before launch" |
| Quebec CAI | Risk of serious injury, anyone in Quebec affected | See "Before launch" |
| UK ICO | Risk to UK users that isn't unlikely | See "Before launch" |
| EU data protection authority | Risk to EU users that isn't unlikely | See "Before launch" |
| OpenRouter | Anything touching requests or the API key | See "Before launch" |
| Google Cloud support | VM, disk, Secret Manager or Cloud Logging compromise | Cloud Console, Support |

## What Whim holds, and where

Facts from the manifest (README "Manifest, version 2") and `docs/deploy.md`. Keep-periods are capped by the manifest: server config refuses a keep-period above its published maximum at startup, and `deploy/deploy.sh` runs the same check (design D9). Records older than the caps below shouldn't exist.

| Data | Where | Kept at most |
|---|---|---|
| Requests and app material | Nowhere at Whim after the request is handled (decision 1, third core promise). In transit to OpenRouter and the model provider, which may keep it briefly for abuse checks and legal duties (B1). | While handled |
| Reports (reason, note, app name, app code, prompt if included) | `reports.db` on the `whim-data` disk of `whim-vm` | 12 months |
| Usage records (per request, and lifetime totals per phone ID) | The usage ledger on the `whim-data` disk | 12 months; totals 12 months after the phone ID was last used (B8) |
| Phone ID | Inside usage records, error details and reports | As those records |
| Error details (fixed error-name list, no typed text, B9) | Server logs | 90 days |
| Connection data and logs (IP address, times, app version and build, consent version) | Docker logs on the VM (`json-file`, about 50 MB rotating, `docs/backlog.md`). In Cloud Logging once `developer-observability` ships (its design D8: the `_Default` bucket keeps 30 days). | 90 days |
| App-integrity key and verdict (once #65 ships) | Server, keyed by phone ID | 12 months after the phone ID's last use |
| Disk snapshots of the `whim-data` disk | Google Cloud, daily, once the schedule is set up (see "Before launch") | 14 days (`docs/deploy.md`) |
| OpenRouter API key (not personal information) | Secret Manager `whim-openrouter-api-key`; `/etc/whim/server.env` on the VM | Until rotated |

What people save inside their apps stays on their phones and isn't Whim's to breach. A containment failure that let a mini-app send saved data off the phone would still be an incident: it breaks core promise 1.

## How you might find out

- OpenRouter spend jumps, or the key's credit limit is hit (`docs/deploy.md` §"OpenRouter key").
- `deploy/smoke.sh` fails in a way you didn't cause, or `whim-admin usage` shows traffic you can't explain.
- An email to `support@anycognition.ca` or a report in the app.
- A notice from OpenRouter, a model provider, Google or Apple.
- Someone finds a secret or personal data in the public repository or a log.

## The first hour

Write times down as you go. The EU and UK deadline is 72 hours from when you became aware (GDPR and UK GDPR Art. 33; general knowledge, not in the research files). It is the tightest clock, so start it now.

`$C` below means `sudo -H docker compose --project-directory /opt/whim --file /opt/whim/compose.yaml`, run on the VM through `gcloud compute ssh whim-vm --tunnel-through-iap --command '<command>'` (`docs/deploy.md` §"Operating").

**Minutes 0–10: write it down, decide if it's still happening**

1. In your private incident notes, write the time you learned of it, how, and what you know. Take the next entry number from `docs/legal/breach-log.md` and use it in your notes. The entry itself is written after containment, because that file is public.
2. Decide: is someone still getting data, or is a key still being abused? If yes, go straight to step 5 for that case and come back to steps 3–4.

**Minutes 10–30: keep the evidence, then contain**

3. Copy the server logs off the VM before they rotate away:

   ```sh
   gcloud compute ssh whim-vm --tunnel-through-iap --command \
     'sudo -H docker compose --project-directory /opt/whim --file /opt/whim/compose.yaml logs --no-color --timestamps whim-server' \
     > incident-YYYYMMDD-server.log
   ```

   Once logs are in Cloud Logging, also run:

   ```sh
   gcloud logging read 'timestamp>="YYYY-MM-DDT00:00:00Z"' --project anycognition-whim --format json > incident-YYYYMMDD-cloud.json
   ```

4. Snapshot the data disk:

   ```sh
   gcloud compute disks snapshot whim-data --zone northamerica-northeast1-a --snapshot-names whim-data-incident-YYYYMMDD
   ```

   These copies hold personal information. Keep them in the private place from "Before launch", and delete them when the incident closes.

5. Contain. Pick the row that fits; more than one can.

| What happened | Do this |
|---|---|
| OpenRouter key leaked or abused | If it's being abused now, disable the key in the OpenRouter dashboard first and accept that AI features stop until step 3 of this row. Then: (1) create a new key in OpenRouter with a credit limit; (2) run `gcloud secrets versions add whim-openrouter-api-key --data-file=-`, paste the key, press Ctrl-D (keeps it out of shell history); (3) from a clean checkout of the commit production runs, run `deploy/deploy.sh` with no `--tag`, so it reads the new version and recreates `whim-server`; (4) when smoke passes, disable the old key in OpenRouter and the old version with `gcloud secrets versions list whim-openrouter-api-key` and `gcloud secrets versions disable <old-version> --secret whim-openrouter-api-key` (`docs/deploy.md` §"Rolling back and rotating the key"). Check in the OpenRouter dashboard whether prompt logging was on during the window (B1). |
| A server bug exposes records (for example, one phone's records returned to another) | Roll back: `deploy/deploy.sh --tag <40-hex sha of a known-good image>`, run from the current checkout, never an old one (`docs/deploy.md`). If no good image exists, stop the server: `$C stop whim-server`. The apps and their saved data keep working on phones. |
| Someone else is on the VM | Snapshot first (step 4). Then stop the VM: `gcloud compute instances stop whim-vm --zone northamerica-northeast1-a`. This also takes the website down. Check project access: `gcloud projects get-iam-policy anycognition-whim`. Rotate the OpenRouter key as above. |
| A server log or report holds something it shouldn't (request content, a secret) | Stop the source: roll back or stop the server as above. Once copied for evidence, remove the entries: `whim-admin device delete <id>` (invoked as in step 6) removes every record held for that phone ID (B8); container logs go when `deploy/deploy.sh` recreates `whim-server`; `gcloud logging logs delete <log-name>` removes a whole log in Cloud Logging. |
| A provider (OpenRouter, a model provider, Google) reports a breach | Ask them in writing which Whim data, which time window, and what they've done. Rotate the OpenRouter key if it could be involved. |
| Your laptop or Google account is lost or compromised | From another device, sign the Google account out of all sessions and change its password. Rotate the OpenRouter key. |
| A mini-app can send saved data off the phone | Fix and release a new build. Raise the minimum build for that platform so older builds lose the AI features (`docs/deploy.md` §"Minimum supported build"). Existing mini-apps on old builds keep running, so say so in the notice. |

**Minutes 30–60: scope it**

6. Work out, as far as you can: which systems, which data categories (table above), what time window, and roughly how many phone IDs. Useful commands, all through `$C exec -T whim-server node server/whim-admin.mjs`:
   - `reports list --since N` and `reports show <id>` to read affected reports.
   - `usage --days N` for traffic and phone IDs in the window.
   - `device export <id>` to see every record held for one phone ID (B8).
7. If EU or UK users could be affected (every storefront is open, decision 2, so assume they could), write the 72-hour deadline as a clock time at the top of your notes.

## Assess the risk

Do this within the first day. Write the reasoning into the breach log either way; the log has to show why you did or didn't report.

**Canada (PIPEDA s.10.1).** Report and notify if it is reasonable to believe the breach creates a real risk of significant harm. Significant harm includes bodily harm, humiliation, damage to reputation, financial loss, identity theft, a negative effect on a credit record, and damage to or loss of property. Weigh two things: how sensitive the information is, and how likely it is to be misused (canada.md, Appendix).

How sensitive Whim's data is on its own:

| Data | Sensitivity | Why |
|---|---|---|
| Requests, app material, report notes and prompts | Can be high | Free text. People type health, money and names into prompts (README, Washington row). Read the actual entries. |
| Connection data | Low to medium | IP addresses and times. |
| Phone ID, usage records, error details, app-integrity record | Low | Random ID and counts, no content (B9 closes error names). |

For likelihood of misuse, ask: who got it (a known party, or an unknown attacker)? Was it read, or only exposed? For how long? Is there sign of intent, like a targeted theft? Was it recovered or deleted? (OPC guidance factors; general knowledge.)

**Quebec.** For a confidentiality incident involving anyone in Quebec, notify the CAI and the people affected if there is a risk of serious injury, judged by the sensitivity of the information, the likely consequences and the likelihood it will be used to cause harm (s.3.5; canada.md, Appendix, medium confidence). Take steps to reduce the risk right away.

**EU and UK.** Notify the authority within 72 hours unless the breach is unlikely to result in a risk to people. Tell the people themselves if the risk is high (GDPR and UK GDPR Art. 33 and 34; general knowledge, not in the research files). A late report is better than none: send what you have and add the rest later.

**US.** State breach laws weren't researched. If US users are affected and report notes or prompts are involved, ask a lawyer.

## Notify

Only after you decide a notice is due. Tell the OPC as soon as feasible after you determine the breach happened, and the people affected as soon as feasible too (PIPEDA s.10.1; timing from the statute text, which the research quotes only for the trigger).

**The OPC report.** Gather these before opening the form. They are the items the Breach of Security Safeguards Regulations ask for (general knowledge; check against the form):

- what happened and why, if known
- the date or period
- what personal information was involved
- roughly how many people (for Whim: phone IDs)
- what you've done to reduce the risk
- how you're telling people
- your contact: the Privacy Officer, `support@anycognition.ca`

**Other organizations.** Also tell any organization that could reduce the harm, such as OpenRouter or Google (PIPEDA s.10.2; practice-and-terms.md).

**The people affected.** Whim doesn't know who its users are, so it can't write to them. The policy already says "we may tell you in the app or publicly" (draft-copy §2, "Keeping it safe"). Use every channel that fits:

1. A dated notice on the support page (`deploy/site/support.html`), published with `deploy/deploy.sh --site-only`.
2. The store listing's release notes in the next release.
3. An in-app notice in the next release, if the risk is still live.
4. A direct reply to anyone who wrote to `support@anycognition.ca` about it, or left contact details in a report.

Say: what happened and when, what information, what Whim has done, and what people can do. Two things they can do themselves: make a new phone ID in Settings, so new records aren't tied to the old one, and turn off AI features or error details in Settings. Give `support@anycognition.ca` for questions. Don't describe a weakness that isn't fixed yet.

PIPEDA allows this kind of indirect notice when you have no contact details for the people affected (Breach of Security Safeguards Regulations; general knowledge, not in the research files).

## Close it

1. Fill in the breach-log entry completely, even if nothing was reportable (s.10.3).
2. Fix the cause. Note the commit or config change in the log.
3. Check that every promise in the policy and on the consent screen is still true. If one was false during the breach, that is a separate problem under Competition Act s.52 (canada.md §(e)) and a question for a lawyer.
4. Delete the evidence copies once nothing more needs them, and note the date in the log.
5. If the breach showed a gap in this runbook, fix the runbook.
