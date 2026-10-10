# Contract: making-sheet (chain-16)

Interface only. Rules: spec prompt-flow (the sheet, plan page, leaving), design.md D15, system.md §7.1/§9.
Pure logic is Node-importable: `prompt-flow.ts`, `flow-draft.ts`, `plan-questions.ts`, `consent-disclosure.ts`.

## Page machine — `prompt-flow.ts`

```ts
type FlowScreen = DescribeScreen | PlanScreen | MakingScreen | ReadyScreen;   // + the shell's `failure` Screen member
DescribeScreen { kind:'describe'; editing?; text; notice?: FlowNotice; kept?: PlanScreen }
PlanScreen     { kind:'plan'; editing?; text; questions: FlowQuestion[]; answers: FlowAnswers; asking: boolean;
                 limit?: FlowLimit; rewritten: string; rows: FlowPlanRow[]; loading: boolean; startedAt?;
                 edited: boolean; notice?: FlowNotice; problem?: { request:'clarify'|'rewrite'; reason: string } }
MakingScreen   { kind:'making'; editing?; runId?: string; text; rewritten; answers; questions; stage; delivering; queuedPosition? }
ReadyScreen    { kind:'ready'; editing?; app: InstalledApp }
FlowAnswer { choices: string[]; other: string; decide: boolean }   // every question starts { decide: true }
```

Transitions (the shell, `LauncherRoot.tsx`, owns the requests; the pages never fetch):
- Continue (`onDescribeContinue`): `planStep(describe)` at once (`asking`, `loading`), one `clarify`; questions land
  (`withQuestions`, all delegated) and the `rewrite` goes out at once with `delegatedAnswers` (`decide: true` each),
  whatever is answered meanwhile; rows land (`withPlan`). `limit` replaces both (`withLimit`). A refusal or `update`
  fallback of either request lands on Describe (text kept, notice); any other failure stays on Plan as `problem`
  with Try again (`onPlanTryAgain` -> `resumePlan`). A failure here never opens the failure page.
- Plan Back (`backToDescribe`): Describe with `kept` = the plan; Continue returns to it while the text is
  unchanged (`describeTextChanged` drops `kept` on other words), else asks afresh.
