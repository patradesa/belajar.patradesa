import type { Deps, Env } from './env';
import { createApp } from './app';
import { DisabledAiProvider } from './ai/provider';
import { verifyGoogleIdToken } from './routes/auth';
import { runMaintenance } from './scheduled';

const deps: Deps = {
  now: () => Date.now(),
  ai: new DisabledAiProvider(),
  fetch: (input, init) => fetch(input, init),
  verifyGoogleIdToken,
};

const app = createApp(deps);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMaintenance(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
