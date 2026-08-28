/*
 * Vercel serverless entry point.
 *
 * Vercel invokes this handler per request; the Express app is imported rather
 * than listened on, and vercel.json routes every path here so the SPA's
 * client-side routes resolve to the app shell.
 */
import app from '../src/app.js';

export default app;
