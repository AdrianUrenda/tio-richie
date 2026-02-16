import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { JwtAccessPayload } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    user: JwtAccessPayload;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Token de acceso requerido" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(
      token,
      config.jwt.accessSecret,
    ) as JwtAccessPayload;
    request.user = payload;
  } catch {
    reply.code(401).send({ error: "Token inválido o expirado" });
  }
}
