import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  v2AuthRouter,
  v2DirectoryRouter,
  v2ContactsRouter,
  v2MessagesRouter,
  v2AttachmentsRouter,
  v2CallsRouter,
  v2StatsRouter,
  v2OtpAuthRouter,
} from "./v2routers";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // v2.0 phone-app namespace
  identity: v2AuthRouter,
  otpAuth: v2OtpAuthRouter,
  directory: v2DirectoryRouter,
  contacts: v2ContactsRouter,
  messages: v2MessagesRouter,
  attachments: v2AttachmentsRouter,
  calls: v2CallsRouter,
  stats: v2StatsRouter,
});

export type AppRouter = typeof appRouter;
