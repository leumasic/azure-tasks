import * as tl from "azure-pipelines-task-lib/task";
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

        const userNpmrcPath = `${process.env.HOME}/.npmrc`;
        if (fs.existsSync(userNpmrcPath)) {
          console.log("Found existing user .npmrc file");
          const userNpmrcContent: string = await fs.readFile(
            userNpmrcPath,
            "utf8"
          );
          const authLine = userNpmrcContent.split("\n").find((line) => {
            // check based on https://github.com/npm/cli/blob/8f8f71e4dd5ee66b3b17888faad5a7bf6c657eed/test/lib/adduser.js#L103-L105
            return /^\s*\/\/registry\.npmjs\.org\/:[_-]authToken=/i.test(line);
          });

          if (authLine) {
            console.log(
              "Found existing auth token for the npm registry in the user .npmrc file"
            );
          } else {
            console.log(
              "Didn't find existing auth token for the npm registry in the user .npmrc file, creating one"
            );
            fs.appendFileSync(
              userNpmrcPath,
              `\n//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`
            );
          }
        } else {
          console.log("No user .npmrc file found, creating one");
          fs.writeFileSync(
            userNpmrcPath,
            `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`
          );
        }

        const result = await runPublish({
          script: publishScript!,
          githubToken,
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
          githubToken,
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
