import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The pinned provider owns its independent login. Only this adapter knows about
// borrowing desktop access tokens; borrowed refresh tokens never leave it.
export function withDesktopWorkBuddyAuth(local, variant, parseCredential, realmOf) {
  const source = process.env.DSH_COMPANION_DESKTOP_HOME;
  if (!source) return local;
  const filename = path.join(source, 'profiles/desktop/.dsh-workbuddy-connect', variant.ownFilename);
  const failure = (code, message) => Object.assign(new Error(message), { code });
  async function desktop() {
    let text;
    try { text = await readFile(filename, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      throw failure('DSH_WORKBUDDY_DESKTOP_AUTH_READ', '无法读取桌面端 WorkBuddy 授权，请检查文件访问权限。');
    }
    const credential = parseCredential(text);
    if (!credential || realmOf(credential) !== variant.region) {
      throw failure('DSH_WORKBUDDY_DESKTOP_AUTH_INVALID', '桌面端 WorkBuddy 授权格式或区域不匹配。');
    }
    return { ...credential, refreshToken: '' };
  }
  async function selected() {
    const credential = await local.current();
    return credential ? { credential, borrowed: false } : { credential: await desktop(), borrowed: true };
  }
  return {
    ownAuthPath: () => local.ownAuthPath(),
    current: async () => (await selected()).credential,
    async resolve() {
      const { credential, borrowed } = await selected();
      if (!borrowed || !credential) return local.resolve();
      if (credential.expiresAtMs <= Date.now()) {
        throw failure('DSH_WORKBUDDY_DESKTOP_AUTH_EXPIRED', '桌面端 WorkBuddy 访问令牌已过期或缺少有效期；请让桌面端更新授权后重试。插件不会刷新桌面授权。');
      }
      return credential;
    },
    async status() {
      const { credential, borrowed } = await selected();
      if (!borrowed || !credential) return local.status();
      return { state: 'signed-in', expiresAtMs: credential.expiresAtMs,
        nickname: credential.nickname, domain: credential.domain, region: variant.region };
    },
    save: credential => local.save(credential),
    importDocument: text => local.importDocument(text),
    async logout() {
      if (!await local.current() && await desktop()) {
        throw failure('DSH_WORKBUDDY_DESKTOP_AUTH_READ_ONLY', '当前只读使用桌面端 WorkBuddy 登录状态；请在桌面端管理此登录。插件不会退出或删除桌面授权。');
      }
      return local.logout();
    },
  };
}
