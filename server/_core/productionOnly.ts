import type { NextFunction, Request, Response } from "express";
import { appEnvironment } from "./connections";

/** Blocks integration entrypoints unless this process is the production app. */
export function productionOnly(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    if (appEnvironment() === "production") {
      next();
      return;
    }
  } catch {
    // Invalid deployment configuration must not expose integration endpoints.
  }

  res.status(403).json({ error: "Forbidden" });
}