- Make it (`onBuildIt`): clears the draft, `makingStep(plan)`, `runAttempt`. Stamps `runId` = the attempt's journal
  id (also the launcher id and, normally, the delivered app's id). Delivery -> `readyStep`; a terminal failure -> the
  shell's `failure` screen. A refused generate returns to the plan page with `notice`.
- Back on Plan while a row is edited cancels the edit (`planBackAction`); Android back (`useSheetBack`) and the visible control
  share it. A second tap on a page's forward action (Continue, Make it) before React draws the next page is ignored (`firstTake`).
- The making sheet and the first-run sheet never overlap: `useSheetHandOver` holds the sheet the screen wants until the other
  reports `onClosed` (iOS can drop a present issued while another Modal is dismissing).

## Closing and reopening — `LauncherRoot.closeSheet`

| Page | Close, scrim, drag, Android back (Sheet `onClose`) |
|---|---|
| describe, plan | `goHome` -> `keepDraft`: aborts clarify (slot `'compose'`) and rewrite (slot `'plan'`), keeps the screen as the draft |
| making | `onLeaveRunning`: the run is detached, never stopped; the tile reopens it |
| ready | Done (`goHome`); failure: `onLeaveFailure` (`goHome`) |

`pageKeyOf(screen | { kind:'failure', journalId?, recordId?, pendingId? })`: `draft:<app id|new>` for describe/plan,
`run:<journal id>` for making, ready and failure. A tile reopens its run: `onOpenPending(rec)` sets the screen to that
run's own `LiveAttempt.screen` (and its signals); `MakingSheet` mounts the page under that key.

## Draft — `flow-draft.ts`

```ts
type FlowDraftScreen = DescribeScreen | PlanScreen;  NEW_APP_DRAFT_KEY = 'new-app';  draftKey({ editing? }): string
class FlowDrafts { get(key); keep(page) /* no words = clear */; clear(key); composerWords(): string | undefined }
withEditing(page: FlowDraftScreen, editing: InstalledApp): FlowDraftScreen
draftPreview(text): string   // <= 24 chars at a word boundary + "…"; ComposerBar shows `Continue "<preview>"`
```
In memory for the session (a `useRef` in `LauncherShell`). Set by `keepDraft` (every way off Describe/Plan: close, a
link, `goHome`); cleared by `onBuildIt` and by empty words. `openCompose(editing, text?)` restores the draft of
that app (a plan page resumes whatever request it lacks: `missingRequest`/`resumePlan`) unless `text` is given. The draft is
restored for the app as it is NOW (`withEditing(page, liveApp)`, also on a Describe page's `kept` plan); a deleted app takes its
draft with it.
`LauncherShell` feeds `HomeScreen.draft` from `composerWords()` (state `composerDraft`, synced by `syncComposerDraft`).

## Components (props verbatim)

```ts
MakingSheet({ content: SheetContent | null /* null closes */; onClose; onClosed? })   // SheetContent { key: string; node }
  PageHead({ onBack? })  PAGE_HEAD_HEIGHT = 44   // every page starts under this row: headlines align
  HostedPage({ children })                        // gives a `flex:1` full-screen page the sheet body's height
DescribePage({ text; editing?: InstalledApp; serverUnreachable?; notice?: FlowNotice;
               onChangeText; onContinue })       // Android back = the sheet's close: no prop, no registration
PlanPage({ screen: PlanScreen; editing?: InstalledApp; onBack; onAnswer(id, AnswerChange); onChangeRow(index, text);
           onMake; onTryAgain; onMakeInstead })
FirstRunSheet({ visible; language: LegalLanguage; onLanguageChange; termsDue: boolean; consentDue: boolean;
                termsOutdated?: boolean; outdatedFrom?: number; refused?: boolean; onAgree; onClose; onClosed? })
```
Both Sheet-hosted pages use `KeyboardShell host="sheet"`; `KeyboardShell` gained `onScrollOffset?(offset)`.
`FirstRunSheet` replaces the terms and ask-consent screens; the shell's `terms` and `consent` (ask) screens are
drawn by it over the screen they replaced (`stackFor(returnTo)`), the silent age check over the same. `onFirstRunAgree`
records the terms acceptance when `kind === 'terms'` and the grant when `grantDue` (not current, or `refused`), then runs the
continuation; the action reads `Agree to send descriptions` when `consentDue`, else `firstRunContinue` (terms only: the
stored grant is left byte-identical). The first layer (`firstRunLead` + the three `firstRun*` rows, the first made of the `FIRST_RUN_SENT_KEYS` sentences) is held to the disclosure
manifest by `FIRST_RUN_COVERAGE` (copy.ts) in `consent-coverage.suite.ts`. Held age (`AgeScreen`, `held` required) and review-mode `ConsentScreen` stay full screens.

## Answers and the build prompt

`clarificationsFrom(questions, answers)` -> contract `Clarification[]`, one per question with an answer: `decide: true`
alone, else `choices` (one for `select:'one'`) and trimmed `other`. The rewrite is sent `delegatedAnswers`; `runAttempt`
sends the current answers as generate's `clarifications`. Plan rows must not restate answers (server side).
`promptForBuild(plan)`: `rewritten` byte-identical until `edited`; then `label: text` per row joined by `\n`, and it stays
on that path when a row is reverted (`edited` is never cleared). One-string plan = one unlabelled row.
`showsChips(q)`: every option <= 20 chars (`CHIP_OPTION_MAX_CHARS`) = chips, else full-width radio/checkbox rows.

## Where chain-17 plugs in (`LauncherRoot.renderSheetPage`)

Each branch returns `{ key: pageKeyOf(screen), node }`. Replace the node, keep the key:
- `screen.kind === 'making'` (`MakingScreen`): now `<HostedPage><BuildStep stage delivering queuedPosition onCancel signals
  now editing editingName onBack onShowDetails/><RunDetailsSheet .../></HostedPage>`. `signalsRef.current` is this run's
  signals (set by `onOpenPending`); Stop = `abortLiveAttempt` + drop (today `onCancelBuild`, in line only).
- `screen.kind === 'ready'` (`ReadyScreen`): `<HostedPage><DoneStep app onOpen onBackToApps onReport/><ReportSheet/></HostedPage>`.
- `screen.kind === 'failure'`: `<HostedPage><FailureScreen ...failureActions(screen)/></HostedPage>`; its state carries `journalId`.
- A page that sizes itself (a `KeyboardShell host="sheet"` body, or `PageHead` + content) drops `HostedPage`.
- The sheet closes via `closeSheet` for all of them. Android back reaches a page through the Sheet's Modal, never `BackHandler`:
  a page that steps back before it closes calls `useSheetBack(step)` (`ui/Sheet.tsx`; Plan does); every other page's back is
  `closeSheet`. Making/Ready/Failure keep their own `useSystemBack`, which a Modal starves on a device (back = `closeSheet`).

## Gone

Components: `ComposeStep`, `ClarifyStep`, `PlanStep`, `TermsScreen`, `refusal-target.ts`, `FlowHeader`/`PrimaryAction`/
`StepNotice`/`BackHeader`, `ClarifyQuestionsSkeleton`. Machine: kinds `compose`, `clarify`, `build`, `done` (now
`describe`, merged into `plan`, `making`, `ready`), `FlowStep`, `primaryActionLabel`, `backFrom`, `stepAfterClarifyExchange`,
`refusalLanding`. `ConsentScreen` is review-mode only. Copy keys: `composeChip*`, `clarifyHeadline*`, `clarifyHelper`,
`clarifyLimit*`, `planSubhead`, `planFooter`, `terms{Title,Lead,Accept,Decline}`, `ageChecking`. `clarifyBuildInstead` stays
for the server's clarify-prompt test. New: `plan*`, `firstRun*`, `composerContinueLine`, `planMakeHeader`.
The plan's proposed name is not on the wire: `attemptName` still derives from the words.
