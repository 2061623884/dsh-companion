import { writeFile } from 'node:fs/promises';
export const name = 'acceptance-delayed-disposal';
export function apply(ctx, config) {
  ctx.effect(() => async () => {
    await writeFile(config.marker, 'saving');
    await new Promise(resolve => setTimeout(resolve, 800));
  });
}
