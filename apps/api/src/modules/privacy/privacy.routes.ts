import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  AdminPrivacyRequestListResponseSchema,
  ApiErrorSchema,
  PrivacyExportSchema,
  PrivacyRequestIdParamsSchema,
  PrivacyRequestListQuerySchema,
  PrivacyRequestListResponseSchema,
  PrivacyRequestSchema,
  ProcessPrivacyRequestBodySchema,
} from "@repo/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AuthError,
  AuthorizationError,
  requireAccessPrincipal,
  requireCsrfToken,
  type AuthService,
} from "../auth/auth.public.js";
import { PrivacyError, type PrivacyService } from "./privacy.service.js";

export interface PrivacyRoutesOptions {
  readonly service: PrivacyService | undefined;
  readonly authService: AuthService | undefined;
}

function errorBody(request: FastifyRequest, code: string, message: string) {
  return { error: { code, message, requestId: request.id } };
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof PrivacyError || error instanceof AuthError || error instanceof AuthorizationError) {
    return reply.code(error.statusCode).send(errorBody(request, error.code, error.message));
  }
  request.log.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Privacy request failed");
  return reply.code(500).send(errorBody(request, "INTERNAL_ERROR", "Privacy request failed."));
}

function privacyServiceOrThrow(service: PrivacyService | undefined): PrivacyService {
  if (!service) throw new PrivacyError("PRIVACY_SERVICE_UNAVAILABLE", "Privacy storage is unavailable.", 503);
  return service;
}

function authServiceOrThrow(service: AuthService | undefined): AuthService {
  if (!service) throw new AuthError("AUTH_UNAVAILABLE", "Authentication storage is unavailable.", 503);
  return service;
}

const commonErrors = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  503: ApiErrorSchema,
};

export function registerPrivacyRoutes(app: FastifyInstance, options: PrivacyRoutesOptions): void {
  const server = app.withTypeProvider<TypeBoxTypeProvider>();

  server.get("/api/v1/privacy/export", {
    schema: {
      tags: ["privacy"],
      operationId: "exportMyPersonalData",
      response: { 200: PrivacyExportSchema, ...commonErrors },
    },
  }, async (request, reply) => {
    try {
      const principal = await requireAccessPrincipal(request, authServiceOrThrow(options.authService));
      reply.header("cache-control", "no-store");
      return reply.send(await privacyServiceOrThrow(options.service).exportData(principal));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  server.post("/api/v1/privacy/erasure-requests", {
    config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
    schema: {
      tags: ["privacy"],
      operationId: "requestAccountErasure",
      response: { 202: PrivacyRequestSchema, ...commonErrors },
    },
  }, async (request, reply) => {
    try {
      requireCsrfToken(request);
      const principal = await requireAccessPrincipal(request, authServiceOrThrow(options.authService));
      return reply.code(202).send(await privacyServiceOrThrow(options.service).requestErasure(principal));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  server.get("/api/v1/privacy/erasure-requests", {
    schema: {
      tags: ["privacy"],
      operationId: "listMyErasureRequests",
      querystring: PrivacyRequestListQuerySchema,
      response: { 200: PrivacyRequestListResponseSchema, ...commonErrors },
    },
  }, async (request, reply) => {
    try {
      const principal = await requireAccessPrincipal(request, authServiceOrThrow(options.authService));
      return reply.send(await privacyServiceOrThrow(options.service).listMyRequests(principal, request.query));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  server.get("/api/v1/admin/privacy/erasure-requests", {
    schema: {
      tags: ["admin", "privacy"],
      operationId: "listAdminErasureRequests",
      querystring: PrivacyRequestListQuerySchema,
      response: { 200: AdminPrivacyRequestListResponseSchema, ...commonErrors },
    },
  }, async (request, reply) => {
    try {
      const principal = await requireAccessPrincipal(request, authServiceOrThrow(options.authService));
      return reply.send(await privacyServiceOrThrow(options.service).listAdminRequests(principal, request.query));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  server.post("/api/v1/admin/privacy/erasure-requests/:privacyRequestId/process", {
    schema: {
      tags: ["admin", "privacy"],
      operationId: "processAccountErasureRequest",
      params: PrivacyRequestIdParamsSchema,
      body: ProcessPrivacyRequestBodySchema,
      response: { 200: PrivacyRequestSchema, ...commonErrors },
    },
  }, async (request, reply) => {
    try {
      requireCsrfToken(request);
      const principal = await requireAccessPrincipal(request, authServiceOrThrow(options.authService));
      return reply.send(
        await privacyServiceOrThrow(options.service).processRequest(
          principal,
          request.params.privacyRequestId,
          request.body,
        ),
      );
    } catch (error) {
      return sendError(request, reply, error);
    }
  });
}
