# CLAUDE.md — LiftShift (KPIFit Training)

Workout-analytics app + coach tools for KPI FIT, in two halves:

1. **Consumer app** (`/app`): import training data from Hevy / Strong / Lyfta
   (CSV, Hevy login, or Hevy Pro API key) — all analytics run client-side and
   the data stays in the browser (localStorage/IndexedDB).
2. **Coach view** (`/coach`): Supabase-auth'd coach workspace — clients connect
   via connect codes, workouts sync into Supabase, coach gets embedded
   per-client dashboards, AI routine recommendations (Claude), push-to-Hevy
   coach-library flows, and a Data Quality panel with set overrides.

Fork of `aree6/LiftShift` (**AGPL-3.0-only** — public deployments must keep
visible attribution). **The GitHub repo `KirbyKPI/LiftShift` is PUBLIC — never
commit secrets.**

## Stack & infrastructure

- Vike (file-based Vite SSG/SSR) + React 19 + Tailwind 4, TypeScript.
  Pages live in `frontend/pages/*/+Page.tsx`; `vercel.json` supplies SPA
  rewrites and `outputDirectory: dist/client`. Build: `npm run build` (vike)
- **Vercel**: team `team_GADJsUraELrsQNV6kZcq8jVc`, project `kpifit-training`
  (`prj_auMrf1pFvHbFDx1dePgzzVkJfbm6`). Push to `main` → production
  (training.kpifit.com); branches → previews
- **Supabase**: SAME project as kpifit-assess — `jrzllayzwzoxlxlohdkt`.
  This app's tables are all `training_*`-prefixed: `training_coaches`,
  `training_clients`, `training_hevy_connections` (client API keys),
  `training_connect_codes`, `training_workout_cache`, `training_sync_metadata`,
  `training_coach_recommendations` + `_recommendation_items`,
  `training_coach_routine_push_audit`, `training_coach_hevy_connections`
  (coach's own Hevy key), `training_coach_set_overrides`
- **AI**: `@anthropic-ai/sdk` in `api/coach/run-ai-recommendation.ts`; default
  model `claude-opus-4-6`, tool-use to force structured output,
  `maxDuration: 300` (Vercel Pro)
- Hevy API keys are AES-256-CBC encrypted with `HEVY_ENCRYPTION_KEY` before
  hitting the DB (`api/*/connect*.ts` encrypt, `sync.ts` decrypts)
- Env vars (Vercel): `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (client),
  `SUPABASE_SERVICE_ROLE_KEY`, `HEVY_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`
- `backend/` is the upstream Express proxy used only by the **consumer**
  Hevy email+password login flow (`VITE_BACKEND_URL`, deployed separately).
  The coach side never touches it — coach flows use `api/` Vercel functions

## Code conventions

- Mixed styles: upstream code (most of `frontend/`) uses semicolons; Kirby's
  additions (`api/`, `frontend/pages/coach/`, `frontend/utils/supabase/`,
  `frontend/app/coachView/`) use single quotes, no semicolons, and big
  box-drawing banner comments at the top of each file. **Match the file**
- API routes are Vercel serverless functions (`@vercel/node`) under `api/`.
  Auth pattern: client sends `coach_token` (Supabase access token) in the
  body → route verifies via `supabase.auth.getUser(token)` → loads the
  `training_coaches` row. DB access uses the service-role client
- Frontend coach auth: standard Supabase email/password
  (`frontend/utils/supabase/auth.ts`); signup trigger creates the coach row

## Key map

- Coach UI: `frontend/pages/coach/` — `+Page.tsx` (shell/roster),
  `CoachClientDashboard.tsx` (embeds the full consumer `<App>` seeded with a
  client's sets via `frontend/app/coachView/CoachViewContext.tsx`, with
  localStorage shimmed so coach tweaks don't persist), `PlanBuilderForm`,
  `GenerateRecommendationPanel`, `SavedRecommendationsPanel`,
  `DataQualityPanel` (set overrides), `HevyTemplatePicker`
- AI recommendation pipeline (`api/coach/`): `generate-recommendation`
  (build draft + data snapshot) → `run-ai-recommendation` (Claude writes
  per-exercise items) → coach reviews/substitutes (`substitute-item`) →
  `push-recommendation` (creates Hevy routine + audit row)
- Client sync: `api/hevy/connect.ts` (connect-code flow) and
  `api/hevy/sync.ts` (paginated Hevy fetch → `training_workout_cache`)
- Analytics engine (upstream, client-side): `frontend/utils/analysis/`
  (core, insights, masterAlgorithm, exerciseTrend, setCommentary…)
- Migrations: `supabase/migrations/` — only 3 files exist;
  `training_coach_hevy_connections` and `training_coach_set_overrides` were
  applied directly to prod **without** migration files

## Gotchas

- Repo is public + AGPL: no secrets in code, keep the attribution/footer
- Claude hallucinates Hevy `exercise_template_id`s (observed 3/8 wrong in one
  run). `run-ai-recommendation.ts` injects a template catalog and validates
  every returned id server-side — keep that defense intact
- Set overrides are an overlay applied after reading the workout cache and
  before computing insights — Hevy data itself is never modified
- `DEPLOYMENT.md`, `netlify.toml`, `GITHUB_SETUP.md` are stale upstream docs
  (Netlify/Render split) — actual deployment is Vercel; ignore them
- Don't keep this repo (or any repo) in an iCloud-synced folder (Desktop /
  Documents with iCloud sync): file eviction corrupts `.git` reads. The
  2026-06 fix was a fresh clone into `~/Projects`
- Supabase project is shared with kpifit-assess — assessment tables live
  alongside; be careful with broad migrations

## On the horizon

kpifit-assess (assessment.kpifit.com) also integrates Hevy but with its own
client tables (`clients`, `client_hevy_connections`) separate from
`training_clients` here. Kirby eventually wants to unify the two client
systems into one.

## Workflow

Work on `main` or a branch; push; Vercel builds. Pushing `main` deploys
production at training.kpifit.com automatically.
