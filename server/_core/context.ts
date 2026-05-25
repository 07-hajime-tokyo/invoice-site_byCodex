import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { ADMIN_EMAILS, COOKIE_NAME } from "@shared/const";
import type { User } from "../../drizzle/schema";
import { getSessionCookieOptions } from "./cookies";
import { EMAIL_AUTH_LOGIN_METHOD, isAllowedLoginEmail } from "./emailAuth";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  const localAuthBypass =
    process.env.LOCAL_AUTH_BYPASS === "true" ||
    (process.env.NODE_ENV === "development" && process.env.LOCAL_AUTH_BYPASS !== "false");

  if (localAuthBypass) {
    const now = new Date();
    return {
      req: opts.req,
      res: opts.res,
      user: {
        id: 0,
        openId: "local-dev",
        name: "Local Developer",
        email: ADMIN_EMAILS[0] ?? "local@example.com",
        loginMethod: "local",
        role: "admin",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
      },
    };
  }

  try {
    user = await sdk.authenticateRequest(opts.req);
    if (
      user &&
      (user.loginMethod !== EMAIL_AUTH_LOGIN_METHOD || !isAllowedLoginEmail(user.email))
    ) {
      opts.res.clearCookie(COOKIE_NAME, {
        ...getSessionCookieOptions(opts.req),
        maxAge: -1,
      });
      user = null;
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
