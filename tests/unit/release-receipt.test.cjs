const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url'), yaml = require('js-yaml');

test('the real CI gate receipt survives the following clean checkout', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-receipt-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'checkout'), runner = path.join(temporary, 'runner');
  await fs.mkdir(root); await fs.mkdir(runner);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  await fs.writeFile(path.join(root, 'tracked.txt'), 'synthetic');
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/remotes/origin/main', sha]);
  const workflow = yaml.load(await fs.readFile('.github/workflows/release.yml', 'utf8'));
  const steps = workflow.jobs.verify.steps;
  const location = steps.find(step => step.run === 'node scripts/check-release-ref.mjs').env.RELEASE_CI_RECEIPT;
  assert.equal(steps.find(step => step.run === 'npm run prepare:release').env?.RELEASE_CI_RECEIPT, location);
  const receipt = location ? location.replace('${{ runner.temp }}', runner) : path.join(root, '.test-work/release/ci-check.json');
  const mock = path.join(runner, 'github.mjs');
  await fs.writeFile(mock, `globalThis.fetch = async url => Response.json(url.includes('/jobs?') ? {
    total_count: 4, jobs: ['Privacy and workflows','Quick checks','Windows runtime','Native VS Code'].map(name => ({name,status:'completed',conclusion:'success'}))
  } : {workflow_runs:[{id:42,head_sha:process.env.RELEASE_SHA,head_branch:'main',event:'push',status:'completed',conclusion:'success'}]});`);
  execFileSync(process.execPath, ['--import', pathToFileURL(mock).href, path.resolve('scripts/check-release-ref.mjs')], {
    cwd: root, stdio: 'pipe', env: { ...process.env, RELEASE_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'synthetic/project',
      GH_TOKEN: 'synthetic-token', ...(location ? { RELEASE_CI_RECEIPT: receipt } : {}) }
  });
  git(['clean', '-ffdx']); git(['reset', '--hard', 'HEAD']);
  assert.deepEqual(JSON.parse(await fs.readFile(receipt, 'utf8')), { commit: sha, repository: 'synthetic/project', runId: 42 });
});
