import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger, accessLogger } from "../lib/logger";
import { recordRequest } from "../lib/metrics";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // CORS preflight (OPTIONS) requests are protocol chatter answered by the cors
  // middleware, not real API accesses. They carry no business signal and, with a
  // cross-origin client polling authenticated endpoints, otherwise flood the
  // access log and metrics. Skip them entirely.
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  req.requestId = randomUUID();
  req.startTime = Date.now();

  res.setHeader("X-Request-Id", req.requestId);

  // Intercept res.json to capture error_code before the response is sent
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (body && typeof body === "object" && (body as Record<string, unknown>).error) {
      const err = (body as Record<string, unknown>).error;
      if (err && typeof err === "object" && (err as Record<string, unknown>).code) {
        res.locals.errorCode = (err as Record<string, unknown>).code;
      }
    }
    return originalJson(body);
  };

  res.on("finish", () => {
    const duration_ms = Date.now() - req.startTime;

    // Feed the in-memory metrics collector for the admin live-monitoring view.
    recordRequest(req.method, req.path, res.statusCode, duration_ms);

    const logData: Record<string, unknown> = {
      request_id: req.requestId,
      endpoint: `${req.method} ${req.path}`,
      duration_ms,
      status: res.statusCode,
    };

    if (res.locals.errorCode) {
      logData.error_code = res.locals.errorCode;
    }

    // Access/audit trail: every request lands in the access channel. Routine
    // client conditions (401 unauthenticated auth checks, 404 not-found probes
    // such as the Replit dev banner) are expected and recorded at info level so
    // they do not masquerade as actionable errors and flood the warn channel.
    const isRoutineClientStatus = res.statusCode === 401 || res.statusCode === 404;
    if (res.statusCode >= 400 && !isRoutineClientStatus) {
      accessLogger.warn(logData, "Request completed with error");
    } else {
      accessLogger.info(logData, "Request completed");
    }

    // Server-side failures are additionally surfaced to the error channel so
    // critical incidents are durably captured alongside other errors.
    if (res.statusCode >= 500) {
      logger.error(logData, "Request failed with server error");
    }
  });

  next();
}
