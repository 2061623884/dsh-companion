// Private compatibility adapter for the pinned provider's status card. Keep UI
// expressions and locale assumptions here, away from runtime/auth ownership.
/** @param {string} source */
export function adaptWorkBuddyStatusClient(source) {
  let client = source.replaceAll('\r\n', '\n');
  const patches = [
    ['t("accessTokenExpires", { time: formatTime(status.expiresAt) })',
      'status.authSource === "desktop-read-only" ? t(status.authUsable ? "desktopReadOnlyExpires" : "desktopReadOnlyExpired", { time: formatTime(status.expiresAt) }) : t("accessTokenExpires", { time: formatTime(status.expiresAt) })'],
    ['accessTokenExpires: "Access token expires {time} (refresh is automatic)",',
      'accessTokenExpires: "Access token expires {time} (refresh is automatic)",\n\t\t\tdesktopReadOnlyExpires: "Using desktop authorization read-only; expires {time}. Companion does not renew it.",\n\t\t\tdesktopReadOnlyExpired: "Desktop authorization has expired or has no expiry. Companion will use updates from the desktop without renewing it.",'],
    ['accessTokenExpires: "访问令牌 {time} 过期（自动续期）",',
      'accessTokenExpires: "访问令牌 {time} 过期（自动续期）",\n\t\t\tdesktopReadOnlyExpires: "只读使用桌面端授权，{time} 过期；插件不会续期。",\n\t\t\tdesktopReadOnlyExpired: "桌面端授权已过期或缺少有效期；插件会读取桌面端后续更新，不会自行续期。",'],
  ];
  for (const [before, after] of patches) {
    if (client.includes(after)) continue;
    if (client.split(before).length !== 2) throw new Error('Pinned WorkBuddy read-only UI seam changed');
    client = client.replace(before, after);
  }
  return client;
}
