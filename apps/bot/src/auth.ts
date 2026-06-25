import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env.js";

export const NORMAL_SESSION_DAYS = 1;
export const TRUSTED_DEVICE_SESSION_DAYS = 90;

export function issueAdminToken(rememberDevice = true) {
  const expiresInDays = rememberDevice ? TRUSTED_DEVICE_SESSION_DAYS : NORMAL_SESSION_DAYS;
  return jwt.sign({ role: "admin" }, env.JWT_SECRET, { expiresIn: `${expiresInDays}d` });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

  try {
    jwt.verify(token, env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
