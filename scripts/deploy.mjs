#!/usr/bin/env node
// Canonical one-shot deploy for human-atlas.
//
// This app is 100% static (Vite build + a generated data pack under public/data/).
// There is no Lambda, no API Gateway, no database — so unlike the fleet's SAM+Amplify
// clones under demos/, there is no CloudFormation/SAM stack here. The whole deploy is
// one AWS Amplify Hosting app, driven directly by this script via "manual" deployment
// (build here, zip it, hand the zip to Amplify) — no GitHub connection required.
//
// Usage:
//   npm run deploy            build + deploy to Amplify Hosting, print the live URL
//   npm run deploy -- --dry-run   build + zip only, skip every AWS call
//   node scripts/deploy.mjs --destroy   delete the Amplify app (asks to confirm the name)
//
// Requires: the AWS CLI, already configured (`aws sts get-caller-identity` must work).
// Region/profile come from your normal AWS CLI configuration (AWS_REGION / AWS_PROFILE
// / `aws configure`) — this script never hardcodes one.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_NAME = "human-atlas"; // this project's own name — not an invented external identifier
const BRANCH = "main";
const DIST = path.join(ROOT, "dist");
const ZIP = path.join(ROOT, ".deploy", "dist.zip");

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
  } catch (e) {
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
}

function zipDist() {
  mkdirSync(path.dirname(ZIP), { recursive: true });
  rmSync(ZIP, { force: true });
  log(`zipping dist/ → ${path.relative(ROOT, ZIP)}`);
  sh("zip", ["-r", "-X", "-q", ZIP, "."], { cwd: DIST });
  const kb = Math.round(readFileSync(ZIP).length / 1024);
  log(`zip is ${kb} KB`);
}

function findApp() {
  const { apps } = aws(["amplify", "list-apps"]);
  return apps.find((a) => a.name === APP_NAME) ?? null;
}

function ensureApp() {
  let app = findApp();
  if (app) {
    log(`found existing Amplify app "${APP_NAME}" (${app.appId})`);
    return app;
  }
  log(`no Amplify app named "${APP_NAME}" yet — creating one (manual deploy, no repository)`);
  const created = aws(["amplify", "create-app", "--name", APP_NAME, "--platform", "WEB"]);
  return created.app;
}

function ensureBranch(appId) {
  let branches;
  try {
    branches = aws(["amplify", "list-branches", "--app-id", appId]).branches;
  } catch {
    branches = [];
  }
  if (branches.some((b) => b.branchName === BRANCH)) {
    log(`branch "${BRANCH}" already exists`);
    return;
  }
  log(`creating branch "${BRANCH}"`);
  aws(["amplify", "create-branch", "--app-id", appId, "--branch-name", BRANCH, "--stage", "PRODUCTION"]);
}

async function deploy(appId) {
  log("creating a manual deployment job");
  const { jobId, zipUploadUrl } = aws([
    "amplify", "create-deployment", "--app-id", appId, "--branch-name", BRANCH,
  ]);
  log(`uploading ${path.relative(ROOT, ZIP)}`);
  const body = await readFile(ZIP);
  const res = await fetch(zipUploadUrl, { method: "PUT", body });
  if (!res.ok) throw new Error(`zip upload failed: HTTP ${res.status}`);
  log("upload complete — starting the deployment");
  aws(["amplify", "start-deployment", "--app-id", appId, "--branch-name", BRANCH, "--job-id", jobId]);

  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const { job } = aws(["amplify", "get-job", "--app-id", appId, "--branch-name", BRANCH, "--job-id", jobId]);
    const status = job.summary.status;
    log(`job ${jobId}: ${status}`);
    if (status === "SUCCEED") return;
    if (["FAILED", "CANCELLED"].includes(status)) throw new Error(`Amplify job ended with status ${status}`);
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
  zipDist();
  if (dryRun) {
    log("--dry-run: built and zipped only, no AWS calls made");
    return;
  }

  requireAwsCli();
  const app = ensureApp();
  ensureBranch(app.appId);
  await deploy(app.appId);
  printReport(app);
}

main().catch((err) => {
  console.error(`[deploy] failed: ${err.message}`);
  process.exit(1);
});
