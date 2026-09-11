/**
 * Zod parsing at the edge. The ZodError is thrown and translated centrally by
 * the error handler, so every validation failure lands on the client as the
 * same `{ error, code, fields }` shape with per-field messages.
 */

import type { Request } from "express";
import type { ZodType, infer as Infer } from "zod";

export function parseBody<T extends ZodType>(schema: T, req: Request): Infer<T> {
  return schema.parse(req.body);
}

export function parseQuery<T extends ZodType>(schema: T, req: Request): Infer<T> {
  return schema.parse(req.query);
}

export function parseParams<T extends ZodType>(schema: T, req: Request): Infer<T> {
  return schema.parse(req.params);
}
