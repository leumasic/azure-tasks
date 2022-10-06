import tl from "azure-pipelines-task-lib/task";
import { Octokit } from "@octokit/rest";
import fs from "fs-extra";
import * as gitUtils from "./gitUtils";
import { runPublish, runVersion } from "./run";
import readChangesetState from "./readChangesetState";

async function run() {
  try {
    const connection = tl.getInput("githubConnection", true);
    const githubToken = tl.getEndpointAuthorizationParameter(
      connection!,
      "AccessToken",
      false
    );

    if (!githubToken) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Github token undefined` +
          "This is probably a bug in the task, please open an issue"
      );
      return;
    }

    const octokit = new Octokit({
      auth: githubToken,
    });

    const inputCwd = tl.getInput("cwd");
    if (inputCwd) {
      console.log("changing directory to the one given as the input");
      process.chdir(inputCwd);
    }

    const setupGitUser = tl.getBoolInput("setupGitUser");

    if (setupGitUser) {
      console.log("setting git user");
      await gitUtils.setupUser();
    }

    console.log("setting GitHub credentials");
    await fs.writeFile(
      `${process.env.HOME}/.netrc`,
      `machine github.com\nlogin github-actions[bot]\npassword ${githubToken}`
    );

    const { changesets } = await readChangesetState();
    const hasChangesets = changesets.length !== 0;
    const hasNonEmptyChangesets = changesets.some(
      (changeset) => changeset.releases.length > 0
    );

    const publishScript = tl.getInput("publish");
    const hasPublishScript = !!publishScript;

    tl.setVariable("published", "false");
    tl.setVariable("publishedPackages", "[]");
    tl.setVariable("hasChangesets", String(hasChangesets));

    switch (true) {
      case !hasChangesets && !hasPublishScript:
        console.log("No changesets found");
        return;

      case !hasChangesets && hasPublishScript: {
        console.log(
          "No changesets found, attempting to publish any unpublished packages"
        );

        // User is expected to authenticate their npm registry prior to running
        // this task

        const result = await runPublish({
          script: publishScript!,
          octokit,
          createGithubReleases: tl.getBoolInput("createGithubReleases"),
        });

        if (result.published) {
          tl.setVariable("published", "true");
          tl.setVariable(
            "publishedPackages",
            JSON.stringify(result.publishedPackages)
          );
        }

        return;
      }

      case hasChangesets && !hasNonEmptyChangesets:
        console.log("All changesets are empty; not creating PR");
        return;

      case hasChangesets: {
        const prTitle = tl.getInput("title");
        const commitMessage = tl.getInput("commit");

        if (!prTitle || !commitMessage)
          throw new Error(
            `title and commit task variables not defined.` +
              "This is probably a bug in the task, please open an issue"
          );

        const { pullRequestNumber } = await runVersion({
          script: tl.getInput("version"),
          octokit,
          prTitle,
          commitMessage,
          hasPublishScript,
        });

        tl.setVariable("pullRequestNumber", String(pullRequestNumber));

        return;
      }
    }
  } catch (err) {
    console.error(err);
    tl.setResult(tl.TaskResult.Failed, (err as any).message);
  }
}

run();
