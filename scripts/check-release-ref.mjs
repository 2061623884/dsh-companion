import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const requiredJobs = ['Privacy and workflows', 'Quick checks', 'Windows runtime', 'Native VS Code'];

/** GitHub is an external boundary: require a completed, successful main CI run.
 * @param {string} sha @param {string} repository @param {string} token
 * @param {typeof fetch} [request]
 */
export async function checkReleaseCI(sha, repository, token, request = fetch) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('RELEASE_SHA_INVALID');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('RELEASE_REPOSITORY_INVALID');
  /** @param {string} endpoint */
  const get = async endpoint => {
    const response = await request('https://api.github.com/repos/' + repository + endpoint, {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new Error('RELEASE_CI_HTTP_' + response.status);
    return response.json();
  };
  const runs = await get('/actions/workflows/ci.yml/runs?head_sha=' + sha + '&branch=main&per_page=100');
  const run = runs.workflow_runs.find((/** @type {{head_sha: string, head_branch: string, event: string, status: string, conclusion: string}} */ run) =>
    run.head_sha === sha && run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event) &&
    run.status === 'completed' && run.conclusion === 'success');
  if (!run) throw new Error('RELEASE_CI_NOT_GREEN');
  const { jobs, total_count: count } = await get('/actions/runs/' + run.id + '/jobs?filter=latest&per_page=100');
  if (count !== jobs.length || !requiredJobs.every(name => jobs.filter((/** @type {{name: string, status: string, conclusion: string}} */ job) =>
    job.name === name && job.status === 'completed' && job.conclusion === 'success').length === 1)) throw new Error('RELEASE_CI_JOBS_INCOMPLETE');
  return run.id;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sha = process.env.RELEASE_SHA || '';
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('RELEASE_REQUIRES_MAIN_AND_FULL_SHA');
  const receipt = process.env.RELEASE_CI_RECEIPT;
  if (!receipt || !path.isAbsolute(receipt)) throw new Error('RELEASE_CI_RECEIPT_PATH_INVALID');
  execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { stdio: 'pipe' });
  const run = await checkReleaseCI(sha, process.env.GITHUB_REPOSITORY || '', process.env.GH_TOKEN || '');
  await mkdir(path.dirname(receipt), { recursive: true });
  await writeFile(receipt, JSON.stringify({ commit: sha, repository: process.env.GITHUB_REPOSITORY, runId: run }) + '\n');
  console.log('Release candidate CI verified: run=' + run);
}
