import type { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import nodeFetch from "node-fetch";

const githubBaseUrl = "https://api.github.com";

export function patchOctokit(octokit: Octokit): Octokit {
  octokit.search.issuesAndPullRequests = async (
    params: RestEndpointMethodTypes["search"]["issuesAndPullRequests"]["parameters"]
  ) => {
    const { token } = (await octokit.auth()) as {
      type: string;
      token: string;
      tokenType: string;
    };

    const response = await nodeFetch(
      `${githubBaseUrl}/search/issues?q=${params.q}`,
      {
        method: "GET",
        ...(token && {
          headers: {
            Authorization: "token " + token,
          },
        }),
      }
    );

    const data = await response.json();

    return {
      data,
      headers: response.headers,
      status: response.status,
      url: response.url,
    };
  };

  octokit.repos.createRelease = async (
    params: RestEndpointMethodTypes["repos"]["createRelease"]["parameters"]
  ) => {
    const { token } = (await octokit.auth()) as {
      type: string;
      token: string;
      tokenType: string;
    };

    const { owner, repo, name, tag_name, body, prerelease } = params;

    const response = await nodeFetch(
      `${githubBaseUrl}/repos/${owner}/${repo}/releases`,
      {
        method: "POST",
        body: JSON.stringify({
          tag_name,
          name,
          body,
          prerelease,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(token && {
            Authorization: "token " + token,
          })
        }
      }
    );

    const data = await response.json();

    return {
      data,
      headers: response.headers,
      status: response.status,
      url: response.url,
    };
  };

  octokit.pulls.create = async (
    params: RestEndpointMethodTypes["pulls"]["create"]["parameters"]
  ) => {
    const { token } = (await octokit.auth()) as {
      type: string;
      token: string;
      tokenType: string;
    };

    const { owner, repo, base, head, body, title } = params;

    console.log(`${githubBaseUrl}/repos/${owner}/${repo}/pulls`)

    const response = await nodeFetch(
      `${githubBaseUrl}/repos/${owner}/${repo}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          base,
          head,
          title,
          body,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(token && {
            Authorization: "token " + token,
          })
        }
      }
    );

    const data = await response.json();

    return {
      data,
      headers: response.headers,
      status: response.status,
      url: response.url,
    };
  };

  octokit.pulls.update = async (
    params: RestEndpointMethodTypes["pulls"]["update"]["parameters"]
  ) => {
    const { token } = (await octokit.auth()) as {
      type: string;
      token: string;
      tokenType: string;
    };

    const { owner, repo, pull_number, body, title } = params;

    const response = await nodeFetch(
      `${githubBaseUrl}/repos/${owner}/${repo}/pulls/${pull_number}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          pull_number,
          title,
          body,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(token && {
            Authorization: "token " + token,
          })
        }
      }
    );

    const data = await response.json();

    return {
      data,
      headers: response.headers,
      status: response.status,
      url: response.url,
    };
  };

  return octokit;
}
