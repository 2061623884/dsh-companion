const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
// Shared synthetic desktop profile; the observer checks that borrowing leaves it unchanged.
exports.prepareWorkBuddyProfile = async home => {
  const directory = path.join(home, 'profiles/desktop/.dsh-workbuddy-connect'); await fs.mkdir(directory, { recursive: true });
  const auth = path.join(directory, '.workbuddy-auth.json');
  await fs.writeFile(auth, JSON.stringify({ region: 'cn', auth: { accessToken: 'fixture-native-access', refreshToken: 'fixture-never-refresh',
    expiresAt: Date.now() + 3600000, domain: 'copilot.tencent.com' } }));
  await fs.writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), JSON.stringify([
    { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'workbuddy', model: 'fixture-workbuddy' } }
  ]));
  const hash = async () => createHash('sha256').update(await fs.readFile(auth)).digest('hex'), before = await hash();
  return { unchanged: async () => before === await hash() };
};
