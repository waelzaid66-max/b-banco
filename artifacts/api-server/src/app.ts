import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { requestLogger } from "./middlewares/requestLogger";
import { isAllowedOrigin, shouldRejectUnsafeOrigin } from "./lib/cors";
import { errorResponse } from "./validators/schemas";
import { accessLogger } from "./lib/logger";
import router from "./routes";
import seoRouter from "./seoRoutes";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler";

const app: Express = express();

// Trust reverse proxy (Replit / load balancers forward X-Forwarded-For)
app.set("trust proxy", 1);

// Never advertise the framework.
app.disable("x-powered-by");

// Hardened security headers. CSP is locked down to 'self' since this is a JSON
// API; crossOriginResourcePolicy is relaxed to "cross-origin" so the official
// BANCO web/mobile clients (served from different origins) can consume it.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Pino structured logging (access channel). autoLogging is OFF: pino-http is
// kept only to attach `req.log`/`req.id` (used by controllers). The single
// per-request access line is emitted by `requestLogger` below, so leaving
// autoLogging on would log every request twice.
app.use(
  pinoHttp({
    logger: accessLogger,
    autoLogging: false,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy MUST be before body parsers and compression (streams raw bytes).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Request-ID + duration access logging. Mounted here — after the Clerk proxy but
// BEFORE compression, CORS, the CSRF-origin guard, body parsers, and Clerk auth —
// so its res.on("finish") fires for EVERY request, including CSRF 403s,
// body-size / malformed-JSON rejections, and auth failures that short-circuit
// before the router. pino-http autoLogging is off, so this is the single access
// line per request. (OPTIONS preflights are skipped inside requestLogger.)
app.use(requestLogger);

// Compress responses (gzip/brotli) — keeps the /feed payload small over the wire.
app.use(compression());

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
  }),
);

// CSRF defense-in-depth (see lib/cors.ts). CORS blocks credentialed cross-origin
// reads and preflighted writes, but a cross-origin "simple" request (e.g. a POST
// with no JSON body / no custom headers) is NOT preflighted, so the browser still
// sends it with the victim's cookies and the side effect runs. Reject unsafe
// methods whose Origin is present but neither allowlisted nor same-origin. Runs
// before the body parsers so rejected requests never get parsed. Native mobile
// (bearer token, no Origin) and server-to-server callers pass untouched.
app.use((req, res, next) => {
  if (shouldRejectUnsafeOrigin(req.method, req.get("origin"), req.get("host"))) {
    res.status(403).json(errorResponse("FORBIDDEN", "Cross-origin request rejected"));
    return;
  }
  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Resolve publishable key from request host for multi-domain support
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Public, crawler-facing HTML/XML routes (/l/:id, /sitemap.xml, /robots.txt).
// Mounted BEFORE /api and the 404 handler so these paths resolve to real pages.
app.use(seoRouter);

app.use("/api", router);

// Fallthrough 404 + centralized error envelope (must be last).
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
