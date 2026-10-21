const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), yaml = require('js-yaml');
test('CI remains a read-only check pipeline without publishing, credentials persistence or artifact uploads', async () => {
  const workflow = yaml.load(await fs.readFile('.github/workflows/ci.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions, undefined, 'jobs must not elevate the workflow token');
    for (const step of job.steps) {
      if (step.uses) {
        assert.match(step.uses, /^actions\/(checkout|setup-node)@[a-f0-9]{40}$/);
        if (step.uses.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
      }
      if (step.run) assert.doesNotMatch(step.run, /(?:npm run package|vsce (?:package|publish)|gh release|git push|upload-artifact)/);
    }
  }
});
