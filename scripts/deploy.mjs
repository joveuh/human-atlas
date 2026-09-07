#!/usr/bin/env node
// Canonical one-shot deploy for human-atlas.
//
// This app is 100% static — no Lambda, no API, no CloudFormation/SAM stack. It is deployed as
// one git-connected AWS Amplify Hosting app (name "human-atlas", repo github.com/joveuh/human-atlas)
// that auto-builds on every push to `main`. Amplify's buildSpec on that app runs
// `npm run data` (skipped once the dataset is cached) then `npm run build` — the data pack is
// generated fresh in Amplify's build container, never committed to git.
//
// `npm run deploy` does the part a plain `git push` can't: build + smoke-gate locally FIRST so a
// broken build never reaches Amplify, then pushes `main` (the actual trigger for Amplify's own
// from-source rebuild), then watches the job it triggers and reports the live URL.
//
// Usage:
//   npm run deploy                smoke-build, push to main, watch the triggered Amplify job
//   npm run deploy -- --dry-run   smoke-build only — no git push, no AWS calls
//   node scripts/deploy.mjs --destroy   print (never run) the app-delete command
//
// Requires: the AWS CLI, already configured (`aws sts get-caller-identity` must work), and a
// clean git working tree with `origin` pointed at the connected GitHub repo.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_NAME = "human-atlas"; // this project's own name — not an invented external identifier
const BRANCH = "main";
const DIST = path.join(ROOT, "dist");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const destroy = args.includes("--destroy");

function log(msg) {
  process.stdout.write(`[deploy] ${msg}\n`);
}

function sh(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: "pipe", encoding: "utf8", ...opts });
}

function aws(argv) {
  const out = sh("aws", [...argv, "--output", "json"]);
  return out.trim() ? JSON.parse(out) : null;
}

function requireAwsCli() {
  try {
    const id = aws(["sts", "get-caller-identity"]);
    log(`AWS account ${id.Account}, identity ${id.Arn}`);
  } catch {
    console.error(
      "[deploy] `aws sts get-caller-identity` failed — the AWS CLI is not configured in " +
        "this shell. Run `aws configure` (or set AWS_PROFILE) and try again.",
    );
    process.exit(1);
  }
}

function build() {
  log("building (npm run data if the data pack is missing, then npm run build)…");
  if (!existsSync(path.join(ROOT, "public/data/atlas.bin"))) {
    log("public/data/atlas.bin is missing — running `npm run data` first (one-time, ~143 MB download)");
    sh("npm", ["run", "data"], { stdio: "inherit" });
  }
  sh("npm", ["run", "build"], { stdio: "inherit" });

  // Build smoke gate — a green `vite build` can still ship a dead shell.
  const indexHtml = path.join(DIST, "index.html");
  if (!existsSync(indexHtml)) throw new Error("dist/index.html missing after build");
  const html = readFileSync(indexHtml, "utf8");
  if (!html.includes('<div id="root">')) throw new Error('dist/index.html has no <div id="root">');
  if (!/\/assets\/.+\.js/.test(html)) throw new Error("dist/index.html has no /assets/*.js bundle reference");
  if (!existsSync(path.join(DIST, "data/atlas.bin"))) throw new Error("dist/data/atlas.bin missing (public/ was not copied into the build)");
  log("build smoke gate passed: index.html mounts #root, a hashed JS bundle exists, the data pack is present");
  log("(this local dist/ is a smoke test only — Amplify rebuilds from the pushed source, it does not use this folder)");
}

function findApp() {
  const { apps } = aws(["amplify", "list-apps"]);
  return apps.find((a) => a.name === APP_NAME) ?? null;
}

function latestJobId(appId) {
  const { jobSummaries } = aws(["amplify", "list-jobs", "--app-id", appId, "--branch-name", BRANCH, "--max-results", "1"]);
  return jobSummaries[0]?.jobId ?? null;
}

function ensureCleanTree() {
  const status = sh("git", ["status", "--porcelain"]);
  if (status.trim()) {
    throw new Error(
      "working tree has uncommitted changes — deploy pushes to origin/main, it does not " +
        "commit for you. Commit your changes first, then run `npm run deploy` again.",
    );
  }
}

function push() {
  log(`pushing ${BRANCH} to origin (this is what actually triggers Amplify's rebuild)`);
  const out = sh("git", ["push", "origin", BRANCH]);
  return !/Everything up-to-date/.test(out);
}

async function watchNewJob(appId, beforeJobId, pushed) {
  if (!pushed) {
    log("nothing new to push — origin/main already matches. Reporting the most recent job instead of waiting for a new one.");
    return;
  }
  log("waiting for the push to reach GitHub and trigger an Amplify build…");
  let jobId = beforeJobId;
  for (let i = 0; i < 30 && jobId === beforeJobId; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    jobId = latestJobId(appId);
  }
  if (jobId === beforeJobId) {
    log("no new job appeared after ~2 minutes — check the Amplify console; the webhook may be delayed.");
    return;
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const { job } = aws(["amplify", "get-job", "--app-id", appId, "--branch-name", BRANCH, "--job-id", jobId]);
    const status = job.summary.status;
    log(`job ${jobId}: ${status}`);
    if (status === "SUCCEED") return;
    if (["FAILED", "CANCELLED"].includes(status)) throw new Error(`Amplify job ${jobId} ended with status ${status}`);
  }
}

function printReport(app) {
  const url = `https://${BRANCH}.${app.defaultDomain}`;
  log("");
  log("──────────────────────────────────────────────");
  log(`  live: ${url}`);
  log(`  app:  https://console.aws.amazon.com/amplify/home#/${app.appId}`);
  log("──────────────────────────────────────────────");
}

async function main() {
  if (destroy) {
    requireAwsCli();
    const app = findApp();
    if (!app) return log(`no Amplify app named "${APP_NAME}" exists — nothing to destroy`);
    log(`this deletes the Amplify app "${APP_NAME}" (${app.appId}) and its public URL, permanently.`);
    log(`run: aws amplify delete-app --app-id ${app.appId}`);
    log("(not run automatically — copy/paste the command above once you're sure)");
    return;
  }

  build();
  if (dryRun) {
    log("--dry-run: built and smoke-gated only, no git push, no AWS calls");
    return;
  }

  ensureCleanTree();
  requireAwsCli();
  const app = findApp();
  if (!app) {
    throw new Error(
      `no Amplify app named "${APP_NAME}" exists. First-time setup is a one-time manual step: ` +
        "in the Amplify console, New app → Host web app → connect the github.com/joveuh/human-atlas " +
        "repo → branch `main`. After that, `npm run deploy` handles every deploy from here.",
    );
  }
  const before = latestJobId(app.appId);
  const pushed = push();
  await watchNewJob(app.appId, before, pushed);
  printReport(app);
}

main().catch((err) => {
  console.error(`[deploy] failed: ${err.message}`);
  process.exit(1);
});
