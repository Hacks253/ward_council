import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

createApp({ serveStatic: true }).listen(PORT, () => {
  console.log(`Ward Council listening on http://localhost:${PORT}`);
});
