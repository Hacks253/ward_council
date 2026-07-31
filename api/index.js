/* Vercel serverless entry — all /api/* routes are rewritten here (vercel.json).
   Static files in public/ are served by Vercel's CDN directly. */
import { createApp } from '../server/app.js';

export default createApp();
